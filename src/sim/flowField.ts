import { DIRECTIONS, type TileMap, stepLength, stepTo } from './map';
import { type TileHeap, createTileHeap, popTile, pushTile } from './tileHeap';

/** Monsters enter on walkable tiles this close to the map edge. */
export const ENTRY_BAND = 4;

/**
 * Shortest walks over land from every tile to one goal tile, for any number of
 * walkers. The field changes in place when a tile opens or closes, and nothing
 * allocates after `createFlowField`.
 */
export interface FlowField {
  readonly goal: number;
  /** For each tile, the next tile on its shortest walk to the goal. The goal holds itself, and a tile with no walk holds -1. */
  readonly next: Int32Array;
  /** For each tile, the length of its shortest walk to the goal in tiles, or Infinity when it has none. */
  readonly walk: Float64Array;
  /** The first `entranceCount` entries are the walkable tiles within `ENTRY_BAND` of the map edge that have a walk to the goal. */
  readonly entrances: Int32Array;
  entranceCount: number;
  /** How many tiles have opened to walking since the field was built. A route can only have grown shorter since then. */
  openings: number;
  readonly heap: TileHeap;
}

export function inEntryBand(size: number, tile: number): boolean {
  const x = tile % size;
  const y = Math.floor(tile / size);
  return Math.min(x, y, size - 1 - x, size - 1 - y) < ENTRY_BAND;
}

function entryBandTiles(size: number): number {
  const inner = Math.max(size - 2 * ENTRY_BAND, 0);
  return size * size - inner * inner;
}

/** Settles every queued tile and spreads shorter walks from it, as Dijkstra's search does. */
function spread(map: TileMap, flow: FlowField): void {
  const { size } = map;
  const { walk, next, heap, entrances } = flow;
  while (heap.size > 0) {
    const tile = popTile(heap);
    const x = tile % size;
    const y = (tile - x) / size;
    const here = walk[tile]!;
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const neighbor = stepTo(map, x, y, direction);
      if (neighbor < 0) continue;
      const through = here + stepLength(direction);
      const before = walk[neighbor]!;
      if (through >= before) continue;
      if (before === Infinity && inEntryBand(size, neighbor)) entrances[flow.entranceCount++] = neighbor;
      walk[neighbor] = through;
      next[neighbor] = tile;
      pushTile(heap, neighbor, through);
    }
  }
}

/** Builds the whole field again in place, as a tile that stops walkers needs. */
export function rebuildFlowField(map: TileMap, flow: FlowField): void {
  const { goal, walk, next, entrances } = flow;
  walk.fill(Infinity);
  next.fill(-1);
  flow.entranceCount = 0;
  walk[goal] = 0;
  next[goal] = goal;
  if (inEntryBand(map.size, goal)) entrances[flow.entranceCount++] = goal;
  pushTile(flow.heap, goal, 0);
  spread(map, flow);
}

/** Builds the flow field to one goal tile, such as the camp. */
export function createFlowField(map: TileMap, goal: number): FlowField {
  const tiles = map.size * map.size;
  const flow: FlowField = {
    goal,
    next: new Int32Array(tiles),
    walk: new Float64Array(tiles),
    entrances: new Int32Array(entryBandTiles(map.size)),
    entranceCount: 0,
    openings: 0,
    heap: createTileHeap(tiles),
  };
  rebuildFlowField(map, flow);
  return flow;
}

/**
 * Brings the field up to date after `tile` turned walkable. Only walks can grow
 * shorter, so the search restarts from the tiles around it with the walks they
 * have. The 3x3 around the tile is queued, not only the tile, because its side
 * neighbors gain diagonal steps past it.
 */
export function openFlowTile(map: TileMap, flow: FlowField, tile: number): void {
  const { size } = map;
  const x = tile % size;
  const y = (tile - x) / size;
  for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, size - 1); ny++) {
    for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, size - 1); nx++) {
      const neighbor = ny * size + nx;
      const walk = flow.walk[neighbor]!;
      if (walk !== Infinity) pushTile(flow.heap, neighbor, walk);
    }
  }
  flow.openings += 1;
  spread(map, flow);
}
