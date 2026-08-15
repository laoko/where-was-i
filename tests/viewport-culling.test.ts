import { describe, it, expect } from 'vitest';
import {
  isPointInBBox,
  isH3CellInBBox,
  buildViewportGeoJSON,
  type BoundingBox,
} from '../src/spatial/viewport.ts';
import { pointToH3Index } from '../src/spatial/h3.ts';
import type { HexStats } from '../src/types/domain.ts';

describe('Viewport Culling & Spatial Filtering Engine', () => {
  const sfLat = 37.7749;
  const sfLng = -122.4194;
  const nyLat = 40.7128;
  const nyLng = -74.006;
  const londonLat = 51.5074;
  const londonLng = -0.1278;

  const sfHex = pointToH3Index(sfLat, sfLng);
  const nyHex = pointToH3Index(nyLat, nyLng);
  const londonHex = pointToH3Index(londonLat, londonLng);

  const mockStats: HexStats[] = [
    { h3Index: sfHex, visitCount: 1, firstVisited: 1000, lastVisited: 1000 },
    { h3Index: nyHex, visitCount: 12, firstVisited: 2000, lastVisited: 5000 },
    { h3Index: londonHex, visitCount: 5, firstVisited: 3000, lastVisited: 4000 },
  ];

  describe('isPointInBBox & isH3CellInBBox', () => {
    it('accurately identifies points inside and outside standard bounding boxes', () => {
      // Bounding box around California / SF
      const caBBox: BoundingBox = [-125, 32, -115, 42];

      expect(isPointInBBox(sfLat, sfLng, caBBox)).toBe(true);
      expect(isPointInBBox(nyLat, nyLng, caBBox)).toBe(false);
      expect(isH3CellInBBox(sfHex, caBBox)).toBe(true);
      expect(isH3CellInBBox(nyHex, caBBox)).toBe(false);
    });

    it('handles antimeridian crossing (+/- 180 deg) where minLng > maxLng', () => {
      // Viewport crossing the antimeridian: spans 170 deg E to -170 deg W
      const antimeridianBBox: BoundingBox = [170, -20, -170, 20];

      // Fiji / Pacific (178 deg E)
      expect(isPointInBBox(0, 178, antimeridianBBox)).toBe(true);
      // Samoa / Pacific (-172 deg W)
      expect(isPointInBBox(0, -172, antimeridianBBox)).toBe(true);
      // London (0 deg)
      expect(isPointInBBox(0, 0, antimeridianBBox)).toBe(false);
    });

    it('applies padding to prevent edge clipping near viewport boundaries', () => {
      const bbox: BoundingBox = [10.0, 30.0, 20.0, 40.0];

      // Slightly outside boundary without padding would fail, but with padding passes
      expect(isPointInBBox(29.99, 9.99, bbox, 0.02)).toBe(true);
    });
  });

  describe('buildViewportGeoJSON', () => {
    it('filters features against bounding box and creates valid FeatureCollection', () => {
      const caBBox: BoundingBox = [-125, 32, -115, 42];
      const geojson = buildViewportGeoJSON(mockStats, caBBox);

      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features).toHaveLength(1);
      expect(geojson.features[0]?.properties?.h3Index).toBe(sfHex);
      expect(geojson.features[0]?.properties?.tier).toBe('tier1');
    });

    it('returns all features when no bounding box is provided', () => {
      const geojson = buildViewportGeoJSON(mockStats);
      expect(geojson.features).toHaveLength(3);
    });

    it('strictly caps rendering budget at maxFeatures to prevent UI freezing', () => {
      // Generate 10 mock stats
      const manyStats: HexStats[] = [];
      for (let i = 0; i < 20; i++) {
        const hex = pointToH3Index(37.7 + i * 0.01, -122.4);
        manyStats.push({
          h3Index: hex,
          visitCount: i + 1,
          firstVisited: 1000,
          lastVisited: 2000,
        });
      }

      const cappedGeoJSON = buildViewportGeoJSON(manyStats, undefined, 5);
      expect(cappedGeoJSON.features).toHaveLength(5);
    });
  });
});
