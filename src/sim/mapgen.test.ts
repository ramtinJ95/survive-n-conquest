import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_SIZE, TileKind, WATER_LEVEL } from './map';
import { generateMap } from './mapgen';

const SEEDS = [1, 7, 42, 1234, 0xdeadbeef];

function share(kinds: Uint8Array, kind: TileKind): number {
  return kinds.reduce((count, tile) => count + (tile === kind ? 1 : 0), 0) / kinds.length;
}

describe('generateMap', () => {
  it('builds a 256 by 256 map by default, in typed arrays', () => {
    const map = generateMap(7);
    expect(map.size).toBe(DEFAULT_MAP_SIZE);
    expect(DEFAULT_MAP_SIZE).toBe(256);
    expect(map.heights).toBeInstanceOf(Float32Array);
    expect(map.kinds).toBeInstanceOf(Uint8Array);
    expect(map.heights.length).toBe(256 * 256);
    expect(map.kinds.length).toBe(256 * 256);
  });

  it('gives the same map for the same seed', () => {
    const first = generateMap(42);
    const second = generateMap(42);
    expect(second.heights).toEqual(first.heights);
    expect(second.kinds).toEqual(first.kinds);
  });

  it('gives different maps for different seeds', () => {
    const first = generateMap(1, 64);
    const second = generateMap(2, 64);
    const moved = first.heights.filter((height, i) => Math.abs(height - second.heights[i]!) > 0.5);
    expect(moved.length).toBeGreaterThan(first.heights.length / 2);
    const retyped = first.kinds.filter((kind, i) => kind !== second.kinds[i]);
    expect(retyped.length).toBeGreaterThan(first.kinds.length / 5);
  });

  it('honors the requested size', () => {
    const map = generateMap(7, 96);
    expect(map.size).toBe(96);
    expect(map.heights.length).toBe(96 * 96);
  });

  it.each(SEEDS)('puts hills, water, forest, and rock on the map for seed %i', (seed) => {
    const { heights, kinds } = generateMap(seed);
    expect(share(kinds, TileKind.Water)).toBeGreaterThan(0.02);
    expect(share(kinds, TileKind.Water)).toBeLessThan(0.4);
    expect(share(kinds, TileKind.Forest)).toBeGreaterThan(0.1);
    expect(share(kinds, TileKind.Rock)).toBeGreaterThan(0.02);
    expect(share(kinds, TileKind.Grass)).toBeGreaterThan(0.2);
    expect(Math.max(...heights)).toBeGreaterThan(WATER_LEVEL + 10);
  });

  it.each(SEEDS)('covers exactly the tiles below the water level with water for seed %i', (seed) => {
    const { heights, kinds } = generateMap(seed);
    const mismatched = kinds.filter(
      (kind, i) => (kind === TileKind.Water) !== heights[i]! < WATER_LEVEL,
    );
    expect(mismatched.length).toBe(0);
  });

  it.each(SEEDS)('keeps every height finite and every tile a known kind for seed %i', (seed) => {
    const { heights, kinds } = generateMap(seed);
    expect(heights.every(Number.isFinite)).toBe(true);
    const known = new Set<number>(Object.values(TileKind));
    expect(kinds.every((kind) => known.has(kind))).toBe(true);
  });
});
