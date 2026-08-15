import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB, PRIMARY_SYNC_ID } from '../src/db/strut-db.ts';
import { runIngestionPipeline } from '../src/ingestion/ingestion-pipeline.ts';
import {
  generateTakeoutPayload,
  generateTimelinePayload,
} from './fixtures/generator.ts';

describe('Ingestion Stress & Performance Benchmarks', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_stress_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('ingests 25,000 synthetic Takeout points within performance budget', async () => {
    const payload = generateTakeoutPayload({
      pointCount: 25_000,
      centerLat: 37.7749,
      centerLng: -122.4194,
      intervalMs: 30_000, // 30s per point (~8.6 days of tracking)
    });

    const start = performance.now();
    const summary = await runIngestionPipeline(
      payload,
      {
        filename: 'stress_takeout_25k.json',
        batchSize: 10_000,
      },
      testDb,
    );
    const durationMs = performance.now() - start;

    expect(summary.status).toBe('completed');
    expect(summary.validPoints).toBe(25_000);
    expect(summary.droppedPoints).toBe(0);

    // Benchmarking target: 25k points should comfortably ingest in < 5 seconds in tests
    expect(durationMs).toBeLessThan(5000);

    const syncState = await testDb.syncState.get(PRIMARY_SYNC_ID);
    expect(syncState?.totalUniqueHexes).toBeGreaterThan(0);
    expect(syncState?.totalGridAreaKm2).toBeGreaterThan(0);
  });

  it('ingests 10,000 synthetic Timeline points accurately', async () => {
    const payload = generateTimelinePayload({
      pointCount: 10_000,
      centerLat: 48.8584,
      centerLng: 2.2945,
      intervalMs: 60_000,
    });

    const summary = await runIngestionPipeline(
      payload,
      {
        filename: 'stress_timeline_10k.json',
        batchSize: 5_000,
      },
      testDb,
    );

    expect(summary.status).toBe('completed');
    expect(summary.validPoints).toBe(10_000);
    expect(summary.droppedPoints).toBe(0);

    const hexCount = await testDb.hexStats.count();
    expect(hexCount).toBeGreaterThan(0);
  });
});
