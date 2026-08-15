import { z } from 'zod';
import type { NormalizedLocationPoint, SourceType } from '../types/domain.ts';

/**
 * Coordinate and geographic boundaries
 */
export function isValidLatitude(lat: number): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/**
 * Geo point string parser (e.g. "geo:37.7749,-122.4194" or "37.7749,-122.4194")
 */
export function parseGeoString(geoStr: string): { lat: number; lng: number } | null {
  const cleaned = geoStr.replace(/^geo:/i, '').trim();
  const parts = cleaned.split(',');
  if (parts.length < 2) return null;
  const latStr = parts[0];
  const lngStr = parts[1];
  if (latStr === undefined || lngStr === undefined) return null;

  const lat = Number.parseFloat(latStr.trim());
  const lng = Number.parseFloat(lngStr.trim());
  if (isValidCoordinate(lat, lng)) {
    return { lat, lng };
  }
  return null;
}

/**
 * Timestamp parsing with robust ISO string or epoch fallback
 */
export function parseTimestamp(ts: string | number): number | null {
  if (typeof ts === 'number') {
    if (Number.isFinite(ts) && ts > 0) {
      // If seconds instead of ms (e.g. < 1e11), convert to ms
      return ts < 1e11 ? ts * 1000 : ts;
    }
    return null;
  }
  if (typeof ts === 'string') {
    // Try numeric string
    const num = Number(ts);
    if (Number.isFinite(num) && num > 0) {
      return num < 1e11 ? num * 1000 : num;
    }
    // Try ISO string
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Format local calendar date string (YYYY-MM-DD) from epoch ms
 */
export function formatCalendarDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYearFromTimestamp(timestampMs: number): number {
  return new Date(timestampMs).getFullYear();
}

// -----------------------------------------------------------------------------
// Google Takeout Schema (Legacy Records.json / Location History.json)
// -----------------------------------------------------------------------------

export const TakeoutLocationRecordSchema = z.object({
  latitudeE7: z.number().int().optional(),
  longitudeE7: z.number().int().optional(),
  timestampMs: z.string().or(z.number()).optional(),
  timestamp: z.string().optional(),
  accuracy: z.number().optional(),
});

export type RawTakeoutRecord = z.infer<typeof TakeoutLocationRecordSchema>;

export const TakeoutRootSchema = z.object({
  locations: z.array(z.unknown()),
});

// -----------------------------------------------------------------------------
// Modern Google Timeline Schema (Semantic Location History / Timeline.json)
// -----------------------------------------------------------------------------

export const TimelineLatLngSchema = z.object({
  latitudeE7: z.number().optional(),
  longitudeE7: z.number().optional(),
  latLng: z.string().optional(),
});

export const TimelinePathPointSchema = z.object({
  point: z.string().or(TimelineLatLngSchema).optional(),
  latLng: z.string().optional(),
  time: z.string().optional(),
  durationMinutesOffsetMs: z.string().or(z.number()).optional(),
});

export const RawPathPointSchema = z.object({
  latE7: z.number().optional(),
  lngE7: z.number().optional(),
  latitudeE7: z.number().optional(),
  longitudeE7: z.number().optional(),
  timestampMs: z.string().or(z.number()).optional(),
  timestamp: z.string().optional(),
});

export const TimelineSegmentSchema = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  timelinePath: z.array(TimelinePathPointSchema).optional(),
  activitySegment: z
    .object({
      startLocation: TimelineLatLngSchema.optional(),
      endLocation: TimelineLatLngSchema.optional(),
      timelinePath: z.array(TimelinePathPointSchema).optional(),
      simplifiedRawPath: z
        .object({
          points: z.array(RawPathPointSchema).optional(),
        })
        .optional(),
      waypointPath: z
        .object({
          waypoints: z.array(TimelineLatLngSchema.or(z.object({ latE7: z.number().optional(), lngE7: z.number().optional() }))).optional(),
        })
        .optional(),
      transitPath: z
        .object({
          transitStops: z
            .array(
              z.object({
                latitude: z.number().optional(),
                longitude: z.number().optional(),
                latitudeE7: z.number().optional(),
                longitudeE7: z.number().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
      duration: z
        .object({
          startTimestamp: z.string().optional(),
          endTimestamp: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  placeVisit: z
    .object({
      location: TimelineLatLngSchema.optional(),
      duration: z
        .object({
          startTimestamp: z.string().optional(),
          endTimestamp: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const TimelineRootSchema = z.object({
  semanticSegments: z.array(z.unknown()),
});

// -----------------------------------------------------------------------------
// Format Detection & Normalization
// -----------------------------------------------------------------------------

export function detectFormat(data: unknown): SourceType | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  if ('locations' in data && Array.isArray((data as { locations: unknown }).locations)) {
    return 'takeout';
  }
  if ('semanticSegments' in data && Array.isArray((data as { semanticSegments: unknown }).semanticSegments)) {
    return 'timeline';
  }
  return null;
}

/**
 * Normalizes a raw Takeout record into domain location point.
 * Returns null if invalid or coordinates out of bounds.
 */
export function normalizeTakeoutRecord(raw: unknown): NormalizedLocationPoint | null {
  const parsed = TakeoutLocationRecordSchema.safeParse(raw);
  if (!parsed.success) return null;

  const data = parsed.data;
  if (data.latitudeE7 === undefined || data.longitudeE7 === undefined) {
    return null;
  }

  const lat = data.latitudeE7 / 1e7;
  const lng = data.longitudeE7 / 1e7;

  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return null;
  }

  let timestampMs: number | null = null;
  if (data.timestampMs !== undefined) {
    timestampMs = typeof data.timestampMs === 'string' ? Number(data.timestampMs) : data.timestampMs;
  } else if (data.timestamp !== undefined) {
    timestampMs = parseTimestamp(data.timestamp);
  }

  if (timestampMs === null || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return null;
  }

  return {
    lat,
    lng,
    timestampMs,
    ...(data.accuracy !== undefined && Number.isFinite(data.accuracy) ? { accuracy: data.accuracy } : {}),
  };
}

export const normalizeTakeoutPoint = normalizeTakeoutRecord;

function extractCoordFromLocation(loc: {
  latitudeE7?: number | undefined;
  longitudeE7?: number | undefined;
  latE7?: number | undefined;
  lngE7?: number | undefined;
  latLng?: string | undefined;
}): { lat: number; lng: number } | null {
  const rawLat = loc.latitudeE7 ?? loc.latE7;
  const rawLng = loc.longitudeE7 ?? loc.lngE7;
  if (rawLat !== undefined && rawLng !== undefined) {
    const lat = rawLat / 1e7;
    const lng = rawLng / 1e7;
    if (isValidLatitude(lat) && isValidLongitude(lng)) {
      return { lat, lng };
    }
  }
  if (loc.latLng) {
    return parseGeoString(loc.latLng);
  }
  return null;
}

/**
 * Normalizes a modern Timeline segment into zero or more normalized points.
 */
export function normalizeTimelineSegment(rawSegment: unknown): NormalizedLocationPoint[] {
  const parsed = TimelineSegmentSchema.safeParse(rawSegment);
  if (!parsed.success) return [];

  const segment = parsed.data;
  const points: NormalizedLocationPoint[] = [];

  const baseStartTime = segment.startTime ? parseTimestamp(segment.startTime) : null;
  const baseEndTime = segment.endTime ? parseTimestamp(segment.endTime) : null;

  // Helper for timelinePath arrays
  const processTimelinePathArray = (pathArray: typeof segment.timelinePath) => {
    if (!pathArray || !Array.isArray(pathArray)) return;
    for (const item of pathArray) {
      let coord: { lat: number; lng: number } | null = null;
      if (typeof item.point === 'string') {
        coord = parseGeoString(item.point);
      } else if (typeof item.point === 'object' && item.point !== null) {
        coord = extractCoordFromLocation(item.point);
      } else if (item.latLng) {
        coord = parseGeoString(item.latLng);
      }

      if (coord) {
        let ptTime: number | null = null;
        if (item.time) {
          ptTime = parseTimestamp(item.time);
        } else if (item.durationMinutesOffsetMs !== undefined && baseStartTime !== null) {
          const offset =
            typeof item.durationMinutesOffsetMs === 'string'
              ? Number(item.durationMinutesOffsetMs)
              : item.durationMinutesOffsetMs;
          if (Number.isFinite(offset)) {
            ptTime = baseStartTime + offset;
          }
        } else {
          ptTime = baseStartTime;
        }

        if (ptTime !== null) {
          points.push({
            lat: coord.lat,
            lng: coord.lng,
            timestampMs: ptTime,
          });
        }
      }
    }
  };

  // 1. Process root timelinePath points
  processTimelinePathArray(segment.timelinePath);

  // 2. Process placeVisit location
  if (segment.placeVisit?.location) {
    const coord = extractCoordFromLocation(segment.placeVisit.location);
    const pvTime = segment.placeVisit.duration?.startTimestamp
      ? parseTimestamp(segment.placeVisit.duration.startTimestamp)
      : baseStartTime;
    if (coord && pvTime !== null) {
      points.push({
        lat: coord.lat,
        lng: coord.lng,
        timestampMs: pvTime,
      });
    }
  }

  // 3. Process activitySegment (start, end, simplifiedRawPath, timelinePath, waypointPath, transitPath)
  if (segment.activitySegment) {
    const act = segment.activitySegment;
    const actStart = act.duration?.startTimestamp ? parseTimestamp(act.duration.startTimestamp) : baseStartTime;
    const actEnd = act.duration?.endTimestamp ? parseTimestamp(act.duration.endTimestamp) : baseEndTime ?? actStart;

    if (act.startLocation && actStart !== null) {
      const coord = extractCoordFromLocation(act.startLocation);
      if (coord) {
        points.push({
          lat: coord.lat,
          lng: coord.lng,
          timestampMs: actStart,
        });
      }
    }

    // Process nested activitySegment.timelinePath
    processTimelinePathArray(act.timelinePath);

    // Process simplifiedRawPath.points
    if (act.simplifiedRawPath?.points && Array.isArray(act.simplifiedRawPath.points)) {
      for (const p of act.simplifiedRawPath.points) {
        const rawLat = p.latE7 ?? p.latitudeE7;
        const rawLng = p.lngE7 ?? p.longitudeE7;
        if (rawLat !== undefined && rawLng !== undefined) {
          const lat = rawLat / 1e7;
          const lng = rawLng / 1e7;
          if (isValidLatitude(lat) && isValidLongitude(lng)) {
            let t = actStart ?? Date.now();
            if (p.timestampMs !== undefined) {
              t = typeof p.timestampMs === 'string' ? Number(p.timestampMs) : p.timestampMs;
            } else if (p.timestamp !== undefined) {
              const parsedT = parseTimestamp(p.timestamp);
              if (parsedT !== null) t = parsedT;
            }
            points.push({ lat, lng, timestampMs: t });
          }
        }
      }
    }

    // Process waypointPath.waypoints
    if (act.waypointPath?.waypoints && Array.isArray(act.waypointPath.waypoints)) {
      for (const wp of act.waypointPath.waypoints) {
        const coord = extractCoordFromLocation(wp);
        if (coord && actStart !== null) {
          points.push({ lat: coord.lat, lng: coord.lng, timestampMs: actStart });
        }
      }
    }

    // Process transitPath.transitStops
    if (act.transitPath?.transitStops && Array.isArray(act.transitPath.transitStops)) {
      for (const stop of act.transitPath.transitStops) {
        const lat = stop.latitude ?? (stop.latitudeE7 ? stop.latitudeE7 / 1e7 : undefined);
        const lng = stop.longitude ?? (stop.longitudeE7 ? stop.longitudeE7 / 1e7 : undefined);
        if (lat !== undefined && lng !== undefined && isValidLatitude(lat) && isValidLongitude(lng) && actStart !== null) {
          points.push({ lat, lng, timestampMs: actStart });
        }
      }
    }

    if (act.endLocation && actEnd !== null) {
      const coord = extractCoordFromLocation(act.endLocation);
      if (coord) {
        points.push({
          lat: coord.lat,
          lng: coord.lng,
          timestampMs: actEnd,
        });
      }
    }
  }

  return points;
}
