import Dexie, { type Table } from 'dexie';
import type {
  DailyVisit,
  HexStats,
  HexYearStats,
  SyncState,
  AppSetting,
  ImportRecord,
  PendingImport,
  NormalizedLocationPoint,
} from '../types/domain.ts';
import { pointToH3Index, computeTotalGridAreaKm2 } from '../spatial/h3.ts';
import { formatCalendarDate, getYearFromTimestamp } from '../validation/schemas.ts';

export const PRIMARY_SYNC_ID = 'primary_sync';

export interface IngestProgressCallback {
  (subMessage: string, progressFraction: number, metrics?: { discoveredHexCount?: number; gridAreaKm2?: number }): void;
}

export class StrutDB extends Dexie {
  imports!: Table<ImportRecord, string>;
  visits!: Table<DailyVisit, string>;
  hexStats!: Table<HexStats, string>;
  hexYearStats!: Table<HexYearStats, string>;
  syncState!: Table<SyncState, string>;
  appSettings!: Table<AppSetting, string>;
  pendingImports!: Table<PendingImport, string>;

  constructor(dbName = 'StrutDB') {
    super(dbName);

    // Schema definition for Dexie v3
    this.version(1).stores({
      imports: 'id, importedAt, status',
      visits: 'id, h3Index, date, year, [h3Index+date], [h3Index+year]',
      hexStats: 'h3Index, visitCount, lastVisited',
      hexYearStats: 'id, h3Index, year, [h3Index+year]',
      syncState: 'id',
      appSettings: 'key',
      pendingImports: 'id, createdAt',
    });
  }

  /**
   * Initializes default database state if empty
   */
  async initializeDefaults(): Promise<void> {
    await this.transaction(
      'rw',
      [this.syncState],
      async () => {
        const sync = await this.syncState.get(PRIMARY_SYNC_ID);
        if (!sync) {
          await this.syncState.put({
            id: PRIMARY_SYNC_ID,
            lastSuccessfulImportTimestamp: 0,
            overlapWindowDays: 7,
            parserVersion: 1,
            totalGridAreaKm2: 0,
            totalUniqueHexes: 0,
          });
        }
      },
    );
  }

  /**
   * Ingests a batch of normalized location points idempotently.
   * Uses high-performance bulk operations and emits granular sub-stage progress.
   */
  async ingestNormalizedPoints(
    points: readonly NormalizedLocationPoint[],
    importMetadata?: { id: string; filename: string; sourceType: 'takeout' | 'timeline' },
    onProgress?: IngestProgressCallback,
  ): Promise<{
    pointsProcessed: number;
    newVisitsCount: number;
    newHexCount: number;
    totalGridAreaKm2: number;
  }> {
    if (points.length === 0) {
      return { pointsProcessed: 0, newVisitsCount: 0, newHexCount: 0, totalGridAreaKm2: 0 };
    }

    onProgress?.('Deduplicating calendar-day visits...', 0.15);

    // Step 1: Bucket points by `${h3Index}_${date}` in memory
    const dailyBuckets = new Map<
      string,
      {
        h3Index: string;
        date: string;
        year: number;
        firstSeen: number;
        lastSeen: number;
      }
    >();

    for (const pt of points) {
      const h3Index = pointToH3Index(pt.lat, pt.lng);
      const dateStr = formatCalendarDate(pt.timestampMs);
      const year = getYearFromTimestamp(pt.timestampMs);
      const key = `${h3Index}_${dateStr}`;

      const existing = dailyBuckets.get(key);
      if (existing) {
        existing.firstSeen = Math.min(existing.firstSeen, pt.timestampMs);
        existing.lastSeen = Math.max(existing.lastSeen, pt.timestampMs);
      } else {
        dailyBuckets.set(key, {
          h3Index,
          date: dateStr,
          year,
          firstSeen: pt.timestampMs,
          lastSeen: pt.timestampMs,
        });
      }
    }

    let newVisitsCount = 0;
    let newHexCount = 0;
    let totalArea = 0;

    onProgress?.('Writing visits to local storage...', 0.35);

    // Step 2: Atomic transaction in Dexie to upsert daily visits and maintain aggregations
    await this.transaction(
      'rw',
      [this.visits, this.hexStats, this.hexYearStats, this.syncState, this.imports],
      async () => {
        const visitKeys = Array.from(dailyBuckets.keys());
        const existingVisits = await this.visits.bulkGet(visitKeys);

        const visitsToPut: DailyVisit[] = [];
        const newVisitsByHex = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();
        const newVisitsByHexYear = new Map<string, number>();

        for (let i = 0; i < visitKeys.length; i++) {
          const key = visitKeys[i];
          if (!key) continue;
          const bucket = dailyBuckets.get(key);
          if (!bucket) continue;

          const existing = existingVisits[i];
          if (existing) {
            const updatedFirst = Math.min(existing.firstSeenTimestamp, bucket.firstSeen);
            const updatedLast = Math.max(existing.lastSeenTimestamp, bucket.lastSeen);
            if (updatedFirst !== existing.firstSeenTimestamp || updatedLast !== existing.lastSeenTimestamp) {
              visitsToPut.push({
                id: key,
                h3Index: bucket.h3Index,
                date: bucket.date,
                year: bucket.year,
                firstSeenTimestamp: updatedFirst,
                lastSeenTimestamp: updatedLast,
              });
            }
          } else {
            newVisitsCount++;
            visitsToPut.push({
              id: key,
              h3Index: bucket.h3Index,
              date: bucket.date,
              year: bucket.year,
              firstSeenTimestamp: bucket.firstSeen,
              lastSeenTimestamp: bucket.lastSeen,
            });

            // Track for hexStats update
            const hexAgg = newVisitsByHex.get(bucket.h3Index);
            if (hexAgg) {
              hexAgg.count++;
              hexAgg.firstSeen = Math.min(hexAgg.firstSeen, bucket.firstSeen);
              hexAgg.lastSeen = Math.max(hexAgg.lastSeen, bucket.lastSeen);
            } else {
              newVisitsByHex.set(bucket.h3Index, {
                count: 1,
                firstSeen: bucket.firstSeen,
                lastSeen: bucket.lastSeen,
              });
            }

            // Track for hexYearStats update
            const yearKey = `${bucket.h3Index}_${bucket.year}`;
            newVisitsByHexYear.set(yearKey, (newVisitsByHexYear.get(yearKey) ?? 0) + 1);
          }
        }

        if (visitsToPut.length > 0) {
          // Chunk bulkPut for smooth progress and memory safety
          const chunkSize = 15_000;
          for (let c = 0; c < visitsToPut.length; c += chunkSize) {
            const chunk = visitsToPut.slice(c, c + chunkSize);
            await this.visits.bulkPut(chunk);
          }
        }

        onProgress?.('Updating lifetime hexagon stats...', 0.65);

        // High-performance bulk update for hexStats
        const affectedHexes = Array.from(newVisitsByHex.keys());
        const existingHexStats = await this.hexStats.bulkGet(affectedHexes);
        const hexStatsToPut: HexStats[] = [];

        for (let i = 0; i < affectedHexes.length; i++) {
          const h3Index = affectedHexes[i];
          if (!h3Index) continue;
          const newAgg = newVisitsByHex.get(h3Index);
          if (!newAgg) continue;

          const existing = existingHexStats[i];
          if (existing) {
            hexStatsToPut.push({
              h3Index,
              visitCount: existing.visitCount + newAgg.count,
              firstVisited: Math.min(existing.firstVisited, newAgg.firstSeen),
              lastVisited: Math.max(existing.lastVisited, newAgg.lastSeen),
            });
          } else {
            newHexCount++;
            hexStatsToPut.push({
              h3Index,
              visitCount: newAgg.count,
              firstVisited: newAgg.firstSeen,
              lastVisited: newAgg.lastSeen,
            });
          }
        }

        if (hexStatsToPut.length > 0) {
          await this.hexStats.bulkPut(hexStatsToPut);
        }

        // High-performance bulk update for hexYearStats
        const affectedYearKeys = Array.from(newVisitsByHexYear.keys());
        const existingYearStats = await this.hexYearStats.bulkGet(affectedYearKeys);
        const hexYearStatsToPut: HexYearStats[] = [];

        for (let i = 0; i < affectedYearKeys.length; i++) {
          const yearKey = affectedYearKeys[i];
          if (!yearKey) continue;
          const newCount = newVisitsByHexYear.get(yearKey) ?? 0;
          const [h3Index, yearStr] = yearKey.split('_');
          if (!h3Index || !yearStr) continue;
          const year = Number(yearStr);

          const existing = existingYearStats[i];
          hexYearStatsToPut.push({
            id: yearKey,
            h3Index,
            year,
            visitCount: (existing?.visitCount ?? 0) + newCount,
          });
        }

        if (hexYearStatsToPut.length > 0) {
          await this.hexYearStats.bulkPut(hexYearStatsToPut);
        }

        onProgress?.('Calculating total explored grid area...', 0.85);

        // Recalculate total unique hexes and grid area in syncState
        const totalHexes = await this.hexStats.count();
        const allHexKeys = await this.hexStats.toCollection().primaryKeys();
        totalArea = computeTotalGridAreaKm2(allHexKeys);

        const sync = (await this.syncState.get(PRIMARY_SYNC_ID)) ?? {
          id: PRIMARY_SYNC_ID,
          lastSuccessfulImportTimestamp: 0,
          overlapWindowDays: 7,
          parserVersion: 1,
          totalGridAreaKm2: 0,
          totalUniqueHexes: 0,
        };

        await this.syncState.put({
          ...sync,
          lastSuccessfulImportTimestamp: Date.now(),
          totalGridAreaKm2: totalArea,
          totalUniqueHexes: totalHexes,
        });

        if (importMetadata) {
          await this.imports.put({
            id: importMetadata.id,
            filename: importMetadata.filename,
            importedAt: Date.now(),
            sourceType: importMetadata.sourceType,
            pointsCount: points.length,
            newVisitsCount,
            newHexCount,
            startDate: formatCalendarDate(points[0]?.timestampMs ?? Date.now()),
            endDate: formatCalendarDate(points[points.length - 1]?.timestampMs ?? Date.now()),
            status: 'completed',
          });
        }
      },
    );

    onProgress?.('Finalizing sync state...', 0.98, { discoveredHexCount: newHexCount, gridAreaKm2: totalArea });

    return {
      pointsProcessed: points.length,
      newVisitsCount,
      newHexCount,
      totalGridAreaKm2: totalArea,
    };
  }

  /**
   * Drops all stored history, wiping IndexedDB stores clean.
   */
  async purgeAllData(): Promise<void> {
    await this.transaction(
      'rw',
      [this.imports, this.visits, this.hexStats, this.hexYearStats, this.syncState, this.pendingImports, this.appSettings],
      async () => {
        await this.imports.clear();
        await this.visits.clear();
        await this.hexStats.clear();
        await this.hexYearStats.clear();
        await this.pendingImports.clear();
        await this.appSettings.clear();
        await this.syncState.put({
          id: PRIMARY_SYNC_ID,
          lastSuccessfulImportTimestamp: 0,
          overlapWindowDays: 7,
          parserVersion: 1,
          totalGridAreaKm2: 0,
          totalUniqueHexes: 0,
        });
      },
    );
  }
}

export const db = new StrutDB();
