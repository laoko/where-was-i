import { db as defaultDb, StrutDB, PRIMARY_SYNC_ID } from '../db/strut-db.ts';
import { computeTotalGridAreaKm2, getH3CellAreaKm2 } from '../spatial/h3.ts';

export interface ExplorationSummaryMetrics {
  readonly totalUniqueHexes: number;
  readonly totalGridAreaKm2: number;
  readonly totalVisitDays: number;
  readonly completedImportsCount: number;
  readonly firstVisitedTimestamp: number;
  readonly lastVisitedTimestamp: number;
}

export interface YearActivitySummary {
  readonly year: number;
  readonly hexCount: number;
  readonly totalVisits: number;
  readonly gridAreaKm2: number;
}

/**
 * Retrieves high-level lifetime exploration metrics
 */
export async function getExplorationMetrics(
  database: StrutDB = defaultDb,
): Promise<ExplorationSummaryMetrics> {
  const sync = await database.syncState.get(PRIMARY_SYNC_ID);
  const allHexStats = await database.hexStats.toArray();
  const completedImports = await database.imports.where('status').equals('completed').count();

  let totalVisits = 0;
  let firstVisited = Number.POSITIVE_INFINITY;
  let lastVisited = 0;

  for (const hex of allHexStats) {
    totalVisits += hex.visitCount;
    if (hex.firstVisited > 0 && hex.firstVisited < firstVisited) {
      firstVisited = hex.firstVisited;
    }
    if (hex.lastVisited > lastVisited) {
      lastVisited = hex.lastVisited;
    }
  }

  const totalArea = sync?.totalGridAreaKm2 ?? computeTotalGridAreaKm2(allHexStats.map((h) => h.h3Index));

  return {
    totalUniqueHexes: allHexStats.length,
    totalGridAreaKm2: totalArea,
    totalVisitDays: totalVisits,
    completedImportsCount: completedImports,
    firstVisitedTimestamp: Number.isFinite(firstVisited) ? firstVisited : 0,
    lastVisitedTimestamp: lastVisited,
  };
}

/**
 * Retrieves year-by-year exploration breakdown
 */
export async function getYearBreakdowns(
  database: StrutDB = defaultDb,
): Promise<YearActivitySummary[]> {
  const allHexYears = await database.hexYearStats.toArray();
  const yearMap = new Map<number, { hexSet: Set<string>; totalVisits: number; area: number }>();

  for (const entry of allHexYears) {
    let bucket = yearMap.get(entry.year);
    if (!bucket) {
      bucket = { hexSet: new Set(), totalVisits: 0, area: 0 };
      yearMap.set(entry.year, bucket);
    }
    bucket.hexSet.add(entry.h3Index);
    bucket.totalVisits += entry.visitCount;
    bucket.area += getH3CellAreaKm2(entry.h3Index);
  }

  const result: YearActivitySummary[] = [];
  for (const [year, data] of yearMap.entries()) {
    result.push({
      year,
      hexCount: data.hexSet.size,
      totalVisits: data.totalVisits,
      gridAreaKm2: data.area,
    });
  }

  return result.sort((a, b) => b.year - a.year);
}
