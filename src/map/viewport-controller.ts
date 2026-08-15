import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { HexStats } from '../types/domain.ts';
import type { BoundingBox } from '../spatial/viewport.ts';
import { buildViewportGeoJSON, buildFogMaskGeoJSON, buildDiscoveryGlowGeoJSON } from '../spatial/viewport.ts';
import type {
  ViewportWorkerIncomingMessage,
  ViewportWorkerOutgoingMessage,
} from '../workers/viewport.worker.ts';
import { HEX_SOURCE_ID, FOG_SOURCE_ID, GLOW_SOURCE_ID } from './hex-layer-styles.ts';

export const VIEWPORT_DEBOUNCE_MS = 50;

export interface ViewportControllerOptions {
  debounceMs?: number;
  useWorker?: boolean;
  onUpdate?: (featureCount: number, executionTimeMs: number) => void;
}

export class ViewportController {
  private map: MapLibreMap;
  private worker: Worker | null = null;
  private cachedHexStats: HexStats[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private useWorker: boolean;
  private onUpdate?: ((featureCount: number, executionTimeMs: number) => void) | undefined;
  private currentRequestId = 0;

  constructor(map: MapLibreMap, options: ViewportControllerOptions = {}) {
    this.map = map;
    this.debounceMs = options.debounceMs ?? VIEWPORT_DEBOUNCE_MS;
    this.useWorker = options.useWorker ?? (typeof Worker !== 'undefined');
    this.onUpdate = options.onUpdate;

    this.initWorker();
    this.attachMapListeners();
  }

  private initWorker(): void {
    if (this.useWorker && typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('../workers/viewport.worker.ts', import.meta.url), {
          type: 'module',
        });

        this.worker.onmessage = (event: MessageEvent<ViewportWorkerOutgoingMessage>) => {
          const { fogGeojson, hexGeojson, glowGeojson, featureCount, executionTimeMs, requestId } = event.data;
          // Discard out-of-order responses
          if (requestId && Number(requestId) < this.currentRequestId) {
            return;
          }
          this.applyFogToMap(fogGeojson);
          this.applyHexToMap(hexGeojson);
          if (glowGeojson) {
            this.applyGlowToMap(glowGeojson);
          }
          this.onUpdate?.(featureCount, executionTimeMs);
        };
      } catch {
        this.worker = null;
      }
    }
  }

  private attachMapListeners(): void {
    const triggerDebouncedUpdate = () => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.requestViewportUpdate();
      }, this.debounceMs);
    };

    this.map.on('moveend', triggerDebouncedUpdate);
    this.map.on('zoomend', triggerDebouncedUpdate);
    this.map.on('resize', triggerDebouncedUpdate);
  }

  /**
   * Updates in-memory/in-worker dataset of explored hexes
   */
  setHexData(hexStatsList: HexStats[]): void {
    this.cachedHexStats = hexStatsList;

    if (this.worker) {
      const msg: ViewportWorkerIncomingMessage = {
        type: 'SET_HEX_DATA',
        hexStats: hexStatsList,
      };
      this.worker.postMessage(msg);
    }

    this.requestViewportUpdate();
  }

  /**
   * Triggers viewport calculation for current bounding box
   */
  requestViewportUpdate(): void {
    if (!this.map.isStyleLoaded()) {
      return;
    }

    const bounds = this.map.getBounds();
    if (!bounds) return;

    const bbox: BoundingBox = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    this.currentRequestId++;
    const reqId = String(this.currentRequestId);

    if (this.worker) {
      const msg: ViewportWorkerIncomingMessage = {
        type: 'FILTER_VIEWPORT',
        bbox,
        requestId: reqId,
      };
      this.worker.postMessage(msg);
    } else {
      // Fallback synchronous in-memory calculation
      const start = performance.now();
      const fogGeojson = buildFogMaskGeoJSON(this.cachedHexStats, bbox);
      const hexGeojson = buildViewportGeoJSON(this.cachedHexStats, bbox);
      const glowGeojson = buildDiscoveryGlowGeoJSON(this.cachedHexStats);
      const executionTime = performance.now() - start;
      this.applyFogToMap(fogGeojson);
      this.applyHexToMap(hexGeojson);
      this.applyGlowToMap(glowGeojson);
      this.onUpdate?.(hexGeojson.features.length, executionTime);
    }
  }

  private applyFogToMap(fogGeojson: ReturnType<typeof buildFogMaskGeoJSON>): void {
    const source = this.map.getSource(FOG_SOURCE_ID) as GeoJSONSource | undefined;
    if (source && typeof source.setData === 'function') {
      source.setData(fogGeojson);
    }
  }

  private applyHexToMap(hexGeojson: ReturnType<typeof buildViewportGeoJSON>): void {
    const source = this.map.getSource(HEX_SOURCE_ID) as GeoJSONSource | undefined;
    if (source && typeof source.setData === 'function') {
      source.setData(hexGeojson);
    }
  }

  private applyGlowToMap(glowGeojson: ReturnType<typeof buildDiscoveryGlowGeoJSON>): void {
    const source = this.map.getSource(GLOW_SOURCE_ID) as GeoJSONSource | undefined;
    if (source && typeof source.setData === 'function') {
      source.setData(glowGeojson);
    }
  }

  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
