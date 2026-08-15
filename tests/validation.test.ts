import { describe, it, expect } from 'vitest';
import {
  isValidCoordinate,
  isValidLatitude,
  isValidLongitude,
  parseGeoString,
  parseTimestamp,
  formatCalendarDate,
  detectFormat,
  normalizeTakeoutPoint,
  normalizeTimelineSegment,
} from '../src/validation/schemas.ts';
import {
  validTakeoutPayload,
  takeoutWithMalformedPoints,
} from './fixtures/takeout.ts';
import {
  validTimelinePayload,
} from './fixtures/timeline.ts';

describe('Validation & Normalization', () => {
  describe('Coordinate Validation', () => {
    it('correctly validates latitude boundaries', () => {
      expect(isValidLatitude(0)).toBe(true);
      expect(isValidLatitude(90)).toBe(true);
      expect(isValidLatitude(-90)).toBe(true);
      expect(isValidLatitude(90.001)).toBe(false);
      expect(isValidLatitude(-90.001)).toBe(false);
      expect(isValidLatitude(Number.NaN)).toBe(false);
    });

    it('correctly validates longitude boundaries', () => {
      expect(isValidLongitude(0)).toBe(true);
      expect(isValidLongitude(180)).toBe(true);
      expect(isValidLongitude(-180)).toBe(true);
      expect(isValidLongitude(180.001)).toBe(false);
      expect(isValidLongitude(-180.001)).toBe(false);
      expect(isValidLongitude(Number.NaN)).toBe(false);
    });

    it('validates combined coordinates', () => {
      expect(isValidCoordinate(37.7749, -122.4194)).toBe(true);
      expect(isValidCoordinate(95, 0)).toBe(false);
      expect(isValidCoordinate(0, 200)).toBe(false);
    });
  });

  describe('Geo String & Timestamp Parsing', () => {
    it('parses geo strings with and without prefix', () => {
      expect(parseGeoString('geo:48.858844,2.294351')).toEqual({
        lat: 48.858844,
        lng: 2.294351,
      });
      expect(parseGeoString('48.858844, 2.294351')).toEqual({
        lat: 48.858844,
        lng: 2.294351,
      });
      expect(parseGeoString('invalid')).toBeNull();
      expect(parseGeoString('geo:999,999')).toBeNull();
    });

    it('parses timestamps across ISO strings, numeric strings, and epoch numbers', () => {
      const expected = 1683028800000;
      expect(parseTimestamp('2023-05-02T12:00:00.000Z')).toBe(expected);
      expect(parseTimestamp('1683028800000')).toBe(expected);
      expect(parseTimestamp(1683028800000)).toBe(expected);
      expect(parseTimestamp(1683028800)).toBe(expected); // Seconds converted to ms
      expect(parseTimestamp('not a date')).toBeNull();
    });

    it('formats calendar dates cleanly', () => {
      // 2024-02-29 12:00 UTC
      const ts = Date.UTC(2024, 1, 29, 12, 0, 0);
      const date = new Date(ts);
      const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      expect(formatCalendarDate(ts)).toBe(expected);
    });
  });

  describe('Format Detection', () => {
    it('detects takeout and timeline formats correctly', () => {
      expect(detectFormat(validTakeoutPayload)).toBe('takeout');
      expect(detectFormat(validTimelinePayload)).toBe('timeline');
      expect(detectFormat({ random: 'data' })).toBeNull();
      expect(detectFormat(null)).toBeNull();
    });
  });

  describe('Takeout Normalization', () => {
    it('normalizes valid takeout points from E7 coordinates', () => {
      const record = validTakeoutPayload.locations[0];
      const normalized = normalizeTakeoutPoint(record);
      expect(normalized).not.toBeNull();
      expect(normalized?.lat).toBeCloseTo(37.7749);
      expect(normalized?.lng).toBeCloseTo(-122.4194);
      expect(normalized?.timestampMs).toBe(1683028800000);
      expect(normalized?.accuracy).toBe(15);
    });

    it('discards malformed takeout points without crashing', () => {
      const results = takeoutWithMalformedPoints.locations
        .map(normalizeTakeoutPoint)
        .filter((pt) => pt !== null);

      expect(results).toHaveLength(1);
      expect(results[0]?.lat).toBeCloseTo(37.7749);
    });
  });

  describe('Timeline Normalization', () => {
    it('extracts points from timeline path, activity segments, and place visits', () => {
      const segment1 = validTimelinePayload.semanticSegments[0];
      const segment2 = validTimelinePayload.semanticSegments[1];

      const points1 = normalizeTimelineSegment(segment1);
      const points2 = normalizeTimelineSegment(segment2);

      expect(points1.length).toBeGreaterThanOrEqual(3);
      expect(points2.length).toBeGreaterThanOrEqual(1);

      // Check Paris coordinates
      expect(points1[0]?.lat).toBeCloseTo(48.8588);
      expect(points1[0]?.lng).toBeCloseTo(2.2943);
    });
  });
});
