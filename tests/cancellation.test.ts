import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB, PRIMARY_SYNC_ID } from '../src/db/strut-db.ts';
import { runIngestionPipeline } from '../src/ingestion/ingestion-pipeline.ts';
import { IngestionController } from '../src/ingestion/ingestion-controller.ts';
import { generateTakeoutPayload } from './fixtures/generator.ts';

describe('Ingestion Cancellation & Rollback Invariants', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_cancel_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('handles immediate in-flight cancellation via AbortSignal', async () => {
    const priorSyncTime = 1700000000000;
    await testDb.syncState.put({
      id: PRIMARY_SYNC_ID,
      lastSuccessfulImportTimestamp: priorSyncTime,
      overlapWindowDays: 7,
      parserVersion: 1,
      totalGridAreaKm2: 0,
      totalUniqueHexes: 0,
    });

    const abortController = new AbortController();
    abortController.abort(); // Cancel immediately

    const payload = generateTakeoutPayload({ pointCount: 500 });
    const summary = await runIngestionPipeline(
      payload,
      {
        filename: 'cancelled_import.json',
        signal: abortController.signal,
      },
      testDb,
    );

    expect(summary.status).toBe('cancelled');
    expect(summary.errorMessage).toBeDefined();

    // Verify sync cursor was NOT advanced
    const syncState = await testDb.syncState.get(PRIMARY_SYNC_ID);
    expect(syncState?.lastSuccessfulImportTimestamp).toBe(priorSyncTime);

    // Verify import record shows cancelled status
    const importRecord = await testDb.imports.get(summary.importId);
    expect(importRecord).toBeDefined();
    expect(importRecord?.status).toBe('cancelled');
  });

  it('cancels mid-stream via IngestionController and updates state cleanly', async () => {
    const priorSyncTime = 1700000000000;
    await testDb.syncState.put({
      id: PRIMARY_SYNC_ID,
      lastSuccessfulImportTimestamp: priorSyncTime,
      overlapWindowDays: 7,
      parserVersion: 1,
      totalGridAreaKm2: 0,
      totalUniqueHexes: 0,
    });

    const controller = new IngestionController();
    const abortController = new AbortController();

    const payload = generateTakeoutPayload({ pointCount: 2000 });

    // Cancel shortly after starting
    setTimeout(() => {
      abortController.abort();
    }, 5);

    const summary = await controller.startIngestion(
      payload,
      {
        filename: 'midstream_cancel.json',
        batchSize: 10,
        signal: abortController.signal,
      },
      false,
    );

    expect(summary.status).toBe('cancelled');
    expect(controller.isRunning).toBe(false);

    // Sync cursor invariant: never advances on cancelled job
    const syncState = await testDb.syncState.get(PRIMARY_SYNC_ID);
    expect(syncState?.lastSuccessfulImportTimestamp).toBe(priorSyncTime);
  });
});
