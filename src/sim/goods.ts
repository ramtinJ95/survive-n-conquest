import { DIRECTIONS, stepTo, walkable } from './map';
import { Claim } from './orders';
import type { Sim } from './sim';
import { noteTileChange } from './tileChanges';

export const Good = { None: 0, Log: 1, Stone: 2 } as const;
export type Good = (typeof Good)[keyof typeof Good];

/** A tile holds up to this many units of one good. */
export const STACK_LIMIT = 8;

/** Scratch for `putDown`'s walk, so putting goods down allocates nothing. Not part of the simulation's state. */
export interface PutDownSearch {
  /** The tiles the walk reached, in the order it reached them. */
  readonly queue: Int32Array;
  /** The search in which each tile was last reached. */
  readonly reached: Uint32Array;
  searches: number;
}

export function createPutDownSearch(tiles: number): PutDownSearch {
  return { queue: new Int32Array(tiles), reached: new Uint32Array(tiles), searches: 0 };
}

/** How many units of `good` a tile can still take: walkable, no site or house, and a stack that is empty or holds that good. */
function room(sim: Sim, tile: number, good: Good): number {
  const { map } = sim;
  if (!walkable(map, tile) || sim.orders.claims[tile] === Claim.Site) return 0;
  const size = map.stackSize[tile]!;
  if (size === 0) return STACK_LIMIT;
  return map.stackGood[tile] === good ? STACK_LIMIT - size : 0;
}

/**
 * Puts `units` of `good` down, starting on tile `from`. A unit that the tile
 * cannot take lands on the nearest tile that can, counted in steps of a walk
 * from `from`, so a walker there can reach every unit. When the land that walks
 * from `from` reach lacks room for all of them, nothing is put down and it
 * returns false.
 */
export function putDown(sim: Sim, from: number, good: Good, units: number): boolean {
  const { map } = sim;
  const { size, stackGood, stackSize } = map;
  const { queue, reached } = sim.putDownSearch;
  const search = ++sim.putDownSearch.searches;
  reached[from] = search;
  queue[0] = from;
  let head = 0;
  let tail = 1;
  let found = 0;
  while (head < tail && found < units) {
    const tile = queue[head++]!;
    found += room(sim, tile, good);
    const x = tile % size;
    const y = (tile - x) / size;
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const neighbor = stepTo(map, x, y, direction);
      if (neighbor < 0 || reached[neighbor] === search) continue;
      reached[neighbor] = search;
      queue[tail++] = neighbor;
    }
  }
  if (found < units) return false;

  let left = units;
  for (let i = 0; left > 0; i++) {
    const tile = queue[i]!;
    const placed = Math.min(room(sim, tile, good), left);
    if (placed === 0) continue;
    stackGood[tile] = good;
    stackSize[tile] = stackSize[tile]! + placed;
    left -= placed;
    noteTileChange(sim, tile);
  }
  return true;
}
