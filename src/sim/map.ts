export const DEFAULT_MAP_SIZE = 256;

/** Height of every water surface, in meters. Land heights are measured from it. */
export const WATER_LEVEL = 0;

/** Bare is a spent rock tile: open ground at the height the rock had. House is a tile of a finished house. */
export const TileKind = { Grass: 0, Water: 1, Forest: 2, Rock: 3, Bare: 4, House: 5 } as const;
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
  /** 1 where a tree stands. Trees stand only on forest tiles. */
  readonly trees: Uint8Array;
  /** The `Good` that each tile's stack holds. */
  readonly stackGood: Uint8Array;
  /** How many units each tile's stack holds, from 0 to `STACK_LIMIT`. */
  readonly stackSize: Uint8Array;
}

/** A map with these heights and kinds, no trees, and no goods. */
export function createTileMap(seed: number, size: number, heights: Float32Array, kinds: Uint8Array): TileMap {
  const tiles = size * size;
  return {
    seed,
    size,
    heights,
    kinds,
    trees: new Uint8Array(tiles),
    stackGood: new Uint8Array(tiles),
    stackSize: new Uint8Array(tiles),
  };
}

export function copyMap(map: TileMap): TileMap {
  return {
    seed: map.seed,
    size: map.size,
    heights: map.heights.slice(),
    kinds: map.kinds.slice(),
    trees: map.trees.slice(),
    stackGood: map.stackGood.slice(),
    stackSize: map.stackSize.slice(),
  };
}

/** Units walk on grass, forest, and bare ground. Water, rock, and houses stop them. */
export function walkable(map: TileMap, tile: number): boolean {
  const kind = map.kinds[tile];
  return kind === TileKind.Grass || kind === TileKind.Forest || kind === TileKind.Bare;
}

/** The eight directions of a step, the four sides first. */
export const DIRECTIONS = 8;
const STEP_X = Int8Array.of(1, -1, 0, 0, 1, 1, -1, -1);
const STEP_Y = Int8Array.of(0, 0, 1, -1, 1, -1, 1, -1);

/**
 * The walkable tile one step from tile (x, y) in `direction`, or -1. A step goes
 * to one of the eight neighbors and cuts a corner only when both tiles beside it
 * are walkable.
 */
export function stepTo(map: TileMap, x: number, y: number, direction: number): number {
  const { size } = map;
  const nx = x + STEP_X[direction]!;
  const ny = y + STEP_Y[direction]!;
  if (nx < 0 || ny < 0 || nx >= size || ny >= size) return -1;
  const neighbor = ny * size + nx;
  if (!walkable(map, neighbor)) return -1;
  if (direction >= 4 && !(walkable(map, y * size + nx) && walkable(map, ny * size + x))) return -1;
  return neighbor;
}

/** The length of a step in `direction`, in tiles. */
export function stepLength(direction: number): number {
  return direction < 4 ? 1 : Math.SQRT2;
}

/** The tile one side step from tile (x, y) in `direction`, from 0 to 3, or -1 off the map. Walkable or not. */
export function sideOf(size: number, x: number, y: number, direction: number): number {
  const nx = x + STEP_X[direction]!;
  const ny = y + STEP_Y[direction]!;
  return nx < 0 || ny < 0 || nx >= size || ny >= size ? -1 : ny * size + nx;
}

/** The index of the tile under a map position inside the map. */
export function tileAt(map: TileMap, x: number, y: number): number {
  return Math.floor(y) * map.size + Math.floor(x);
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
