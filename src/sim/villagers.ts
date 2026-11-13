import { TICKS_PER_SECOND } from './calendar';
import { type TileMap, tileAt, walkable } from './map';
import { hashUnit } from './noise';

/** Tiles a villager walks in one tick. */
export const VILLAGER_STEP = 1.5 / TICKS_PER_SECOND;
/** A villager picks its next point within this many tiles of where it stands, on both axes. */
export const WANDER_REACH = 16;
const SALT = 0x5f1a_7e11;
const PLACEMENT_TRIES = 1000;

/**
 * The villager table. Row `i` of every column belongs to villager `i`, and rows
 * never move, so a row index is a villager id. Positions are in tiles.
 */
export interface Villagers {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly targetX: Float32Array;
  readonly targetY: Float32Array;
  /** How many random numbers each villager has drawn. Each draw hashes the seed, the id, and this count, so no villager's draws depend on another's. */
  readonly draws: Uint32Array;
}

function draw(map: TileMap, villagers: Villagers, id: number): number {
  const count = villagers.draws[id]!;
  villagers.draws[id] = count + 1;
  return hashUnit(map.seed ^ SALT, id, count);
}

/** Points the villager at a random walkable spot nearby, or at where it stands when the spot is not walkable. */
function chooseTarget(map: TileMap, villagers: Villagers, id: number): void {
  const { x, y, targetX, targetY } = villagers;
  const edge = map.size - 0.5;
  const tx = Math.fround(Math.min(Math.max(x[id]! + (draw(map, villagers, id) * 2 - 1) * WANDER_REACH, 0.5), edge));
  const ty = Math.fround(Math.min(Math.max(y[id]! + (draw(map, villagers, id) * 2 - 1) * WANDER_REACH, 0.5), edge));
  const reachable = walkable(map, tileAt(map, tx, ty));
  targetX[id] = reachable ? tx : x[id]!;
  targetY[id] = reachable ? ty : y[id]!;
}

/** Places `count` villagers on the centers of random walkable tiles, each standing still until its first tick. */
export function createVillagers(map: TileMap, count: number): Villagers {
  const villagers: Villagers = {
    x: new Float32Array(count),
    y: new Float32Array(count),
    targetX: new Float32Array(count),
    targetY: new Float32Array(count),
    draws: new Uint32Array(count),
  };
  for (let id = 0; id < count; id++) {
    let tries = 0;
    do {
      if (++tries > PLACEMENT_TRIES) throw new Error(`seed ${map.seed} has too little land to place villagers`);
      villagers.x[id] = Math.floor(draw(map, villagers, id) * map.size) + 0.5;
      villagers.y[id] = Math.floor(draw(map, villagers, id) * map.size) + 0.5;
    } while (!walkable(map, tileAt(map, villagers.x[id]!, villagers.y[id]!)));
    villagers.targetX[id] = villagers.x[id]!;
    villagers.targetY[id] = villagers.y[id]!;
  }
  return villagers;
}

/**
 * Walks every villager one tick toward its target. A villager that arrives, or
 * whose next step would enter water or rock, picks a new target instead.
 */
export function moveVillagers(map: TileMap, villagers: Villagers): void {
  const { x, y, targetX, targetY } = villagers;
  for (let id = 0; id < x.length; id++) {
    const dx = targetX[id]! - x[id]!;
    const dy = targetY[id]! - y[id]!;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= VILLAGER_STEP) {
      x[id] = targetX[id]!;
      y[id] = targetY[id]!;
      chooseTarget(map, villagers, id);
      continue;
    }
    const nx = Math.fround(x[id]! + (dx / distance) * VILLAGER_STEP);
    const ny = Math.fround(y[id]! + (dy / distance) * VILLAGER_STEP);
    if (walkable(map, tileAt(map, nx, ny))) {
      x[id] = nx;
      y[id] = ny;
    } else {
      chooseTarget(map, villagers, id);
    }
  }
}
