import { describe, it, expect } from 'vitest';
import { buildDiscoveryGlowGeoJSON, pickRandomDiscoveredHex } from '../src/spatial/viewport.ts';
import {
  createDiscoveryGlowLayerSpec,
  GLOW_LAYER_ID,
  GLOW_SOURCE_ID,
} from '../src/map/hex-layer-styles.ts';
import { pointToH3Index } from '../src/spatial/h3.ts';
import type { HexStats } from '../src/types/domain.ts';

describe('Discovery Glow Beacons (Density-Weighted & Zoom-Adaptive)', () => {
  it('returns empty feature collection for empty input', () => {
    const geojson = buildDiscoveryGlowGeoJSON([]);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(0);
  });

  it('aggregates hexagons into parent metropolitan clusters with density weights', () => {
    const cph1 = pointToH3Index(55.6761, 12.5683);
    const cph2 = pointToH3Index(55.6775, 12.5700);
    const tokyo = pointToH3Index(35.6762, 139.6503);

    const stats: HexStats[] = [
      { h3Index: cph1, visitCount: 10, firstVisited: 100, lastVisited: 200 },
      { h3Index: cph2, visitCount: 5, firstVisited: 100, lastVisited: 200 },
      { h3Index: tokyo, visitCount: 1, firstVisited: 100, lastVisited: 200 },
    ];

    const geojson = buildDiscoveryGlowGeoJSON(stats);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features).toHaveLength(2); // 1 for Copenhagen cluster, 1 for Tokyo

    const cphFeature = geojson.features.find((f) => f.properties.hexCount === 2);
    const tokyoFeature = geojson.features.find((f) => f.properties.hexCount === 1);

    expect(cphFeature).toBeDefined();
    expect(tokyoFeature).toBeDefined();

    // Copenhagen has more hexes -> higher weight
    expect(cphFeature?.properties.weight).toBeGreaterThan(tokyoFeature?.properties.weight ?? 0);
    expect(cphFeature?.geometry.type).toBe('Point');
    expect(cphFeature?.geometry.coordinates[0]).toBeCloseTo(12.57, 1);
    expect(cphFeature?.geometry.coordinates[1]).toBeCloseTo(55.67, 1);
  });

  it('creates valid MapLibre Heatmap specification with 60% compact radius and zoom curves', () => {
    const spec = createDiscoveryGlowLayerSpec();

    expect(spec.id).toBe(GLOW_LAYER_ID);
    expect(spec.source).toBe(GLOW_SOURCE_ID);
    expect(spec.type).toBe('heatmap');
    expect(spec.paint).toBeDefined();

    const paint = spec.paint as Record<string, unknown>;

    // Check 60% compact radius
    const radiusCurve = paint['heatmap-radius'] as unknown[];
    expect(radiusCurve).toBeDefined();
    expect(radiusCurve).toContain(6); // Zoom 1 radius is 6 (60% of 10)
    expect(radiusCurve).toContain(22); // Zoom 9 radius is 22 (60% of 36)

    // Check zoom fade configuration
    const opacityCurve = paint['heatmap-opacity'] as unknown[];
    expect(opacityCurve).toBeDefined();
    expect(Array.isArray(opacityCurve)).toBe(true);

    // Verify opacity is zero at city-level zoom 11
    const zoom11Idx = opacityCurve.indexOf(11);
    expect(zoom11Idx).toBeGreaterThan(0);
    expect(opacityCurve[zoom11Idx + 1]).toBe(0.0);
  });

  describe('Random Discovered Area Selection', () => {
    it('returns null for empty hex list', () => {
      expect(pickRandomDiscoveredHex([])).toBeNull();
    });

    it('selects a valid discovered hexagon with inverse density balancing', () => {
      const hex1 = pointToH3Index(55.6761, 12.5683);
      const hex2 = pointToH3Index(35.6762, 139.6503);

      const stats: HexStats[] = [
        { h3Index: hex1, visitCount: 20, firstVisited: 100, lastVisited: 200 },
        { h3Index: hex2, visitCount: 2, firstVisited: 100, lastVisited: 200 },
      ];

      const picked = pickRandomDiscoveredHex(stats);
      expect(picked).not.toBeNull();
      expect([hex1, hex2]).toContain(picked);
    });
  });
});
