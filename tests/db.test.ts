import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrutDB, PRIMARY_SYNC_ID } from '../src/db/strut-db.ts';

describe('StrutDB IndexedDB Architecture', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_strut_${Date.now()}_${Math.random()}`);
    await testDb.open();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('initializes all required object stores with correct indexes', async () => {
    expect(testDb.imports).toBeDefined();
    expect(testDb.visits).toBeDefined();
    expect(testDb.hexStats).toBeDefined();
    expect(testDb.hexYearStats).toBeDefined();
    expect(testDb.syncState).toBeDefined();
    expect(testDb.appSettings).toBeDefined();
  });

  it('initializes default sync state properly', async () => {
    await testDb.initializeDefaults();
    const sync = await testDb.syncState.get(PRIMARY_SYNC_ID);

    expect(sync).toBeDefined();
    expect(sync?.id).toBe(PRIMARY_SYNC_ID);
    expect(sync?.overlapWindowDays).toBe(7);
    expect(sync?.totalUniqueHexes).toBe(0);
    expect(sync?.totalGridAreaKm2).toBe(0);
  });

  it('stores and retrieves strongly typed application settings', async () => {
    await testDb.appSettings.put({ key: 'highContrast', value: true });
    await testDb.appSettings.put({ key: 'tileProvider', value: 'carto-dark' });
    await testDb.appSettings.put({ key: 'maxRenderedFeatures', value: 5000 });

    const highContrast = await testDb.appSettings.get('highContrast');
    const tileProvider = await testDb.appSettings.get('tileProvider');
    const maxFeatures = await testDb.appSettings.get('maxRenderedFeatures');

    expect(highContrast?.value).toBe(true);
    expect(tileProvider?.value).toBe('carto-dark');
    expect(maxFeatures?.value).toBe(5000);
  });

  it('purges all stores completely and resets sync state on purgeAllData()', async () => {
    await testDb.initializeDefaults();
    await testDb.appSettings.put({ key: 'testKey', value: 'testVal' });
    await testDb.hexStats.put({
      h3Index: '8828308281fffff',
      visitCount: 10,
      firstVisited: 1000,
      lastVisited: 2000,
    });

    expect(await testDb.hexStats.count()).toBe(1);
    expect(await testDb.appSettings.count()).toBeGreaterThanOrEqual(1);

    await testDb.purgeAllData();

    expect(await testDb.hexStats.count()).toBe(0);
    expect(await testDb.appSettings.count()).toBe(0);
    expect(await testDb.visits.count()).toBe(0);
    expect(await testDb.imports.count()).toBe(0);

    const resetSync = await testDb.syncState.get(PRIMARY_SYNC_ID);
    expect(resetSync?.totalUniqueHexes).toBe(0);
    expect(resetSync?.totalGridAreaKm2).toBe(0);
  });
});
