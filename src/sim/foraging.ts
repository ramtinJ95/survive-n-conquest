import { Job, kindOf, siteMidX, siteMidY, withinReach } from './buildings';
import { SEASONS, TICKS_PER_DAY, TICKS_PER_SECOND, seasonIndexAt } from './calendar';
import { Good, putDownHeld } from './goods';
import { TileKind } from './map';
import { planPath } from './paths';
import type { Sim } from './sim';
import { Wants, nearestCommonStore, storeDoor } from './stores';
import type { TaskKind } from './tasks';

/** Work ticks by one forager that pick a unit of food from a tile. */
export const FORAGE_WORK_TICKS = 30 * TICKS_PER_SECOND;
/** Ticks from a pick until the tile bears again. */
export const FORAGE_REGROW_TICKS = 2 * TICKS_PER_DAY;
const WINTER = SEASONS.indexOf('Winter');

/** Forage on the forest tiles, as tile state the size of the map. */
export interface Foraging {
  /** The tick from which each tile bears again after its last pick. */
  readonly ripeAt: Uint32Array;
  /** The forager that works each tile, or -1. */
  readonly taker: Int32Array;
  /** Work ticks done on each tile toward its next unit. Work stays when the forager leaves. */
  readonly progress: Uint16Array;
}

export function createForaging(tiles: number): Foraging {
  return { ripeAt: new Uint32Array(tiles), taker: new Int32Array(tiles).fill(-1), progress: new Uint16Array(tiles) };
}

/**
 * Whether a tile bears forage now: a forest tile with a standing tree, picked
 * no later than its regrowth allows. Nothing bears in winter. Seasons turn at
 * midnight, so the forage is gone from the first dawn of winter and bears
 * again from the first dawn of spring.
 */
export function bears(sim: Sim, tile: number): boolean {
  const { map } = sim;
  return (
    seasonIndexAt(sim.tick) !== WINTER &&
    map.kinds[tile] === TileKind.Forest &&
    map.trees[tile] === 1 &&
    sim.tick >= sim.foraging.ripeAt[tile]!
  );
}

/** Whether a tile's center lies within the reach of the workplace in `slot`. */
function inReach(sim: Sim, slot: number, tile: number): boolean {
  const { size } = sim.map;
  return withinReach(sim.orders.sites, slot, (tile % size) + 0.5, (tile - (tile % size)) / size + 0.5);
}

/**
 * The tile nearest a point in a straight line among those within the reach of
 * the workplace in `slot`, measured from its middle to each tile's center,
 * that bear, that no forager works, and that a walk from the camp reaches, or
 * -1. Equally near tiles go to the lowest tile index.
 */
function nearestForage(sim: Sim, slot: number, px: number, py: number): number {
  const { map, foraging, flow } = sim;
  const { sites } = sim.orders;
  const { size } = map;
  const { reach } = kindOf(sites, slot);
  const cx = siteMidX(sites, slot);
  const cy = siteMidY(sites, slot);
  const x0 = Math.max(Math.ceil(cx - reach - 0.5), 0);
  const x1 = Math.min(Math.floor(cx + reach - 0.5), size - 1);
  const y0 = Math.max(Math.ceil(cy - reach - 0.5), 0);
  const y1 = Math.min(Math.floor(cy + reach - 0.5), size - 1);
  let best = -1;
  let bestDistance = Infinity;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - py;
    for (let x = x0; x <= x1; x++) {
      const tile = y * size + x;
      if (!inReach(sim, slot, tile) || foraging.taker[tile] !== -1 || flow.next[tile] === -1 || !bears(sim, tile)) continue;
      const dx = x + 0.5 - px;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Sends a forager with empty hands to the forage nearest it in its
 * workplace's reach, and reserves the tile and a place in the common store
 * nearest that tile with room. A forager that still holds a unit, because the
 * land had no room to put it down, only reserves the place and walks there.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, stores } = sim;
  const { size } = sim.map;
  const workplace = villagers.workplace[id]!;
  const held = villagers.carried[id]!;
  if (workplace < 0 || (held !== Good.None && held !== Good.Food)) return false;
  let store: number;
  let door: number;
  if (held === Good.Food) {
    store = nearestCommonStore(sim, villagers.x[id]!, villagers.y[id]!, Wants.Room);
    door = store < 0 ? -1 : storeDoor(sim, store, villagers.x[id]!, villagers.y[id]!);
    if (door < 0 || !planPath(sim, id, door)) return false;
    villagers.workTile[id] = door;
  } else {
    const tile = nearestForage(sim, workplace, villagers.x[id]!, villagers.y[id]!);
    if (tile < 0) return false;
    const tx = (tile % size) + 0.5;
    const ty = (tile - (tile % size)) / size + 0.5;
    store = nearestCommonStore(sim, tx, ty, Wants.Room);
    door = store < 0 ? -1 : storeDoor(sim, store, tx, ty);
    if (door < 0 || !planPath(sim, id, tile)) return false;
    sim.foraging.taker[tile] = id;
    villagers.taskTile[id] = tile;
    villagers.workTile[id] = tile;
  }
  stores.inbound[Good.Food - 1]![store]! += 1;
  villagers.toStore[id] = store;
  villagers.destination[id] = door;
  return true;
}

/**
 * The forager carries its unit, or still works its tile, the tree there
 * stands, and the tile lies in the reach of the hut it works at now, which a
 * forager moved to another hut by a change of places does not.
 */
function holds(sim: Sim, id: number): boolean {
  const { villagers } = sim;
  if (villagers.carried[id] === Good.Food) return true;
  const tile = villagers.taskTile[id]!;
  const workplace = villagers.workplace[id]!;
  return tile >= 0 && workplace >= 0 && sim.foraging.taker[tile] === id && sim.map.trees[tile] === 1 && inReach(sim, workplace, tile);
}

/**
 * One tick of picking, until the unit is picked and the forager turns toward
 * its store, or puts the unit into the store there, which takes no work ticks.
 * The picked tile bears again after `FORAGE_REGROW_TICKS`.
 */
function work(sim: Sim, id: number): boolean {
  const { villagers, foraging, stores } = sim;
  if (villagers.carried[id] === Good.None) {
    const tile = villagers.taskTile[id]!;
    foraging.progress[tile] = foraging.progress[tile]! + 1;
    if (foraging.progress[tile]! < FORAGE_WORK_TICKS) return false;
    foraging.progress[tile] = 0;
    foraging.ripeAt[tile] = sim.tick + FORAGE_REGROW_TICKS;
    foraging.taker[tile] = -1;
    villagers.carried[id] = Good.Food;
    sim.tally.foraged += 1;
    villagers.workTile[id] = villagers.destination[id]!;
    return !planPath(sim, id, villagers.workTile[id]!);
  }
  const store = villagers.toStore[id]!;
  stores.inbound[Good.Food - 1]![store]! -= 1;
  stores.held[Good.Food - 1]![store]! += 1;
  villagers.carried[id] = Good.None;
  villagers.toStore[id] = -1;
  villagers.destination[id] = -1;
  sim.tally.foragedIn += 1;
  return true;
}

/**
 * Frees the tile and the place in the store that the task still holds, and
 * puts down a unit in the forager's hands where it stands, as every carrier
 * does when its task ends: at dusk, when it loses its place, or when no walk
 * reaches its store. Settlers without a job carry it from the ground.
 */
function release(sim: Sim, id: number): void {
  const { villagers, stores } = sim;
  const tile = villagers.taskTile[id]!;
  if (tile >= 0 && sim.foraging.taker[tile] === id) sim.foraging.taker[tile] = -1;
  const store = villagers.toStore[id]!;
  if (store >= 0) stores.inbound[Good.Food - 1]![store]! -= 1;
  if (villagers.carried[id] !== Good.None) putDownHeld(sim, id);
}

const nothing = () => {};

/** Picking food in the forest around a forager's hut and carrying it to the nearest common store with room, the work of a forager. */
export const FORAGING: TaskKind = { job: Job.Forager, take, holds, work, release, refresh: nothing, reopen: nothing };
