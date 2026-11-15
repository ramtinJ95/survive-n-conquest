import type { FlowField } from './flowField';
import { DIRECTIONS, type TileMap, stepLength, stepTo, tileAt } from './map';
import type { Sim } from './sim';
import { type TileHeap, clearHeap, createTileHeap, popTile, pushTile } from './tileHeap';

/** A villager keeps this many tiles of its route. A longer route is planned again from its last kept tile. */
export const MAX_PATH = 256;

/** Scratch for `findPath`, so a search allocates nothing. Not part of the simulation's state. */
export interface PathSearch {
  /** Walk length from the start of the search, valid where `reached` holds the current search. */
  readonly walked: Float64Array;
  /** The tile each tile was reached from, back toward the start. */
  readonly parent: Int32Array;
  /** The search in which each tile was last reached, and last settled. */
  readonly reached: Uint32Array;
  readonly settled: Uint32Array;
  readonly heap: TileHeap;
  searches: number;
}

export function createPathSearch(tiles: number): PathSearch {
  return {
    walked: new Float64Array(tiles),
    parent: new Int32Array(tiles),
    reached: new Uint32Array(tiles),
    settled: new Uint32Array(tiles),
    heap: createTileHeap(tiles),
    searches: 0,
  };
}

/**
 * Equal keys go to the tile walked farther, so the search runs along one of many
 * equally short routes instead of widening across all of them. Walk lengths are
 * sums of 1 and √2 that differ by far more than this times a walk, so it never
 * orders unequal keys.
 */
const TIE_BREAK = 1e-9;

/** The shortest walk between two tiles over open land, where a diagonal step is √2 long. */
function octile(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return Math.max(ax, ay) + (Math.SQRT2 - 1) * Math.min(ax, ay);
}

/**
 * Searches for a shortest walk from `from` to `to` over the steps that units
 * take, by A*. When it returns true, following `parent` from `to` walks back to
 * `from`, where the parent is -1.
 *
 * The walks of a flow field to any goal guide the search as a landmark: no walk
 * between two tiles is shorter than the gap between their walks to the goal.
 * The camp's field guides it almost straight along a route that leaves the camp.
 */
export function findPath(map: TileMap, landmark: FlowField, search: PathSearch, from: number, to: number): boolean {
  const { size } = map;
  const { walked, parent, reached, settled, heap } = search;
  const landmarkWalk = landmark.walk;
  const current = ++search.searches;
  const toX = to % size;
  const toY = (to - toX) / size;
  const toWalk = landmarkWalk[to]!;
  walked[from] = 0;
  parent[from] = -1;
  reached[from] = current;
  pushTile(heap, from, octile((from % size) - toX, Math.floor(from / size) - toY));
  while (heap.size > 0) {
    const tile = popTile(heap);
    if (tile === to) {
      clearHeap(heap);
      return true;
    }
    settled[tile] = current;
    const x = tile % size;
    const y = (tile - x) / size;
    const here = walked[tile]!;
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const neighbor = stepTo(map, x, y, direction);
      if (neighbor < 0 || settled[neighbor] === current) continue;
      const through = here + stepLength(direction);
      if (reached[neighbor] === current && through >= walked[neighbor]!) continue;
      reached[neighbor] = current;
      walked[neighbor] = through;
      parent[neighbor] = tile;
      const nx = neighbor % size;
      const guess = Math.max(octile(nx - toX, (neighbor - nx) / size - toY), Math.abs(landmarkWalk[neighbor]! - toWalk));
      pushTile(heap, neighbor, through + guess - TIE_BREAK * through);
    }
  }
  return false;
}

/**
 * Plans the villager's route from where it stands to the center of tile `to`
 * and keeps up to `MAX_PATH` tiles of it. The first is the villager's own tile.
 * Returns false when no walk reaches `to`.
 */
export function planPath(sim: Sim, id: number, to: number): boolean {
  const { map, villagers, pathSearch } = sim;
  const here = tileAt(map, villagers.x[id]!, villagers.y[id]!);
  // Searching from the far end leaves parents that read forward from the villager's tile.
  if (!findPath(map, sim.flow, pathSearch, to, here)) return false;
  const { path } = villagers;
  const row = id * MAX_PATH;
  let length = 0;
  for (let tile = here; tile !== -1 && length < MAX_PATH; tile = pathSearch.parent[tile]!) path[row + length++] = tile;
  villagers.pathLength[id] = length;
  villagers.pathCursor[id] = 0;
  return true;
}
