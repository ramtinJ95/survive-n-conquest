import { createFlowField } from './flowField';
import type { TileKind } from './map';
import type { Sim } from './sim';

/** Int32 values per changed tile in `takeTileChanges`: tile, kind, tree, good, count. */
export const TILE_CHANGE_STRIDE = 5;

/** The tiles changed since the last `takeTileChanges`, each listed once, in the order of their first change. */
export interface TileChanges {
  readonly listed: Uint8Array;
  readonly tiles: Int32Array;
  count: number;
}

export function createTileChanges(tiles: number): TileChanges {
  return { listed: new Uint8Array(tiles), tiles: new Int32Array(tiles), count: 0 };
}

/** Lists a tile whose kind, tree, or stack changed, for the renderer. */
export function noteTileChange(sim: Sim, tile: number): void {
  const changes = sim.tileChanges;
  if (changes.listed[tile]) return;
  changes.listed[tile] = 1;
  changes.tiles[changes.count++] = tile;
}

/** Changes the kind of a tile, records the change for the renderer, and routes around the tile from then on. */
export function changeTile(sim: Sim, tile: number, kind: TileKind): void {
  if (sim.map.kinds[tile] === kind) return;
  sim.map.kinds[tile] = kind;
  noteTileChange(sim, tile);
  sim.flow = createFlowField(sim.map, sim.camp);
}

/**
 * The tiles changed since the last call, as groups of `TILE_CHANGE_STRIDE`: a
 * tile index, then its kind, tree, stack good, and stack size now. Forgets them.
 */
export function takeTileChanges(sim: Sim): Int32Array {
  const changes = sim.tileChanges;
  const { kinds, trees, stackGood, stackSize } = sim.map;
  const groups = new Int32Array(changes.count * TILE_CHANGE_STRIDE);
  for (let i = 0; i < changes.count; i++) {
    const tile = changes.tiles[i]!;
    const at = i * TILE_CHANGE_STRIDE;
    groups[at] = tile;
    groups[at + 1] = kinds[tile]!;
    groups[at + 2] = trees[tile]!;
    groups[at + 3] = stackGood[tile]!;
    groups[at + 4] = stackSize[tile]!;
    changes.listed[tile] = 0;
  }
  changes.count = 0;
  return groups;
}
