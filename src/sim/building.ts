import { TICKS_PER_SECOND } from './calendar';
import { closeFlowTiles } from './flowField';
import { GOOD_KINDS, Good, STACK_LIMIT } from './goods';
import { moveInto } from './households';
import { TileKind, type TileMap } from './map';
import { MAX_SITES, type Orders, SiteState, finishSite, setSiteWork } from './orders';
import { planPath } from './paths';
import type { Sim } from './sim';
import type { TaskKind } from './tasks';
import { noteTileChange } from './tileChanges';
import { type TileSet, createTileSet, nearestOpen, setOpen } from './tileSet';

/** Units of each good that a house needs, at index `good - 1`: 12 logs and 6 stone. */
export const HOUSE_NEEDS: readonly number[] = [12, 6];
/** Ticks of building work that finish a house once its last unit has arrived, shared by its builders. */
export const HOUSE_WORK_TICKS = 90 * TICKS_PER_SECOND;
/** Villagers that build one site at a time, one on each corner tile. */
export const MAX_BUILDERS = 4;

/**
 * What villagers have taken on at each site, by slot. What has arrived at a
 * site is never counted here: it is the stacks on the site's nine tiles.
 */
export interface SiteTasks {
  /** Units on their way to each site, at `slot * GOOD_KINDS + good - 1`. */
  readonly inbound: Uint8Array;
  /** Villagers that hold building work at each site. */
  readonly builders: Uint8Array;
  /** Bit `1 << corner` is set where a builder holds that corner tile. Corner 1 is right of the center, 2 below it, and 3 both. */
  readonly corners: Uint8Array;
  /** 1 where a site's building work is set aside as out of reach, until dawn or until land gains walks. */
  readonly setAside: Uint8Array;
  /** The center tiles of the sites whose building work is open: every unit arrived, a corner free, reached, and not set aside. */
  readonly building: TileSet;
  /** Scratch for `finishHouse`: the nine tiles of the house. */
  readonly closing: Int32Array;
}

export function createSiteTasks(size: number): SiteTasks {
  return {
    inbound: new Uint8Array(MAX_SITES * GOOD_KINDS),
    builders: new Uint8Array(MAX_SITES),
    corners: new Uint8Array(MAX_SITES),
    setAside: new Uint8Array(MAX_SITES),
    building: createTileSet(size),
    closing: new Int32Array(9),
  };
}

/** One of a site's nine tiles, counted from 0 at its top left to 8 at its bottom right, row by row. */
function siteTile(orders: Orders, slot: number, index: number): number {
  const { size, sites } = orders;
  const row = (index / 3) | 0;
  return (sites.y[slot]! - 1 + row) * size + sites.x[slot]! - 1 + index - row * 3;
}

export function siteCenter(orders: Orders, slot: number): number {
  return orders.sites.y[slot]! * orders.size + orders.sites.x[slot]!;
}

/** Units of `good` that have arrived at a site: the stacks of that good on its nine tiles. */
export function arrived(map: TileMap, orders: Orders, slot: number, good: Good): number {
  let units = 0;
  for (let index = 0; index < 9; index++) {
    const tile = siteTile(orders, slot, index);
    if (map.stackGood[tile] === good) units += map.stackSize[tile]!;
  }
  return units;
}

/** Units of `good` that a site still lacks and that are not on their way to it. */
export function lacking(sim: Sim, slot: number, good: Good): number {
  const needs = HOUSE_NEEDS[good - 1]!;
  return needs - arrived(sim.map, sim.orders, slot, good) - sim.siteTasks.inbound[slot * GOOD_KINDS + good - 1]!;
}

function allArrived(sim: Sim, slot: number): boolean {
  for (let index = 0; index < GOOD_KINDS; index++) {
    if (arrived(sim.map, sim.orders, slot, (index + 1) as Good) < HOUSE_NEEDS[index]!) return false;
  }
  return true;
}

/** Brings a site's place in the open building work up to date. */
function refreshSite(sim: Sim, slot: number): void {
  const { orders, siteTasks } = sim;
  const center = siteCenter(orders, slot);
  const open =
    orders.sites.state[slot] === SiteState.Site &&
    sim.flow.next[center] !== -1 &&
    siteTasks.builders[slot]! < MAX_BUILDERS &&
    siteTasks.setAside[slot] === 0 &&
    allArrived(sim, slot);
  setOpen(siteTasks.building, orders.size, center, open);
}

/** Starts a newly placed site with nothing on its way and no builders. */
export function resetSite(sim: Sim, slot: number): void {
  const { siteTasks } = sim;
  siteTasks.inbound.fill(0, slot * GOOD_KINDS, (slot + 1) * GOOD_KINDS);
  siteTasks.builders[slot] = 0;
  siteTasks.corners[slot] = 0;
  siteTasks.setAside[slot] = 0;
  refreshSite(sim, slot);
}

/**
 * Stacks a unit that arrived on the site's own tiles. Logs fill them in row
 * order from the top left and stone from the bottom right, one good to a
 * stack. A house needs fewer units than nine stacks hold, so a unit always fits.
 */
export function deliver(sim: Sim, slot: number, good: Good): void {
  const { map, orders } = sim;
  for (let step = 0; step < 9; step++) {
    const tile = siteTile(orders, slot, good === Good.Stone ? 8 - step : step);
    const size = map.stackSize[tile]!;
    if (size > 0 && (map.stackGood[tile] !== good || size === STACK_LIMIT)) continue;
    map.stackGood[tile] = good;
    map.stackSize[tile] = size + 1;
    noteTileChange(sim, tile);
    break;
  }
  sim.tally.delivered += 1;
  refreshSite(sim, slot);
}

/**
 * Turns a site whose work is done into a house, and the home of a household
 * that has none. Its materials are used up, its nine tiles stop walkers, and
 * the routes are brought up to date in place. The
 * villagers leave the land it closed once the work that finished it ends.
 */
export function finishHouse(sim: Sim, slot: number): void {
  const { map, orders, siteTasks } = sim;
  for (let index = 0; index < 9; index++) {
    const tile = siteTile(orders, slot, index);
    map.stackGood[tile] = Good.None;
    map.stackSize[tile] = 0;
    map.kinds[tile] = TileKind.House;
    noteTileChange(sim, tile);
    siteTasks.closing[index] = tile;
  }
  finishSite(orders, slot);
  moveInto(sim.households, slot);
  closeFlowTiles(map, sim.flow, siteTasks.closing, 9);
  sim.tally.built += 1;
  refreshSite(sim, slot);
}

function cornerTile(orders: Orders, slot: number, corner: number): number {
  return siteCenter(orders, slot) + (corner & 1 ? 1 : -1) + (corner & 2 ? orders.size : -orders.size);
}

/** The corner a builder on `tile` holds at the site centered on `center`. */
function cornerAt(size: number, center: number, tile: number): number {
  return (tile % size > center % size ? 1 : 0) | (tile > center ? 2 : 0);
}

/** The free corner tile of a site nearest a point in a straight line. Equally near corners go to the lowest tile. */
function nearestFreeCorner(sim: Sim, slot: number, px: number, py: number): number {
  const { orders } = sim;
  const { size } = orders;
  let best = -1;
  let bestDistance = Infinity;
  for (let corner = 0; corner < 4; corner++) {
    if ((sim.siteTasks.corners[slot]! & (1 << corner)) !== 0) continue;
    const tile = cornerTile(orders, slot, corner);
    const dx = (tile % size) + 0.5 - px;
    const dy = (tile - (tile % size)) / size + 0.5 - py;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

function setAside(sim: Sim, slot: number): void {
  sim.siteTasks.setAside[slot] = 1;
  refreshSite(sim, slot);
}

function reopen(sim: Sim): void {
  const { setAside } = sim.siteTasks;
  for (let slot = 0; slot < MAX_SITES; slot++) {
    if (setAside[slot] === 0) continue;
    setAside[slot] = 0;
    refreshSite(sim, slot);
  }
}

/** Takes the open building work nearest the villager and the free corner tile of that site nearest it. Hands must be empty. */
function take(sim: Sim, id: number): boolean {
  const { villagers, orders, siteTasks } = sim;
  if (villagers.carried[id] !== Good.None) return false;
  const px = villagers.x[id]!;
  const py = villagers.y[id]!;
  for (;;) {
    const center = nearestOpen(siteTasks.building, orders.size, px, py);
    if (center < 0) return false;
    const slot = orders.siteOf[center]!;
    const corner = nearestFreeCorner(sim, slot, px, py);
    if (!planPath(sim, id, corner)) {
      setAside(sim, slot);
      continue;
    }
    siteTasks.builders[slot]! += 1;
    siteTasks.corners[slot]! |= 1 << cornerAt(orders.size, center, corner);
    refreshSite(sim, slot);
    villagers.taskTile[id] = center;
    villagers.workTile[id] = corner;
    return true;
  }
}

/** The site is still a site: not cancelled and not finished. */
function holds(sim: Sim, id: number): boolean {
  const slot = sim.orders.siteOf[sim.villagers.taskTile[id]!]!;
  return slot >= 0 && sim.orders.sites.state[slot] === SiteState.Site;
}

/** One tick of building work. The tick that completes it finishes the house. */
function work(sim: Sim, id: number): boolean {
  const { orders } = sim;
  const slot = orders.siteOf[sim.villagers.taskTile[id]!]!;
  const done = orders.sites.work[slot]! + 1;
  setSiteWork(orders, slot, done);
  if (done < HOUSE_WORK_TICKS) return false;
  finishHouse(sim, slot);
  return true;
}

/** Frees the builder's corner. The work done stays on the site. */
function release(sim: Sim, id: number): void {
  const { villagers, orders, siteTasks } = sim;
  if (!holds(sim, id)) return;
  const center = villagers.taskTile[id]!;
  const slot = orders.siteOf[center]!;
  siteTasks.builders[slot]! -= 1;
  siteTasks.corners[slot]! &= ~(1 << cornerAt(orders.size, center, villagers.workTile[id]!));
  refreshSite(sim, slot);
}

function refresh(sim: Sim, tile: number): void {
  const slot = sim.orders.siteOf[tile]!;
  if (slot >= 0) refreshSite(sim, slot);
  else setOpen(sim.siteTasks.building, sim.orders.size, tile, false);
}

/** Building work at a site that has all its materials, the most urgent kind of task. */
export const BUILDING: TaskKind = { take, holds, work, release, refresh, reopen };
