export const DEFAULT_MAP_SIZE = 256;

/** Height of every water surface, in meters. Land heights are measured from it. */
export const WATER_LEVEL = 0;

export const TileKind = { Grass: 0, Water: 1, Forest: 2, Rock: 3 } as const;
export type TileKind = (typeof TileKind)[keyof typeof TileKind];

/**
 * A square grid of tiles, one meter each, stored row by row. Tile (x, y) is at
 * index `y * size + x`, and its center is at the map position (x + 0.5, y + 0.5).
 */
export interface TileMap {
  readonly seed: number;
  readonly size: number;
  /** Height of each tile center, in meters. */
  readonly heights: Float32Array;
  /** One `TileKind` for each tile. */
  readonly kinds: Uint8Array;
}

/** Ground height at a map position in tiles. Positions outside the map take the nearest edge. */
export function heightAt(map: TileMap, x: number, y: number): number {
  const { size, heights } = map;
  const cx = Math.min(Math.max(x - 0.5, 0), size - 1);
  const cy = Math.min(Math.max(y - 0.5, 0), size - 1);
  const x0 = Math.min(Math.floor(cx), size - 2);
  const y0 = Math.min(Math.floor(cy), size - 2);
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * size + x0;
  const top = heights[i]! + (heights[i + 1]! - heights[i]!) * fx;
  const bottom = heights[i + size]! + (heights[i + size + 1]! - heights[i + size]!) * fx;
  return top + (bottom - top) * fy;
}
