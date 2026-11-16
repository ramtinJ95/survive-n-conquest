import { Building } from './buildings';
import { MAX_SITES, type Orders, SiteState } from './orders';

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
export const MEALS_PER_DAY = 1;

/**
 * The places under a roof that hold food, by store id. A unit of food is a
 * count in one of them, or on one tile, or in a villager's hands.
 */
export interface Stores {
  readonly food: Uint16Array;
  /** Units on their way into each store. */
  readonly inbound: Uint16Array;
  /** Units in each store that a carrier has spoken for and will take out. */
  readonly outbound: Uint16Array;
  readonly campLimit: number;
}

export function createStores(campFood: number): Stores {
  const food = new Uint16Array(STORES);
  food[CAMP_STORE] = campFood;
  return { food, inbound: new Uint16Array(STORES), outbound: new Uint16Array(STORES), campLimit: Math.max(CAMP_FOOD_LIMIT, campFood) };
}

/**
 * What a store is to the settlement. A common store is the camp, and a barn
 * later: households without a home eat from the camp, and households stock
 * their homes from it. A home is a household's own. The interface totals each
 * kind apart.
 */
export const StoreKind = { None: 0, Common: 1, Home: 2 } as const;
export type StoreKind = (typeof StoreKind)[keyof typeof StoreKind];

/** The one place that says which buildings are stores. Anything that is no store holds nothing. */
export function storeKind(orders: Orders, store: number): StoreKind {
  if (store === CAMP_STORE) return StoreKind.Common;
  return orders.sites.state[store] === SiteState.Built && orders.sites.kind[store] === Building.House ? StoreKind.Home : StoreKind.None;
}

/** The most food a store holds. */
export function foodLimit(orders: Orders, stores: Stores, store: number): number {
  if (store === CAMP_STORE) return stores.campLimit;
  return storeKind(orders, store) === StoreKind.Home ? HOUSE_FOOD_LIMIT : 0;
}

/** A store that takes one more unit, counting the units on their way into it: the camp, or -1 when it is full. */
export function storeWithRoom(orders: Orders, stores: Stores): number {
  return stores.food[CAMP_STORE]! + stores.inbound[CAMP_STORE]! < foodLimit(orders, stores, CAMP_STORE) ? CAMP_STORE : -1;
}

/** Units in a store that no carrier has spoken for. */
export function freeFood(stores: Stores, store: number): number {
  return stores.food[store]! - stores.outbound[store]!;
}
