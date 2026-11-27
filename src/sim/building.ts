import { Building, Job, MAX_SIDE, footprintStart, kindOf, needOf, siteX0, siteY0 } from './buildings';
import { closeFlowTiles } from './flowField';
import { GOOD_KINDS, Good, STACK_LIMIT, type Unit } from './goods';
import { openHouse } from './households';
import { openWorkplace } from './jobs';
import { TileKind, type TileMap } from './map';
import { MAX_SITES, type Orders, SiteState, finishSite, setSiteWork } from './orders';
import { planPath } from './paths';
import type { Sim } from './sim';
import type { TaskKind } from './tasks';
import { openStore } from './stores';
import { noteTileChange } from './tileChanges';
import { type TileSet, createTileSet, nearestOpen, setOpen } from './tileSet';
import { resetWorkplaceYears } from './workplaceYears';

/** Villagers that build one site at a time, one on each corner tile. */
export const MAX_BUILDERS = 4;

/**
 * What villagers have taken on at each site, by slot. What has arrived at a
 * site is never counted here: it is the stacks on the site's tiles.
 */
export interface SiteTasks {
  /** Units on their way to each site, at `slot * GOOD_KINDS + good - 1`. */
  readonly inbound: Uint8Array;
  /** Villagers that hold building work at each site. */
  readonly builders: Uint8Array;
  /** Bit `1 << corner` is set where a builder holds that corner tile of the footprint. Corner 0 is its top left, 1 its top right, 2 its bottom left, and 3 its bottom right. */
  readonly corners: Uint8Array;
  /** 1 where a site's building work is set aside as out of reach, until dawn or until land gains walks. */
  readonly setAside: Uint8Array;
  /** The anchor tiles of the sites whose building work is open: every unit arrived, a corner free, reached, and not set aside. */
  readonly building: TileSet;
  /** Scratch for `finishBuilding`: the tiles of the building. */
  readonly closing: Int32Array;
}

export function createSiteTasks(size: number): SiteTasks {
  return {
    inbound: new Uint8Array(MAX_SITES * GOOD_KINDS),
    builders: new Uint8Array(MAX_SITES),
    corners: new Uint8Array(MAX_SITES),
    setAside: new Uint8Array(MAX_SITES),
    building: createTileSet(size),
    closing: new Int32Array(MAX_SIDE * MAX_SIDE),
  };
}

/** The tiles of a site's footprint. */
function siteTiles(orders: Orders, slot: number): number {
  const { side } = kindOf(orders.sites, slot);
  return side * side;
}

/** One of a site's tiles, counted from 0 at its top left to `siteTiles - 1` at its bottom right, row by row. */
function siteTile(orders: Orders, slot: number, index: number): number {
  const { size, sites } = orders;
  const { side } = kindOf(sites, slot);
  const row = (index / side) | 0;
  return (siteY0(sites, slot) + row) * size + siteX0(sites, slot) + index - row * side;
}

/** The anchor tile of a site, which stands for the site in its open building work and in the tasks that go to it. */
export function siteAnchor(orders: Orders, slot: number): number {
  return orders.sites.y[slot]! * orders.size + orders.sites.x[slot]!;
}

/** Units of `good` that have arrived at a site: the stacks of that good on its tiles. */
export function arrived(map: TileMap, orders: Orders, slot: number, good: Good): number {
  const { size, sites } = orders;
  const { side } = kindOf(sites, slot);
  const x0 = footprintStart(sites.x[slot]!, side);
  const y0 = footprintStart(sites.y[slot]!, side);
  let units = 0;
  for (let row = y0 * size + x0, end = row + side * size; row < end; row += size) {
    for (let tile = row; tile < row + side; tile++) if (map.stackGood[tile] === good) units += map.stackSize[tile]!;
  }
  return units;
}

/** Units of `good` that a site still lacks and that are not on their way to it. */
export function lacking(sim: Sim, slot: number, good: Unit): number {
  return needOf(kindOf(sim.orders.sites, slot), good) - arrived(sim.map, sim.orders, slot, good) - sim.siteTasks.inbound[slot * GOOD_KINDS + good - 1]!;
}

function allArrived(sim: Sim, slot: number): boolean {
  const kind = kindOf(sim.orders.sites, slot);
  for (let index = 0; index < GOOD_KINDS; index++) {
    const good = (index + 1) as Unit;
    if (arrived(sim.map, sim.orders, slot, good) < needOf(kind, good)) return false;
  }
  return true;
}

/** Brings a site's place in the open building work up to date. */
function refreshSite(sim: Sim, slot: number): void {
  const { orders, siteTasks } = sim;
  const anchor = siteAnchor(orders, slot);
  const open =
    orders.sites.state[slot] === SiteState.Site &&
    sim.flow.next[anchor] !== -1 &&
    siteTasks.builders[slot]! < MAX_BUILDERS &&
    siteTasks.setAside[slot] === 0 &&
    allArrived(sim, slot);
  setOpen(siteTasks.building, orders.size, anchor, open);
}

/** Starts a newly placed site with nothing on its way and no builders, and its years and standing crops from 0. */
export function resetSite(sim: Sim, slot: number): void {
  const { siteTasks } = sim;
  siteTasks.inbound.fill(0, slot * GOOD_KINDS, (slot + 1) * GOOD_KINDS);
  siteTasks.builders[slot] = 0;
  siteTasks.corners[slot] = 0;
  siteTasks.setAside[slot] = 0;
  resetWorkplaceYears(sim.workplaceYears, slot);
  sim.fields.standingBy[slot] = 0;
  refreshSite(sim, slot);
}

/**
 * Stacks a unit that arrived on the site's own tiles. Logs fill them in row
 * order from the top left and stone from the bottom right, one good to a
 * stack. Every kind needs fewer units than its tiles' stacks hold, so a unit always fits.
 */
export function deliver(sim: Sim, slot: number, good: Good): void {
  const { map, orders } = sim;
  const tiles = siteTiles(orders, slot);
  for (let step = 0; step < tiles; step++) {
    const tile = siteTile(orders, slot, good === Good.Stone ? tiles - 1 - step : step);
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
 * Turns a site whose work is done into a building. Its materials are used up,
 * its tiles stop walkers, and the routes are brought up to date in place. The
 * villagers leave the land it closed once the work that finished it ends. A
 * house becomes the home of a household that has none, and a workplace asks
 * for all its places and fills them.
 */
export function finishBuilding(sim: Sim, slot: number): void {
  const { map, orders, siteTasks } = sim;
  const tiles = siteTiles(orders, slot);
  for (let index = 0; index < tiles; index++) {
    const tile = siteTile(orders, slot, index);
    map.stackGood[tile] = Good.None;
    map.stackSize[tile] = 0;
    map.kinds[tile] = TileKind.Built;
    noteTileChange(sim, tile);
    siteTasks.closing[index] = tile;
  }
  finishSite(orders, slot);
  if (orders.sites.kind[slot] === Building.House) openHouse(sim.households, sim.villagers, slot);
  openStore(orders, sim.stores, slot);
  closeFlowTiles(map, sim.flow, siteTasks.closing, tiles);
  sim.tally.built += 1;
  refreshSite(sim, slot);
  if (kindOf(orders.sites, slot).places > 0) openWorkplace(sim, slot);
}

function cornerTile(orders: Orders, slot: number, corner: number): number {
  const { sites, size } = orders;
  const last = kindOf(sites, slot).side - 1;
  return (siteY0(sites, slot) + (corner & 2 ? last : 0)) * size + siteX0(sites, slot) + (corner & 1 ? last : 0);
}

/** The corner a builder on `tile`, one of the site's corner tiles, holds. */
function cornerAt(orders: Orders, slot: number, tile: number): number {
  const { sites, size } = orders;
  const x = tile % size;
  return (x > siteX0(sites, slot) ? 1 : 0) | ((tile - x) / size > siteY0(sites, slot) ? 2 : 0);
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
  for (let slot = 0; slot < sim.orders.sites.used; slot++) {
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
    const anchor = nearestOpen(siteTasks.building, orders.size, px, py);
    if (anchor < 0) return false;
    const slot = orders.siteOf[anchor]!;
    const corner = nearestFreeCorner(sim, slot, px, py);
    if (!planPath(sim, id, corner)) {
      setAside(sim, slot);
      continue;
    }
    siteTasks.builders[slot]! += 1;
    siteTasks.corners[slot]! |= 1 << cornerAt(orders, slot, corner);
    refreshSite(sim, slot);
    villagers.taskTile[id] = anchor;
    villagers.workTile[id] = corner;
    return true;
  }
}

/** The site is still a site: not cancelled and not finished. */
function holds(sim: Sim, id: number): boolean {
  const slot = sim.orders.siteOf[sim.villagers.taskTile[id]!]!;
  return slot >= 0 && sim.orders.sites.state[slot] === SiteState.Site;
}

/** One tick of building work. The tick that completes it finishes the building. */
function work(sim: Sim, id: number): boolean {
  const { orders } = sim;
  const slot = orders.siteOf[sim.villagers.taskTile[id]!]!;
  const done = orders.sites.work[slot]! + 1;
  setSiteWork(orders, slot, done);
  if (done < kindOf(orders.sites, slot).workTicks) return false;
  finishBuilding(sim, slot);
  return true;
}

/** Frees the builder's corner. The work done stays on the site. */
function release(sim: Sim, id: number): void {
  const { villagers, orders, siteTasks } = sim;
  if (!holds(sim, id)) return;
  const slot = orders.siteOf[villagers.taskTile[id]!]!;
  siteTasks.builders[slot]! -= 1;
  siteTasks.corners[slot]! &= ~(1 << cornerAt(orders, slot, villagers.workTile[id]!));
  refreshSite(sim, slot);
}

function refresh(sim: Sim, tile: number): void {
  const slot = sim.orders.siteOf[tile]!;
  if (slot >= 0) refreshSite(sim, slot);
  else setOpen(sim.siteTasks.building, sim.orders.size, tile, false);
}

/** Building work at a site that has all its materials, the most urgent kind of task after stocking a home. */
export const BUILDING: TaskKind = { job: Job.None, take, holds, work, release, refresh, reopen };
