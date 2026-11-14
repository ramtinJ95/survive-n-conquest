import { TICKS_PER_SECOND } from './calendar';
import type { FlowField } from './flowField';
import { type TileMap, tileAt, walkable } from './map';
import { hashUnit } from './noise';

/** Tiles a villager walks in one tick. */
export const VILLAGER_STEP = 1.5 / TICKS_PER_SECOND;
/** By day a villager picks its next point within this many tiles of the camp center, on both axes. */
export const WANDER_REACH = 8;
/** A villager whose walk to the camp is this many tiles or shorter has reached the camp, and heads straight for its spot there. */
export const CAMP_REACH = 3;
/** Each villager's spot at the camp lies this many tiles from the camp center. */
const SPOT_RADIUS = 1.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SALT = 0x5f1a_7e11;

/**
 * The villager table. Row `i` of every column belongs to villager `i`, and rows
 * never move, so a row index is a villager id. Positions are in tiles.
 */
export interface Villagers {
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Where the villager walks by day. */
  readonly targetX: Float32Array;
  readonly targetY: Float32Array;
  /** Where the villager stands at the camp through the night. */
  readonly spotX: Float32Array;
  readonly spotY: Float32Array;
  /** How many random numbers each villager has drawn. Each draw hashes the seed, the id, and this count, so no villager's draws depend on another's. */
  readonly draws: Uint32Array;
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

/**
 * Gives every villager a spot around the camp center and stands it there. A
 * spot that falls off the camp's land moves to the camp center.
 */
export function createVillagers(map: TileMap, camp: FlowField, count: number): Villagers {
  const villagers: Villagers = {
    x: new Float32Array(count),
    y: new Float32Array(count),
    targetX: new Float32Array(count),
    targetY: new Float32Array(count),
    spotX: new Float32Array(count),
    spotY: new Float32Array(count),
    draws: new Uint32Array(count),
  };
  const campX = (camp.goal % map.size) + 0.5;
  const campY = Math.floor(camp.goal / map.size) + 0.5;
  for (let id = 0; id < count; id++) {
    const angle = id * GOLDEN_ANGLE;
    const sx = Math.fround(campX + Math.cos(angle) * SPOT_RADIUS);
    const sy = Math.fround(campY + Math.sin(angle) * SPOT_RADIUS);
    const onCampLand = camp.walk[tileAt(map, sx, sy)]! <= CAMP_REACH;
    villagers.spotX[id] = onCampLand ? sx : campX;
    villagers.spotY[id] = onCampLand ? sy : campY;
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

/**
 * By day, walks the villager toward its target near the camp. One that arrives,
 * or whose step would enter water or rock, picks a new target.
 */
function wander(map: TileMap, camp: FlowField, villagers: Villagers, id: number): void {
  const moved = stepToward(map, villagers, id, villagers.targetX[id]!, villagers.targetY[id]!);
  const arrived = villagers.x[id] === villagers.targetX[id] && villagers.y[id] === villagers.targetY[id];
  if (!moved || arrived) chooseTarget(map, camp, villagers, id);
}

/**
 * By night, walks the villager along the camp's flow field until it reaches the
 * camp, then to its spot there, where it stays. A villager with no walk to the
 * camp stays where it stands.
 */
function goToCamp(map: TileMap, camp: FlowField, villagers: Villagers, id: number): void {
  const tile = tileAt(map, villagers.x[id]!, villagers.y[id]!);
  if (camp.walk[tile]! <= CAMP_REACH) {
    stepToward(map, villagers, id, villagers.spotX[id]!, villagers.spotY[id]!);
    return;
  }
  const next = camp.next[tile]!;
  if (next === -1) return;
  stepToward(map, villagers, id, (next % map.size) + 0.5, Math.floor(next / map.size) + 0.5);
}

/** Moves every villager one tick: wandering near the camp by day, and to the camp by night. */
export function moveVillagers(map: TileMap, camp: FlowField, villagers: Villagers, night: boolean): void {
  for (let id = 0; id < villagers.x.length; id++) {
    if (night) goToCamp(map, camp, villagers, id);
    else wander(map, camp, villagers, id);
  }
}
