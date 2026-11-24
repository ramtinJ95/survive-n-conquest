import { AnimalState, MAX_ANIMALS, grazes } from './animals';
import { nearestDoor } from './buildings';
import { TICKS_PER_SECOND } from './calendar';
import { isColdNight } from './daylight';
import { EATING, wantsMeal } from './eating';
import type { FlowField } from './flowField';
import { Good, putDownHeld } from './goods';
import { NO_HOME, loseMember } from './households';
import { loseWorker, works } from './jobs';
import { type TileMap, sideOf, stepAllowed, tileAt, walkable } from './map';
import { hashUnit } from './noise';
import { NAMES, Sex } from './names';
import { COLD, HUNGER, type Need, WARM_SOURCES, eat, lightFire, meetNeed, storeOf, wanting, warmth } from './needs';
import { MAX_PATH, planPath } from './paths';
import type { Sim } from './sim';
import { CAMP_STORE } from './stores';
import { endTask, loseTasks, stands, takeTask, taskKind } from './tasks';
import { Cause, NO_TASK, THINK_GROUPS, VILLAGER_ROWS, VillagerState } from './villagerState';

/** Tiles a villager walks in one tick. */
export const VILLAGER_STEP = 1.5 / TICKS_PER_SECOND;
/** By day an idle villager picks its next point within this many tiles of the camp center, on both axes. */
export const WANDER_REACH = 8;
/** Each villager's spot at the camp lies this many tiles from the camp center. */
const SPOT_RADIUS = 1.5;
/** A spot is kept only when this many even steps along the line from the camp center to it are all allowed. */
const SPOT_CHECKS = 16;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SALT = 0x5f1a_7e11;
const NAME_SALT = 0x2a3e_5b07;

/**
 * The villager table. Row `i` of every column belongs to villager `i`, and rows
 * never move, so a row index is a villager id. Every column has `VILLAGER_ROWS`
 * rows, and the first `count` are in use. A row is never used twice, so a dead
 * villager keeps its row. Positions are in tiles.
 */
export interface Villagers {
  /** The rows in use. */
  count: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Where an idle villager walks by day. */
  readonly targetX: Float32Array;
  readonly targetY: Float32Array;
  /** Where the villager stands at the camp through the night. A straight walk from the camp center reaches it. */
  readonly spotX: Float32Array;
  readonly spotY: Float32Array;
  /** One `VillagerState` for each villager. It walks or works only while it holds a task. */
  readonly state: Uint8Array;
  /** How many random numbers each villager has drawn. Each draw hashes the seed, the id, and this count, so no villager's draws depend on another's. */
  readonly draws: Uint32Array;
  /** The task each villager holds: `NO_TASK`, or one more than its kind's index in `TASK_KINDS`. */
  readonly task: Uint8Array;
  /** The tile of the task, such as the tree, the rock, or the unit to carry, or -1. */
  readonly taskTile: Int32Array;
  /** The tile the villager stands on to work its task, or -1. A villager going in holds its door here, or -1 when it stays where it stands. */
  readonly workTile: Int32Array;
  /** The tile a carrying or supplying task takes its unit to, a stockpile place or a site's anchor, or -1. */
  readonly destination: Int32Array;
  /** The store a task takes its unit of food out of, as the camp or a barn for stocking a home, or -1. */
  readonly fromStore: Int16Array;
  /** The store a task brings its unit of food into, a common store or a home, or the workshop a workshop's task is for, or -1. */
  readonly toStore: Int16Array;
  /** The `Good` of the unit each villager carries, or `Good.None`. */
  readonly carried: Uint8Array;
  /** `MAX_PATH` tiles of route to the work tile for each villager, row by row. The villager walks to the center of each in turn. */
  readonly path: Int32Array;
  /** The tiles of route kept. A villager going in with a door and no route has not planned it yet. */
  readonly pathLength: Uint16Array;
  /** The route tile the villager walks to next. It has walked the whole kept route when this equals `pathLength`. */
  readonly pathCursor: Uint16Array;
  /** An index into `NAMES[sex]`. */
  readonly name: Uint16Array;
  /** One `Sex` for each villager. */
  readonly sex: Uint8Array;
  /** The household each villager belongs to. */
  readonly household: Int16Array;
  /** The meals each villager missed in a row. */
  readonly missedMeals: Uint8Array;
  /** The cold nights each villager had in a row. */
  readonly coldNights: Uint8Array;
  /** The `Good` a stocking task carries, or `Good.None`. */
  readonly stockGood: Uint8Array;
  /** The `Good` each villager wears, `Good.Clothing` or `Good.None`. It wears it from the moment it puts it on until it dies. */
  readonly worn: Uint8Array;
  /** The site slot of the workplace where each villager holds a place, or -1. Its job is the job of that building's kind. */
  readonly workplace: Int16Array;
  /** When each villager took its place, as a count of `Sim.hires`, so the one that came last is plain. 0 without a place. */
  readonly hired: Uint32Array;
  /** The tick at which each villager was born. A starting settler's lies before tick 0. */
  readonly born: Int32Array;
  /** The whole years each villager lives: it dies of old age at the first dawn at which it is this old. */
  readonly span: Uint8Array;
  /** What each villager died of, `Cause.None` while it lives. */
  readonly cause: Uint8Array;
  /** The tick at which each villager died, or -1 while it lives. */
  readonly diedAt: Int32Array;
  /** 1 while the villager is a child, who does no work. `works` reads it. */
  readonly child: Uint8Array;
  /** The ids of each villager's mother and father, or -1 for a settler the map started with. An id stays valid after the parent's death. */
  readonly mother: Int32Array;
  readonly father: Int32Array;
}

function draw(map: TileMap, villagers: Villagers, id: number): number {
  const count = villagers.draws[id]!;
  villagers.draws[id] = count + 1;
  return hashUnit(map.seed ^ SALT, id, count);
}

/** Points the villager at a random walkable spot near the camp, or at where it stands when the spot is not walkable. */
function chooseTarget(map: TileMap, camp: FlowField, villagers: Villagers, id: number): void {
  const { x, y, targetX, targetY } = villagers;
  const edge = map.size - 0.5;
  const campX = (camp.goal % map.size) + 0.5;
  const campY = Math.floor(camp.goal / map.size) + 0.5;
  const tx = Math.fround(Math.min(Math.max(campX + (draw(map, villagers, id) * 2 - 1) * WANDER_REACH, 0.5), edge));
  const ty = Math.fround(Math.min(Math.max(campY + (draw(map, villagers, id) * 2 - 1) * WANDER_REACH, 0.5), edge));
  const reachable = walkable(map, tileAt(map, tx, ty));
  targetX[id] = reachable ? tx : x[id]!;
  targetY[id] = reachable ? ty : y[id]!;
}

/** Whether a straight walk from one point to another stays on land and cuts no blocked corner. */
function clearLine(map: TileMap, fromX: number, fromY: number, toX: number, toY: number): boolean {
  let x = fromX;
  let y = fromY;
  for (let check = 1; check <= SPOT_CHECKS; check++) {
    const nx = fromX + ((toX - fromX) * check) / SPOT_CHECKS;
    const ny = fromY + ((toY - fromY) * check) / SPOT_CHECKS;
    if (!canStep(map, x, y, nx, ny)) return false;
    x = nx;
    y = ny;
  }
  return true;
}

function shuffledNames(seed: number, sex: Sex): Uint16Array {
  const order = Uint16Array.from(NAMES[sex], (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(hashUnit(seed ^ NAME_SALT, i, sex) * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * The names the seed gives the starting households, indexed by `Sex` and then
 * by household, so no two of a sex are named alike while the names last.
 */
export function startingNames(seed: number): readonly [Uint16Array, Uint16Array] {
  return [shuffledNames(seed, Sex.Woman), shuffledNames(seed, Sex.Man)];
}

/** A villager as it enters the table. `name` is an index into `NAMES[sex]`, `born` a tick, and `span` its life span in whole years. */
export interface NewVillager {
  readonly sex: Sex;
  readonly household: number;
  readonly name: number;
  readonly born: number;
  readonly span: number;
  /** Whether it enters as a child, who does no work. */
  readonly child: boolean;
  /** Its parents' ids, or -1. */
  readonly mother: number;
  readonly father: number;
}

/** An empty table of `VILLAGER_ROWS` rows. `addVillager` adds each villager. */
export function createVillagers(): Villagers {
  const rows = VILLAGER_ROWS;
  const villagers: Villagers = {
    count: 0,
    x: new Float32Array(rows),
    y: new Float32Array(rows),
    targetX: new Float32Array(rows),
    targetY: new Float32Array(rows),
    spotX: new Float32Array(rows),
    spotY: new Float32Array(rows),
    state: new Uint8Array(rows),
    draws: new Uint32Array(rows),
    task: new Uint8Array(rows),
    taskTile: new Int32Array(rows).fill(-1),
    workTile: new Int32Array(rows).fill(-1),
    destination: new Int32Array(rows).fill(-1),
    fromStore: new Int16Array(rows).fill(-1),
    toStore: new Int16Array(rows).fill(-1),
    carried: new Uint8Array(rows),
    path: new Int32Array(rows * MAX_PATH),
    pathLength: new Uint16Array(rows),
    pathCursor: new Uint16Array(rows),
    name: new Uint16Array(rows),
    sex: new Uint8Array(rows),
    household: new Int16Array(rows),
    missedMeals: new Uint8Array(rows),
    coldNights: new Uint8Array(rows),
    stockGood: new Uint8Array(rows),
    worn: new Uint8Array(rows),
    workplace: new Int16Array(rows).fill(-1),
    hired: new Uint32Array(rows),
    born: new Int32Array(rows),
    span: new Uint8Array(rows),
    cause: new Uint8Array(rows),
    diedAt: new Int32Array(rows).fill(-1),
    child: new Uint8Array(rows),
    mother: new Int32Array(rows).fill(-1),
    father: new Int32Array(rows).fill(-1),
  };
  return villagers;
}

/**
 * Adds a villager in the next unused row and returns its id, or -1 when the
 * table is full. It stands idle at its spot around the camp center. A spot
 * that a straight walk from the camp center cannot reach moves to the camp
 * center. This is the one place a villager enters the table.
 */
export function addVillager(villagers: Villagers, map: TileMap, camp: FlowField, settler: NewVillager): number {
  const id = villagers.count;
  if (id >= VILLAGER_ROWS) return -1;
  villagers.count = id + 1;
  const campX = (camp.goal % map.size) + 0.5;
  const campY = Math.floor(camp.goal / map.size) + 0.5;
  const angle = id * GOLDEN_ANGLE;
  const sx = Math.fround(campX + Math.cos(angle) * SPOT_RADIUS);
  const sy = Math.fround(campY + Math.sin(angle) * SPOT_RADIUS);
  const reachable = clearLine(map, campX, campY, sx, sy);
  villagers.spotX[id] = reachable ? sx : campX;
  villagers.spotY[id] = reachable ? sy : campY;
  villagers.x[id] = villagers.targetX[id] = villagers.spotX[id]!;
  villagers.y[id] = villagers.targetY[id] = villagers.spotY[id]!;
  villagers.household[id] = settler.household;
  villagers.sex[id] = settler.sex;
  villagers.name[id] = settler.name;
  villagers.born[id] = settler.born;
  villagers.span[id] = settler.span;
  villagers.child[id] = Number(settler.child);
  villagers.mother[id] = settler.mother;
  villagers.father[id] = settler.father;
  return id;
}

/**
 * Whether a step shorter than a tile may go from one position to another. Like
 * a flow field route, it cuts a corner only when both tiles beside it are walkable.
 */
function canStep(map: TileMap, fromX: number, fromY: number, toX: number, toY: number): boolean {
  if (!walkable(map, tileAt(map, toX, toY))) return false;
  const turnsCorner = Math.floor(fromX) !== Math.floor(toX) && Math.floor(fromY) !== Math.floor(toY);
  return !turnsCorner || (walkable(map, tileAt(map, toX, fromY)) && walkable(map, tileAt(map, fromX, toY)));
}

/** One step toward a point. Returns false when the villager is already there or the step is blocked. */
function stepToward(map: TileMap, villagers: Villagers, id: number, toX: number, toY: number): boolean {
  const { x, y } = villagers;
  const dx = toX - x[id]!;
  const dy = toY - y[id]!;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return false;
  const arrives = distance <= VILLAGER_STEP;
  const nx = arrives ? toX : Math.fround(x[id]! + (dx / distance) * VILLAGER_STEP);
  const ny = arrives ? toY : Math.fround(y[id]! + (dy / distance) * VILLAGER_STEP);
  if (!canStep(map, x[id]!, y[id]!, nx, ny)) return false;
  x[id] = nx;
  y[id] = ny;
  return true;
}

/** One step along the camp's flow field. A villager with no walk to the camp stays where it stands. */
function stepHome(sim: Sim, id: number): void {
  const { map, flow, villagers } = sim;
  const next = flow.next[tileAt(map, villagers.x[id]!, villagers.y[id]!)]!;
  if (next === -1) return;
  stepToward(map, villagers, id, (next % map.size) + 0.5, Math.floor(next / map.size) + 0.5);
}

/**
 * By day, walks an idle villager toward its target near the camp. One that
 * arrives, or whose step would enter water or rock, picks a new target. One
 * that stands farther from the camp than its targets lie walks back first.
 */
function idle(sim: Sim, id: number): void {
  const { map, flow, villagers } = sim;
  const campX = (flow.goal % map.size) + 0.5;
  const campY = Math.floor(flow.goal / map.size) + 0.5;
  if (Math.abs(villagers.x[id]! - campX) > WANDER_REACH || Math.abs(villagers.y[id]! - campY) > WANDER_REACH) {
    stepHome(sim, id);
    return;
  }
  const moved = stepToward(map, villagers, id, villagers.targetX[id]!, villagers.targetY[id]!);
  const arrived = villagers.x[id] === villagers.targetX[id] && villagers.y[id] === villagers.targetY[id];
  if (!moved || arrived) chooseTarget(map, flow, villagers, id);
}

/**
 * By night, walks the villager along the camp's flow field to the camp center,
 * where it takes its meal and its night is judged, then straight out to its
 * spot, where it stays. A villager with no walk to the camp stays where it stands.
 */
function goToCamp(sim: Sim, id: number): void {
  const { map, flow, villagers } = sim;
  const { x, y, state } = villagers;
  if (state[id] === VillagerState.Settling) {
    stepToward(map, villagers, id, villagers.spotX[id]!, villagers.spotY[id]!);
    return;
  }
  const tile = tileAt(map, x[id]!, y[id]!);
  const centerX = (flow.goal % map.size) + 0.5;
  const centerY = Math.floor(flow.goal / map.size) + 0.5;
  if (tile === flow.goal && x[id] === centerX && y[id] === centerY) {
    state[id] = VillagerState.Settling;
    comeHome(sim, id, CAMP_STORE);
    if (state[id] === VillagerState.Settling) stepToward(map, villagers, id, villagers.spotX[id]!, villagers.spotY[id]!);
    return;
  }
  stepHome(sim, id);
}

function atNight(state: number): boolean {
  return state === VillagerState.GoingToCamp || state === VillagerState.Settling || state === VillagerState.GoingIn || state === VillagerState.Inside;
}

/**
 * Ends the villager's day: it gives its task up and goes in to its house, or
 * to the camp when its household has no home. One going in picks its door now
 * and plans its route on its think tick. One with no walk to the camp, or no
 * door, keeps a work tile of -1 and stays where it stands.
 */
function nightfall(sim: Sim, id: number): void {
  const { map, villagers } = sim;
  endTask(sim, id);
  const home = sim.households.home[villagers.household[id]!]!;
  if (home === NO_HOME) {
    villagers.state[id] = VillagerState.GoingToCamp;
    return;
  }
  villagers.state[id] = VillagerState.GoingIn;
  const reaches = sim.flow.next[tileAt(map, villagers.x[id]!, villagers.y[id]!)] !== -1;
  villagers.workTile[id] = reaches ? nearestDoor(sim, home, villagers.x[id]!, villagers.y[id]!) : -1;
  villagers.pathLength[id] = 0;
  villagers.pathCursor[id] = 0;
}

/**
 * The villager's meal, then its night, as it comes home to `store`. The meal
 * comes first, so a villager that freezes tonight has eaten, and one that
 * starves is not judged for the night.
 */
function comeHome(sim: Sim, id: number, store: number): void {
  dine(sim, id, store);
  if (sim.villagers.state[id] !== VillagerState.Dead) judgeNight(sim, id, store);
}

/** Walks a villager going in toward its door, once it has planned its route on a think tick, and takes it inside there to its meal and its night. */
function goIn(sim: Sim, id: number, thinks: boolean): void {
  const { villagers } = sim;
  const door = villagers.workTile[id]!;
  if (door === -1) return;
  if (villagers.pathLength[id] === 0) {
    if (!thinks) return;
    if (!planPath(sim, id, door)) {
      villagers.workTile[id] = -1;
      return;
    }
  }
  if (!walkRoute(sim, id)) villagers.workTile[id] = -1;
  else if (atWork(villagers, id)) {
    villagers.state[id] = VillagerState.Inside;
    comeHome(sim, id, storeOf(sim, id));
  }
}

/** Counts the need unmet once more, and kills the villager at the count that kills. */
function missNeed(sim: Sim, id: number, need: Need): void {
  const column = need.column(sim.villagers);
  column[id] = column[id]! + 1;
  if (column[id]! < need.diesAt) return;
  sim.tally[need.deaths] += 1;
  die(sim, id, need.cause);
}

/** The villager's meal of the day: it eats, or misses the meal. */
function dine(sim: Sim, id: number, store: number): void {
  if (!eat(sim, id, store)) missMeal(sim, id);
}

function missMeal(sim: Sim, id: number): void {
  sim.tally.missed += 1;
  missNeed(sim, id, HUNGER);
}

/**
 * Judges the villager's night as it comes home to `store`, its house or the
 * camp, or -1 when it never got home. On a cold night the first to come home
 * lights the store's fire when it can, and the villager is warm with
 * `WARM_SOURCES` of its sources of warmth, or has a cold night. Every other
 * night is warm.
 */
export function judgeNight(sim: Sim, id: number, store: number): void {
  if (!isColdNight(sim.tick)) {
    meetNeed(sim, id, COLD);
    return;
  }
  if (store >= 0) lightFire(sim, store);
  if (warmth(sim, id, store, store >= 0 && sim.stores.burning[store] === 1) >= WARM_SOURCES) {
    meetNeed(sim, id, COLD);
    return;
  }
  sim.tally.coldNights += 1;
  missNeed(sim, id, COLD);
}

/**
 * Starts the villager's day where it stands. One that never came home missed
 * its meal, and had its night with no house and no fire. One that came home
 * hungry eats now if the store it came home to has food: the camp for one that
 * slept there, even when its household gained a house in the night, and its
 * house for one inside.
 */
function daybreak(sim: Sim, id: number): void {
  const { villagers } = sim;
  const came = villagers.state[id] === VillagerState.Settling || villagers.state[id] === VillagerState.Inside;
  if (!came) {
    missMeal(sim, id);
    if (villagers.state[id] !== VillagerState.Dead) judgeNight(sim, id, -1);
  } else if (villagers.missedMeals[id]! > 0) eat(sim, id, villagers.state[id] === VillagerState.Inside ? storeOf(sim, id) : CAMP_STORE);
  if (villagers.state[id] === VillagerState.Dead) return;
  villagers.state[id] = VillagerState.Idle;
  villagers.targetX[id] = villagers.x[id]!;
  villagers.targetY[id] = villagers.y[id]!;
  villagers.workTile[id] = -1;
  villagers.pathLength[id] = 0;
  villagers.pathCursor[id] = 0;
}

/** Whether the villager stands on the center of its work tile, at the end of its route. */
function atWork(villagers: Villagers, id: number): boolean {
  const length = villagers.pathLength[id]!;
  return (
    length > 0 &&
    villagers.pathCursor[id] === length &&
    villagers.path[id * MAX_PATH + length - 1] === villagers.workTile[id]
  );
}

/**
 * Walks the villager one tick along its route, through as many tile centers as
 * the step reaches. A kept route that ends short of the work tile is planned
 * again from where it ends. Returns false when no walk reaches the work tile.
 */
function walkRoute(sim: Sim, id: number): boolean {
  const { map, villagers } = sim;
  const { size } = map;
  const { path, pathCursor, pathLength } = villagers;
  const row = id * MAX_PATH;
  let x = villagers.x[id]!;
  let y = villagers.y[id]!;
  let left = VILLAGER_STEP;
  while (left > 0 && !atWork(villagers, id)) {
    const cursor = pathCursor[id]!;
    if (cursor === pathLength[id]) {
      if (!planPath(sim, id, villagers.workTile[id]!)) return false;
      continue;
    }
    const tile = path[row + cursor]!;
    const tx = (tile % size) + 0.5;
    const ty = (tile - (tile % size)) / size + 0.5;
    const dx = tx - x;
    const dy = ty - y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= left) {
      x = tx;
      y = ty;
      left -= distance;
      pathCursor[id] = cursor + 1;
    } else {
      x += (dx / distance) * left;
      y += (dy / distance) * left;
      left = 0;
    }
    villagers.x[id] = Math.fround(x);
    villagers.y[id] = Math.fround(y);
  }
  return true;
}

/** Ends the villager's task and leaves it waiting where it stands for its next look for work. */
function stopTask(sim: Sim, id: number): void {
  const { villagers } = sim;
  endTask(sim, id);
  villagers.state[id] = VillagerState.Waiting;
  villagers.targetX[id] = villagers.x[id]!;
  villagers.targetY[id] = villagers.y[id]!;
}

/** Ends at once every task that no longer stands, as one under a cancelled order or one a new job does not allow. */
export function stopFallenTasks(sim: Sim): void {
  const { task, count } = sim.villagers;
  for (let id = 0; id < count; id++) {
    if (task[id] !== NO_TASK && !stands(sim, id)) stopTask(sim, id);
  }
}

/** Whether a tile has a walk to the camp, where a villager or a monster may stand. */
const reached = (sim: Sim, tile: number) => sim.flow.next[tile] !== -1;
/** Whether an animal may stand on a tile. */
const grazed = (sim: Sim, tile: number) => grazes(sim.map, tile);

/** The tile that `fits` accepts nearest `from`, counted in side steps over tiles of any kind, or -1. */
function nearestFitting(sim: Sim, from: number, fits: (sim: Sim, tile: number) => boolean): number {
  const { size } = sim.map;
  const { queue, reached: seen } = sim.putDownSearch;
  const search = ++sim.putDownSearch.searches;
  seen[from] = search;
  queue[0] = from;
  for (let head = 0, tail = 1; head < tail; head++) {
    const tile = queue[head]!;
    if (fits(sim, tile)) return tile;
    const x = tile % size;
    const y = (tile - x) / size;
    for (let side = 0; side < 4; side++) {
      const neighbor = sideOf(size, x, y, side);
      if (neighbor < 0 || seen[neighbor] === search) continue;
      seen[neighbor] = search;
      queue[tail++] = neighbor;
    }
  }
  return -1;
}

/** Moves a unit that stands on a tile `fits` refuses to the center of the nearest tile it accepts. Returns whether it moved. */
function standOn(sim: Sim, xs: Float32Array, ys: Float32Array, id: number, fits: (sim: Sim, tile: number) => boolean): boolean {
  const { map } = sim;
  const tile = tileAt(map, xs[id]!, ys[id]!);
  if (fits(sim, tile)) return false;
  const to = nearestFitting(sim, tile, fits);
  if (to < 0) return false;
  xs[id] = (to % map.size) + 0.5;
  ys[id] = (to - (to % map.size)) / map.size + 0.5;
  return true;
}

/** Whether the villager's kept route, from the step it walks now to its end, still goes over walkable tiles past no blocked corner. */
function routeStands(map: TileMap, villagers: Villagers, id: number): boolean {
  const row = id * MAX_PATH;
  const from = Math.max(villagers.pathCursor[id]! - 1, 0);
  const length = villagers.pathLength[id]!;
  if (from < length && !walkable(map, villagers.path[row + from]!)) return false;
  for (let at = from + 1; at < length; at++) {
    if (!stepAllowed(map, villagers.path[row + at - 1]!, villagers.path[row + at]!)) return false;
  }
  return true;
}

/**
 * Settles every unit after a finished house closed tiles, in the tick it was
 * finished, before the next unit moves. Tasks on land that lost its walk to
 * the camp close. A villager or a monster that stands where no walk reaches
 * the camp moves to the nearest tile with one, as on the house or on land that
 * reached the camp only across its site. An animal on the house moves to the
 * nearest grass or forest. A villager whose task fell, or whose work tile lost its
 * walk, gives the task up. One that moved, or whose route crossed what closed,
 * plans its route again.
 */
function leaveClosedLand(sim: Sim): void {
  const { map, flow, villagers, monsters, animals } = sim;
  loseTasks(sim);
  for (let id = 0; id < villagers.count; id++) {
    if (villagers.state[id] === VillagerState.Dead) continue;
    const moved = standOn(sim, villagers.x, villagers.y, id, reached);
    if (moved) {
      villagers.targetX[id] = villagers.x[id]!;
      villagers.targetY[id] = villagers.y[id]!;
    }
    if (villagers.task[id] === NO_TASK) continue;
    const workTile = villagers.workTile[id]!;
    if (!stands(sim, id) || flow.next[workTile] === -1) stopTask(sim, id);
    else if ((moved || !routeStands(map, villagers, id)) && !planPath(sim, id, workTile)) stopTask(sim, id);
  }
  for (let id = 0; id < monsters.x.length; id++) standOn(sim, monsters.x, monsters.y, id, reached);
  for (let row = 0; row < MAX_ANIMALS; row++) if (animals.state[row] !== AnimalState.Gone) standOn(sim, animals.x, animals.y, row, grazed);
}

/** One tick of a villager that holds a task: it gives the task up when it no longer stands or its kind can no longer follow it, walks its route, then works. */
function doTask(sim: Sim, id: number): void {
  const { villagers } = sim;
  const kind = taskKind(sim, id);
  if (!stands(sim, id) || (kind.follow !== undefined && !kind.follow(sim, id))) {
    stopTask(sim, id);
    return;
  }
  if (!atWork(villagers, id)) {
    villagers.state[id] = VillagerState.Walking;
    if (!walkRoute(sim, id)) {
      stopTask(sim, id);
      return;
    }
    if (!atWork(villagers, id)) return;
  }
  villagers.state[id] = VillagerState.Working;
  // A wanting villager works at half the rate: on even ticks only.
  if (wanting(villagers, id) && (sim.tick & 1) === 1) return;
  if (!kind.work(sim, id)) return;
  stopTask(sim, id);
  if (sim.flow.lostCount > 0) leaveClosedLand(sim);
}

/**
 * Starts every villager's day at dawn. It runs before any villager moves, so
 * every dawn meal comes before any villager takes the day's first task, and
 * stocking cannot take it.
 */
export function breakDay(sim: Sim): void {
  const { state, count } = sim.villagers;
  for (let id = 0; id < count; id++) if (state[id] !== VillagerState.Dead && atNight(state[id]!)) daybreak(sim, id);
}

/**
 * Moves every villager one tick. By day an idle villager looks for work on the
 * tick of its group and wanders near the camp until it finds some. On the same
 * tick a villager that wants a meal gives up any task but its meal, so it goes
 * to eat first. At dusk a villager gives its task up at once. One whose
 * household has a house sets out for it on the tick of its group and goes in.
 * The others walk to their spots at the camp. The choice is made only at dusk, so a home gained in the night
 * is first used the next night. At dawn every villager is idle again where it
 * stands, so one that was inside comes out on the tile it went in on.
 */
export function moveVillagers(sim: Sim, night: boolean): void {
  const { state, task, count } = sim.villagers;
  const group = sim.tick % THINK_GROUPS;
  for (let id = 0; id < count; id++) {
    if (state[id] === VillagerState.Dead) continue;
    if (night) {
      if (!atNight(state[id]!)) nightfall(sim, id);
      if (state[id] === VillagerState.GoingIn) goIn(sim, id, id % THINK_GROUPS === group);
      else if (state[id] !== VillagerState.Inside) goToCamp(sim, id);
      continue;
    }
    const thinks = id % THINK_GROUPS === group;
    if (thinks && wantsMeal(sim, id) && task[id] !== NO_TASK && taskKind(sim, id) !== EATING) stopTask(sim, id);
    const free = state[id] === VillagerState.Idle || state[id] === VillagerState.Waiting;
    if (free && thinks) state[id] = takeTask(sim, id) ? VillagerState.Walking : VillagerState.Idle;
    if (state[id] === VillagerState.Idle) idle(sim, id);
    else if (state[id] !== VillagerState.Waiting) doTask(sim, id);
  }
}

/**
 * Removes the villager from the map for good, of `cause`, at this tick. It
 * gives its task up, as a cancelled one, and puts down what it carries. Its
 * row stays, so ids and households hold. Its place at a workplace opens to the
 * nearest villager without a job. When it was its household's last member, the house goes to
 * the next household without one. When it was the last villager, the
 * settlement has died out.
 */
export function die(sim: Sim, id: number, cause: Cause): void {
  const { villagers } = sim;
  endTask(sim, id);
  if (villagers.carried[id] !== Good.None) putDownHeld(sim, id);
  villagers.state[id] = VillagerState.Dead;
  villagers.cause[id] = cause;
  villagers.diedAt[id] = sim.tick;
  sim.tally.died += 1;
  sim.living -= 1;
  loseWorker(sim, id);
  loseMember(sim.households, villagers.household[id]!, works(villagers, id));
  if (sim.living === 0) sim.over = true;
}
