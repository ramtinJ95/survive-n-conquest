import { TileKind, type TileMap } from './map';
import { hashUnit } from './noise';

export const TREES_PER_FOREST_TILE = 0.17;

/** Whether a tree stands on the tile. The seed picks about one forest tile in six. */
export function hasTree(map: TileMap, tile: number): boolean {
  if (map.kinds[tile] !== TileKind.Forest) return false;
  const { size } = map;
  return hashUnit(map.seed ^ 5, tile % size, Math.floor(tile / size)) < TREES_PER_FOREST_TILE;
}
