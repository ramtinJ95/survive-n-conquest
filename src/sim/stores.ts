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
  };
}

/**
 * What a store is to the settlement. A common store is the camp or a barn:
 * carriers bring food to the nearest one with room, households without a home
 * eat from the camp, and households stock their homes from the nearest one
 * with food. A home is a household's own. The interface totals each kind apart.
 */
export const StoreKind = { None: 0, Common: 1, Home: 2 } as const;
export type StoreKind = (typeof StoreKind)[keyof typeof StoreKind];

/** What each kind of building is as a store once it is finished, and the most of each good it holds. A good left out it holds none of. A site is no store and holds nothing. */
const BUILDING_STORES: Readonly<Record<Building, { readonly kind: StoreKind; readonly limits: Readonly<Partial<Record<Unit, number>>> }>> = {
  [Building.House]: { kind: StoreKind.Home, limits: { [Good.Food]: HOUSE_FOOD_LIMIT } },
  [Building.Hut]: { kind: StoreKind.None, limits: {} },
  [Building.Barn]: { kind: StoreKind.Common, limits: { [Good.Food]: BARN_FOOD_LIMIT } },
  [Building.Lodge]: { kind: StoreKind.None, limits: {} },
};

/** The one place that says which buildings are stores. Anything that is no store holds nothing. */
export function storeKind(orders: Orders, store: number): StoreKind {
  if (store === CAMP_STORE) return StoreKind.Common;
  return orders.sites.state[store] === SiteState.Built ? BUILDING_STORES[orders.sites.kind[store] as Building].kind : StoreKind.None;
}

/** The most of a good a store holds, where the camp holds `campLimit` of food and nothing else. */
export function limitOf(orders: Orders, campLimit: number, store: number, good: Unit): number {
  if (store === CAMP_STORE) return good === Good.Food ? campLimit : 0;
  return orders.sites.state[store] === SiteState.Built ? (BUILDING_STORES[orders.sites.kind[store] as Building].limits[good] ?? 0) : 0;
}

/** Counts a finished building among the common stores, when its kind is one. */
export function openStore(orders: Orders, stores: Stores, slot: number): void {
  if (storeKind(orders, slot) === StoreKind.Common) stores.barns[stores.barnCount++] = slot;
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

/** What a carrier looks for in a common store, for food. */
export const Wants = { Room: 0, Food: 1 } as const;
export type Wants = (typeof Wants)[keyof typeof Wants];

function offers(sim: Sim, store: number, wants: Wants): boolean {
  return wants === Wants.Room ? hasRoom(sim.orders, sim.stores, store, Good.Food) : free(sim.stores, store, Good.Food) > 0;
}

/**
 * The common store nearest a point in a straight line that has room for one
 * more unit, counting the units on their way, or that holds a unit no carrier
 * spoke for, or -1. The line runs to the camp center or to the middle of a
 * barn, as hauling measures the line to a stockpile place. A barn with no tile
 * beside it that a walk from the camp reaches is passed over. Equally near
 * stores go to the camp, then to the barn finished first. With `barnsOnly` the
 * camp is left out.
 */
export function nearestCommonStore(sim: Sim, px: number, py: number, wants: Wants, barnsOnly = false): number {
  const { stores } = sim;
  const { sites } = sim.orders;
  const { size } = sim.map;
  let best = -1;
  let bestDistance = Infinity;
  if (!barnsOnly && offers(sim, CAMP_STORE, wants)) {
    best = CAMP_STORE;
    const camp = sim.flow.goal;
    bestDistance = ((camp % size) + 0.5 - px) ** 2 + (Math.floor(camp / size) + 0.5 - py) ** 2;
  }
  for (let i = 0; i < stores.barnCount; i++) {
    const slot = stores.barns[i]!;
    const mx = siteMidX(sites, slot);
    const my = siteMidY(sites, slot);
    const distance = (mx - px) ** 2 + (my - py) ** 2;
    if (distance < bestDistance && offers(sim, slot, wants) && nearestDoor(sim, slot, mx, my) >= 0) {
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
