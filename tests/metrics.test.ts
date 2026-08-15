import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB } from '../src/db/strut-db.ts';
import { getExplorationMetrics, getYearBreakdowns } from '../src/metrics/metrics-engine.ts';
import { getFilteredHexStats } from '../src/metrics/temporal-filter.ts';
import type { NormalizedLocationPoint } from '../src/types/domain.ts';

describe('Metrics Engine & Temporal Filtering', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_metrics_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('calculates exploration summary metrics accurately', async () => {
    const emptyMetrics = await getExplorationMetrics(testDb);
    expect(emptyMetrics.totalUniqueHexes).toBe(0);
    expect(emptyMetrics.totalGridAreaKm2).toBe(0);
    expect(emptyMetrics.totalVisitDays).toBe(0);

    // Ingest data in 2023 and 2024
    const points2023: NormalizedLocationPoint[] = [
      { lat: 37.7749, lng: -122.4194, timestampMs: Date.parse('2023-05-01T12:00:00.000Z') },
      { lat: 37.7749, lng: -122.4194, timestampMs: Date.parse('2023-05-02T12:00:00.000Z') },
    ];
    const points2024: NormalizedLocationPoint[] = [
      { lat: 40.7128, lng: -74.006, timestampMs: Date.parse('2024-06-01T12:00:00.000Z') },
    ];

    await testDb.ingestNormalizedPoints(points2023, {
      id: 'imp_2023',
      filename: '2023.json',
      sourceType: 'takeout',
    });

    await testDb.ingestNormalizedPoints(points2024, {
      id: 'imp_2024',
      filename: '2024.json',
      sourceType: 'takeout',
    });

    const metrics = await getExplorationMetrics(testDb);
    expect(metrics.totalUniqueHexes).toBe(2);
    expect(metrics.totalVisitDays).toBe(3); // 2 visits in SF + 1 in NY
    expect(metrics.totalGridAreaKm2).toBeGreaterThan(0.003);
    expect(metrics.completedImportsCount).toBe(2);
  });

  it('computes year-by-year breakdowns correctly', async () => {
    const points: NormalizedLocationPoint[] = [
      { lat: 37.7749, lng: -122.4194, timestampMs: Date.parse('2022-01-01T12:00:00.000Z') },
      { lat: 37.7749, lng: -122.4194, timestampMs: Date.parse('2023-01-01T12:00:00.000Z') },
      { lat: 48.8584, lng: 2.2945, timestampMs: Date.parse('2023-06-01T12:00:00.000Z') },
      { lat: 51.5074, lng: -0.1278, timestampMs: Date.parse('2024-01-01T12:00:00.000Z') },
    ];

    await testDb.ingestNormalizedPoints(points);

    const yearBreakdowns = await getYearBreakdowns(testDb);
    expect(yearBreakdowns).toHaveLength(3); // 2024, 2023, 2022

    expect(yearBreakdowns[0]?.year).toBe(2024);
    expect(yearBreakdowns[0]?.hexCount).toBe(1);

    expect(yearBreakdowns[1]?.year).toBe(2023);
    expect(yearBreakdowns[1]?.hexCount).toBe(2);

    expect(yearBreakdowns[2]?.year).toBe(2022);
    expect(yearBreakdowns[2]?.hexCount).toBe(1);
  });

  it('filters hex stats by All-Time, Year, and Latest Sync', async () => {
    const points2023: NormalizedLocationPoint[] = [
      { lat: 37.7749, lng: -122.4194, timestampMs: Date.parse('2023-05-01T12:00:00.000Z') },
    ];
    const points2024: NormalizedLocationPoint[] = [
      { lat: 40.7128, lng: -74.006, timestampMs: Date.parse('2024-06-01T12:00:00.000Z') },
    ];

    await testDb.ingestNormalizedPoints(points2023, {
      id: 'imp1',
      filename: 'old.json',
      sourceType: 'takeout',
    });
    await testDb.ingestNormalizedPoints(points2024, {
      id: 'imp2',
      filename: 'new.json',
      sourceType: 'takeout',
    });

    // All-time filter
    const allTimeStats = await getFilteredHexStats({ mode: 'all-time' }, testDb);
    expect(allTimeStats).toHaveLength(2);

    // Year filter 2023
    const year2023Stats = await getFilteredHexStats({ mode: 'year', year: 2023 }, testDb);
    expect(year2023Stats).toHaveLength(1);

    // Year filter 2024
    const year2024Stats = await getFilteredHexStats({ mode: 'year', year: 2024 }, testDb);
    expect(year2024Stats).toHaveLength(1);

    // Latest sync filter
    const latestStats = await getFilteredHexStats({ mode: 'latest-sync' }, testDb);
    expect(latestStats).toHaveLength(1);
  });
});
