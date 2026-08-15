import type { HexStats } from '../types/domain.ts';
import {
  buildViewportGeoJSON,
  buildFogMaskGeoJSON,
  buildDiscoveryGlowGeoJSON,
  type BoundingBox,
} from '../spatial/viewport.ts';

let cachedHexStats: HexStats[] = [];

export interface ViewportWorkerIncomingMessage {
  readonly type: 'SET_HEX_DATA' | 'FILTER_VIEWPORT' | 'CLEAR_DATA';
  readonly hexStats?: HexStats[];
  readonly bbox?: BoundingBox;
  readonly requestId?: string;
}

export interface ViewportWorkerOutgoingMessage {
  readonly type: 'GEOJSON_RESULT';
  readonly requestId?: string;
  readonly fogGeojson: ReturnType<typeof buildFogMaskGeoJSON>;
  readonly hexGeojson: ReturnType<typeof buildViewportGeoJSON>;
  readonly glowGeojson: ReturnType<typeof buildDiscoveryGlowGeoJSON>;
  readonly featureCount: number;
  readonly executionTimeMs: number;
}

self.onmessage = (event: MessageEvent<ViewportWorkerIncomingMessage>) => {
  const { type, hexStats, bbox, requestId } = event.data;

  if (type === 'SET_HEX_DATA') {
    cachedHexStats = hexStats ?? [];
  } else if (type === 'CLEAR_DATA') {
    cachedHexStats = [];
  } else if (type === 'FILTER_VIEWPORT') {
    const startTime = performance.now();
    const fogGeojson = buildFogMaskGeoJSON(cachedHexStats, bbox);
    const hexGeojson = buildViewportGeoJSON(cachedHexStats, bbox);
    const glowGeojson = buildDiscoveryGlowGeoJSON(cachedHexStats);
    const executionTimeMs = performance.now() - startTime;

    const response: ViewportWorkerOutgoingMessage = {
      type: 'GEOJSON_RESULT',
      ...(requestId ? { requestId } : {}),
      fogGeojson,
      hexGeojson,
      glowGeojson,
      featureCount: hexGeojson.features.length,
      executionTimeMs,
    };

    self.postMessage(response);
  }
};
