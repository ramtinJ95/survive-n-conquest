import { TICKS_PER_SECOND } from './calendar';
import type { FlowField } from './flowField';
import { type TileMap, tileAt, walkable } from './map';
import { hashUnit } from './noise';
import { MAX_PATH, planPath } from './paths';
import type { Sim } from './sim';
import { endTask, takeTask, taskKind } from './tasks';

/** Tiles a villager walks in one tick. */
export const VILLAGER_STEP = 1.5 / TICKS_PER_SECOND;
/** By day an idle villager picks its next point within this many tiles of the camp center, on both axes. */
export const WANDER_REACH = 8;
/** An idle villager looks for work on one tick in this many, the tick of its group. Villager `id` is in group `id % THINK_GROUPS`. */
export const THINK_GROUPS = 10;
/** Each villager's spot at the camp lies this many tiles from the camp center. */
const SPOT_RADIUS = 1.5;
/** A spot is kept only when this many even steps along the line from the camp center to it are all allowed. */
const SPOT_CHECKS = 16;

/**
 * What a villager is doing. By day it is idle near the camp, or walks its route
 * to a task and works it there. A villager whose task just ended waits where it
 * stands until it next looks for work, so it does not wander off between two
 * tasks at the same place. By night it walks the flow field to the camp center,
 * then out to its spot, where it stays until dawn.
 */
export const VillagerState = { Idle: 0, Walking: 1, Working: 2, GoingHome: 3, Settling: 4, Waiting: 5 } as const;
export type VillagerState = (typeof VillagerState)[keyof typeof VillagerState];
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SALT = 0x5f1a_7e11;

/**
 * The villager table. Row `i` of every column belongs to villager `i`, and rows
 * never move, so a row index is a villager id. Positions are in tiles.
 */
export interface Villagers {
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
  /** The tile of the task, such as the tree or the rock, or -1. */
  readonly taskTile: Int32Array;
  /** The tile the villager stands on to work its task, or -1. */
  readonly workTile: Int32Array;
  /** `MAX_PATH` tiles of route to the work tile for each villager, row by row. The villager walks to the center of each in turn. */
  readonly path: Int32Array;
  readonly pathLength: Uint16Array;
  /** The route tile the villager walks to next. It has walked the whole kept route when this equals `pathLength`. */
  readonly pathCursor: Uint16Array;
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

/**
 * Gives every villager a spot around the camp center and stands it there. A
 * spot that a straight walk from the camp center cannot reach moves to the
 * camp center.
 */
export function createVillagers(map: TileMap, camp: FlowField, count: number): Villagers {
  const villagers: Villagers = {
    x: new Float32Array(count),
    y: new Float32Array(count),
    targetX: new Float32Array(count),
    targetY: new Float32Array(count),
    spotX: new Float32Array(count),
    spotY: new Float32Array(count),
    state: new Uint8Array(count),
    draws: new Uint32Array(count),
    task: new Uint8Array(count),
    taskTile: new Int32Array(count).fill(-1),
    workTile: new Int32Array(count).fill(-1),
    path: new Int32Array(count * MAX_PATH),
    pathLength: new Uint16Array(count),
    pathCursor: new Uint16Array(count),
  };
  const campX = (camp.goal % map.size) + 0.5;
  const campY = Math.floor(camp.goal / map.size) + 0.5;
  for (let id = 0; id < count; id++) {
    const angle = id * GOLDEN_ANGLE;
    const sx = Math.fround(campX + Math.cos(angle) * SPOT_RADIUS);
    const sy = Math.fround(campY + Math.sin(angle) * SPOT_RADIUS);
    const reachable = clearLine(map, campX, campY, sx, sy);
    villagers.spotX[id] = reachable ? sx : campX;
    villagers.spotY[id] = reachable ? sy : campY;
    villagers.x[id] = villagers.targetX[id] = villagers.spotX[id]!;
    villagers.y[id] = villagers.targetY[id] = villagers.spotY[id]!;
  }
  return villagers;
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
 * then straight out to its spot, where it stays. A villager with no walk to
 * the camp stays where it stands.
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
    stepToward(map, villagers, id, villagers.spotX[id]!, villagers.spotY[id]!);
    return;
  }
  stepHome(sim, id);
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

/** One tick of a villager that holds a task: it gives the task up when it no longer stands, walks its route, then works. */
function doTask(sim: Sim, id: number): void {
  const { villagers } = sim;
  const kind = taskKind(sim, id);
  if (!kind.holds(sim, id)) {
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
  if (kind.work(sim, id)) stopTask(sim, id);
}

/**
 * Moves every villager one tick. By day an idle villager looks for work on the
 * tick of its group and wanders near the camp until it finds some. At dusk a
 * villager gives its task up at once and walks to its spot at the camp, and at
 * dawn it is idle again.
 */
export function moveVillagers(sim: Sim, night: boolean): void {
  const { villagers } = sim;
  const { state } = villagers;
  const group = sim.tick % THINK_GROUPS;
  for (let id = 0; id < state.length; id++) {
    if (night) {
      if (state[id] !== VillagerState.GoingHome && state[id] !== VillagerState.Settling) {
        endTask(sim, id);
        state[id] = VillagerState.GoingHome;
      }
      goToCamp(sim, id);
      continue;
    }
    if (state[id] === VillagerState.GoingHome || state[id] === VillagerState.Settling) {
      state[id] = VillagerState.Idle;
      villagers.targetX[id] = villagers.x[id]!;
      villagers.targetY[id] = villagers.y[id]!;
    }
    const free = state[id] === VillagerState.Idle || state[id] === VillagerState.Waiting;
    if (free && id % THINK_GROUPS === group) state[id] = takeTask(sim, id) ? VillagerState.Walking : VillagerState.Idle;
    if (state[id] === VillagerState.Idle) idle(sim, id);
    else if (state[id] !== VillagerState.Waiting) doTask(sim, id);
  }
}
