import { GATHERING } from './gathering';
import { sideOf } from './map';
import { type TileArea, clip } from './orders';
import type { Sim } from './sim';

/** A villager column value for no task. Any other value is one more than the kind's index in `TASK_KINDS`. */
export const NO_TASK = 0;

/**
 * One kind of task, such as gathering. A task belongs to one villager from
 * `take` until `release`. Each kind keeps its own state in the simulation and
 * points the villager at its work with the villager's `taskTile`, `workTile`,
 * and route.
 */
export interface TaskKind {
  /**
   * Finds the open task of this kind nearest the villager in a straight line,
   * reserves it for the villager, and plans the villager's route to its work
   * tile. Returns false when none is open.
   */
  take(sim: Sim, id: number): boolean;
  /** Whether the villager's task still stands, as an order cancelled under it does not. */
  holds(sim: Sim, id: number): boolean;
  /** One tick of work by the villager standing on its work tile. Returns true when the task is over, done or not. */
  work(sim: Sim, id: number): boolean;
  /** Ends the villager's hold on its task and frees what the task reserved. */
  release(sim: Sim, id: number): void;
  /** Brings the tasks on a tile up to date after its order, or the walks to it or beside it, changed. */
  refresh(sim: Sim, tile: number): void;
  /** Opens again every task set aside as out of reach. */
  reopen(sim: Sim): void;
}

/**
 * Every kind of task, most urgent first. An idle villager takes a task of the
 * first kind that has one open. Stage 2 adds building work at a site (2.5),
 * carrying to a site (2.5), and carrying to a stockpile (2.4) ahead of gathering.
 */
export const TASK_KINDS: readonly TaskKind[] = [GATHERING];

/** Gives the villager a task of the most urgent kind that has one open. Returns false when no kind has one. */
export function takeTask(sim: Sim, id: number): boolean {
  for (let kind = 0; kind < TASK_KINDS.length; kind++) {
    if (!TASK_KINDS[kind]!.take(sim, id)) continue;
    sim.villagers.task[id] = kind + 1;
    return true;
  }
  return false;
}

/** The kind of the villager's task. The villager must hold one. */
export function taskKind(sim: Sim, id: number): TaskKind {
  return TASK_KINDS[sim.villagers.task[id]! - 1]!;
}

/** Releases the villager's task and forgets it, with its route. */
export function endTask(sim: Sim, id: number): void {
  const { villagers } = sim;
  if (villagers.task[id] === NO_TASK) return;
  taskKind(sim, id).release(sim, id);
  villagers.task[id] = NO_TASK;
  villagers.taskTile[id] = -1;
  villagers.workTile[id] = -1;
  villagers.destination[id] = -1;
  villagers.pathLength[id] = 0;
  villagers.pathCursor[id] = 0;
}

/** Brings every kind's tasks up to date on the tiles of an area order. */
export function refreshTasks(sim: Sim, area: TileArea): void {
  const { size } = sim.map;
  const { x0, y0, x1, y1 } = clip(sim.map, area);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      refreshTile(sim, y * size + x);
    }
  }
}

/** Opens again every task of every kind that was set aside as out of reach. */
export function reopenTasks(sim: Sim): void {
  for (let kind = 0; kind < TASK_KINDS.length; kind++) TASK_KINDS[kind]!.reopen(sim);
}

function refreshTile(sim: Sim, tile: number): void {
  for (let kind = 0; kind < TASK_KINDS.length; kind++) TASK_KINDS[kind]!.refresh(sim, tile);
}

/**
 * Brings the tasks up to date after tiles gained a walk to the camp, as when a
 * rock tile is spent, and opens again every task set aside as out of reach. A
 * villager works a task from its tile or from a tile beside it, so the side
 * neighbors of each tile are brought up to date too.
 */
export function reachTasks(sim: Sim): void {
  const { flow } = sim;
  const { size } = sim.map;
  for (let i = 0; i < flow.gainedCount; i++) {
    const tile = flow.gained[i]!;
    const x = tile % size;
    const y = (tile - x) / size;
    refreshTile(sim, tile);
    for (let side = 0; side < 4; side++) {
      const neighbor = sideOf(size, x, y, side);
      if (neighbor >= 0) refreshTile(sim, neighbor);
    }
  }
  flow.gainedCount = 0;
  reopenTasks(sim);
}
