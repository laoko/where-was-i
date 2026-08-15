import type {
  FillLayerSpecification,
  LineLayerSpecification,
  HeatmapLayerSpecification,
  GeoJSONSourceSpecification,
} from 'maplibre-gl';

export const FOG_SOURCE_ID = 'strut-fog-source';
export const FOG_LAYER_ID = 'strut-fog-mask';

export const GLOW_SOURCE_ID = 'strut-glow-source';
export const GLOW_LAYER_ID = 'strut-discovery-glow';

export const HEX_SOURCE_ID = 'strut-hex-source';
export const HEX_HEAT_LAYER_ID = 'strut-hex-heat';
export const HEX_BORDER_LAYER_ID = 'strut-hex-borders';

/**
 * Creates empty GeoJSON source specification for MapLibre
 */
export function createEmptyGeoJSONSourceSpec(): GeoJSONSourceSpecification {
  return {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: [],
    },
  };
}

/**
 * Creates the dark "Fog of War" mask layer that obscures undiscovered map areas.
 * Discovered hexagon clusters are merged into single unified cutout holes,
 * completely eliminating any interior dividing lines or borders.
 */
export function createFogMaskLayerSpec(): FillLayerSpecification {
  return {
    id: FOG_LAYER_ID,
    type: 'fill',
    source: FOG_SOURCE_ID,
    paint: {
      'fill-color': '#18202c',
      'fill-opacity': 0.90,
      'fill-antialias': true,
    },
  };
}

/**
 * Creates GPU-accelerated discovery glow beacons for zoom-out views.
 * 1. Density-weighted: areas with more discovered tiles glow with radiant white cores.
 * 2. Zoom-adaptive: bright white beacons at continent level, smoothly fading to 0% opacity at city level.
 * 3. Scaled to ~60% compact size.
 */
export function createDiscoveryGlowLayerSpec(): HeatmapLayerSpecification {
  return {
    id: GLOW_LAYER_ID,
    type: 'heatmap',
    source: GLOW_SOURCE_ID,
    paint: {
      // 1. Weight by cluster density of discovered tiles
      'heatmap-weight': [
        'interpolate',
        ['linear'],
        ['get', 'hexCount'],
        1, 0.20,
        10, 0.40,
        50, 0.70,
        200, 1.0,
      ],
      // 2. Soft white/cyan glow gradient
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0.0, 'rgba(255, 255, 255, 0)',
        0.2, 'rgba(165, 230, 255, 0.35)',
        0.6, 'rgba(230, 245, 255, 0.80)',
        1.0, 'rgba(255, 255, 255, 1.0)',
      ],
      // 3. Compact radius (~60% of previous size) dynamically scaled with camera zoom
      'heatmap-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        1, 6,
        5, 13,
        9, 22,
      ],
      // 4. Smooth fade out: 95% at continent level down to 0% at city level (zoom >= 11)
      'heatmap-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        1, 0.95,
        6, 0.80,
        9, 0.35,
        11, 0.0,
      ],
    },
  };
}

/**
 * Invisible click hit-target layer on discovered hexagons to handle stats inspection on click
 */
export function createHexHeatLayerSpec(): FillLayerSpecification {
  return {
    id: HEX_HEAT_LAYER_ID,
    type: 'fill',
    source: HEX_SOURCE_ID,
    paint: {
      'fill-color': '#000000',
      'fill-opacity': 0.001, // Invisible to eye, fully interactive for clicks
    },
  };
}

/**
 * Optional border layer specification
 */
export function createHexBorderLayerSpec(): LineLayerSpecification {
  return {
    id: HEX_BORDER_LAYER_ID,
    type: 'line',
    source: HEX_SOURCE_ID,
    paint: {
      'line-color': 'transparent',
      'line-width': 0,
      'line-opacity': 0,
    },
  };
}
