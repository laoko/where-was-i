import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB } from '../src/db/strut-db.ts';
import { exportCanonicalBackup } from '../src/data-controls/backup.ts';
import { restoreCanonicalBackup } from '../src/data-controls/restore.ts';
import type { NormalizedLocationPoint } from '../src/types/domain.ts';

describe('Canonical Backup, Restore & Data Controls', () => {
  let sourceDb: StrutDB;
  let targetDb: StrutDB;

  beforeEach(async () => {
    sourceDb = new StrutDB(`test_source_${Date.now()}_${Math.random()}`);
    targetDb = new StrutDB(`test_target_${Date.now()}_${Math.random()}`);
    await sourceDb.open();
    await targetDb.open();
    await sourceDb.initializeDefaults();
    await targetDb.initializeDefaults();
  });

  afterEach(async () => {
    await sourceDb.delete();
    await targetDb.delete();
  });

  it('performs lossless round-trip canonical backup export and restore', async () => {
    // Populate source database
    const points: NormalizedLocationPoint[] = [
      { lat: 37.7749, lng: -122.4194, timestampMs: Date.parse('2024-05-01T10:00:00.000Z') },
      { lat: 40.7128, lng: -74.006, timestampMs: Date.parse('2024-05-02T10:00:00.000Z') },
    ];

    await sourceDb.ingestNormalizedPoints(points, {
      id: 'import_test_1',
      filename: 'source.json',
      sourceType: 'takeout',
    });
    await sourceDb.appSettings.put({ key: 'highContrast', value: true });

    // Export backup JSON
    const backupJson = await exportCanonicalBackup(sourceDb);
    expect(backupJson).toContain('strut_backup_v1');

    // Restore backup into clean target database
    const restoreSummary = await restoreCanonicalBackup(backupJson, targetDb);

    expect(restoreSummary.restoredVisits).toBe(2);
    expect(restoreSummary.restoredImports).toBe(1);
    expect(restoreSummary.durationMs).toBeLessThan(500); // Sub-500ms target

    // Verify target database tables
    expect(await targetDb.visits.count()).toBe(2);
    expect(await targetDb.hexStats.count()).toBe(2);
    expect(await targetDb.hexYearStats.count()).toBe(2);
    expect(await targetDb.imports.count()).toBe(1);

    const setting = await targetDb.appSettings.get('highContrast');
    expect(setting?.value).toBe(true);

    const syncState = await targetDb.syncState.get('primary_sync');
    expect(syncState?.totalUniqueHexes).toBe(2);
    expect(syncState?.totalGridAreaKm2).toBeGreaterThan(0.003);
  });

  it('rejects corrupt or invalid backup schema', async () => {
    const invalidBackup = JSON.stringify({
      version: 99,
      schema: 'invalid_schema',
      data: [],
    });

    await expect(restoreCanonicalBackup(invalidBackup, targetDb)).rejects.toThrow();
  });
});
