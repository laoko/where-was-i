import type { NormalizedLocationPoint, SourceType } from '../types/domain.ts';
import {
  detectFormat,
  normalizeTakeoutPoint,
  normalizeTimelineSegment,
} from '../validation/schemas.ts';
import { isPointInWindow } from './windowing.ts';
import { interpolateSegment } from '../spatial/path-interpolator.ts';

export const DEFAULT_BATCH_SIZE = 10_000;

export interface ExtractedBatch {
  readonly points: NormalizedLocationPoint[];
  readonly validCount: number;
  readonly droppedCount: number;
  readonly inspectedRawCount: number;
}

export interface StreamProcessorResult {
  readonly sourceType: SourceType;
  readonly batches: AsyncGenerator<ExtractedBatch, void, unknown>;
}

/**
 * Generator that streams normalized points from a raw JSON payload in batches of `batchSize`.
 * Automatically interpolates paths between consecutive GPS points that meet distance/speed thresholds.
 */
export function createPayloadStream(
  rawJson: unknown,
  options: {
    batchSize?: number | undefined;
    cutoffTimestampMs?: number | undefined;
    signal?: AbortSignal | undefined;
    enableInterpolation?: boolean | undefined;
  } = {},
): { sourceType: SourceType; batchGenerator: () => AsyncGenerator<ExtractedBatch, void, unknown> } {
  const sourceType = detectFormat(rawJson);
  if (!sourceType) {
    throw new Error('Unsupported or unrecognized location history schema format.');
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const cutoffMs = options.cutoffTimestampMs ?? 0;
  const signal = options.signal;
  const shouldInterpolate = options.enableInterpolation ?? true;

  async function* generateBatches(): AsyncGenerator<ExtractedBatch, void, unknown> {
    let lastPoint: NormalizedLocationPoint | null = null;

    if (sourceType === 'takeout') {
      const root = rawJson as { locations: unknown[] };
      const rawRecords = root.locations;
      let currentBatch: NormalizedLocationPoint[] = [];
      let validCount = 0;
      let droppedCount = 0;
      let inspectedRawCount = 0;

      for (let i = 0; i < rawRecords.length; i++) {
        if (signal?.aborted) {
          throw new DOMException('Import aborted by user.', 'AbortError');
        }

        const raw = rawRecords[i];
        inspectedRawCount++;
        const normalized = normalizeTakeoutPoint(raw);

        if (normalized) {
          if (isPointInWindow(normalized.timestampMs, cutoffMs)) {
            // Interpolate path from previous point if within speed and distance constraints
            if (shouldInterpolate && lastPoint) {
              const intermediates = interpolateSegment(lastPoint, normalized);
              for (const intPt of intermediates) {
                if (isPointInWindow(intPt.timestampMs, cutoffMs)) {
                  currentBatch.push(intPt);
                  validCount++;
                }
              }
            }

            currentBatch.push(normalized);
            validCount++;
            lastPoint = normalized;
          }
        } else {
          droppedCount++;
        }

        if (currentBatch.length >= batchSize) {
          yield {
            points: currentBatch,
            validCount,
            droppedCount,
            inspectedRawCount,
          };
          currentBatch = [];
          validCount = 0;
          droppedCount = 0;
          inspectedRawCount = 0;
        }
      }

      if (currentBatch.length > 0 || droppedCount > 0) {
        yield {
          points: currentBatch,
          validCount,
          droppedCount,
          inspectedRawCount,
        };
      }
    } else if (sourceType === 'timeline') {
      const root = rawJson as { semanticSegments: unknown[] };
      const rawSegments = root.semanticSegments;
      let currentBatch: NormalizedLocationPoint[] = [];
      let validCount = 0;
      let droppedCount = 0;
      let inspectedRawCount = 0;

      for (let i = 0; i < rawSegments.length; i++) {
        if (signal?.aborted) {
          throw new DOMException('Import aborted by user.', 'AbortError');
        }

        const rawSeg = rawSegments[i];
        inspectedRawCount++;
        const segmentPoints = normalizeTimelineSegment(rawSeg);

        if (segmentPoints.length === 0) {
          droppedCount++;
        } else {
          for (const pt of segmentPoints) {
            if (isPointInWindow(pt.timestampMs, cutoffMs)) {
              if (shouldInterpolate && lastPoint) {
                const intermediates = interpolateSegment(lastPoint, pt);
                for (const intPt of intermediates) {
                  if (isPointInWindow(intPt.timestampMs, cutoffMs)) {
                    currentBatch.push(intPt);
                    validCount++;
                  }
                }
              }

              currentBatch.push(pt);
              validCount++;
              lastPoint = pt;
            }
          }
        }

        if (currentBatch.length >= batchSize) {
          yield {
            points: currentBatch,
            validCount,
            droppedCount,
            inspectedRawCount,
          };
          currentBatch = [];
          validCount = 0;
          droppedCount = 0;
          inspectedRawCount = 0;
        }
      }

      if (currentBatch.length > 0 || droppedCount > 0) {
        yield {
          points: currentBatch,
          validCount,
          droppedCount,
          inspectedRawCount,
        };
      }
    }
  }

  return {
    sourceType,
    batchGenerator: generateBatches,
  };
}
