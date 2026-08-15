import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrutDB } from '../src/db/strut-db.ts';
import {
  enqueuePendingImport,
  getPendingImports,
  removePendingImport,
  clearPendingImports,
} from '../src/pwa/pending-queue.ts';
import { ShareTargetManager } from '../src/pwa/share-target-manager.ts';
import { IngestionController } from '../src/ingestion/ingestion-controller.ts';
import { validTakeoutPayload } from './fixtures/takeout.ts';

describe('PWA Web Share Target & Durable Queue', () => {
  let testDb: StrutDB;

  beforeEach(async () => {
    testDb = new StrutDB(`test_pwa_share_${Date.now()}_${Math.random()}`);
    await testDb.open();
    await testDb.initializeDefaults();
  });

  afterEach(async () => {
    await testDb.delete();
  });

  it('enqueues, retrieves, and removes pending imports durably', async () => {
    const queueId1 = await enqueuePendingImport('shared_takeout.json', validTakeoutPayload, testDb);
    const queueId2 = await enqueuePendingImport('timeline_data.json', { test: true }, testDb);

    expect(queueId1).toBeDefined();
    expect(queueId2).toBeDefined();

    const pending = await getPendingImports(testDb);
    expect(pending).toHaveLength(2);
    const filenames = pending.map((p) => p.filename);
    expect(filenames).toContain('shared_takeout.json');
    expect(filenames).toContain('timeline_data.json');

    // Remove first item
    await removePendingImport(queueId1, testDb);
    const remaining = await getPendingImports(testDb);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(queueId2);

    // Clear all
    await clearPendingImports(testDb);
    expect(await getPendingImports(testDb)).toHaveLength(0);
  });

  it('ShareTargetManager processes pending queue items and deletes on confirmed success', async () => {
    await enqueuePendingImport('shared_launch.json', validTakeoutPayload, testDb);
    expect(await getPendingImports(testDb)).toHaveLength(1);

    const onComplete = vi.fn();
    const onStart = vi.fn();

    const controller = new IngestionController();
    const manager = new ShareTargetManager(
      controller,
      {
        onStartJob: onStart,
        onJobComplete: onComplete,
      },
      testDb,
    );

    const summaries = await manager.processPendingImports();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.status).toBe('completed');
    expect(onStart).toHaveBeenCalledWith('shared_launch.json');
    expect(onComplete).toHaveBeenCalled();

    // Queue must be empty now because item was deleted on success
    const remaining = await getPendingImports(testDb);
    expect(remaining).toHaveLength(0);
  });

  it('ShareTargetManager retains item in queue if processing fails', async () => {
    // Corrupt payload
    await enqueuePendingImport('corrupt.json', { invalid: 'schema' }, testDb);
    expect(await getPendingImports(testDb)).toHaveLength(1);

    const onError = vi.fn();
    const controller = new IngestionController();
    const manager = new ShareTargetManager(
      controller,
      {
        onJobError: onError,
      },
      testDb,
    );

    const summaries = await manager.processPendingImports();
    expect(summaries).toHaveLength(0);
    expect(onError).toHaveBeenCalled();

    // Invariant: Failed job remains in queue for retry/recovery
    const remaining = await getPendingImports(testDb);
    expect(remaining).toHaveLength(1);
  });
});
