import { TICKS_PER_SECOND } from './calendar';
import type { FlowField } from './flowField';
import { type TileMap, tileAt } from './map';
import { hash } from './noise';

/** Tiles a monster walks in one tick. */
export const MONSTER_STEP = 1 / TICKS_PER_SECOND;
const SALT = 0x0d3a_d5ed;
const PLACEMENT_TRIES = 1000;

/**
 * The monster table. Row `i` of every column belongs to monster `i`, and rows
 * never move, so a row index is a monster id. Positions are in tiles.
 */
export interface Monsters {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** How many random numbers each monster has drawn. Each draw hashes the seed, the id, and this count, so no monster's draws depend on another's. */
  readonly draws: Uint32Array;
}

function draw(map: TileMap, monsters: Monsters, id: number): number {
  const count = monsters.draws[id]!;
  monsters.draws[id] = count + 1;
  return hash(map.seed ^ SALT, id, count);
}

function standOn(map: TileMap, monsters: Monsters, id: number, tile: number): void {
  monsters.x[id] = (tile % map.size) + 0.5;
  monsters.y[id] = Math.floor(tile / map.size) + 0.5;
}

/** Places `count` monsters on the centers of random tiles that have a walk to the goal. */
export function createMonsters(map: TileMap, flow: FlowField, count: number): Monsters {
  const monsters: Monsters = { x: new Float32Array(count), y: new Float32Array(count), draws: new Uint32Array(count) };
  const tiles = map.size * map.size;
  for (let id = 0; id < count; id++) {
    let tile: number;
    let tries = 0;
    do {
      if (++tries > PLACEMENT_TRIES) throw new Error(`seed ${map.seed} has too little land with a walk to the goal`);
      tile = draw(map, monsters, id) % tiles;
    } while (flow.next[tile] === -1);
    standOn(map, monsters, id, tile);
  }
  return monsters;
}

/**
 * Walks every monster one tick toward the center of the next tile on its flow
 * field route. A monster that reaches the goal enters again at a random entrance.
 */
export function moveMonsters(map: TileMap, flow: FlowField, monsters: Monsters): void {
  const { size } = map;
  const { goal, next, entrances } = flow;
  const { x, y } = monsters;
  for (let id = 0; id < x.length; id++) {
    const tile = tileAt(map, x[id]!, y[id]!);
    if (tile === goal) {
      standOn(map, monsters, id, entrances[draw(map, monsters, id) % entrances.length]!);
      continue;
    }
    const to = next[tile]!;
    const toX = (to % size) + 0.5;
    const toY = Math.floor(to / size) + 0.5;
    const dx = toX - x[id]!;
    const dy = toY - y[id]!;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= MONSTER_STEP) {
      x[id] = toX;
      y[id] = toY;
    } else {
      x[id] = x[id]! + (dx / distance) * MONSTER_STEP;
      y[id] = y[id]! + (dy / distance) * MONSTER_STEP;
    }
  }
}
