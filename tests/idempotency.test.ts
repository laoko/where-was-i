import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB } from '../src/db/strut-db.ts';
import type { NormalizedLocationPoint } from '../src/types/domain.ts';
import { temporalBoundaryPoints } from './fixtures/boundaries.ts';

describe('Mathematical Idempotency & Aggregation Invariants', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_idempotency_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('guarantees 100% idempotency when ingesting identical files repeatedly', async () => {
    // San Francisco coordinate
    const points: NormalizedLocationPoint[] = [
      {
        lat: 37.7749,
        lng: -122.4194,
        timestampMs: Date.parse('2024-05-01T10:00:00.000Z'),
      },
      {
        lat: 37.7750,
        lng: -122.4195,
        timestampMs: Date.parse('2024-05-01T14:00:00.000Z'),
      },
    ];

    // First ingestion run
    const run1 = await testDb.ingestNormalizedPoints(points, {
      id: 'import_1',
      filename: 'takeout_run1.json',
      sourceType: 'takeout',
    });

    expect(run1.newVisitsCount).toBe(1);
    expect(run1.newHexCount).toBe(1);

    const initialVisitsCount = await testDb.visits.count();
    const initialHexStatsCount = await testDb.hexStats.count();
    const initialHexStat = await testDb.hexStats.toCollection().first();

    expect(initialVisitsCount).toBe(1);
    expect(initialHexStatsCount).toBe(1);
    expect(initialHexStat?.visitCount).toBe(1);

    // Second identical ingestion run (simulating re-uploading file)
    const run2 = await testDb.ingestNormalizedPoints(points, {
      id: 'import_2',
      filename: 'takeout_run1.json',
      sourceType: 'takeout',
    });

    expect(run2.newVisitsCount).toBe(0);
    expect(run2.newHexCount).toBe(0);

    const postVisitsCount = await testDb.visits.count();
    const postHexStatsCount = await testDb.hexStats.count();
    const postHexStat = await testDb.hexStats.toCollection().first();

    // Invariants: zero inflation of visits or hex counts
    expect(postVisitsCount).toBe(initialVisitsCount);
    expect(postHexStatsCount).toBe(initialHexStatsCount);
    expect(postHexStat?.visitCount).toBe(1);
  });

  it('correctly increments visit count for distinct calendar days', async () => {
    const day1Point: NormalizedLocationPoint = {
      lat: 48.8584,
      lng: 2.2945, // Paris
      timestampMs: Date.parse('2024-06-01T12:00:00.000Z'),
    };
    const day2Point: NormalizedLocationPoint = {
      lat: 48.8584,
      lng: 2.2945, // Paris (same location, next day)
      timestampMs: Date.parse('2024-06-02T12:00:00.000Z'),
    };

    await testDb.ingestNormalizedPoints([day1Point]);
    const hexAfterDay1 = await testDb.hexStats.toCollection().first();
    expect(hexAfterDay1?.visitCount).toBe(1);

    await testDb.ingestNormalizedPoints([day2Point]);
    const hexAfterDay2 = await testDb.hexStats.toCollection().first();
    expect(hexAfterDay2?.visitCount).toBe(2);
  });

  it('handles temporal boundaries such as year transitions and leap days', async () => {
    const points: NormalizedLocationPoint[] = [
      temporalBoundaryPoints.yearEnd2023,
      temporalBoundaryPoints.yearStart2024,
      temporalBoundaryPoints.leapDay,
    ];

    const result = await testDb.ingestNormalizedPoints(points);
    expect(result.pointsProcessed).toBe(3);

    // London hex had visits on 2023-12-31 and 2024-01-01 -> 2 distinct days
    const allVisits = await testDb.visits.toArray();
    expect(allVisits.length).toBe(3);

    // Check year partitions in hexYearStats
    const yearStats = await testDb.hexYearStats.toArray();
    const year2023 = yearStats.find((s) => s.year === 2023);
    const year2024 = yearStats.find((s) => s.year === 2024);

    expect(year2023).toBeDefined();
    expect(year2024).toBeDefined();
  });
});
