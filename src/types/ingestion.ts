import type {
  SourceType,
  ImportStatus,
  IngestionProgress,
} from './domain.ts';

export interface IngestionOptions {
  readonly filename?: string | undefined;
  readonly fullReimport?: boolean | undefined;
  readonly batchSize?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: IngestionProgress) => void) | undefined;
}

export interface IngestionSummary {
  readonly importId: string;
  readonly filename: string;
  readonly sourceType: SourceType;
  readonly totalPoints: number;
  readonly validPoints: number;
  readonly droppedPoints: number;
  readonly newVisitsCount: number;
  readonly newHexCount: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly durationMs: number;
  readonly status: ImportStatus;
  readonly errorMessage?: string | undefined;
}

export interface WorkerStartPayload {
  readonly importId: string;
  readonly filename: string;
  readonly rawJson: unknown;
  readonly fullReimport?: boolean | undefined;
  readonly batchSize?: number | undefined;
}

export type WorkerIncomingMessage =
  | { readonly type: 'START'; readonly payload: WorkerStartPayload }
  | { readonly type: 'CANCEL'; readonly importId: string };

export type WorkerOutgoingMessage =
  | { readonly type: 'PROGRESS'; readonly importId: string; readonly progress: IngestionProgress }
  | { readonly type: 'COMPLETE'; readonly importId: string; readonly summary: IngestionSummary }
  | { readonly type: 'ERROR'; readonly importId: string; readonly error: string };
