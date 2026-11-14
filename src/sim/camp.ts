import { eachStep, inEntryBand } from './flowField';
import { type TileMap, walkable } from './map';

/**
 * The tile where the settlement starts: the walkable tile nearest the map
 * center that a walk from the map edge reaches. When water or rock cuts the
 * center off from the edge, the camp moves to the nearest land the edge reaches.
 */
export function campTile(map: TileMap): number {
  const { size } = map;
  const reached = new Uint8Array(size * size);
  const open: number[] = [];
  for (let tile = 0; tile < size * size; tile++) {
    if (inEntryBand(size, tile) && walkable(map, tile)) {
      reached[tile] = 1;
      open.push(tile);
    }
  }
  while (open.length > 0) {
    eachStep(map, open.pop()!, (neighbor) => {
      if (reached[neighbor]) return;
      reached[neighbor] = 1;
      open.push(neighbor);
    });
  }

  let camp = -1;
  let nearest = Infinity;
  for (let tile = 0; tile < size * size; tile++) {
    if (!reached[tile]) continue;
    const dx = (tile % size) + 0.5 - size / 2;
    const dy = Math.floor(tile / size) + 0.5 - size / 2;
    if (dx * dx + dy * dy < nearest) {
      camp = tile;
      nearest = dx * dx + dy * dy;
    }
  }
  if (camp < 0) throw new Error(`seed ${map.seed} has no walkable tile near the map edge`);
  return camp;
}

/** The camp is a disc of this radius around the center of its tile, in meters. */
export const CAMP_RADIUS = 2;

/** Whether any part of a tile lies under the camp's disc. */
export function underCamp(map: TileMap, camp: number, tile: number): boolean {
  const { size } = map;
  const dx = Math.max(Math.abs((tile % size) - (camp % size)) - 0.5, 0);
  const dy = Math.max(Math.abs(Math.floor(tile / size) - Math.floor(camp / size)) - 0.5, 0);
  return dx * dx + dy * dy < CAMP_RADIUS * CAMP_RADIUS;
}
