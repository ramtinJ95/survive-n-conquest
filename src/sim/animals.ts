import { TICKS_PER_SECOND } from './calendar';
import { TileKind, type TileMap, tileAt } from './map';
import { hash } from './noise';
import type { Sim } from './sim';
import { VillagerState } from './villagerState';

export const AnimalKind = { Deer: 0 } as const;
export type AnimalKind = (typeof AnimalKind)[keyof typeof AnimalKind];

/** What an animal is doing. A row that is `Gone` holds no animal, and the next animal that walks in may take it. */
export const AnimalState = { Gone: 0, Grazing: 1, Walking: 2, Fleeing: 3 } as const;
export type AnimalState = (typeof AnimalState)[keyof typeof AnimalState];

/** The most animals on a map at once. */
export const MAX_ANIMALS = 256;

export interface AnimalKindRule {
  readonly name: string;
  /** The map holds one of the kind for this many land tiles it had at the start, and one walks in at each dawn while it holds fewer. */
  readonly perLandTiles: number;
  /** Tiles it walks in one tick while it wanders. */
  readonly walkStep: number;
  /** Tiles it runs in one tick while it flees. */
  readonly fleeStep: number;
  /** It flees from a villager on the map this many tiles away or nearer. */
  readonly fleeFrom: number;
  /** Ticks a flight lasts. */
  readonly fleeTicks: number;
  /** Units of food a kill leaves on the ground. */
  readonly food: number;
  /** The fewest and the most ticks it grazes before it wanders on. */
  readonly grazeTicks: readonly [number, number];
  /** It wanders to a point at most this many tiles from where it grazed, on both axes. */
  readonly wanderReach: number;
}

/** The one place a kind of animal is declared. A kind added here also needs its shape in the renderer. */
export const ANIMALS: Readonly<Record<AnimalKind, AnimalKindRule>> = {
  [AnimalKind.Deer]: {
    name: 'deer',
    perLandTiles: 1500,
    walkStep: 0.8 / TICKS_PER_SECOND,
    fleeStep: 3 / TICKS_PER_SECOND,
    fleeFrom: 6,
    fleeTicks: 4 * TICKS_PER_SECOND,
    food: 6,
    grazeTicks: [2 * TICKS_PER_SECOND, 8 * TICKS_PER_SECOND],
    wanderReach: 8,
  },
};
const ANIMAL_KINDS = Object.keys(ANIMALS).length;

/** The side of a cell of the villager grid, in tiles. */
const CELL = 8;
/** An animal that walks in starts on the map's edge and walks this many tiles inward. */
const WALK_IN = 8;
const PLACEMENT_TRIES = 1000;
const ARRIVAL_TRIES = 64;
const SALT = 0x3d1e_e7a5;
const ARRIVAL_SALT = 0x6b2f_a913;
const UNIT = 1 / 0x100000000;

/**
 * Turns a blocked flight tries, in order: 45 degrees either way, then 90, then
 * 135, as cosines and sines, so no angle needs `Math.cos`, which may round
 * differently in another engine.
 */
const TURN_COS = Float64Array.of(Math.SQRT1_2, Math.SQRT1_2, 0, 0, -Math.SQRT1_2, -Math.SQRT1_2);
const TURN_SIN = Float64Array.of(Math.SQRT1_2, -Math.SQRT1_2, 1, -1, Math.SQRT1_2, -Math.SQRT1_2);
/** A flight from a villager on the animal's own point goes one of the eight ways of a step, drawn. */
const AWAY_X = Float64Array.of(1, -1, 0, 0, Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, -Math.SQRT1_2);
const AWAY_Y = Float64Array.of(0, 0, 1, -1, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2);

/**
 * The animal table, `MAX_ANIMALS` rows that never move, so a row index is an
 * animal id while it lives. A row whose animal was killed is `Gone` until the
 * next animal walks in. Positions are in tiles.
 */
export interface Animals {
  readonly kind: Uint8Array;
  /** One `AnimalState` for each row. */
  readonly state: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Where a walking animal goes. */
  readonly targetX: Float32Array;
  readonly targetY: Float32Array;
  /** The tick at which a graze or a flight ends. */
  readonly until: Uint32Array;
  /** The unit direction of a flight. */
  readonly fleeX: Float32Array;
  readonly fleeY: Float32Array;
  /** The villager that hunts each animal, or -1. */
  readonly hunter: Int16Array;
  /** How many random numbers each row has drawn, as `Monsters.draws` counts them. */
  readonly draws: Uint32Array;
  /** By kind: how many the map holds while none is missing. */
  readonly wanted: Uint16Array;
  /** By kind: how many live. */
  readonly living: Uint16Array;
  /** Draws made to find where an animal walks in. */
  arrivals: number;
  /** Shots taken by hunters, which draw whether each one hits. */
  shots: number;
  /** Cells of the villager grid along each side of the map. */
  readonly cells: number;
  /** Scratch for the villager grid, rebuilt each tick: the first villager in each cell, and the next in the same cell after each villager, or -1. */
  readonly cellHead: Int32Array;
  readonly cellNext: Int32Array;
}

/** Whether animals walk on a tile: grass or forest, never water, rock, spent rock, or a building. */
export function grazes(map: TileMap, tile: number): boolean {
  const kind = map.kinds[tile];
  return kind === TileKind.Grass || kind === TileKind.Forest;
}

function draw(map: TileMap, animals: Animals, row: number): number {
  const count = animals.draws[row]!;
  animals.draws[row] = count + 1;
  return hash(map.seed ^ SALT, row, count);
}

/** Ticks an animal grazes, drawn within its kind's range. */
function grazeTicks(map: TileMap, animals: Animals, row: number): number {
  const range = ANIMALS[animals.kind[row] as AnimalKind].grazeTicks;
  return range[0] + Math.floor(draw(map, animals, row) * UNIT * (range[1] - range[0] + 1));
}

function graze(sim: Sim, row: number): void {
  sim.animals.state[row] = AnimalState.Grazing;
  sim.animals.until[row] = sim.tick + grazeTicks(sim.map, sim.animals, row);
}

function freeRow(animals: Animals): number {
  return animals.state.indexOf(AnimalState.Gone);
}

/** Puts an animal of a kind in the lowest free row, standing at a point, and returns its row, or -1 when the table is full. */
export function addAnimal(animals: Animals, kind: AnimalKind, x: number, y: number, state: AnimalState = AnimalState.Grazing): number {
  const row = freeRow(animals);
  if (row < 0) return -1;
  animals.kind[row] = kind;
  animals.state[row] = state;
  animals.x[row] = animals.targetX[row] = x;
  animals.y[row] = animals.targetY[row] = y;
  animals.until[row] = 0;
  animals.hunter[row] = -1;
  animals.living[kind] = animals.living[kind]! + 1;
  return row;
}

/** Takes a killed animal off the map. Its row is free for the next one that walks in. */
export function removeAnimal(animals: Animals, row: number): void {
  animals.state[row] = AnimalState.Gone;
  animals.hunter[row] = -1;
  animals.living[animals.kind[row]!] = animals.living[animals.kind[row]!]! - 1;
}

/**
 * Starts the table on a map for `villagers` villagers: of each kind, one
 * animal for every `perLandTiles` tiles that are not water, each on a random
 * tile of grass or forest, grazing. A row that finds no such tile stays free.
 */
export function createAnimals(map: TileMap, villagers: number, wild = true): Animals {
  const cells = Math.ceil(map.size / CELL);
  const animals: Animals = {
    kind: new Uint8Array(MAX_ANIMALS),
    state: new Uint8Array(MAX_ANIMALS),
    x: new Float32Array(MAX_ANIMALS),
    y: new Float32Array(MAX_ANIMALS),
    targetX: new Float32Array(MAX_ANIMALS),
    targetY: new Float32Array(MAX_ANIMALS),
    until: new Uint32Array(MAX_ANIMALS),
    fleeX: new Float32Array(MAX_ANIMALS),
    fleeY: new Float32Array(MAX_ANIMALS),
    hunter: new Int16Array(MAX_ANIMALS).fill(-1),
    draws: new Uint32Array(MAX_ANIMALS),
    wanted: new Uint16Array(ANIMAL_KINDS),
    living: new Uint16Array(ANIMAL_KINDS),
    arrivals: 0,
    shots: 0,
    cells,
    cellHead: new Int32Array(cells * cells).fill(-1),
    cellNext: new Int32Array(villagers).fill(-1),
  };
  const tiles = map.size * map.size;
  let land = 0;
  for (let tile = 0; tile < tiles; tile++) if (map.kinds[tile] !== TileKind.Water) land++;
  let rows = 0;
  for (let kind = 0; kind < ANIMAL_KINDS; kind++) {
    const wanted = wild ? Math.min(Math.floor(land / ANIMALS[kind as AnimalKind].perLandTiles), MAX_ANIMALS - rows) : 0;
    animals.wanted[kind] = wanted;
    rows += wanted;
    for (let n = 0; n < wanted; n++) {
      const row = freeRow(animals);
      let tile = -1;
      for (let tries = 0; tries < PLACEMENT_TRIES && tile < 0; tries++) {
        const drawn = draw(map, animals, row) % tiles;
        if (grazes(map, drawn)) tile = drawn;
      }
      if (tile < 0) break;
      addAnimal(animals, kind as AnimalKind, (tile % map.size) + 0.5, Math.floor(tile / map.size) + 0.5);
      animals.until[row] = grazeTicks(map, animals, row);
    }
  }
  return animals;
}

/**
 * Whether an animal may step from one point to another shorter than a tile,
 * as a villager may on its own land: inside the map, onto grass or forest,
 * and past a corner only when both tiles beside it are grass or forest. One
 * standing where it may not walk, as on a building finished under it, may
 * still move within its tile, so it can step off.
 */
function canStep(map: TileMap, fromX: number, fromY: number, toX: number, toY: number): boolean {
  if (toX < 0 || toY < 0 || toX >= map.size || toY >= map.size) return false;
  const to = tileAt(map, toX, toY);
  if (to !== tileAt(map, fromX, fromY) && !grazes(map, to)) return false;
  const turnsCorner = Math.floor(fromX) !== Math.floor(toX) && Math.floor(fromY) !== Math.floor(toY);
  return !turnsCorner || (grazes(map, tileAt(map, toX, fromY)) && grazes(map, tileAt(map, fromX, toY)));
}

/** Sends a grazing animal toward a random point within its kind's reach. A point off grass and forest keeps it grazing a while longer. */
function wander(sim: Sim, row: number): void {
  const { map, animals } = sim;
  const reach = ANIMALS[animals.kind[row] as AnimalKind].wanderReach;
  const edge = map.size - 0.5;
  const tx = Math.fround(Math.min(Math.max(animals.x[row]! + (draw(map, animals, row) * UNIT * 2 - 1) * reach, 0.5), edge));
  const ty = Math.fround(Math.min(Math.max(animals.y[row]! + (draw(map, animals, row) * UNIT * 2 - 1) * reach, 0.5), edge));
  if (!grazes(map, tileAt(map, tx, ty))) {
    graze(sim, row);
    return;
  }
  animals.targetX[row] = tx;
  animals.targetY[row] = ty;
  animals.state[row] = AnimalState.Walking;
}

/** One step toward the animal's target. It grazes once it arrives, or when the step is blocked. */
function walk(sim: Sim, row: number): void {
  const { map, animals } = sim;
  const { x, y } = animals;
  const step = ANIMALS[animals.kind[row] as AnimalKind].walkStep;
  const dx = animals.targetX[row]! - x[row]!;
  const dy = animals.targetY[row]! - y[row]!;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const arrives = distance <= step;
  const nx = arrives ? animals.targetX[row]! : Math.fround(x[row]! + (dx / distance) * step);
  const ny = arrives ? animals.targetY[row]! : Math.fround(y[row]! + (dy / distance) * step);
  if (distance === 0 || !canStep(map, x[row]!, y[row]!, nx, ny)) {
    graze(sim, row);
    return;
  }
  x[row] = nx;
  y[row] = ny;
  if (arrives) graze(sim, row);
}

/**
 * Sends the animal running away from a point, for its kind's flight time. A
 * villager on the animal's own point sends it a way it draws.
 */
export function startFlight(sim: Sim, row: number, fromX: number, fromY: number): void {
  const { animals } = sim;
  const dx = animals.x[row]! - fromX;
  const dy = animals.y[row]! - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) {
    const way = draw(sim.map, animals, row) % AWAY_X.length;
    animals.fleeX[row] = AWAY_X[way]!;
    animals.fleeY[row] = AWAY_Y[way]!;
  } else {
    animals.fleeX[row] = dx / distance;
    animals.fleeY[row] = dy / distance;
  }
  animals.until[row] = sim.tick + ANIMALS[animals.kind[row] as AnimalKind].fleeTicks;
  animals.state[row] = AnimalState.Fleeing;
}

/**
 * One step of a flight. A blocked step turns by 45, 90, then 135 degrees
 * either way, and the first way open becomes the flight's. With none open, or
 * once its time is up, the animal grazes.
 */
function flee(sim: Sim, row: number): void {
  const { map, animals } = sim;
  const { x, y, fleeX, fleeY } = animals;
  if (sim.tick >= animals.until[row]!) {
    graze(sim, row);
    return;
  }
  const step = ANIMALS[animals.kind[row] as AnimalKind].fleeStep;
  for (let turn = -1; turn < TURN_COS.length; turn++) {
    const fx = turn < 0 ? fleeX[row]! : fleeX[row]! * TURN_COS[turn]! - fleeY[row]! * TURN_SIN[turn]!;
    const fy = turn < 0 ? fleeY[row]! : fleeX[row]! * TURN_SIN[turn]! + fleeY[row]! * TURN_COS[turn]!;
    const nx = Math.fround(x[row]! + fx * step);
    const ny = Math.fround(y[row]! + fy * step);
    if (!canStep(map, x[row]!, y[row]!, nx, ny)) continue;
    x[row] = nx;
    y[row] = ny;
    fleeX[row] = fx;
    fleeY[row] = fy;
    return;
  }
  graze(sim, row);
}

/** Lists every villager on the map, neither inside nor dead, in the cell of the villager grid it stands in. */
function gridVillagers(sim: Sim): void {
  const { animals, villagers } = sim;
  const { cellHead, cellNext, cells } = animals;
  cellHead.fill(-1);
  for (let id = 0; id < villagers.state.length; id++) {
    const state = villagers.state[id];
    if (state === VillagerState.Inside || state === VillagerState.Dead) continue;
    const cell = Math.floor(villagers.y[id]! / CELL) * cells + Math.floor(villagers.x[id]! / CELL);
    cellNext[id] = cellHead[cell]!;
    cellHead[cell] = id;
  }
}

/** The villager on the map nearest the animal within `reach` tiles, read from the cells of the grid that reach covers, or -1. Equally near villagers go to the lowest id. */
function nearestVillager(sim: Sim, row: number, reach: number): number {
  const { animals, villagers } = sim;
  const { cellHead, cellNext, cells } = animals;
  const ax = animals.x[row]!;
  const ay = animals.y[row]!;
  const cx0 = Math.max(Math.floor((ax - reach) / CELL), 0);
  const cx1 = Math.min(Math.floor((ax + reach) / CELL), cells - 1);
  const cy0 = Math.max(Math.floor((ay - reach) / CELL), 0);
  const cy1 = Math.min(Math.floor((ay + reach) / CELL), cells - 1);
  let best = -1;
  let bestDistance = reach * reach;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let id = cellHead[cy * cells + cx]!; id >= 0; id = cellNext[id]!) {
        const dx = villagers.x[id]! - ax;
        const dy = villagers.y[id]! - ay;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance || (distance === bestDistance && (best < 0 || id < best))) {
          best = id;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

/**
 * An animal of a kind walks in at a random tile of grass or forest on the
 * map's outer rows and columns, toward a point `WALK_IN` tiles inward. No
 * such tile in `ARRIVAL_TRIES` draws, or a full table, means none walks in.
 */
function walkIn(sim: Sim, kind: AnimalKind): void {
  const { map, animals } = sim;
  const { size } = map;
  const edge = size - 1;
  if (edge <= 0 || freeRow(animals) < 0) return;
  for (let tries = 0; tries < ARRIVAL_TRIES; tries++) {
    const at = hash(map.seed ^ ARRIVAL_SALT, animals.arrivals++, 0) % (4 * edge);
    const side = Math.floor(at / edge);
    const along = at - side * edge;
    const tx = side === 0 ? along : side === 1 ? edge : side === 2 ? edge - along : 0;
    const ty = side === 0 ? 0 : side === 1 ? along : side === 2 ? edge : edge - along;
    if (!grazes(map, ty * size + tx)) continue;
    const inX = side === 1 ? -1 : side === 3 ? 1 : 0;
    const inY = side === 0 ? 1 : side === 2 ? -1 : 0;
    const row = addAnimal(animals, kind, tx + 0.5, ty + 0.5, AnimalState.Walking);
    animals.targetX[row] = Math.min(Math.max(tx + 0.5 + inX * WALK_IN, 0.5), size - 0.5);
    animals.targetY[row] = Math.min(Math.max(ty + 0.5 + inY * WALK_IN, 0.5), size - 0.5);
    return;
  }
}

/**
 * Moves every animal one tick. At dawn one animal of each kind the map lacks
 * walks in from its edge. An animal that is not already fleeing flees from the
 * nearest villager on the map within its kind's `fleeFrom`, found through a
 * grid of the villagers built once for the tick, so no animal looks at every
 * villager. Then it grazes, walks, or runs. Day and season make no difference.
 */
export function moveAnimals(sim: Sim, dawn: boolean): void {
  const { animals, villagers } = sim;
  if (dawn) for (let kind = 0; kind < ANIMAL_KINDS; kind++) if (animals.living[kind]! < animals.wanted[kind]!) walkIn(sim, kind as AnimalKind);
  let living = 0;
  for (let kind = 0; kind < ANIMAL_KINDS; kind++) living += animals.living[kind]!;
  if (living === 0) return;
  gridVillagers(sim);
  for (let row = 0; row < MAX_ANIMALS; row++) {
    if (animals.state[row] === AnimalState.Gone) continue;
    if (animals.state[row] !== AnimalState.Fleeing) {
      const threat = nearestVillager(sim, row, ANIMALS[animals.kind[row] as AnimalKind].fleeFrom);
      if (threat >= 0) startFlight(sim, row, villagers.x[threat]!, villagers.y[threat]!);
    }
    switch (animals.state[row]) {
      case AnimalState.Grazing:
        if (sim.tick >= animals.until[row]!) wander(sim, row);
        break;
      case AnimalState.Walking:
        walk(sim, row);
        break;
      case AnimalState.Fleeing:
        flee(sim, row);
        break;
    }
  }
}
