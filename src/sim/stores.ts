import { Building, nearestDoor, siteMidX, siteMidY } from './buildings';
import { GOOD_KINDS, Good, type Unit } from './goods';
import { MAX_SITES, type Orders, SiteState } from './orders';
import type { Sim } from './sim';

/** The store id of the camp. Store `slot` below it is the store of the building in that site slot. */
export const CAMP_STORE = MAX_SITES;
/** Store ids run from 0 to this, the camp's, less one. */
export const STORES = MAX_SITES + 1;
/** The food the camp starts with: three days for 8 settlers. */
export const CAMP_FOOD = 24;
/** The most food the camp holds, unless it starts with more. */
export const CAMP_FOOD_LIMIT = 40;
export const HOUSE_FOOD_LIMIT = 16;
/** Three nights of a house's fire. */
export const HOUSE_FIREWOOD_LIMIT = 6;
export const CAMP_FIREWOOD_LIMIT = 12;
/** A household keeps this many days of meals for its living members at home, when it can get them. */
export const DAYS_KEPT_AT_HOME = 3;
/**
 * Settlers without a job keep this many days of meals at the camp for the
 * households that eat there, from the barns. One day leaves the rest in the
 * barns, so the camp holds the next meal and draws no more.
 */
export const DAYS_KEPT_AT_CAMP = 1;
export const MEALS_PER_DAY = 1;

export const BARN_FOOD_LIMIT = 120;
export const WOODSHED_FIREWOOD_LIMIT = 40;
export const TAILOR_CLOTHING_LIMIT = 8;

/**
 * The places under a roof that hold goods, by good at index `good - 1` and
 * then by store id. A unit of a stored good is a count in one of them, or on
 * one tile, or in a villager's hands.
 */
export interface Stores {
  readonly held: readonly Uint16Array[];
  /** Units on their way into each store. */
  readonly inbound: readonly Uint16Array[];
  /** Units in each store that a carrier has spoken for and will take out. */
  readonly outbound: readonly Uint16Array[];
  readonly campLimit: number;
  /** The site slots of the finished barns, the first `barnCount` of them, in the order they were finished. A barn is never torn down. */
  readonly barns: Int16Array;
  barnCount: number;
  /** The site slots of the finished workshops, the first `workshopCount` of them, in the order they were finished. */
  readonly workshops: Int16Array;
  workshopCount: number;
  /** 1 for each store whose fire burns tonight. Every fire goes out at dawn. */
  readonly burning: Uint8Array;
  /** 1 for each store whose fire burned in the night that ended at the last dawn. */
  readonly burnedLastNight: Uint8Array;
}

const byGood = () => Array.from({ length: GOOD_KINDS }, () => new Uint16Array(STORES));

export function createStores(campFood: number): Stores {
  const held = byGood();
  held[Good.Food - 1]![CAMP_STORE] = campFood;
  return {
    held,
    inbound: byGood(),
    outbound: byGood(),
    campLimit: Math.max(CAMP_FOOD_LIMIT, campFood),
    barns: new Int16Array(MAX_SITES),
    barnCount: 0,
    workshops: new Int16Array(MAX_SITES),
    workshopCount: 0,
    burning: new Uint8Array(STORES),
    burnedLastNight: new Uint8Array(STORES),
  };
}

/**
 * What a store is to the settlement. A common store is the camp or a barn:
 * carriers bring food to the nearest one with room, households without a home
 * eat from the camp, and households stock their homes from the nearest one
 * with food. A home is a household's own. A workshop's store holds what its
 * worker makes. The interface totals each kind apart.
 */
export const StoreKind = { None: 0, Common: 1, Home: 2, Workshop: 3 } as const;
export type StoreKind = (typeof StoreKind)[keyof typeof StoreKind];

/**
 * What a store is: its kind, the most of each good it holds, and the firewood
 * its fire burns on a cold night. A good left out it holds none of. A store
 * with no fire burns 0.
 */
interface StoreRow {
  readonly kind: StoreKind;
  readonly limits: Readonly<Partial<Record<Unit, number>>>;
  readonly fire: number;
}

/** The camp's row. Its food limit is `Stores.campLimit`, which a larger start raises. */
const CAMP_ROW: StoreRow = { kind: StoreKind.Common, limits: { [Good.Food]: CAMP_FOOD_LIMIT, [Good.Firewood]: CAMP_FIREWOOD_LIMIT }, fire: 4 };
const NO_STORE: StoreRow = { kind: StoreKind.None, limits: {}, fire: 0 };

/** What each kind of building is as a store once it is finished. A site is no store and holds nothing. */
const BUILDING_STORES: Readonly<Record<Building, StoreRow>> = {
  [Building.House]: { kind: StoreKind.Home, limits: { [Good.Food]: HOUSE_FOOD_LIMIT, [Good.Firewood]: HOUSE_FIREWOOD_LIMIT }, fire: 2 },
  [Building.Hut]: NO_STORE,
  [Building.Barn]: { kind: StoreKind.Common, limits: { [Good.Food]: BARN_FOOD_LIMIT }, fire: 0 },
  [Building.Lodge]: NO_STORE,
  [Building.Woodshed]: { kind: StoreKind.Workshop, limits: { [Good.Firewood]: WOODSHED_FIREWOOD_LIMIT }, fire: 0 },
  [Building.Tailor]: { kind: StoreKind.Workshop, limits: { [Good.Clothing]: TAILOR_CLOTHING_LIMIT }, fire: 0 },
};

/** The one place that says what each store is. Anything that is no store holds nothing. */
function rowOf(orders: Orders, store: number): StoreRow {
  if (store === CAMP_STORE) return CAMP_ROW;
  return orders.sites.state[store] === SiteState.Built ? BUILDING_STORES[orders.sites.kind[store] as Building] : NO_STORE;
}

export function storeKind(orders: Orders, store: number): StoreKind {
  return rowOf(orders, store).kind;
}

/** The most of a good a store holds, where the camp holds `campLimit` of food. */
export function limitOf(orders: Orders, campLimit: number, store: number, good: Unit): number {
  if (store === CAMP_STORE && good === Good.Food) return campLimit;
  return rowOf(orders, store).limits[good] ?? 0;
}

/** The firewood a store's fire burns on a cold night, or 0 for a store with no fire. */
export function fireOf(orders: Orders, store: number): number {
  return rowOf(orders, store).fire;
}

/** Counts a finished building among the common stores or the workshops, when its kind is one. */
export function openStore(orders: Orders, stores: Stores, slot: number): void {
  const kind = storeKind(orders, slot);
  if (kind === StoreKind.Common) stores.barns[stores.barnCount++] = slot;
  else if (kind === StoreKind.Workshop) stores.workshops[stores.workshopCount++] = slot;
}

/** Whether a store takes one more unit of a good, counting the units on their way into it. */
export function hasRoom(orders: Orders, stores: Stores, store: number, good: Unit): boolean {
  const index = good - 1;
  return stores.held[index]![store]! + stores.inbound[index]![store]! < limitOf(orders, stores.campLimit, store, good);
}

/** Units of a good in a store that no carrier has spoken for. */
export function free(stores: Stores, store: number, good: Unit): number {
  return stores.held[good - 1]![store]! - stores.outbound[good - 1]![store]!;
}

/** What a carrier looks for in a common store: room for a unit of a good, or a unit of it. */
export const Wants = { Room: 0, Unit: 1 } as const;
export type Wants = (typeof Wants)[keyof typeof Wants];

function offers(sim: Sim, store: number, wants: Wants, good: Unit): boolean {
  return wants === Wants.Room ? hasRoom(sim.orders, sim.stores, store, good) : free(sim.stores, store, good) > 0;
}

/**
 * The common store nearest a point in a straight line that has room for one
 * more unit of `good`, counting the units on their way, or that holds a unit
 * of it no carrier spoke for, or -1. The line runs to the camp center or to
 * the middle of a barn, as hauling measures the line to a stockpile place. A
 * barn with no tile beside it that a walk from the camp reaches is passed
 * over. Equally near stores go to the camp, then to the barn finished first.
 * With `barnsOnly` the camp is left out.
 */
export function nearestCommonStore(sim: Sim, px: number, py: number, wants: Wants, good: Unit = Good.Food, barnsOnly = false): number {
  const { stores } = sim;
  const { sites } = sim.orders;
  const { size } = sim.map;
  let best = -1;
  let bestDistance = Infinity;
  if (!barnsOnly && offers(sim, CAMP_STORE, wants, good)) {
    best = CAMP_STORE;
    const camp = sim.flow.goal;
    bestDistance = ((camp % size) + 0.5 - px) ** 2 + (Math.floor(camp / size) + 0.5 - py) ** 2;
  }
  for (let i = 0; i < stores.barnCount; i++) {
    const slot = stores.barns[i]!;
    const mx = siteMidX(sites, slot);
    const my = siteMidY(sites, slot);
    const distance = (mx - px) ** 2 + (my - py) ** 2;
    if (distance < bestDistance && offers(sim, slot, wants, good) && nearestDoor(sim, slot, mx, my) >= 0) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The tile a carrier stands on to put food into a common store or take it out:
 * the camp center, or the door of a barn nearest a point, or -1 when no tile
 * beside the barn has a walk to the camp.
 */
export function storeDoor(sim: Sim, store: number, px: number, py: number): number {
  return store === CAMP_STORE ? sim.flow.goal : nearestDoor(sim, store, px, py);
}

/**
 * The finished workshop nearest a point in a straight line, to its middle,
 * that holds a unit of `good` no carrier has spoken for, or -1. A workshop
 * with no tile beside it that a walk from the camp reaches is passed over.
 * Equally near workshops go to the one finished first.
 */
export function nearestWorkshopWith(sim: Sim, px: number, py: number, good: Unit): number {
  const { stores } = sim;
  const { sites } = sim.orders;
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < stores.workshopCount; i++) {
    const slot = stores.workshops[i]!;
    const mx = siteMidX(sites, slot);
    const my = siteMidY(sites, slot);
    const distance = (mx - px) ** 2 + (my - py) ** 2;
    if (distance < bestDistance && free(stores, slot, good) > 0 && nearestDoor(sim, slot, mx, my) >= 0) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best;
}
