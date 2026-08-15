import type { NormalizedLocationPoint } from '../types/domain.ts';

export const MAX_INTERPOLATION_DISTANCE_KM = 1.0; // 1km max segment length
export const MAX_INTERPOLATION_SPEED_KMH = 300.0; // 300 km/h max speed (allows high-speed train/car, skips plane)
export const MAX_INTERPOLATION_TIME_GAP_MS = 15 * 60 * 1000; // 15 minutes max gap between points
export const INTERPOLATION_STEP_METERS = 25; // 25m step (smaller than Res 11 cell radius)

const EARTH_RADIUS_KM = 6371.0088;

/**
 * Computes great-circle distance between two coordinates in kilometers using Haversine formula
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Interpolates intermediate points between two consecutive GPS fixes if they meet
 * strict distance (<= 1.0km), speed (<= 300km/h), and time (<= 15min) constraints.
 */
export function interpolateSegment(
  p1: NormalizedLocationPoint,
  p2: NormalizedLocationPoint,
): NormalizedLocationPoint[] {
  const timeDeltaMs = Math.abs(p2.timestampMs - p1.timestampMs);

  // Time gap check
  if (timeDeltaMs > MAX_INTERPOLATION_TIME_GAP_MS) {
    return [];
  }

  const distKm = haversineDistanceKm(p1.lat, p1.lng, p2.lat, p2.lng);

  // Distance checks: ignore stationary points (< 10m) and long jumps (> 1.0km)
  if (distKm <= 0.01 || distKm > MAX_INTERPOLATION_DISTANCE_KM) {
    return [];
  }

  // Speed check: (distance in km) / (time in hours)
  if (timeDeltaMs > 0) {
    const hours = timeDeltaMs / (1000 * 60 * 60);
    const speedKmh = distKm / hours;
    if (speedKmh > MAX_INTERPOLATION_SPEED_KMH) {
      return []; // Flight or GPS teleportation
    }
  }

  // Calculate number of intermediate steps (~25m per step)
  const distMeters = distKm * 1000;
  const numSteps = Math.floor(distMeters / INTERPOLATION_STEP_METERS);

  if (numSteps <= 1) {
    return [];
  }

  const intermediatePoints: NormalizedLocationPoint[] = [];

  for (let k = 1; k < numSteps; k++) {
    const ratio = k / numSteps;
    const lat = p1.lat + ratio * (p2.lat - p1.lat);
    const lng = p1.lng + ratio * (p2.lng - p1.lng);
    const timestampMs = Math.round(p1.timestampMs + ratio * (p2.timestampMs - p1.timestampMs));

    intermediatePoints.push({
      lat,
      lng,
      timestampMs,
    });
  }

  return intermediatePoints;
}

/**
 * Processes a sequence of location points and connects consecutive points with interpolated ribbons
 */
export function interpolatePointStream(
  points: readonly NormalizedLocationPoint[],
): NormalizedLocationPoint[] {
  if (points.length <= 1) {
    return [...points];
  }

  const result: NormalizedLocationPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    if (!current) continue;

    result.push(current);

    const next = points[i + 1];
    if (next) {
      const intermediates = interpolateSegment(current, next);
      if (intermediates.length > 0) {
        result.push(...intermediates);
      }
    }
  }

  return result;
}
