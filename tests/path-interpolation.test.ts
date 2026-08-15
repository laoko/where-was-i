import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  haversineDistanceKm,
  interpolateSegment,
  MAX_INTERPOLATION_DISTANCE_KM,
} from '../src/spatial/path-interpolator.ts';
import { normalizeTimelineSegment } from '../src/validation/schemas.ts';
import { StrutDB } from '../src/db/strut-db.ts';
import { runIngestionPipeline } from '../src/ingestion/ingestion-pipeline.ts';
import type { NormalizedLocationPoint } from '../src/types/domain.ts';

describe('Path Interpolation & Timeline Waypoints Suite', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_interp_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  describe('Haversine & Distance Calculations', () => {
    it('accurately calculates distance between coordinates', () => {
      // Copenhagen City Hall to Central Station (~500m)
      const dist = haversineDistanceKm(55.6761, 12.5683, 55.6728, 12.5644);
      expect(dist).toBeGreaterThan(0.4);
      expect(dist).toBeLessThan(0.6);
    });
  });

  describe('Segment Interpolation Constraints', () => {
    const baseTime = Date.parse('2024-06-01T12:00:00.000Z');

    it('interpolates intermediate points for a realistic pedestrian walk (~200m in 2min)', () => {
      const p1: NormalizedLocationPoint = { lat: 55.6761, lng: 12.5683, timestampMs: baseTime };
      const p2: NormalizedLocationPoint = { lat: 55.6775, lng: 12.5700, timestampMs: baseTime + 120_000 };

      const intermediates = interpolateSegment(p1, p2);
      expect(intermediates.length).toBeGreaterThan(3);

      // Verify intermediate coordinates and timestamps advance monotonically
      for (let i = 0; i < intermediates.length; i++) {
        const pt = intermediates[i];
        expect(pt).toBeDefined();
        expect(pt?.timestampMs).toBeGreaterThan(p1.timestampMs);
        expect(pt?.timestampMs).toBeLessThan(p2.timestampMs);
      }
    });

    it('rejects interpolation when distance exceeds 1.0 km', () => {
      const p1: NormalizedLocationPoint = { lat: 55.6761, lng: 12.5683, timestampMs: baseTime };
      // ~2.5km away
      const p2: NormalizedLocationPoint = { lat: 55.6980, lng: 12.5700, timestampMs: baseTime + 600_000 };

      const dist = haversineDistanceKm(p1.lat, p1.lng, p2.lat, p2.lng);
      expect(dist).toBeGreaterThan(MAX_INTERPOLATION_DISTANCE_KM);

      const intermediates = interpolateSegment(p1, p2);
      expect(intermediates).toHaveLength(0);
    });

    it('rejects interpolation when implied speed exceeds 300 km/h (e.g. plane / GPS jump)', () => {
      const p1: NormalizedLocationPoint = { lat: 55.6761, lng: 12.5683, timestampMs: baseTime };
      // 800m away in 2 seconds = ~1,440 km/h
      const p2: NormalizedLocationPoint = { lat: 55.6830, lng: 12.5700, timestampMs: baseTime + 2_000 };

      const intermediates = interpolateSegment(p1, p2);
      expect(intermediates).toHaveLength(0);
    });

    it('rejects interpolation when time gap exceeds 15 minutes', () => {
      const p1: NormalizedLocationPoint = { lat: 55.6761, lng: 12.5683, timestampMs: baseTime };
      // 200m away, but 30 minutes later (separate stationary sessions)
      const p2: NormalizedLocationPoint = { lat: 55.6775, lng: 12.5700, timestampMs: baseTime + 30 * 60 * 1000 };

      const intermediates = interpolateSegment(p1, p2);
      expect(intermediates).toHaveLength(0);
    });
  });

  describe('Modern Timeline Polyline Extraction', () => {
    it('extracts simplifiedRawPath points and waypointPath from activitySegment', () => {
      const mockSegment = {
        startTime: '2024-06-01T10:00:00.000Z',
        endTime: '2024-06-01T10:30:00.000Z',
        activitySegment: {
          startLocation: { latitudeE7: 556761000, longitudeE7: 125683000 },
          endLocation: { latitudeE7: 556800000, longitudeE7: 125720000 },
          simplifiedRawPath: {
            points: [
              { latE7: 556770000, lngE7: 125690000, timestampMs: '1717236300000' },
              { latE7: 556785000, lngE7: 125705000, timestampMs: '1717236600000' },
            ],
          },
          waypointPath: {
            waypoints: [{ latLng: '55.6790, 12.5710' }],
          },
          transitPath: {
            transitStops: [{ latitude: 55.6795, longitude: 12.5715 }],
          },
        },
      };

      const extracted = normalizeTimelineSegment(mockSegment);
      // startLocation (1) + simplifiedRawPath (2) + waypointPath (1) + transitPath (1) + endLocation (1) = 6
      expect(extracted.length).toBeGreaterThanOrEqual(5);

      for (const pt of extracted) {
        expect(pt.lat).toBeCloseTo(55.67, 1);
        expect(pt.lng).toBeCloseTo(12.57, 1);
      }
    });
  });

  describe('End-to-End Ingestion with Continuous Hex Discovery', () => {
    it('unlocks a continuous chain of hexagons between two 300m walking fixes', async () => {
      const p1 = {
        latitudeE7: 556761000,
        longitudeE7: 125683000,
        timestampMs: '1717236000000',
      };
      const p2 = {
        latitudeE7: 556785000,
        longitudeE7: 125705000,
        timestampMs: '1717236180000', // 3 minutes later
      };

      const takeoutPayload = {
        locations: [p1, p2],
      };

      const summary = await runIngestionPipeline(
        takeoutPayload,
        { filename: 'walk_copenhagen.json' },
        testDb,
      );

      expect(summary.status).toBe('completed');
      // With interpolation across 300m at Res 11 (25m step), unlocks multiple intermediate hexes
      expect(summary.newHexCount).toBeGreaterThan(4);

      const allHexes = await testDb.hexStats.toArray();
      expect(allHexes.length).toBe(summary.newHexCount);
    });
  });
});
