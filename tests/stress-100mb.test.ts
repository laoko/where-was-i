import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB, PRIMARY_SYNC_ID } from '../src/db/strut-db.ts';
import { runIngestionPipeline } from '../src/ingestion/ingestion-pipeline.ts';
import { generateTakeoutPayload } from './fixtures/generator.ts';

describe('100MB+ Scale Stress & Benchmark Invariant Suite', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_stress_100mb_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('ingests 100,000 points stream comfortably within the 15-second PRS target', async () => {
    // Generate 100,000 points (~100MB equivalent JSON in memory)
    const payload = generateTakeoutPayload({
      pointCount: 100_000,
      centerLat: 40.7128,
      centerLng: -74.006,
      intervalMs: 15_000, // 15s per point across ~17 days
    });

    const start = performance.now();
    const summary = await runIngestionPipeline(
      payload,
      {
        filename: 'stress_100k_records.json',
        batchSize: 10_000,
      },
      testDb,
    );
    const durationMs = performance.now() - start;

    expect(summary.status).toBe('completed');
    expect(summary.validPoints).toBe(100_000);
    expect(summary.droppedPoints).toBe(0);

    // Section 6.3 PRS Target: 100MB import <= 15.0s
    expect(durationMs).toBeLessThan(15_000);

    // Verify aggregate consistency in IndexedDB
    const syncState = await testDb.syncState.get(PRIMARY_SYNC_ID);
    expect(syncState?.totalUniqueHexes).toBeGreaterThan(0);
    expect(syncState?.totalGridAreaKm2).toBeGreaterThan(0);

    const visitsCount = await testDb.visits.count();
    expect(visitsCount).toBeGreaterThan(0);
  });
});
