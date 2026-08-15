import { z } from 'zod';
import { db as defaultDb, StrutDB, PRIMARY_SYNC_ID } from '../db/strut-db.ts';
import type { DailyVisit, ImportRecord, AppSetting, HexStats, HexYearStats } from '../types/domain.ts';
import { computeTotalGridAreaKm2 } from '../spatial/h3.ts';

const BackupDailyVisitSchema = z.object({
  id: z.string(),
  h3Index: z.string(),
  date: z.string(),
  year: z.number(),
  firstSeenTimestamp: z.number(),
  lastSeenTimestamp: z.number(),
});

const BackupImportRecordSchema = z.object({
  id: z.string(),
  filename: z.string(),
  importedAt: z.number(),
  sourceType: z.enum(['takeout', 'timeline']),
  pointsCount: z.number(),
  newVisitsCount: z.number(),
  newHexCount: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']),
  errorMessage: z.string().optional(),
});

const BackupAppSettingSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const CanonicalBackupSchema = z.object({
  version: z.literal(1),
  schema: z.literal('strut_backup_v1'),
  exportedAt: z.number(),
  visits: z.array(BackupDailyVisitSchema),
  imports: z.array(BackupImportRecordSchema),
  appSettings: z.array(BackupAppSettingSchema),
});

export interface RestoreSummary {
  readonly restoredVisits: number;
  readonly restoredImports: number;
  readonly durationMs: number;
}

/**
 * Validates and restores a canonical backup payload into IndexedDB
 */
export async function restoreCanonicalBackup(
  backupContent: string | unknown,
  database: StrutDB = defaultDb,
): Promise<RestoreSummary> {
  const startTime = performance.now();

  const rawJson = typeof backupContent === 'string' ? JSON.parse(backupContent) : backupContent;
  const parsed = CanonicalBackupSchema.safeParse(rawJson);

  if (!parsed.success) {
    throw new Error(`Invalid backup schema: ${parsed.error.message}`);
  }

  const { visits, imports, appSettings } = parsed.data;

  await database.transaction(
    'rw',
    [
      database.visits,
      database.imports,
      database.appSettings,
      database.hexStats,
      database.hexYearStats,
      database.syncState,
    ],
    async () => {
      // 1. Bulk put raw visits and imports
      if (visits.length > 0) {
        await database.visits.bulkPut(visits as DailyVisit[]);
      }
      if (imports.length > 0) {
        await database.imports.bulkPut(imports as ImportRecord[]);
      }
      if (appSettings.length > 0) {
        await database.appSettings.bulkPut(appSettings as AppSetting[]);
      }

      // 2. Recompute hexStats & hexYearStats
      const hexMap = new Map<string, { visitCount: number; firstVisited: number; lastVisited: number }>();
      const hexYearMap = new Map<string, { h3Index: string; year: number; visitCount: number }>();

      const allVisits = await database.visits.toArray();
      for (const v of allVisits) {
        // Lifetime Hex Stats
        const hex = hexMap.get(v.h3Index);
        if (hex) {
          hex.visitCount++;
          hex.firstVisited = Math.min(hex.firstVisited, v.firstSeenTimestamp);
          hex.lastVisited = Math.max(hex.lastVisited, v.lastSeenTimestamp);
        } else {
          hexMap.set(v.h3Index, {
            visitCount: 1,
            firstVisited: v.firstSeenTimestamp,
            lastVisited: v.lastSeenTimestamp,
          });
        }

        // Year Stats
        const yearKey = `${v.h3Index}_${v.year}`;
        const hexYear = hexYearMap.get(yearKey);
        if (hexYear) {
          hexYear.visitCount++;
        } else {
          hexYearMap.set(yearKey, {
            h3Index: v.h3Index,
            year: v.year,
            visitCount: 1,
          });
        }
      }

      const hexStatsToPut: HexStats[] = [];
      for (const [h3Index, stat] of hexMap.entries()) {
        hexStatsToPut.push({
          h3Index,
          visitCount: stat.visitCount,
          firstVisited: stat.firstVisited,
          lastVisited: stat.lastVisited,
        });
      }

      const hexYearStatsToPut: HexYearStats[] = [];
      for (const [id, stat] of hexYearMap.entries()) {
        hexYearStatsToPut.push({
          id,
          h3Index: stat.h3Index,
          year: stat.year,
          visitCount: stat.visitCount,
        });
      }

      await database.hexStats.clear();
      if (hexStatsToPut.length > 0) {
        await database.hexStats.bulkPut(hexStatsToPut);
      }

      await database.hexYearStats.clear();
      if (hexYearStatsToPut.length > 0) {
        await database.hexYearStats.bulkPut(hexYearStatsToPut);
      }

      // 3. Update syncState
      const totalHexes = hexStatsToPut.length;
      const totalArea = computeTotalGridAreaKm2(hexStatsToPut.map((h) => h.h3Index));

      await database.syncState.put({
        id: PRIMARY_SYNC_ID,
        lastSuccessfulImportTimestamp: Date.now(),
        overlapWindowDays: 7,
        parserVersion: 1,
        totalGridAreaKm2: totalArea,
        totalUniqueHexes: totalHexes,
      });
    },
  );

  return {
    restoredVisits: visits.length,
    restoredImports: imports.length,
    durationMs: performance.now() - startTime,
  };
}
