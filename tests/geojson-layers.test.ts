import { describe, it, expect } from 'vitest';
import { buildViewportGeoJSON, buildFogMaskGeoJSON, findBiggestClusterBounds } from '../src/spatial/viewport.ts';
import {
  createEmptyGeoJSONSourceSpec,
  createFogMaskLayerSpec,
  createHexHeatLayerSpec,
  createHexBorderLayerSpec,
  FOG_SOURCE_ID,
  FOG_LAYER_ID,
  HEX_SOURCE_ID,
  HEX_HEAT_LAYER_ID,
  HEX_BORDER_LAYER_ID,
} from '../src/map/hex-layer-styles.ts';
import { pointToH3Index } from '../src/spatial/h3.ts';
import type { HexStats } from '../src/types/domain.ts';

describe('GeoJSON Polygon Features & MapLibre Layer Specifications', () => {
  const parisHex = pointToH3Index(48.8566, 2.3522);
  const mockStats: HexStats[] = [
    {
      h3Index: parisHex,
      visitCount: 15,
      firstVisited: Date.parse('2024-01-01T00:00:00.000Z'),
      lastVisited: Date.parse('2024-06-01T00:00:00.000Z'),
    },
  ];

  describe('Inverse Fog of War Mask Generation (Boolean Difference MultiPolygon)', () => {
    it('creates global MultiPolygon mask with clean cutout holes for discovered hexes', () => {
      const fogGeojson = buildFogMaskGeoJSON(mockStats);
      expect(fogGeojson.features).toHaveLength(1);

      const fogFeature = fogGeojson.features[0];
      expect(fogFeature?.geometry.type).toBe('MultiPolygon');

      const multiCoords = fogFeature?.geometry.coordinates;
      expect(multiCoords).toBeDefined();
      expect(multiCoords?.length).toBeGreaterThanOrEqual(1);

      const firstPolygon = multiCoords?.[0];
      expect(firstPolygon).toBeDefined();
      expect(firstPolygon?.length).toBeGreaterThanOrEqual(2); // 1 outer world ring + 1 cutout hole

      // Outer ring covers world bounds
      const outerRing = firstPolygon?.[0];
      expect(outerRing).toBeDefined();
      expect(outerRing?.length).toBeGreaterThanOrEqual(4);

      // Inner cutout hole is a closed boundary ring
      const innerHole = firstPolygon?.[1];
      expect(innerHole).toBeDefined();
      expect(innerHole?.length).toBeGreaterThanOrEqual(6);
      expect(innerHole?.[0]?.[0]).toBeCloseTo(innerHole?.[innerHole.length - 1]?.[0] ?? 0, 8);
    });
  });

  describe('Biggest Cluster Bounds Detection', () => {
    it('identifies bounding box for largest metropolitan cluster', () => {
      const oslo1 = pointToH3Index(59.9139, 10.7522);
      const oslo2 = pointToH3Index(59.9145, 10.7530);
      const tokyo = pointToH3Index(35.6762, 139.6503);

      const stats: HexStats[] = [
        { h3Index: oslo1, visitCount: 5, firstVisited: 100, lastVisited: 200 },
        { h3Index: oslo2, visitCount: 3, firstVisited: 100, lastVisited: 200 },
        { h3Index: tokyo, visitCount: 1, firstVisited: 100, lastVisited: 200 },
      ];

      const bounds = findBiggestClusterBounds(stats);
      expect(bounds).not.toBeNull();

      if (bounds) {
        const [minLng, minLat, maxLng, maxLat] = bounds;
        expect(minLng).toBeCloseTo(10.75, 1);
        expect(maxLng).toBeCloseTo(10.75, 1);
        expect(minLat).toBeCloseTo(59.91, 1);
        expect(maxLat).toBeCloseTo(59.91, 1);
      }
    });
  });

  describe('GeoJSON Polygon Ring Validation (RFC 7946)', () => {
    it('generates strictly valid closed polygon coordinates', () => {
      const geojson = buildViewportGeoJSON(mockStats);
      expect(geojson.features).toHaveLength(1);

      const feature = geojson.features[0];
      expect(feature).toBeDefined();
      expect(feature?.geometry.type).toBe('Polygon');

      const ring = feature?.geometry.coordinates[0];
      expect(ring).toBeDefined();
      expect(ring?.length).toBeGreaterThanOrEqual(4);

      // Verify closed ring: first vertex equals last vertex
      const firstCoord = ring?.[0];
      const lastCoord = ring?.[ring.length - 1];
      expect(firstCoord).toBeDefined();
      expect(lastCoord).toBeDefined();
      expect(firstCoord?.[0]).toBeCloseTo(lastCoord?.[0] ?? 0, 8);
      expect(firstCoord?.[1]).toBeCloseTo(lastCoord?.[1] ?? 0, 8);

      // Verify GeoJSON [lng, lat] coordinate bounds
      for (const [lng, lat] of ring ?? []) {
        expect(lng).toBeGreaterThanOrEqual(-180);
        expect(lng).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
      }
    });

    it('attaches required properties with correct heat tier and intensity', () => {
      const geojson = buildViewportGeoJSON(mockStats);
      const props = geojson.features[0]?.properties;

      expect(props).toBeDefined();
      expect(props?.h3Index).toBe(parisHex);
      expect(props?.visitCount).toBe(15);
      expect(props?.tier).toBe('tier3'); // 15 visits -> tier 3
      expect(props?.intensity).toBeGreaterThan(0.5);
      expect(props?.firstVisited).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
      expect(props?.lastVisited).toBe(Date.parse('2024-06-01T00:00:00.000Z'));
    });
  });

  describe('MapLibre Layer Specifications', () => {
    it('creates standard GeoJSON source specification', () => {
      const sourceSpec = createEmptyGeoJSONSourceSpec();
      expect(sourceSpec.type).toBe('geojson');
    });

    it('creates Fog of War mask layer specification', () => {
      const fogLayer = createFogMaskLayerSpec(false);
      expect(fogLayer.id).toBe(FOG_LAYER_ID);
      expect(fogLayer.source).toBe(FOG_SOURCE_ID);
      expect(fogLayer.type).toBe('fill');
      expect(fogLayer.paint?.['fill-color']).toBe('#18202c');
      expect(fogLayer.paint?.['fill-opacity']).toBe(0.9);
    });

    it('creates interactive hit layer and border specifications', () => {
      const heatFill = createHexHeatLayerSpec();
      expect(heatFill.id).toBe(HEX_HEAT_LAYER_ID);
      expect(heatFill.source).toBe(HEX_SOURCE_ID);

      const standardBorder = createHexBorderLayerSpec(false);
      expect(standardBorder.id).toBe(HEX_BORDER_LAYER_ID);
      expect(standardBorder.source).toBe(HEX_SOURCE_ID);
      expect(standardBorder.type).toBe('line');
    });
  });
});
