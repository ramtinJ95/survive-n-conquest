import { Good } from './goods';
import { NO_HOME } from './households';
import type { Sim, Tally } from './sim';
import { CAMP_STORE, fireOf, free } from './stores';
import { Cause } from './villagerState';
import type { Villagers } from './villagers';

/**
 * A need of every villager: a column of the times in a row it went unmet. A
 * villager with any unmet need is wanting, and works at half the rate. One
 * whose count reaches `diesAt` dies.
 */
export interface Need {
  readonly column: (villagers: Villagers) => Uint8Array;
  readonly diesAt: number;
  /** The tally that counts the villagers it killed. */
  readonly deaths: keyof Tally;
  /** The cause of death of the villagers it killed. */
  readonly cause: Cause;
}

/** Meals missed in a row. The third kills. */
export const HUNGER: Need = { column: (villagers) => villagers.missedMeals, diesAt: 3, deaths: 'starved', cause: Cause.Hunger };
/** Cold nights in a row. The third kills. */
export const COLD: Need = { column: (villagers) => villagers.coldNights, diesAt: 3, deaths: 'froze', cause: Cause.Cold };

/**
 * Every need. A new need adds its column to the villager table and an entry
 * here, and meets or misses it where it is checked. The half rate, and the
 * column a frame and the news read, follow from the entry.
 */
export const NEEDS: readonly Need[] = [HUNGER, COLD];

export function meetNeed(sim: Sim, id: number, need: Need): void {
  need.column(sim.villagers)[id] = 0;
}

/** Whether any need of the villager is unmet. */
export function wanting(villagers: Villagers, id: number): boolean {
  for (let need = 0; need < NEEDS.length; need++) if (NEEDS[need]!.column(villagers)[id]! > 0) return true;
  return false;
}

/** The store the villager eats from and stocks: its household's house, or the camp while it has none. */
export function storeOf(sim: Sim, id: number): number {
  const home = sim.households.home[sim.villagers.household[id]!]!;
  return home === NO_HOME ? CAMP_STORE : home;
}

/** Takes one meal from the store the villager came home to, when it holds one no carrier has spoken for. Returns whether it ate. */
export function eat(sim: Sim, id: number, store: number): boolean {
  const { stores } = sim;
  if (free(stores, store, Good.Food) <= 0) return false;
  stores.held[Good.Food - 1]![store]! -= 1;
  meetNeed(sim, id, HUNGER);
  sim.tally.meals += 1;
  return true;
}

/** A villager is warm through a cold night with this many of the sources of warmth. */
export const WARM_SOURCES = 2;

/** Whether the villager wears clothing. */
export function clothed(sim: Sim, id: number): boolean {
  return sim.villagers.worn[id] === Good.Clothing;
}

/**
 * The sources of warmth the villager has tonight: it sleeps in a house, a fire
 * burns where it sleeps, and it wears clothing. `store` is where it sleeps,
 * its house or the camp, or -1 for one that never got home. `fire` says
 * whether that store's fire burns.
 */
export function warmth(sim: Sim, id: number, store: number, fire: boolean): number {
  const house = store >= 0 && store !== CAMP_STORE;
  return Number(house) + Number(store >= 0 && fire) + Number(clothed(sim, id));
}

/** Whether the store's fire would light now: it has a fire, and holds the firewood that fire burns. */
export function fireLights(sim: Sim, store: number): boolean {
  const burns = fireOf(sim.orders, store);
  return burns > 0 && free(sim.stores, store, Good.Firewood) >= burns;
}

/**
 * Lights the fire of a store that has one on a cold night, once, when the
 * store holds the firewood it burns, which it takes. A store with less keeps
 * what it has and has no fire tonight.
 */
export function lightFire(sim: Sim, store: number): void {
  const { stores } = sim;
  if (stores.burning[store] === 1 || !fireLights(sim, store)) return;
  const burns = fireOf(sim.orders, store);
  stores.held[Good.Firewood - 1]![store]! -= burns;
  stores.burning[store] = 1;
  sim.tally.fires += 1;
  sim.tally.burnt += burns;
}
