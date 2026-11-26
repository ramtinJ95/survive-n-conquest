import { Job } from './buildings';
import { CARRYING, pickUpReserved, putInStore, reserveLoose, takeHeld } from './carrying';
import { Claim } from './claims';
import { CUT_WORK_TICKS, FOOD_PER_TILE, FieldState, fieldState, inReach, nearestInReach } from './fields';
import { Good, putDown, setAsideGoods } from './goods';
import { planPath } from './paths';
import type { Sim } from './sim';
import { Wants, nearestCommonStore } from './stores';
import type { TaskKind } from './tasks';
import { noteTileChange } from './tileChanges';

/** A field tile with a unit of food that no carrier has reserved. */
function lyingCut(sim: Sim, tile: number): boolean {
  return sim.goods.loose[Good.Food - 1]!.open[tile] === 1;
}

/** A ripe field tile that no farmer cuts. */
function toCut(sim: Sim, tile: number): boolean {
  return sim.fields.taker[tile] === -1 && fieldState(sim.fields, tile, sim.tick) === FieldState.Ripe;
}

/**
 * Sends a farmer with empty hands to the unit of food nearest it on the field
 * tiles in its farm's reach, and reserves the unit and a place in the common
 * store nearest the unit with room, as a hunter carries its kill in. A farmer
 * that still holds a unit, because the land had no room to put it down, takes
 * it to a store.
 */
function fetchCrop(sim: Sim, id: number): boolean {
  const { villagers } = sim;
  const held = villagers.carried[id]!;
  if (held === Good.Food) return takeHeld(sim, id);
  const workplace = villagers.workplace[id]!;
  if (held !== Good.None || workplace < 0) return false;
  const px = villagers.x[id]!;
  const py = villagers.y[id]!;
  if (nearestCommonStore(sim, px, py, Wants.Room, Good.Food) < 0) return false;
  const source = nearestInReach(sim, workplace, px, py, lyingCut, sim.goods.loose[Good.Food - 1]!);
  if (source < 0) return false;
  if (!planPath(sim, id, source)) {
    setAsideGoods(sim, source);
    return false;
  }
  return reserveLoose(sim, id, source);
}

/** Picks the unit up, or puts it into the store, as carrying does, and counts it among the food farmers carried in. */
function carryIn(sim: Sim, id: number): boolean {
  if (sim.villagers.carried[id] === Good.None) return pickUpReserved(sim, id);
  putInStore(sim, id);
  sim.tally.reapedIn += 1;
  return true;
}

/**
 * Sends a farmer with empty hands to the ripe field tile nearest it in its
 * farm's reach, and reserves the tile, while some common store has room for
 * food. With no room the crop stands.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, fields } = sim;
  const workplace = villagers.workplace[id]!;
  if (workplace < 0 || villagers.carried[id] !== Good.None) return false;
  const px = villagers.x[id]!;
  const py = villagers.y[id]!;
  if (nearestCommonStore(sim, px, py, Wants.Room, Good.Food) < 0) return false;
  const tile = nearestInReach(sim, workplace, px, py, toCut, null);
  if (tile < 0 || !planPath(sim, id, tile)) return false;
  fields.taker[tile] = id;
  villagers.taskTile[id] = tile;
  villagers.workTile[id] = tile;
  return true;
}

/** The farmer still cuts its tile: the tile is still a ripe field, and it lies in the reach of the farm the farmer works at now. */
function holds(sim: Sim, id: number): boolean {
  const { villagers, fields } = sim;
  const tile = villagers.taskTile[id]!;
  const workplace = villagers.workplace[id]!;
  return (
    tile >= 0 &&
    workplace >= 0 &&
    fields.taker[tile] === id &&
    sim.orders.claims[tile] === Claim.Field &&
    fieldState(fields, tile, sim.tick) === FieldState.Ripe &&
    inReach(sim, workplace, tile)
  );
}

/**
 * One tick of cutting. The tile counts as cut from the step of its last work
 * tick on, and its food lies on it, spilling to the nearest tiles with room.
 * The tile is cut even when the land has no room for the food.
 */
function work(sim: Sim, id: number): boolean {
  const { fields } = sim;
  const tile = sim.villagers.taskTile[id]!;
  fields.progress[tile] = fields.progress[tile]! + 1;
  if (fields.progress[tile]! < CUT_WORK_TICKS) return false;
  fields.progress[tile] = 0;
  fields.taker[tile] = -1;
  fields.cutAt[tile] = sim.tick;
  sim.tally.cut += 1;
  noteTileChange(sim, tile);
  if (putDown(sim, tile, Good.Food, FOOD_PER_TILE)) sim.tally.reaped += FOOD_PER_TILE;
  return true;
}

/** Frees the tile the task still holds, at dusk, when the farmer loses its place, or when the field is cancelled. */
function release(sim: Sim, id: number): void {
  const tile = sim.villagers.taskTile[id]!;
  if (tile >= 0 && sim.fields.taker[tile] === id) sim.fields.taker[tile] = -1;
}

const nothing = () => {};

/**
 * Carrying the food that lies cut on the field tiles in a farm's reach to the
 * nearest common store with room, 1 unit at a time, the work of a farmer
 * before it cuts another tile. The reservations, the hold, and the dusk rule
 * are carrying's.
 */
export const FETCHING_CROP: TaskKind = { job: Job.Farmer, take: fetchCrop, holds: CARRYING.holds, work: carryIn, release: CARRYING.release, refresh: nothing, reopen: nothing };

/** Cutting the ripe field tiles in a farm's reach, the work of a farmer. The field's state on a cancel is sowing's to keep. */
export const CUTTING: TaskKind = { job: Job.Farmer, take, holds, work, release, refresh: nothing, reopen: nothing };
