/**
 * Incremental date windowing logic
 */

export const MS_PER_DAY = 86_400_000;

/**
 * Calculates the earliest timestamp to consider during an incremental ingestion run.
 * Skips points older than `lastImport - (overlapDays * 86400000)` unless fullReimport is active.
 */
export function calculateIncrementalCutoff(
  lastSuccessfulImportTimestamp: number,
  overlapWindowDays = 7,
  fullReimport = false,
): number {
  if (fullReimport || lastSuccessfulImportTimestamp <= 0) {
    return 0;
  }
  const overlapMs = Math.max(0, overlapWindowDays) * MS_PER_DAY;
  return Math.max(0, lastSuccessfulImportTimestamp - overlapMs);
}

/**
 * Determines whether a location point timestamp should be included in the ingestion batch.
 */
export function isPointInWindow(
  timestampMs: number,
  cutoffTimestampMs: number,
): boolean {
  return timestampMs >= cutoffTimestampMs;
}
