import maplibregl, {
  type Map as MapLibreMap,
  type MapOptions,
  type MapLayerMouseEvent,
  type Point,
} from 'maplibre-gl';
import type { HexStats } from '../types/domain.ts';
import {
  FOG_SOURCE_ID,
  GLOW_SOURCE_ID,
  HEX_SOURCE_ID,
  HEX_HEAT_LAYER_ID,
  createEmptyGeoJSONSourceSpec,
  createFogMaskLayerSpec,
  createDiscoveryGlowLayerSpec,
  createHexHeatLayerSpec,
} from './hex-layer-styles.ts';
import { ViewportController } from './viewport-controller.ts';
import { OfflineFallbackManager } from './offline-fallback.ts';
import { h3IndexToCenter } from '../spatial/h3.ts';
import { findBiggestClusterBounds } from '../spatial/viewport.ts';
import { formatCalendarDate } from '../validation/schemas.ts';

export const DEFAULT_DAYLIGHT_STYLE_URL = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

export interface MapEngineOptions {
  container: HTMLElement | string;
  styleUrl?: string;
  initialCenter?: [lng: number, lat: number];
  initialZoom?: number;
  onHexClick?: (h3Index: string, stats: { visitCount: number; firstVisited: number; lastVisited: number }) => void;
}

export class MapEngine {
  private map: MapLibreMap;
  private viewportController: ViewportController | null = null;
  private offlineManager: OfflineFallbackManager | null = null;
  private popup: maplibregl.Popup | null = null;
  private lastClickPoint: Point | null = null;
  private onHexClick?: MapEngineOptions['onHexClick'];

  constructor(options: MapEngineOptions) {
    this.onHexClick = options.onHexClick;

    const mapOptions: MapOptions = {
      container: options.container,
      style: options.styleUrl ?? DEFAULT_DAYLIGHT_STYLE_URL,
      center: options.initialCenter ?? [0, 20],
      zoom: options.initialZoom ?? 2,
      maxZoom: 18,
      minZoom: 1,
      attributionControl: false,
    };

    this.map = new maplibregl.Map(mapOptions);
    this.initMap();
  }

  private initMap(): void {
    this.offlineManager = new OfflineFallbackManager(this.map);

    this.map.on('load', () => {
      this.setupHexLayers();
      this.viewportController = new ViewportController(this.map);
      this.setupInteractions();
    });
  }

  private setupHexLayers(): void {
    // 1. Fog of War Mask Source & Layer
    if (!this.map.getSource(FOG_SOURCE_ID)) {
      this.map.addSource(FOG_SOURCE_ID, createEmptyGeoJSONSourceSpec());
      this.map.addLayer(createFogMaskLayerSpec());
    }

    // 2. Zoom-Out Discovery Glow Beacons Layer (Density Weighted & 60% Compact)
    if (!this.map.getSource(GLOW_SOURCE_ID)) {
      this.map.addSource(GLOW_SOURCE_ID, createEmptyGeoJSONSourceSpec());
      this.map.addLayer(createDiscoveryGlowLayerSpec());
    }

    // 3. Discovered Hexagons Interactive Hit Target Layer
    if (!this.map.getSource(HEX_SOURCE_ID)) {
      this.map.addSource(HEX_SOURCE_ID, createEmptyGeoJSONSourceSpec());
      this.map.addLayer(createHexHeatLayerSpec());
    }
  }

  private setupInteractions(): void {
    this.popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'strut-hex-popup',
    });

    // Pointer cursor on hover over discovered cells
    this.map.on('mouseenter', HEX_HEAT_LAYER_ID, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', HEX_HEAT_LAYER_ID, () => {
      this.map.getCanvas().style.cursor = '';
    });

    // Show popup on click
    this.map.on('click', HEX_HEAT_LAYER_ID, (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature || !feature.properties) return;

      const props = feature.properties as {
        h3Index: string;
        visitCount: number;
        firstVisited: number;
        lastVisited: number;
      };

      const firstDate = props.firstVisited > 0 ? formatCalendarDate(props.firstVisited) : 'N/A';
      const lastDate = props.lastVisited > 0 ? formatCalendarDate(props.lastVisited) : 'N/A';

      const content = `
        <div class="strut-popup-content">
          <strong>Explored Hexagon</strong>
          <div>Visits: <span>${props.visitCount} days</span></div>
          <div>First: <span>${firstDate}</span></div>
          <div>Last: <span>${lastDate}</span></div>
        </div>
      `;

      this.popup?.setLngLat(e.lngLat).setHTML(content).addTo(this.map);
      this.lastClickPoint = e.point;

      if (this.onHexClick) {
        this.onHexClick(props.h3Index, {
          visitCount: Number(props.visitCount),
          firstVisited: Number(props.firstVisited),
          lastVisited: Number(props.lastVisited),
        });
      }
    });

    // Remove popup once cursor moves away after clicking
    this.map.on('mousemove', (e: MapLayerMouseEvent) => {
      if (this.lastClickPoint && this.popup?.isOpen()) {
        const dx = e.point.x - this.lastClickPoint.x;
        const dy = e.point.y - this.lastClickPoint.y;
        if (Math.hypot(dx, dy) > 4) {
          this.popup.remove();
          this.lastClickPoint = null;
        }
      }
    });
  }

  /**
   * Updates the explored hex data displayed on the map
   */
  updateHexData(hexStatsList: HexStats[], autoFitCluster = false): void {
    if (this.viewportController) {
      this.viewportController.setHexData(hexStatsList);
    }
    if (autoFitCluster && hexStatsList.length > 0) {
      this.fitToBiggestCluster(hexStatsList);
    }
  }

  /**
   * Moves camera to frame the largest cluster of explored hexes
   */
  fitToBiggestCluster(hexStatsList: readonly HexStats[], animate = true): void {
    const bounds = findBiggestClusterBounds(hexStatsList);
    if (!bounds) return;

    const [minLng, minLat, maxLng, maxLat] = bounds;

    if (minLng === maxLng && minLat === maxLat) {
      this.map.flyTo({
        center: [minLng, minLat],
        zoom: 15,
        essential: true,
      });
      return;
    }

    this.map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: { top: 70, bottom: 70, left: 70, right: 70 },
        maxZoom: 16,
        animate,
        essential: true,
      },
    );
  }

  /**
   * Smoothly pans and zooms to a target H3 cell
   */
  flyToCell(h3Index: string, zoom = 16): void {
    const [lat, lng] = h3IndexToCenter(h3Index);
    this.map.flyTo({
      center: [lng, lat],
      zoom,
      essential: true,
    });
  }

  get mapInstance(): MapLibreMap {
    return this.map;
  }

  destroy(): void {
    this.popup?.remove();
    this.viewportController?.destroy();
    this.offlineManager?.destroy();
    this.map.remove();
  }
}
