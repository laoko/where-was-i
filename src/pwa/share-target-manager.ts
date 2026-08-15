import { getPendingImports, removePendingImport } from './pending-queue.ts';
import { IngestionController } from '../ingestion/ingestion-controller.ts';
import type { IngestionSummary } from '../types/ingestion.ts';
import type { IngestionProgress } from '../types/domain.ts';
import { db as defaultDb, StrutDB } from '../db/strut-db.ts';

export interface ShareTargetManagerOptions {
  onStartJob?: (filename: string) => void;
  onProgress?: (progress: IngestionProgress) => void;
  onJobComplete?: (summary: IngestionSummary) => void;
  onJobError?: (filename: string, error: Error) => void;
}

export class ShareTargetManager {
  private controller: IngestionController;
  private database: StrutDB;
  private options: ShareTargetManagerOptions;
  private isProcessing = false;

  constructor(
    controller = new IngestionController(),
    options: ShareTargetManagerOptions = {},
    database: StrutDB = defaultDb,
  ) {
    this.controller = controller;
    this.options = options;
    this.database = database;
  }

  /**
   * Scans the pendingImports queue and processes any awaiting files.
   */
  async processPendingImports(): Promise<IngestionSummary[]> {
    if (this.isProcessing) return [];
    this.isProcessing = true;

    const summaries: IngestionSummary[] = [];

    try {
      const pendingList = await getPendingImports(this.database);
      if (pendingList.length === 0) {
        return [];
      }

      for (const item of pendingList) {
        this.options.onStartJob?.(item.filename);

        try {
          const summary = await this.controller.startIngestion(
            item.payload,
            {
              filename: item.filename,
              onProgress: this.options.onProgress,
            },
            false, // Direct or worker
          );

          // Atomic delete only on confirmed completion
          await removePendingImport(item.id, this.database);
          summaries.push(summary);
          this.options.onJobComplete?.(summary);
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.options.onJobError?.(item.filename, error);
          // Keep in queue for retry or user intervention
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return summaries;
  }
}
