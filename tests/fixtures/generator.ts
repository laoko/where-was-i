/**
 * Programmatic fixture generator for large-scale stress testing and synthetic location data
 */

export interface GeneratorOptions {
  pointCount: number;
  daysCount?: number;
  centerLat?: number;
  centerLng?: number;
  startEpochMs?: number;
  intervalMs?: number;
}

export function generateTakeoutPayload(options: GeneratorOptions): {
  locations: Array<{
    latitudeE7: number;
    longitudeE7: number;
    timestampMs: string;
    accuracy: number;
  }>;
} {
  const {
    pointCount,
    centerLat = 37.7749,
    centerLng = -122.4194,
    startEpochMs = Date.parse('2024-01-01T00:00:00.000Z'),
    intervalMs = 60_000, // 1 minute per point
  } = options;

  const locations = new Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    // Add small jitter to simulate walking around
    const latOffset = (Math.sin(i / 100) * 0.01);
    const lngOffset = (Math.cos(i / 100) * 0.01);
    const lat = centerLat + latOffset;
    const lng = centerLng + lngOffset;
    const timestampMs = startEpochMs + i * intervalMs;

    locations[i] = {
      latitudeE7: Math.round(lat * 1e7),
      longitudeE7: Math.round(lng * 1e7),
      timestampMs: String(timestampMs),
      accuracy: 10,
    };
  }

  return { locations };
}

export function generateTimelinePayload(options: GeneratorOptions): {
  semanticSegments: Array<{
    startTime: string;
    endTime: string;
    timelinePath: Array<{
      point: string;
      durationMinutesOffsetMs: number;
    }>;
  }>;
} {
  const {
    pointCount,
    centerLat = 48.8584,
    centerLng = 2.2945,
    startEpochMs = Date.parse('2024-01-01T00:00:00.000Z'),
    intervalMs = 60_000,
  } = options;

  const segments = [];
  const pointsPerSegment = 50;
  const numSegments = Math.ceil(pointCount / pointsPerSegment);

  for (let s = 0; s < numSegments; s++) {
    const segStartTime = startEpochMs + s * pointsPerSegment * intervalMs;
    const segEndTime = segStartTime + pointsPerSegment * intervalMs;

    const timelinePath = [];
    const countInSeg = Math.min(pointsPerSegment, pointCount - s * pointsPerSegment);
    for (let p = 0; p < countInSeg; p++) {
      const lat = centerLat + Math.sin((s * pointsPerSegment + p) / 100) * 0.01;
      const lng = centerLng + Math.cos((s * pointsPerSegment + p) / 100) * 0.01;
      timelinePath.push({
        point: `geo:${lat.toFixed(6)},${lng.toFixed(6)}`,
        durationMinutesOffsetMs: p * intervalMs,
      });
    }

    segments.push({
      startTime: new Date(segStartTime).toISOString(),
      endTime: new Date(segEndTime).toISOString(),
      timelinePath,
    });
  }

  return { semanticSegments: segments };
}
