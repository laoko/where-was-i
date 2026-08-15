/**
 * Core Domain Models for Strut PWA
 */

export type SourceType = 'takeout' | 'timeline';

export type ImportStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface NormalizedLocationPoint {
  readonly lat: number;
  readonly lng: number;
  readonly timestampMs: number;
  readonly accuracy?: number;
}

export interface ImportRecord {
  readonly id: string;
  readonly filename: string;
  readonly importedAt: number;
  readonly sourceType: SourceType;
  readonly pointsCount: number;
  readonly newVisitsCount: number;
  readonly newHexCount: number;
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string;   // YYYY-MM-DD
  readonly status: ImportStatus;
  readonly errorMessage?: string;
}

export interface DailyVisit {
  /** Composite key: `${h3Index}_${date}` */
  readonly id: string;
  readonly h3Index: string;
  readonly date: string; // YYYY-MM-DD
  readonly year: number;
  readonly firstSeenTimestamp: number;
  readonly lastSeenTimestamp: number;
}

export interface HexStats {
  readonly h3Index: string;
  readonly visitCount: number; // Sum of distinct calendar days visited
  readonly firstVisited: number; // Epoch timestamp ms
  readonly lastVisited: number;  // Epoch timestamp ms
}

export interface HexYearStats {
  /** Composite key: `${h3Index}_${year}` */
  readonly id: string;
  readonly h3Index: string;
  readonly year: number;
  readonly visitCount: number;
}

export interface SyncState {
  readonly id: string; // e.g. 'primary_sync'
  readonly lastSuccessfulImportTimestamp: number;
  readonly overlapWindowDays: number;
  readonly parserVersion: number;
  readonly totalGridAreaKm2: number;
  readonly totalUniqueHexes: number;
}

export interface PendingImport {
  readonly id: string;
  readonly filename: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

export type SettingValue = string | number | boolean;

export interface AppSetting<T extends SettingValue = SettingValue> {
  readonly key: string;
  readonly value: T;
}

export type IngestionStage =
  | 'reading'
  | 'parsing'
  | 'connecting'
  | 'filtering'
  | 'aggregating'
  | 'deduplicating'
  | 'persisting'
  | 'complete'
  | 'error';

export interface IngestionProgress {
  readonly stage: IngestionStage;
  readonly progressPercent: number; // 0 to 100
  readonly pointsProcessed: number;
  readonly totalPoints: number;
  readonly message?: string | undefined;
  readonly subMessage?: string | undefined;
  readonly discoveredHexCount?: number | undefined;
  readonly gridAreaKm2?: number | undefined;
  readonly pointsPerSec?: number | undefined;
  readonly etaSeconds?: number | undefined;
  readonly batchCurrent?: number | undefined;
  readonly batchTotal?: number | undefined;
}
