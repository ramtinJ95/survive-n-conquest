import { NO_HOME } from './households';
import type { Sim } from './sim';
import { CAMP_STORE, freeFood } from './stores';
import { type Villagers, die } from './villagers';

/**
 * A need of every villager: a column of the times in a row it went unmet. A
 * villager with any unmet need is wanting, and works at half the rate. One
 * whose count reaches `diesAt` dies.
 */
export interface Need {
  readonly column: (villagers: Villagers) => Uint8Array;
  readonly diesAt: number;
}

/** Meals missed in a row. The third kills. */
export const HUNGER: Need = { column: (villagers) => villagers.missedMeals, diesAt: 3 };

/** Every need. A new need adds its column to the villager table and an entry here, and meets or misses it where it is checked. */
const NEEDS: readonly Need[] = [HUNGER];

export function meetNeed(sim: Sim, id: number, need: Need): void {
  need.column(sim.villagers)[id] = 0;
}

/** Counts the need unmet once more, and kills the villager at the count that kills. */
export function missNeed(sim: Sim, id: number, need: Need): void {
  const column = need.column(sim.villagers);
  column[id] = column[id]! + 1;
  if (column[id]! >= need.diesAt) die(sim, id);
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

/** Takes one meal from the villager's store, when it holds one no carrier has spoken for. Returns whether it ate. */
export function eat(sim: Sim, id: number): boolean {
  const { stores } = sim;
  const store = storeOf(sim, id);
  if (freeFood(stores, store) <= 0) return false;
  stores.food[store] = stores.food[store]! - 1;
  meetNeed(sim, id, HUNGER);
  sim.tally.meals += 1;
  return true;
}

/** The villager's meal of the day: it eats, or misses the meal. */
export function dine(sim: Sim, id: number): void {
  if (!eat(sim, id)) missMeal(sim, id);
}

export function missMeal(sim: Sim, id: number): void {
  sim.tally.missed += 1;
  missNeed(sim, id, HUNGER);
}
