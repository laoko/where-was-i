import { db as defaultDb, StrutDB, PRIMARY_SYNC_ID } from '../db/strut-db.ts';
import type { DailyVisit, ImportRecord, AppSetting, SyncState } from '../types/domain.ts';

export interface CanonicalBackupPayload {
  readonly version: 1;
  readonly schema: 'strut_backup_v1';
  readonly exportedAt: number;
  readonly visits: DailyVisit[];
  readonly imports: ImportRecord[];
  readonly appSettings: AppSetting[];
  readonly syncState: SyncState | null;
}

/**
 * Generates canonical JSON backup payload from IndexedDB
 */
export async function exportCanonicalBackup(
  database: StrutDB = defaultDb,
): Promise<string> {
  const visits = await database.visits.toArray();
  const imports = await database.imports.toArray();
  const appSettings = await database.appSettings.toArray();
  const syncState = (await database.syncState.get(PRIMARY_SYNC_ID)) ?? null;

  const payload: CanonicalBackupPayload = {
    version: 1,
    schema: 'strut_backup_v1',
    exportedAt: Date.now(),
    visits,
    imports,
    appSettings,
    syncState,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Triggers a native browser file download for the backup JSON payload
 */
export function triggerBackupDownload(jsonContent: string, filename?: string): void {
  if (typeof document === 'undefined') return;

  const dateStr = new Date().toISOString().split('T')[0];
  const name = filename ?? `strut-backup-${dateStr}.json`;

  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
