import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { StrutDB } from '../src/db/strut-db.ts';
import { runIngestionPipeline } from '../src/ingestion/ingestion-pipeline.ts';
import { getExplorationMetrics } from '../src/metrics/metrics-engine.ts';

describe('Demo State Lifecycle & Auto-Transition Suite', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_demo_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('tracks demo mode flag in database settings', async () => {
    expect(await testDb.isDemoMode()).toBe(false);

    await testDb.setDemoMode(true);
    expect(await testDb.isDemoMode()).toBe(true);

    await testDb.setDemoMode(false);
    expect(await testDb.isDemoMode()).toBe(false);
  });

  it('ingests the 1-year fabricated demo dataset accurately across all regions', async () => {
    const demoPath = path.resolve(__dirname, '../public/demo-timeline.json');
    const rawDemo = JSON.parse(fs.readFileSync(demoPath, 'utf8'));

    const testPayload = {
      locations: rawDemo.locations.slice(0, 10000),
    };

    const summary = await runIngestionPipeline(
      testPayload,
      { filename: 'Demo Timeline (Oslo, Seville, London)' },
      testDb,
    );

    expect(summary.status).toBe('completed');
    expect(summary.validPoints).toBeGreaterThanOrEqual(10000);
    expect(summary.newHexCount).toBeGreaterThanOrEqual(300);

    await testDb.setDemoMode(true);
    expect(await testDb.isDemoMode()).toBe(true);

    const metrics = await getExplorationMetrics(testDb);
    expect(metrics.totalUniqueHexes).toBeGreaterThanOrEqual(300);
    expect(metrics.totalGridAreaKm2).toBeGreaterThan(1.0);
  }, 15000);

  it('automatically purges demo data when user imports personal data', async () => {
    // 1. Setup demo state
    await testDb.setDemoMode(true);
    await testDb.hexStats.put({
      h3Index: '8b1962380000fff',
      visitCount: 5,
      firstVisited: 100,
      lastVisited: 200,
    });

    expect(await testDb.isDemoMode()).toBe(true);
    expect(await testDb.hexStats.count()).toBe(1);

    // 2. User imports personal Takeout file
    const wasDemo = await testDb.clearDemoIfActive();
    expect(wasDemo).toBe(true);
    expect(await testDb.hexStats.count()).toBe(0);

    // 3. Ingest user real data
    const userPayload = {
      locations: [
        {
          latitudeE7: 407128000,
          longitudeE7: -740060000,
          timestampMs: '1700000000000',
        },
      ],
    };

    await runIngestionPipeline(userPayload, { filename: 'my_real_takeout.json' }, testDb);
    await testDb.setDemoMode(false);

    expect(await testDb.isDemoMode()).toBe(false);
    expect(await testDb.hexStats.count()).toBe(1);

    const userHex = await testDb.hexStats.toArray();
    expect(userHex[0]?.h3Index).not.toBe('8b1962380000fff');

    // 4. Calling clearDemoIfActive again returns false since real data is active
    const wasDemoAgain = await testDb.clearDemoIfActive();
    expect(wasDemoAgain).toBe(false);
    expect(await testDb.hexStats.count()).toBe(1);
  });
});
