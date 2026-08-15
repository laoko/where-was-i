import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB, PRIMARY_SYNC_ID } from '../src/db/strut-db.ts';
import { runIngestionPipeline } from '../src/ingestion/ingestion-pipeline.ts';
import { IngestionController } from '../src/ingestion/ingestion-controller.ts';
import {
  validTakeoutPayload,
  takeoutWithMalformedPoints,
} from './fixtures/takeout.ts';
import { validTimelinePayload } from './fixtures/timeline.ts';
import type { IngestionProgress } from '../src/types/domain.ts';

describe('Ingestion Pipeline & Multi-Format Adapters', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_pipeline_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('runs complete ingestion on Takeout format and tracks progress stages', async () => {
    const recordedStages: string[] = [];
    const progressUpdates: IngestionProgress[] = [];

    const summary = await runIngestionPipeline(
      validTakeoutPayload,
      {
        filename: 'takeout_test.json',
        onProgress: (p) => {
          progressUpdates.push(p);
          if (!recordedStages.includes(p.stage)) {
            recordedStages.push(p.stage);
          }
        },
      },
      testDb,
    );

    expect(summary.status).toBe('completed');
    expect(summary.sourceType).toBe('takeout');
    expect(summary.validPoints).toBe(3);
    expect(summary.droppedPoints).toBe(0);
    expect(summary.newVisitsCount).toBeGreaterThanOrEqual(2);

    // Verify all lifecycle stages occurred
    expect(recordedStages).toContain('reading');
    expect(recordedStages).toContain('parsing');
    expect(recordedStages).toContain('filtering');
    expect(recordedStages).toContain('aggregating');
    expect(recordedStages).toContain('persisting');
    expect(recordedStages).toContain('complete');

    // Verify database record created in imports table
    const importRec = await testDb.imports.get(summary.importId);
    expect(importRec).toBeDefined();
    expect(importRec?.status).toBe('completed');
    expect(importRec?.pointsCount).toBe(3);
  });

  it('runs complete ingestion on Modern Timeline format', async () => {
    const summary = await runIngestionPipeline(
      validTimelinePayload,
      {
        filename: 'timeline_test.json',
      },
      testDb,
    );

    expect(summary.status).toBe('completed');
    expect(summary.sourceType).toBe('timeline');
    expect(summary.validPoints).toBeGreaterThanOrEqual(4);
    expect(summary.droppedPoints).toBe(0);

    const visitsCount = await testDb.visits.count();
    expect(visitsCount).toBeGreaterThanOrEqual(1);
  });

  it('tolerates malformed coordinates and reports dropped record counts', async () => {
    const summary = await runIngestionPipeline(
      takeoutWithMalformedPoints,
      {
        filename: 'malformed_test.json',
      },
      testDb,
    );

    expect(summary.status).toBe('completed');
    expect(summary.validPoints).toBe(1);
    expect(summary.droppedPoints).toBe(4); // 4 malformed records discarded
    expect(summary.totalPoints).toBe(5);

    const visits = await testDb.visits.toArray();
    expect(visits).toHaveLength(1);
  });

  it('processes data in chunked batches without issue', async () => {
    const summary = await runIngestionPipeline(
      validTakeoutPayload,
      {
        filename: 'chunked_test.json',
        batchSize: 1, // Force batch of 1
      },
      testDb,
    );

    expect(summary.status).toBe('completed');
    expect(summary.validPoints).toBe(3);
    expect(await testDb.visits.count()).toBeGreaterThanOrEqual(2);
  });

  it('applies incremental date windowing correctly', async () => {
    // 1. Manually set sync cursor to 2024-06-01 (1717200000000) with 7 days overlap window
    const syncTime = Date.parse('2024-06-01T00:00:00.000Z');
    await testDb.syncState.put({
      id: PRIMARY_SYNC_ID,
      lastSuccessfulImportTimestamp: syncTime,
      overlapWindowDays: 7,
      parserVersion: 1,
      totalGridAreaKm2: 0,
      totalUniqueHexes: 0,
    });

    // 2. Prepare payload with 1 old point (2024-01-01), 1 point in overlap window (2024-05-28), 1 new point (2024-06-05)
    const payload = {
      locations: [
        {
          latitudeE7: 377749000,
          longitudeE7: -1224194000,
          timestampMs: String(Date.parse('2024-01-01T12:00:00.000Z')), // Older than cutoff (skipped in incremental)
        },
        {
          latitudeE7: 377749000,
          longitudeE7: -1224194000,
          timestampMs: String(Date.parse('2024-05-28T12:00:00.000Z')), // In 7-day window (processed)
        },
        {
          latitudeE7: 377749000,
          longitudeE7: -1224194000,
          timestampMs: String(Date.parse('2024-06-05T12:00:00.000Z')), // After syncTime (processed)
        },
      ],
    };

    // Incremental run (fullReimport = false)
    const incrementalSummary = await runIngestionPipeline(
      payload,
      { fullReimport: false },
      testDb,
    );

    // Only 2 points should be processed (old point skipped)
    expect(incrementalSummary.validPoints).toBe(2);

    // Full Re-import override run
    const fullSummary = await runIngestionPipeline(
      payload,
      { fullReimport: true },
      testDb,
    );

    // All 3 points should be processed
    expect(fullSummary.validPoints).toBe(3);
  });

  it('runs seamlessly through IngestionController', async () => {
    const controller = new IngestionController();
    const summary = await controller.startIngestion(
      validTakeoutPayload,
      { filename: 'controller_test.json' },
      false, // Direct mode for testing
    );

    expect(summary.status).toBe('completed');
    expect(summary.validPoints).toBe(3);
    expect(controller.isRunning).toBe(false);
  });
});
