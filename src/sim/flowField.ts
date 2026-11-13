import { type TileMap, walkable } from './map';

/** Monsters enter on walkable tiles this close to the map edge. */
export const ENTRY_BAND = 4;

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Shortest walks over land from every tile to one goal tile, for any number of walkers. */
export interface FlowField {
  /** The walkable tile nearest the map center that a walk from the map edge reaches. */
  readonly goal: number;
  /** For each tile, the next tile on its shortest walk to the goal. The goal holds itself, and a tile with no walk holds -1. */
  readonly next: Int32Array;
  /** The walkable tiles within `ENTRY_BAND` of the map edge that have a walk to the goal. */
  readonly entrances: Int32Array;
}

/**
 * Calls `visit` with each tile one step from `tile` and the length of that step.
 * A step goes to one of the eight neighbors and cuts a corner only when both tiles beside it are walkable.
 */
function eachStep(map: TileMap, tile: number, visit: (neighbor: number, length: number) => void): void {
  const { size } = map;
  const x = tile % size;
  const y = Math.floor(tile / size);
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const neighbor = ny * size + nx;
    if (!walkable(map, neighbor)) continue;
    const diagonal = dx !== 0 && dy !== 0;
    if (diagonal && !(walkable(map, y * size + nx) && walkable(map, ny * size + x))) continue;
    visit(neighbor, diagonal ? Math.SQRT2 : 1);
  }
}

function inEntryBand(size: number, tile: number): boolean {
  const x = tile % size;
  const y = Math.floor(tile / size);
  return Math.min(x, y, size - 1 - x, size - 1 - y) < ENTRY_BAND;
}

/** The walkable tile nearest the map center among those that a walk from the entry band reaches. */
function findGoal(map: TileMap): number {
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

  let goal = -1;
  let nearest = Infinity;
  for (let tile = 0; tile < size * size; tile++) {
    if (!reached[tile]) continue;
    const dx = (tile % size) + 0.5 - size / 2;
    const dy = Math.floor(tile / size) + 0.5 - size / 2;
    if (dx * dx + dy * dy < nearest) {
      goal = tile;
      nearest = dx * dx + dy * dy;
    }
  }
  if (goal < 0) throw new Error(`seed ${map.seed} has no walkable tile near the map edge`);
  return goal;
}

/** A binary min-heap of tiles keyed by walk length. A tile can sit in it more than once. */
class TileQueue {
  private readonly tiles: number[] = [];
  private readonly lengths: number[] = [];

  get size(): number {
    return this.tiles.length;
  }

  push(tile: number, length: number): void {
    let at = this.tiles.length;
    this.tiles.push(tile);
    this.lengths.push(length);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.lengths[parent]! <= length) break;
      this.tiles[at] = this.tiles[parent]!;
      this.lengths[at] = this.lengths[parent]!;
      at = parent;
    }
    this.tiles[at] = tile;
    this.lengths[at] = length;
  }

  /** Removes the entry with the shortest length and returns its tile. */
  pop(): number {
    const top = this.tiles[0]!;
    const tile = this.tiles.pop()!;
    const length = this.lengths.pop()!;
    const size = this.tiles.length;
    if (size === 0) return top;
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= size) break;
      if (child + 1 < size && this.lengths[child + 1]! < this.lengths[child]!) child += 1;
      if (this.lengths[child]! >= length) break;
      this.tiles[at] = this.tiles[child]!;
      this.lengths[at] = this.lengths[child]!;
      at = child;
    }
    this.tiles[at] = tile;
    this.lengths[at] = length;
    return top;
  }
}

/**
 * Builds the flow field to the map center. When water or rock cuts the center
 * off from the map edge, the goal moves to the nearest land that the edge reaches.
 */
export function createFlowField(map: TileMap): FlowField {
  const { size } = map;
  const goal = findGoal(map);
  const walk = new Float64Array(size * size).fill(Infinity);
  const next = new Int32Array(size * size).fill(-1);
  const queue = new TileQueue();
  walk[goal] = 0;
  next[goal] = goal;
  queue.push(goal, 0);

  while (queue.size > 0) {
    const tile = queue.pop();
    eachStep(map, tile, (neighbor, length) => {
      const through = walk[tile]! + length;
      if (through >= walk[neighbor]!) return;
      walk[neighbor] = through;
      next[neighbor] = tile;
      queue.push(neighbor, through);
    });
  }

  const entrances: number[] = [];
  for (let tile = 0; tile < size * size; tile++) {
    if (inEntryBand(size, tile) && next[tile] !== -1) entrances.push(tile);
  }
  return { goal, next, entrances: Int32Array.from(entrances) };
}
