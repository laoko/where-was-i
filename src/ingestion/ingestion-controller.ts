import type {
  IngestionOptions,
  IngestionSummary,
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from '../types/ingestion.ts';
import { runIngestionPipeline } from './ingestion-pipeline.ts';

export class IngestionController {
  private worker: Worker | null = null;
  private activeAbortController: AbortController | null = null;
  private isProcessing = false;

  /**
   * Starts ingestion. If a Web Worker constructor is available and requested, runs off-thread.
   * Otherwise runs directly through the pipeline.
   */
  async startIngestion(
    rawJson: unknown,
    options: IngestionOptions = {},
    useWorker = true,
  ): Promise<IngestionSummary> {
    if (this.isProcessing) {
      throw new Error('An ingestion job is already in progress.');
    }

    this.isProcessing = true;
    this.activeAbortController = new AbortController();

    // Link incoming signal if provided
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        this.cancel();
      });
    }

    try {
      if (useWorker && typeof Worker !== 'undefined') {
        return await this.runInWorker(rawJson, options);
      }

      return await runIngestionPipeline(rawJson, {
        ...options,
        signal: this.activeAbortController.signal,
      });
    } finally {
      this.isProcessing = false;
      this.activeAbortController = null;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
    }
  }

  /**
   * Cancels any active in-flight ingestion job.
   */
  cancel(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    if (this.worker) {
      const cancelMsg: WorkerIncomingMessage = {
        type: 'CANCEL',
        importId: '',
      };
      this.worker.postMessage(cancelMsg);
    }
  }

  get isRunning(): boolean {
    return this.isProcessing;
  }

  private runInWorker(rawJson: unknown, options: IngestionOptions): Promise<IngestionSummary> {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(new URL('../workers/ingestion.worker.ts', import.meta.url), {
          type: 'module',
        });

        const importId = `worker_job_${Date.now()}`;
        const startMsg: WorkerIncomingMessage = {
          type: 'START',
          payload: {
            importId,
            filename: options.filename ?? 'location_history.json',
            rawJson,
            fullReimport: options.fullReimport,
            batchSize: options.batchSize,
          },
        };

        this.worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
          const msg = event.data;
          if (msg.type === 'PROGRESS') {
            options.onProgress?.(msg.progress);
          } else if (msg.type === 'COMPLETE') {
            resolve(msg.summary);
          } else if (msg.type === 'ERROR') {
            reject(new Error(msg.error));
          }
        };

        this.worker.onerror = (err) => {
          reject(new Error(`Worker execution failed: ${err.message}`));
        };

        this.worker.postMessage(startMsg);
      } catch (err) {
        reject(err);
      }
    });
  }
}
