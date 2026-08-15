import type { FeatureCollection, Feature, Polygon, MultiPolygon, Position } from 'geojson';
import polygonClipping, {
  type Polygon as ClippingPolygon,
  type MultiPolygon as ClippingMultiPolygon,
} from 'polygon-clipping';
import {
  h3IndexToCenter,
  h3IndexToGeoBoundary,
  calculateHeatmapIntensity,
  getHeatStyleForVisitCount,
} from './h3.ts';
import { cellsToMultiPolygon, cellToParent } from 'h3-js';
import type { HexStats } from '../types/domain.ts';

export type BoundingBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

export const MAX_VIEWPORT_FEATURES = 15_000;
export const VIEWPORT_PADDING_DEG = 0.003; // ~300m margin suited for Resolution 11 (~35-50m hexes)

export interface HexFeatureProperties {
  readonly h3Index: string;
  readonly visitCount: number;
  readonly intensity: number;
  readonly tier: 'tier1' | 'tier2' | 'tier3';
  readonly firstVisited: number;
  readonly lastVisited: number;
  readonly [key: string]: unknown;
}

/**
 * Checks if a point (lat, lng) falls within a bounding box (including antimeridian handling).
 */
export function isPointInBBox(
  lat: number,
  lng: number,
  bbox: BoundingBox,
  padding = VIEWPORT_PADDING_DEG,
): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const paddedMinLat = Math.max(-90, minLat - padding);
  const paddedMaxLat = Math.min(90, maxLat + padding);

  if (lat < paddedMinLat || lat > paddedMaxLat) {
    return false;
  }

  // Antimeridian crossing check (e.g., minLng = 175, maxLng = -175)
  if (minLng > maxLng) {
    const paddedMinLng = minLng - padding;
    const paddedMaxLng = maxLng + padding;
    return lng >= paddedMinLng || lng <= paddedMaxLng;
  }

  const paddedMinLng = Math.max(-180, minLng - padding);
  const paddedMaxLng = Math.min(180, maxLng + padding);
  return lng >= paddedMinLng && lng <= paddedMaxLng;
}

/**
 * Checks if an H3 cell falls within a given bounding box based on its center point.
 */
export function isH3CellInBBox(
  h3Index: string,
  bbox: BoundingBox,
  padding = VIEWPORT_PADDING_DEG,
): boolean {
  const [lat, lng] = h3IndexToCenter(h3Index);
  return isPointInBBox(lat, lng, bbox, padding);
}

/**
 * Generates an inverted "Fog of War" mask using robust polygon clipping.
 * Performs geometric boolean difference (World - Discovered Hexagons) to guarantee:
 * 1. 100% artifact-free rendering without cross-cluster bridge edges or WebGL shards.
 * 2. Proper winding order and topology across all zoom levels and multiple disjoint clusters.
 * 3. Zero internal lines or dividing seams between adjacent hexagons.
 */
export function buildFogMaskGeoJSON(
  hexStatsList: readonly HexStats[],
  bbox?: BoundingBox,
  maxFeatures = MAX_VIEWPORT_FEATURES,
): FeatureCollection<MultiPolygon> {
  const worldPoly: ClippingPolygon = [
    [
      [-180, -90],
      [180, -90],
      [180, 90],
      [-180, 90],
      [-180, -90],
    ],
  ];

  const visibleCells: string[] = [];
  for (const stat of hexStatsList) {
    if (bbox && !isH3CellInBBox(stat.h3Index, bbox)) {
      continue;
    }
    visibleCells.push(stat.h3Index);
    if (visibleCells.length >= maxFeatures) {
      break;
    }
  }

  if (visibleCells.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'fog-mask-world',
          geometry: {
            type: 'MultiPolygon',
            coordinates: [worldPoly] as unknown as Position[][][],
          },
          properties: { discoveredCount: 0 },
        },
      ],
    };
  }

  // 1. Group contiguous cells into clean GeoJSON MultiPolygons
  const hexMultiPolys = cellsToMultiPolygon(visibleCells, true) as unknown as ClippingMultiPolygon;

  // 2. Perform robust 2D boolean difference: World - Discovered Hexagons
  const differenceResult = polygonClipping.difference(worldPoly, hexMultiPolys);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'fog-mask-world',
        geometry: {
          type: 'MultiPolygon',
          coordinates: differenceResult as unknown as Position[][][],
        },
        properties: { discoveredCount: visibleCells.length },
      },
    ],
  };
}

/**
 * Filters a collection of HexStats by viewport bounding box and converts to a GeoJSON FeatureCollection.
 * Used for click hit-testing and tooltip data inspection.
 */
export function buildViewportGeoJSON(
  hexStatsList: readonly HexStats[],
  bbox?: BoundingBox,
  maxFeatures = MAX_VIEWPORT_FEATURES,
): FeatureCollection<Polygon, HexFeatureProperties> {
  const features: Feature<Polygon, HexFeatureProperties>[] = [];

  for (const stat of hexStatsList) {
    if (bbox && !isH3CellInBBox(stat.h3Index, bbox)) {
      continue;
    }

    const coords = h3IndexToGeoBoundary(stat.h3Index);
    const intensity = calculateHeatmapIntensity(stat.visitCount);
    const heatStyle = getHeatStyleForVisitCount(stat.visitCount);

    features.push({
      type: 'Feature',
      id: stat.h3Index,
      geometry: {
        type: 'Polygon',
        coordinates: [coords],
      },
      properties: {
        h3Index: stat.h3Index,
        visitCount: stat.visitCount,
        intensity,
        tier: heatStyle.tier,
        firstVisited: stat.firstVisited,
        lastVisited: stat.lastVisited,
      },
    });

    if (features.length >= maxFeatures) {
      break;
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Finds the geographic bounding box of the largest cluster of explored hexes
 * (grouped by metropolitan parent H3 resolution 6 cells).
 */
export function findBiggestClusterBounds(
  hexStatsList: readonly HexStats[],
): [minLng: number, minLat: number, maxLng: number, maxLat: number] | null {
  if (hexStatsList.length === 0) return null;

  // Group by Resolution 6 parent (~15km metropolitan bucket)
  const clusterMap = new Map<string, HexStats[]>();
  for (const stat of hexStatsList) {
    const parent = cellToParent(stat.h3Index, 6);
    let list = clusterMap.get(parent);
    if (!list) {
      list = [];
      clusterMap.set(parent, list);
    }
    list.push(stat);
  }

  let biggestCluster: HexStats[] = [];
  for (const list of clusterMap.values()) {
    if (list.length > biggestCluster.length) {
      biggestCluster = list;
    }
  }

  if (biggestCluster.length === 0) return null;

  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;

  for (const stat of biggestCluster) {
    const [lat, lng] = h3IndexToCenter(stat.h3Index);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}

export interface GlowFeatureProperties {
  readonly hexCount: number;
  readonly weight: number;
}

/**
 * Aggregates all explored hexagons into metropolitan parent clusters (Resolution 6, ~15km buckets)
 * and generates a lightweight Point FeatureCollection for density-weighted zoom-out glow beacons.
 */
export function buildDiscoveryGlowGeoJSON(
  hexStatsList: readonly HexStats[],
): FeatureCollection<import('geojson').Point, GlowFeatureProperties> {
  if (hexStatsList.length === 0) {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  const clusterMap = new Map<string, { count: number; sumLat: number; sumLng: number }>();

  for (const stat of hexStatsList) {
    const parent = cellToParent(stat.h3Index, 6);
    const [lat, lng] = h3IndexToCenter(stat.h3Index);
    const existing = clusterMap.get(parent);
    if (existing) {
      existing.count++;
      existing.sumLat += lat;
      existing.sumLng += lng;
    } else {
      clusterMap.set(parent, { count: 1, sumLat: lat, sumLng: lng });
    }
  }

  const features: Feature<import('geojson').Point, GlowFeatureProperties>[] = [];

  for (const [parentHex, data] of clusterMap.entries()) {
    const avgLat = data.sumLat / data.count;
    const avgLng = data.sumLng / data.count;
    const weight = Math.min(1.0, Math.log(1 + data.count) / Math.log(1 + 250));

    features.push({
      type: 'Feature',
      id: `glow-${parentHex}`,
      geometry: {
        type: 'Point',
        coordinates: [avgLng, avgLat],
      },
      properties: {
        hexCount: data.count,
        weight,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
