import { db as defaultDb, StrutDB } from '../db/strut-db.ts';
import type { HexStats } from '../types/domain.ts';

export type TemporalFilterMode = 'all-time' | 'year' | 'latest-sync';

export interface TemporalFilterConfig {
  readonly mode: TemporalFilterMode;
  readonly year?: number | undefined;
}

/**
 * Returns filtered HexStats based on active temporal filter configuration
 */
export async function getFilteredHexStats(
  config: TemporalFilterConfig,
  database: StrutDB = defaultDb,
): Promise<HexStats[]> {
  const { mode, year } = config;

  if (mode === 'all-time') {
    return await database.hexStats.toArray();
  }

  if (mode === 'year') {
    if (year === undefined) {
      return await database.hexStats.toArray();
    }

    const yearRecords = await database.hexYearStats
      .where('year')
      .equals(year)
      .toArray();

    return yearRecords.map((r) => ({
      h3Index: r.h3Index,
      visitCount: r.visitCount,
      firstVisited: 0,
      lastVisited: 0,
    }));
  }

  if (mode === 'latest-sync') {
    const latestImport = await database.imports
      .where('status')
      .equals('completed')
      .reverse()
      .sortBy('importedAt')
      .then((records) => records[0]);

    if (!latestImport || !latestImport.startDate || !latestImport.endDate) {
      return await database.hexStats.toArray();
    }

    // Query visits within the latest import's date range
    const visitsInRange = await database.visits
      .where('date')
      .between(latestImport.startDate, latestImport.endDate, true, true)
      .toArray();

    const hexMap = new Map<string, { visitCount: number; firstVisited: number; lastVisited: number }>();
    for (const v of visitsInRange) {
      const existing = hexMap.get(v.h3Index);
      if (existing) {
        existing.visitCount++;
        existing.firstVisited = Math.min(existing.firstVisited, v.firstSeenTimestamp);
        existing.lastVisited = Math.max(existing.lastVisited, v.lastSeenTimestamp);
      } else {
        hexMap.set(v.h3Index, {
          visitCount: 1,
          firstVisited: v.firstSeenTimestamp,
          lastVisited: v.lastSeenTimestamp,
        });
      }
    }

    const result: HexStats[] = [];
    for (const [h3Index, stats] of hexMap.entries()) {
      result.push({
        h3Index,
        visitCount: stats.visitCount,
        firstVisited: stats.firstVisited,
        lastVisited: stats.lastVisited,
      });
    }

    return result;
  }

  return await database.hexStats.toArray();
}
