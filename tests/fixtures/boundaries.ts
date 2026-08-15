import type { NormalizedLocationPoint } from '../../src/types/domain.ts';

/**
 * Spatial boundary coordinate points
 */
export const spatialBoundaryPoints: Record<string, NormalizedLocationPoint> = {
  equatorPrimeMeridian: {
    lat: 0.0,
    lng: 0.0,
    timestampMs: 1700000000000,
  },
  antimeridianEast: {
    lat: 17.5,
    lng: 179.999,
    timestampMs: 1700000000000,
  },
  antimeridianWest: {
    lat: 17.5,
    lng: -179.999,
    timestampMs: 1700000000000,
  },
  extremeNorth: {
    lat: 89.9,
    lng: 0.0,
    timestampMs: 1700000000000,
  },
  extremeSouth: {
    lat: -89.9,
    lng: 0.0,
    timestampMs: 1700000000000,
  },
  // H3 base cell 4 pentagon vicinity
  pentagonRegion: {
    lat: 50.8,
    lng: 0.0,
    timestampMs: 1700000000000,
  },
};

/**
 * Temporal boundary points
 */
export const temporalBoundaryPoints = {
  // Leap day 2024
  leapDay: {
    lat: 52.52,
    lng: 13.405, // Berlin
    timestampMs: Date.parse('2024-02-29T12:00:00.000Z'),
  },
  // Year transition (2023 -> 2024)
  yearEnd2023: {
    lat: 51.5074,
    lng: -0.1278, // London
    timestampMs: new Date(2023, 11, 31, 23, 59, 50).getTime(),
  },
  yearStart2024: {
    lat: 51.5074,
    lng: -0.1278, // London (same cell)
    timestampMs: new Date(2024, 0, 1, 0, 0, 10).getTime(),
  },
  // Daylight Saving Time shift (e.g. Europe spring forward 2024-03-31)
  dstSpringBefore: {
    lat: 48.8566,
    lng: 2.3522, // Paris
    timestampMs: Date.parse('2024-03-31T01:59:00.000Z'),
  },
  dstSpringAfter: {
    lat: 48.8566,
    lng: 2.3522, // Paris
    timestampMs: Date.parse('2024-03-31T03:01:00.000Z'),
  },
};
