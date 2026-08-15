import { describe, it, expect } from 'vitest';
import {
  pointToH3Index,
  isValidH3Index,
  h3IndexToCenter,
  h3IndexToGeoBoundary,
  getH3CellAreaKm2,
  computeTotalGridAreaKm2,
  calculateHeatmapIntensity,
  getHeatStyleForVisitCount,
} from '../src/spatial/h3.ts';
import { spatialBoundaryPoints } from './fixtures/boundaries.ts';

describe('H3 Spatial Indexing & Heatmap Styling', () => {
  describe('H3 Resolution 11 Operations (~35-50m footprint)', () => {
    const sfLat = 37.7749;
    const sfLng = -122.4194;

    it('indexes coordinates to Resolution 11 H3 cells', () => {
      const h3Index = pointToH3Index(sfLat, sfLng);
      expect(isValidH3Index(h3Index)).toBe(true);

      const [centerLat, centerLng] = h3IndexToCenter(h3Index);
      expect(centerLat).toBeCloseTo(sfLat, 2);
      expect(centerLng).toBeCloseTo(sfLng, 2);
    });

    it('calculates GeoJSON polygon boundaries with closed rings', () => {
      const h3Index = pointToH3Index(sfLat, sfLng);
      const boundary = h3IndexToGeoBoundary(h3Index);

      expect(boundary.length).toBeGreaterThanOrEqual(6);
      // GeoJSON coordinate order is [lng, lat]
      const first = boundary[0];
      const last = boundary[boundary.length - 1];
      expect(first).toBeDefined();
      expect(last).toBeDefined();
      expect(first?.[0]).toEqual(last?.[0]);
      expect(first?.[1]).toEqual(last?.[1]);
    });

    it('calculates realistic cell area in km²', () => {
      const h3Index = pointToH3Index(sfLat, sfLng);
      const area = getH3CellAreaKm2(h3Index);

      // Resolution 11 cell average is ~0.0021 km² (~2,150 m²)
      expect(area).toBeGreaterThan(0.001);
      expect(area).toBeLessThan(0.005);
    });

    it('computes aggregate grid area for unique cells', () => {
      const hex1 = pointToH3Index(37.7749, -122.4194);
      const hex2 = pointToH3Index(40.7128, -74.006); // NY
      const totalArea = computeTotalGridAreaKm2([hex1, hex2]);

      expect(totalArea).toBeCloseTo(getH3CellAreaKm2(hex1) + getH3CellAreaKm2(hex2), 5);
    });
  });

  describe('Spatial Boundaries', () => {
    it('handles Equator and Prime Meridian (0, 0)', () => {
      const pt = spatialBoundaryPoints.equatorPrimeMeridian;
      expect(pt).toBeDefined();
      if (!pt) return;
      const hex = pointToH3Index(pt.lat, pt.lng);
      expect(isValidH3Index(hex)).toBe(true);
    });

    it('handles antimeridian coordinates (+/-180 deg)', () => {
      const east = spatialBoundaryPoints.antimeridianEast;
      const west = spatialBoundaryPoints.antimeridianWest;
      expect(east).toBeDefined();
      expect(west).toBeDefined();
      if (!east || !west) return;

      const hexEast = pointToH3Index(east.lat, east.lng);
      const hexWest = pointToH3Index(west.lat, west.lng);
      expect(isValidH3Index(hexEast)).toBe(true);
      expect(isValidH3Index(hexWest)).toBe(true);
    });

    it('handles extreme polar latitudes', () => {
      const north = spatialBoundaryPoints.extremeNorth;
      const south = spatialBoundaryPoints.extremeSouth;
      expect(north).toBeDefined();
      expect(south).toBeDefined();
      if (!north || !south) return;

      const hexNorth = pointToH3Index(north.lat, north.lng);
      const hexSouth = pointToH3Index(south.lat, south.lng);
      expect(isValidH3Index(hexNorth)).toBe(true);
      expect(isValidH3Index(hexSouth)).toBe(true);
    });
  });

  describe('Logarithmic Heatmap & Visual Tiers', () => {
    it('calculates deterministic logarithmic intensity', () => {
      expect(calculateHeatmapIntensity(0)).toBe(0);
      const intensity1 = calculateHeatmapIntensity(1);
      expect(intensity1).toBeCloseTo(Math.log(2) / Math.log(51), 4);
      expect(calculateHeatmapIntensity(50)).toBe(1.0);
      expect(calculateHeatmapIntensity(100)).toBe(1.0); // Clamped to 1.0
    });

    it('assigns correct visual tiers according to visit count', () => {
      // 1 Visit: Tier 1 Cyan
      const tier1 = getHeatStyleForVisitCount(1);
      expect(tier1.tier).toBe('tier1');
      expect(tier1.fillOpacity).toBe(0.35);

      // 5 Visits: Tier 2 Green/Yellow
      const tier2 = getHeatStyleForVisitCount(5);
      expect(tier2.tier).toBe('tier2');
      expect(tier2.fillOpacity).toBe(0.55);

      // 15 Visits: Tier 3 Warm Gold/Orange
      const tier3 = getHeatStyleForVisitCount(15);
      expect(tier3.tier).toBe('tier3');
      expect(tier3.fillOpacity).toBe(0.85);
    });
  });
});
