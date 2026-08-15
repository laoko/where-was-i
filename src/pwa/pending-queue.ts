import { db as defaultDb, StrutDB } from '../db/strut-db.ts';
import type { PendingImport } from '../types/domain.ts';

/**
 * Enqueues a shared or pending payload durably into IndexedDB
 */
export async function enqueuePendingImport(
  filename: string,
  payload: unknown,
  database: StrutDB = defaultDb,
): Promise<string> {
  const id = `pending_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const record: PendingImport = {
    id,
    filename,
    payload,
    createdAt: Date.now(),
  };

  await database.pendingImports.put(record);
  return id;
}

/**
 * Retrieves all pending import items ordered by creation time
 */
export async function getPendingImports(database: StrutDB = defaultDb): Promise<PendingImport[]> {
  return await database.pendingImports.orderBy('createdAt').toArray();
}

/**
 * Removes a pending import from the queue after successful ingestion
 */
export async function removePendingImport(id: string, database: StrutDB = defaultDb): Promise<void> {
  await database.pendingImports.delete(id);
}

/**
 * Clears all pending import items from the queue
 */
export async function clearPendingImports(database: StrutDB = defaultDb): Promise<void> {
  await database.pendingImports.clear();
}
