import { TICKS_PER_SECOND } from './calendar';
import { Good, putDown } from './goods';
import { TileKind, type TileMap, sideOf } from './map';
import { Claim, setClaim } from './orders';
import { planPath } from './paths';
import type { Sim } from './sim';
import type { TaskKind } from './tasks';
import { changeTile, noteTileChange } from './tileChanges';

/** Work ticks by one villager that fell a tree. */
export const TREE_WORK_TICKS = 20 * TICKS_PER_SECOND;
/** Work ticks by one villager that quarry one stone from a rock tile. */
export const STONE_WORK_TICKS = 20 * TICKS_PER_SECOND;
export const LOGS_PER_TREE = 2;
/** Stone a rock tile gives before it is spent. */
export const STONE_PER_ROCK = 8;

const CHUNK_SHIFT = 4;
const CHUNK = 1 << CHUNK_SHIFT;

/**
 * Chopping and quarrying, as tile state the size of the map. A task is one tree
 * to fell or one stone to quarry, on a tile marked for it. The open tasks are
 * counted by 16 by 16 chunk, so the search for the nearest skips empty land.
 */
export interface Gathering {
  /** The villager that holds each tile's task, or -1. */
  readonly taker: Int32Array;
  /** Work ticks done on each tile toward its tree or its next stone. Work stays when the worker leaves. */
  readonly progress: Uint16Array;
  /** Stone each rock tile has given. */
  readonly yielded: Uint8Array;
  /** 1 where the task is set aside as out of reach, until dawn or until a rock tile is spent. */
  readonly setAside: Uint8Array;
  /** The first `setAsideCount` are the tiles set aside. */
  readonly setAsideTiles: Int32Array;
  setAsideCount: number;
  /** 1 where a task is open: marked, workable, untaken, and not set aside. */
  readonly open: Uint8Array;
  /** Open tasks in each chunk, row by row. */
  readonly chunkOpen: Int32Array;
  /** Chunks along each side of the map. */
  readonly chunks: number;
  openCount: number;
}

export function createGathering(map: TileMap): Gathering {
  const tiles = map.size * map.size;
  const chunks = Math.ceil(map.size / CHUNK);
  return {
    taker: new Int32Array(tiles).fill(-1),
    progress: new Uint16Array(tiles),
    yielded: new Uint8Array(tiles),
    setAside: new Uint8Array(tiles),
    setAsideTiles: new Int32Array(tiles),
    setAsideCount: 0,
    open: new Uint8Array(tiles),
    chunkOpen: new Int32Array(chunks * chunks),
    chunks,
    openCount: 0,
  };
}

/** Whether a tile beside the rock tile has a walk to the camp, so a villager can stand there to quarry. */
function reachableSide(sim: Sim, tile: number): boolean {
  const { size } = sim.map;
  const x = tile % size;
  const y = (tile - x) / size;
  for (let side = 0; side < 4; side++) {
    const neighbor = sideOf(size, x, y, side);
    if (neighbor >= 0 && sim.flow.next[neighbor] !== -1) return true;
  }
  return false;
}

function setOpen(sim: Sim, tile: number, open: boolean): void {
  const gathering = sim.gathering;
  const value = open ? 1 : 0;
  if (gathering.open[tile] === value) return;
  gathering.open[tile] = value;
  const { size } = sim.map;
  const x = tile % size;
  const y = (tile - x) / size;
  const change = open ? 1 : -1;
  gathering.chunkOpen[(y >> CHUNK_SHIFT) * gathering.chunks + (x >> CHUNK_SHIFT)]! += change;
  gathering.openCount += change;
}

/**
 * Works out whether a tile's task is open from its claim, its tree or rock, the
 * walks from the camp to where a villager stands to work it, its taker, and
 * whether it is set aside.
 */
function refresh(sim: Sim, tile: number): void {
  const { map, gathering } = sim;
  const claim = sim.orders.claims[tile];
  let task = false;
  if (claim === Claim.Chop) task = map.trees[tile] === 1 && sim.flow.next[tile] !== -1;
  else if (claim === Claim.Quarry) task = map.kinds[tile] === TileKind.Rock && reachableSide(sim, tile);
  else gathering.taker[tile] = -1;
  setOpen(sim, tile, task && gathering.taker[tile] === -1 && gathering.setAside[tile] === 0);
}

function setAside(sim: Sim, tile: number): void {
  const gathering = sim.gathering;
  if (gathering.setAside[tile] === 1) return;
  gathering.setAside[tile] = 1;
  gathering.setAsideTiles[gathering.setAsideCount++] = tile;
  refresh(sim, tile);
}

function reopen(sim: Sim): void {
  const gathering = sim.gathering;
  for (let i = 0; i < gathering.setAsideCount; i++) {
    const tile = gathering.setAsideTiles[i]!;
    gathering.setAside[tile] = 0;
    refresh(sim, tile);
  }
  gathering.setAsideCount = 0;
}

/**
 * The open task nearest a point in a straight line, or -1. Rings of chunks
 * spread out from the point's chunk until no tile beyond them can be nearer.
 * Equally near tasks go to the lowest tile index.
 */
function nearestOpen(sim: Sim, px: number, py: number): number {
  const { open, chunkOpen, chunks, openCount } = sim.gathering;
  if (openCount === 0) return -1;
  const { size } = sim.map;
  const cx = Math.min(Math.max(Math.floor(px) >> CHUNK_SHIFT, 0), chunks - 1);
  const cy = Math.min(Math.max(Math.floor(py) >> CHUNK_SHIFT, 0), chunks - 1);
  let best = -1;
  let bestDistance = Infinity;
  let seen = 0;
  for (let ring = 0; ring < chunks; ring++) {
    const across = ring * 2;
    const ringChunks = ring === 0 ? 1 : ring * 8;
    for (let k = 0; k < ringChunks; k++) {
      let i: number;
      let j: number;
      if (k <= across) {
        i = cx - ring + k;
        j = cy - ring;
      } else if (k <= across * 2 + 1) {
        i = cx - ring + k - across - 1;
        j = cy + ring;
      } else {
        const m = k - across * 2 - 2;
        i = m % 2 === 0 ? cx - ring : cx + ring;
        j = cy - ring + 1 + (m >> 1);
      }
      if (i < 0 || j < 0 || i >= chunks || j >= chunks) continue;
      const inChunk = chunkOpen[j * chunks + i]!;
      if (inChunk === 0) continue;
      seen += inChunk;
      const x0 = i << CHUNK_SHIFT;
      const y0 = j << CHUNK_SHIFT;
      const x1 = Math.min(x0 + CHUNK, size);
      const y1 = Math.min(y0 + CHUNK, size);
      for (let y = y0; y < y1; y++) {
        const dy = y + 0.5 - py;
        for (let x = x0; x < x1; x++) {
          const tile = y * size + x;
          if (open[tile] === 0) continue;
          const dx = x + 0.5 - px;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance || (distance === bestDistance && tile < best)) {
            best = tile;
            bestDistance = distance;
          }
        }
      }
    }
    if (seen === openCount) break;
    if (best < 0) continue;
    const left = (cx - ring) << CHUNK_SHIFT;
    const right = (cx + ring + 1) << CHUNK_SHIFT;
    const top = (cy - ring) << CHUNK_SHIFT;
    const bottom = (cy + ring + 1) << CHUNK_SHIFT;
    let gap = Infinity;
    if (left > 0) gap = Math.min(gap, px - left + 0.5);
    if (right < size) gap = Math.min(gap, right + 0.5 - px);
    if (top > 0) gap = Math.min(gap, py - top + 0.5);
    if (bottom < size) gap = Math.min(gap, bottom + 0.5 - py);
    if (bestDistance < gap * gap) break;
  }
  return best;
}

/**
 * Where a villager at (px, py) stands to work a tile's task, or -1 when no walk
 * from the camp reaches it. A tree is chopped from its own tile. A rock tile is
 * quarried from the side neighbor nearest the villager that a walk from the camp reaches.
 */
function workTileFor(sim: Sim, tile: number, px: number, py: number): number {
  const { map, flow } = sim;
  if (sim.orders.claims[tile] === Claim.Chop) return flow.next[tile] === -1 ? -1 : tile;
  const { size } = map;
  const x = tile % size;
  const y = (tile - x) / size;
  let best = -1;
  let bestDistance = Infinity;
  for (let side = 0; side < 4; side++) {
    const neighbor = sideOf(size, x, y, side);
    if (neighbor < 0 || flow.next[neighbor] === -1) continue;
    const dx = (neighbor % size) + 0.5 - px;
    const dy = (neighbor - (neighbor % size)) / size + 0.5 - py;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = neighbor;
      bestDistance = distance;
    }
  }
  return best;
}

function take(sim: Sim, id: number): boolean {
  const { villagers, gathering } = sim;
  const px = villagers.x[id]!;
  const py = villagers.y[id]!;
  for (;;) {
    const tile = nearestOpen(sim, px, py);
    if (tile < 0) return false;
    const work = workTileFor(sim, tile, px, py);
    // Every villager lives on the camp's land, so what one cannot reach, none can.
    if (work < 0 || !planPath(sim, id, work)) {
      setAside(sim, tile);
      continue;
    }
    gathering.taker[tile] = id;
    refresh(sim, tile);
    villagers.taskTile[id] = tile;
    villagers.workTile[id] = work;
    return true;
  }
}

function holds(sim: Sim, id: number): boolean {
  return sim.gathering.taker[sim.villagers.taskTile[id]!] === id;
}

/** Fells a tree whose work is done, unless the land has no room for its logs. */
function fell(sim: Sim, tile: number): void {
  if (!putDown(sim, tile, Good.Log, LOGS_PER_TREE)) return;
  sim.map.trees[tile] = 0;
  noteTileChange(sim, tile);
  sim.gathering.progress[tile] = 0;
  setClaim(sim.orders, tile, Claim.None);
  refresh(sim, tile);
}

/** Takes a stone from a rock tile whose work is done, unless the land has no room for it. The last stone spends the tile. */
function quarry(sim: Sim, tile: number, standing: number): void {
  const { gathering, map } = sim;
  if (!putDown(sim, standing, Good.Stone, 1)) return;
  gathering.progress[tile] = 0;
  gathering.yielded[tile]! += 1;
  if (gathering.yielded[tile]! < STONE_PER_ROCK) return;
  gathering.yielded[tile] = 0;
  changeTile(sim, tile, TileKind.Bare);
  setClaim(sim.orders, tile, Claim.None);
  refresh(sim, tile);
  const x = tile % map.size;
  const y = (tile - x) / map.size;
  for (let side = 0; side < 4; side++) {
    const neighbor = sideOf(map.size, x, y, side);
    if (neighbor >= 0) refresh(sim, neighbor);
  }
}

function work(sim: Sim, id: number): boolean {
  const { gathering, villagers } = sim;
  const tile = villagers.taskTile[id]!;
  const chop = sim.orders.claims[tile] === Claim.Chop;
  const needed = chop ? TREE_WORK_TICKS : STONE_WORK_TICKS;
  if (gathering.progress[tile]! < needed) gathering.progress[tile]! += 1;
  if (gathering.progress[tile]! < needed) return false;
  if (chop) fell(sim, tile);
  else quarry(sim, tile, villagers.workTile[id]!);
  return true;
}

function release(sim: Sim, id: number): void {
  const tile = sim.villagers.taskTile[id]!;
  if (sim.gathering.taker[tile] === id) sim.gathering.taker[tile] = -1;
  refresh(sim, tile);
}

/** Felling marked trees and quarrying marked rock, the least urgent kind of task. */
export const GATHERING: TaskKind = { take, holds, work, release, refresh, reopen };
