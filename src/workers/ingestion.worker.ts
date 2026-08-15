import { runIngestionPipeline } from '../ingestion/ingestion-pipeline.ts';
import type {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from '../types/ingestion.ts';
import { db } from '../db/strut-db.ts';

let activeAbortController: AbortController | null = null;

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const msg = event.data;

  if (msg.type === 'START') {
    const { importId, filename, rawJson, fullReimport, batchSize } = msg.payload;
    activeAbortController = new AbortController();

    try {
      const summary = await runIngestionPipeline(
        rawJson,
        {
          filename,
          fullReimport,
          batchSize,
          signal: activeAbortController.signal,
          onProgress: (progress) => {
            const out: WorkerOutgoingMessage = {
              type: 'PROGRESS',
              importId,
              progress,
            };
            self.postMessage(out);
          },
        },
        db,
      );

      const completeMsg: WorkerOutgoingMessage = {
        type: 'COMPLETE',
        importId,
        summary,
      };
      self.postMessage(completeMsg);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown worker error';
      const outError: WorkerOutgoingMessage = {
        type: 'ERROR',
        importId,
        error: errorMsg,
      };
      self.postMessage(outError);
    } finally {
      activeAbortController = null;
    }
  } else if (msg.type === 'CANCEL') {
    if (activeAbortController) {
      activeAbortController.abort();
    }
  }
};
