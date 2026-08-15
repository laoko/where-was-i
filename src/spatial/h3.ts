import {
  latLngToCell,
  cellToLatLng,
  cellToBoundary,
  cellArea,
  isValidCell,
  UNITS,
} from 'h3-js';

export const H3_RESOLUTION = 11;

/**
 * Standard average area in km² for Resolution 11 cells (~25m edge length, ~35-50m span)
 */
export const H3_RES_11_AVG_AREA_KM2 = 0.0021496;

/**
 * Converts a geographic coordinate to an H3 Resolution 11 index string.
 */
export function pointToH3Index(lat: number, lng: number, resolution = H3_RESOLUTION): string {
  return latLngToCell(lat, lng, resolution);
}

/**
 * Validates whether a string is a valid H3 cell index.
 */
export function isValidH3Index(h3Index: string): boolean {
  return isValidCell(h3Index);
}

/**
 * Retrieves the center (lat, lng) of an H3 cell.
 */
export function h3IndexToCenter(h3Index: string): [number, number] {
  return cellToLatLng(h3Index);
}

/**
 * Retrieves GeoJSON polygon boundary coordinates for an H3 cell.
 * Returns array of [lng, lat] coordinate pairs suitable for GeoJSON Polygon.
 */
export function h3IndexToGeoBoundary(h3Index: string): [number, number][] {
  // h3-js cellToBoundary returns [[lat, lng], ...]
  const boundary = cellToBoundary(h3Index);
  // Convert to GeoJSON [lng, lat] format
  const coords: [number, number][] = boundary.map(([lat, lng]) => [lng, lat]);

  // Ensure closed polygon ring if needed
  if (coords.length > 0) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      coords.push([first[0], first[1]]);
    }
  }

  return coords;
}

/**
 * Computes exact spherical area in square kilometers for an H3 cell.
 */
export function getH3CellAreaKm2(h3Index: string): number {
  return cellArea(h3Index, UNITS.km2);
}

/**
 * Computes the total grid area explored for a set of unique H3 cells.
 */
export function computeTotalGridAreaKm2(h3Indices: Iterable<string>): number {
  let totalArea = 0;
  for (const index of h3Indices) {
    totalArea += getH3CellAreaKm2(index);
  }
  return totalArea;
}

/**
 * Logarithmic Heatmap Intensity calculation
 * Formula: min(1.0, ln(1 + visitCount) / ln(1 + 50))
 */
export function calculateHeatmapIntensity(visitCount: number): number {
  if (visitCount <= 0) return 0;
  const numerator = Math.log(1 + visitCount);
  const denominator = Math.log(1 + 50);
  return Math.min(1.0, numerator / denominator);
}

export type HeatTier = 'tier1' | 'tier2' | 'tier3';

export interface HeatStyle {
  readonly tier: HeatTier;
  readonly intensity: number;
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly strokeColor: string;
  readonly strokeWidth: number;
}

/**
 * Evaluates the multi-cue visual tier for an explored hex based on distinct calendar visit count.
 * - 1 Visit: Translucent Cool Cyan (opacity: 0.35, thin border)
 * - 2-9 Visits: Vibrant Green/Yellow Gradient (opacity: 0.55)
 * - 10+ Visits: High-Intensity Warm Gold/Orange (opacity: 0.85, glowing border)
 */
export function getHeatStyleForVisitCount(visitCount: number): HeatStyle {
  const intensity = calculateHeatmapIntensity(visitCount);

  if (visitCount <= 1) {
    return {
      tier: 'tier1',
      intensity,
      fillColor: '#00e5ff', // Cyan
      fillOpacity: 0.35,
      strokeColor: '#00e5ff',
      strokeWidth: 1,
    };
  }

  if (visitCount < 10) {
    return {
      tier: 'tier2',
      intensity,
      fillColor: '#a6e22e', // Green/Yellow
      fillOpacity: 0.55,
      strokeColor: '#c6ff00',
      strokeWidth: 1.5,
    };
  }

  return {
    tier: 'tier3',
    intensity,
    fillColor: '#ff9100', // Gold/Orange
    fillOpacity: 0.85,
    strokeColor: '#ffab00',
    strokeWidth: 2,
  };
}
