import { StrutDB, PRIMARY_SYNC_ID, db as defaultDb } from '../db/strut-db.ts';
import type { IngestionOptions, IngestionSummary } from '../types/ingestion.ts';
import type { IngestionProgress } from '../types/domain.ts';
import { calculateIncrementalCutoff } from './windowing.ts';
import { createPayloadStream, DEFAULT_BATCH_SIZE } from './stream-processor.ts';
import { formatCalendarDate } from '../validation/schemas.ts';

/**
 * Executes the enhanced multi-stage ingestion pipeline with live throughput, ETA, and granular progress.
 */
export async function runIngestionPipeline(
  rawJson: unknown,
  options: IngestionOptions = {},
  database: StrutDB = defaultDb,
): Promise<IngestionSummary> {
  const startTime = Date.now();
  const importId = `import_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const filename = options.filename ?? 'location_history.json';
  const signal = options.signal;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const fullReimport = options.fullReimport ?? false;

  let totalValidPoints = 0;
  let totalDroppedPoints = 0;
  let totalNewVisits = 0;
  let totalNewHexes = 0;
  let latestGridArea = 0;
  let minDateStr = '';
  let maxDateStr = '';

  function reportProgress(
    stage: IngestionProgress['stage'],
    percent: number,
    processed: number,
    total: number,
    msg?: string,
    subMsg?: string,
  ) {
    if (options.onProgress) {
      const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
      const pointsPerSec = Math.round(processed / elapsedSec);
      const remainingPoints = Math.max(0, total - processed);
      const etaSeconds = pointsPerSec > 0 && remainingPoints > 0 ? Math.ceil(remainingPoints / pointsPerSec) : 0;

      options.onProgress({
        stage,
        progressPercent: Math.min(100, Math.round(percent)),
        pointsProcessed: processed,
        totalPoints: total,
        ...(msg ? { message: msg } : {}),
        ...(subMsg ? { subMessage: subMsg } : {}),
        discoveredHexCount: totalNewHexes,
        gridAreaKm2: latestGridArea,
        pointsPerSec,
        etaSeconds,
      });
    }
  }

  // Stage 1: Reading
  reportProgress('reading', 5, 0, 0, 'Reading payload stream', 'Initializing memory buffer');

  if (signal?.aborted) {
    return handleCancellation(importId, filename, 'takeout', startTime, 0, 0, 0, 0, 0, database);
  }

  // Ensure DB initialized
  await database.initializeDefaults();
  const syncState = await database.syncState.get(PRIMARY_SYNC_ID);
  const lastSyncTime = syncState?.lastSuccessfulImportTimestamp ?? 0;
  const overlapDays = syncState?.overlapWindowDays ?? 7;
  const cutoffTimestampMs = calculateIncrementalCutoff(lastSyncTime, overlapDays, fullReimport);

  // Stage 2: Parsing & Format Detection
  reportProgress('parsing', 15, 0, 0, 'Detecting format and validating schema', 'Checking Takeout / Timeline structures');

  let streamResult;
  try {
    streamResult = createPayloadStream(rawJson, {
      batchSize,
      cutoffTimestampMs,
      signal,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown parsing error';
    await database.imports.put({
      id: importId,
      filename,
      importedAt: Date.now(),
      sourceType: 'takeout',
      pointsCount: 0,
      newVisitsCount: 0,
      newHexCount: 0,
      startDate: '',
      endDate: '',
      status: 'failed',
      errorMessage: errorMsg,
    });

    reportProgress('error', 0, 0, 0, errorMsg);
    throw err;
  }

  const { sourceType, batchGenerator } = streamResult;

  // Insert initial 'processing' record
  await database.imports.put({
    id: importId,
    filename,
    importedAt: Date.now(),
    sourceType,
    pointsCount: 0,
    newVisitsCount: 0,
    newHexCount: 0,
    startDate: '',
    endDate: '',
    status: 'processing',
  });

  try {
    reportProgress('filtering', 25, 0, 0, 'Filtering date windows and chunking', 'Preparing incremental sync');
    reportProgress('connecting', 35, 0, 0, 'Connecting movement paths', 'Interpolating pedestrian and transit segments');

    const iterator = batchGenerator();

    while (true) {
      if (signal?.aborted) {
        return await handleCancellation(
          importId,
          filename,
          sourceType,
          startTime,
          totalValidPoints + totalDroppedPoints,
          totalValidPoints,
          totalDroppedPoints,
          totalNewVisits,
          totalNewHexes,
          database,
        );
      }

      const nextBatch = await iterator.next();
      if (nextBatch.done) break;

      const batch = nextBatch.value;
      totalValidPoints += batch.validCount;
      totalDroppedPoints += batch.droppedCount;

      if (batch.points.length > 0) {
        reportProgress(
          'aggregating',
          45,
          totalValidPoints,
          totalValidPoints + totalDroppedPoints,
          `Aggregating H3 hexes (${totalValidPoints} points)`,
          'Grouping spatial coordinates into H3 Resolution 11 cells',
        );
        reportProgress(
          'deduplicating',
          50,
          totalValidPoints,
          totalValidPoints + totalDroppedPoints,
          'Deduplicating daily visits',
          `Processing ${batch.points.length.toLocaleString()} points into calendar visits`,
        );

        // Track start/end date ranges
        for (const pt of batch.points) {
          const d = formatCalendarDate(pt.timestampMs);
          if (!minDateStr || d < minDateStr) minDateStr = d;
          if (!maxDateStr || d > maxDateStr) maxDateStr = d;
        }

        const ingestRes = await database.ingestNormalizedPoints(batch.points, undefined, (subMsg, frac, metrics) => {
          if (metrics?.gridAreaKm2) latestGridArea = metrics.gridAreaKm2;
          const currentPercent = 50 + frac * 45; // Smooth progression between 50% and 95%
          reportProgress(
            'persisting',
            currentPercent,
            totalValidPoints,
            totalValidPoints + totalDroppedPoints,
            'Saving exploration records',
            subMsg,
          );
        });

        totalNewVisits += ingestRes.newVisitsCount;
        totalNewHexes += ingestRes.newHexCount;
        latestGridArea = ingestRes.totalGridAreaKm2;
      }
    }

    // Finalize import record
    const durationMs = Date.now() - startTime;
    await database.imports.put({
      id: importId,
      filename,
      importedAt: Date.now(),
      sourceType,
      pointsCount: totalValidPoints,
      newVisitsCount: totalNewVisits,
      newHexCount: totalNewHexes,
      startDate: minDateStr,
      endDate: maxDateStr,
      status: 'completed',
    });

    // Stage: Complete
    reportProgress(
      'complete',
      100,
      totalValidPoints,
      totalValidPoints + totalDroppedPoints,
      'Ingestion Complete',
      `Unlocked ${totalNewHexes.toLocaleString()} new hexes!`,
    );

    return {
      importId,
      filename,
      sourceType,
      totalPoints: totalValidPoints + totalDroppedPoints,
      validPoints: totalValidPoints,
      droppedPoints: totalDroppedPoints,
      newVisitsCount: totalNewVisits,
      newHexCount: totalNewHexes,
      startDate: minDateStr,
      endDate: maxDateStr,
      durationMs,
      status: 'completed',
    };
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      return await handleCancellation(
        importId,
        filename,
        sourceType,
        startTime,
        totalValidPoints + totalDroppedPoints,
        totalValidPoints,
        totalDroppedPoints,
        totalNewVisits,
        totalNewHexes,
        database,
      );
    }

    const errorMsg = err instanceof Error ? err.message : 'Unknown processing error';
    await database.imports.put({
      id: importId,
      filename,
      importedAt: Date.now(),
      sourceType,
      pointsCount: totalValidPoints,
      newVisitsCount: totalNewVisits,
      newHexCount: totalNewHexes,
      startDate: minDateStr,
      endDate: maxDateStr,
      status: 'failed',
      errorMessage: errorMsg,
    });

    reportProgress('error', 0, totalValidPoints, totalValidPoints + totalDroppedPoints, errorMsg);
    throw err;
  }
}

async function handleCancellation(
  importId: string,
  filename: string,
  sourceType: 'takeout' | 'timeline',
  startTime: number,
  totalPoints: number,
  validPoints: number,
  droppedPoints: number,
  newVisitsCount: number,
  newHexCount: number,
  database: StrutDB,
): Promise<IngestionSummary> {
  // Mark import as cancelled in DB without advancing sync cursor
  await database.imports.put({
    id: importId,
    filename,
    importedAt: Date.now(),
    sourceType,
    pointsCount: validPoints,
    newVisitsCount,
    newHexCount,
    startDate: '',
    endDate: '',
    status: 'cancelled',
    errorMessage: 'Ingestion cancelled by user.',
  });

  return {
    importId,
    filename,
    sourceType,
    totalPoints,
    validPoints,
    droppedPoints,
    newVisitsCount,
    newHexCount,
    startDate: '',
    endDate: '',
    durationMs: Date.now() - startTime,
    status: 'cancelled',
    errorMessage: 'Ingestion cancelled by user.',
  };
}
