import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeolocationTracker } from '../src/spatial/geolocation-tracker.ts';
import { StrutDB } from '../src/db/strut-db.ts';
import { runIngestionPipeline } from '../src/ingestion/ingestion-pipeline.ts';
import { pointToH3Index } from '../src/spatial/h3.ts';

describe('GeolocationTracker & Real-Time Hexagon Discovery Suite', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_live_geo_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  describe('Accuracy & Jitter Gating', () => {
    it('rejects low-accuracy GPS fixes (> 40m) from unlocking hexagons', async () => {
      const tracker = new GeolocationTracker({
        database: testDb,
        accuracyThresholdMeters: 40,
      });

      // Poor accuracy fix (e.g. 75m indoor cell tower fix)
      const unlocked = await tracker.processFix(55.6761, 12.5683, 75);
      expect(unlocked).toBe(0);

      const allHexes = await testDb.hexStats.toArray();
      expect(allHexes).toHaveLength(0);
    });

    it('accepts high-accuracy GPS fixes (<= 40m) and unlocks hexagons', async () => {
      const onDiscovered = vi.fn();
      const tracker = new GeolocationTracker({
        database: testDb,
        accuracyThresholdMeters: 40,
        onHexDiscovered: onDiscovered,
      });

      const unlocked = await tracker.processFix(55.6761, 12.5683, 8);
      expect(unlocked).toBeGreaterThanOrEqual(1);
      expect(onDiscovered).toHaveBeenCalled();

      const allHexes = await testDb.hexStats.toArray();
      expect(allHexes).toHaveLength(1);
    });
  });

  describe('Real-Time Path Corridor Interpolation', () => {
    it('interpolates intermediate street hexagons as user walks 250m', async () => {
      const tracker = new GeolocationTracker({
        database: testDb,
        enableInterpolation: true,
      });

      const baseTime = Date.parse('2026-08-15T10:00:00.000Z');

      // First fix at City Hall
      await tracker.processFix(55.6761, 12.5683, 10, null, 1.4, baseTime);

      // Second fix 200m away 2 minutes later
      const newHexes = await tracker.processFix(55.6775, 12.5700, 10, null, 1.4, baseTime + 120_000);

      // Connected corridor unlocks multiple intermediate Res 11 hexagons
      expect(newHexes).toBeGreaterThan(2);

      const totalHexCount = await testDb.hexStats.count();
      expect(totalHexCount).toBeGreaterThan(3);
    });
  });

  describe('Zero Double-Counting (Live Tracking + Timeline.json Merge)', () => {
    it('merges live tracking today with subsequent Timeline.json import without duplicate visits', async () => {
      const tracker = new GeolocationTracker({
        database: testDb,
      });

      const fixedTime = Date.parse('2026-08-15T12:00:00.000Z');
      const testLat = 55.6761;
      const testLng = 12.5683;
      const targetHex = pointToH3Index(testLat, testLng);

      // 1. User explores location live today
      await tracker.processFix(testLat, testLng, 10, null, null, fixedTime);

      const statsAfterLive = await testDb.hexStats.get(targetHex);
      expect(statsAfterLive).toBeDefined();
      expect(statsAfterLive?.visitCount).toBe(1);

      // 2. Later, user imports Timeline.json covering the exact same location on the same day
      const timelinePayload = {
        semanticSegments: [
          {
            startTime: '2026-08-15T11:00:00.000Z',
            endTime: '2026-08-15T13:00:00.000Z',
            placeVisit: {
              location: {
                latitudeE7: Math.round(testLat * 1e7),
                longitudeE7: Math.round(testLng * 1e7),
              },
              duration: {
                startTimestamp: '2026-08-15T11:30:00.000Z',
                endTimestamp: '2026-08-15T12:30:00.000Z',
              },
            },
          },
        ],
      };

      const summary = await runIngestionPipeline(
        timelinePayload,
        { filename: 'Timeline_20260815.json' },
        testDb,
      );

      expect(summary.status).toBe('completed');

      // 3. Verify visitCount remains strictly 1 (1 visit per cell per calendar day)
      const statsAfterMerge = await testDb.hexStats.get(targetHex);
      expect(statsAfterMerge?.visitCount).toBe(1);

      const totalUniqueHexes = await testDb.hexStats.count();
      expect(totalUniqueHexes).toBe(1);

      const totalVisits = await testDb.visits.count();
      expect(totalVisits).toBe(1);
    });

    it('merges prior Timeline.json import with subsequent live tracking on the same day without duplicate visits', async () => {
      const fixedTime = Date.parse('2026-08-15T09:00:00.000Z');
      const testLat = 55.6761;
      const testLng = 12.5683;
      const targetHex = pointToH3Index(testLat, testLng);

      // 1. Import Takeout / Timeline data first
      const takeoutPayload = {
        locations: [
          {
            latitudeE7: Math.round(testLat * 1e7),
            longitudeE7: Math.round(testLng * 1e7),
            timestampMs: String(fixedTime),
          },
        ],
      };

      await runIngestionPipeline(
        takeoutPayload,
        { filename: 'morning_history.json' },
        testDb,
      );

      expect(await testDb.hexStats.count()).toBe(1);

      // 2. User walks around same spot in the afternoon with live tracking
      const tracker = new GeolocationTracker({
        database: testDb,
      });

      const newHexes = await tracker.processFix(testLat, testLng, 10, null, null, fixedTime + 4 * 3600 * 1000);
      expect(newHexes).toBe(0); // 0 new hexes, already explored today

      const stats = await testDb.hexStats.get(targetHex);
      expect(stats?.visitCount).toBe(1); // strictly 1 visit for this calendar day

      const totalVisits = await testDb.visits.count();
      expect(totalVisits).toBe(1);
    });
  });
});
