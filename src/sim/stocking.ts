import { nearestDoor } from './building';
import { Good, putDownHeld } from './goods';
import { NO_HOME } from './households';
import { planPath } from './paths';
import type { Sim } from './sim';
import { CAMP_STORE, DAYS_KEPT_AT_HOME, MEALS_PER_DAY, foodLimit, freeFood } from './stores';
import type { TaskKind } from './tasks';

/**
 * The units of food a household's home lacks to hold its living members'
 * meals for `DAYS_KEPT_AT_HOME`, up to what the house holds, counting the units
 * on their way in. A household must have a home.
 */
export function lacks(sim: Sim, household: number): number {
  const { households, stores } = sim;
  const home = households.home[household]!;
  const wanted = Math.min(DAYS_KEPT_AT_HOME * MEALS_PER_DAY * households.living[household]!, foodLimit(sim.orders, stores, home));
  return wanted - stores.food[home]! - stores.inbound[home]!;
}

const homeOf = (sim: Sim, id: number) => sim.households.home[sim.villagers.household[id]!]!;

/**
 * Sends a villager with empty hands, whose home lacks food, to the camp center
 * for a unit the camp has and no carrier spoke for, and reserves the unit and
 * its place in the home. The house is the home of the villager's household,
 * which stays its home while a member lives, so the task keeps no house of its own.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, stores, flow } = sim;
  const home = homeOf(sim, id);
  if (home === NO_HOME || villagers.carried[id] !== Good.None) return false;
  if (lacks(sim, villagers.household[id]!) <= 0 || freeFood(stores, CAMP_STORE) <= 0) return false;
  const { size } = sim.map;
  const door = nearestDoor(sim, home, (flow.goal % size) + 0.5, Math.floor(flow.goal / size) + 0.5);
  if (door < 0 || !planPath(sim, id, flow.goal)) return false;
  stores.outbound[CAMP_STORE] = stores.outbound[CAMP_STORE]! + 1;
  stores.inbound[home] = stores.inbound[home]! + 1;
  villagers.taskTile[id] = flow.goal;
  villagers.workTile[id] = flow.goal;
  villagers.destination[id] = door;
  return true;
}

/** The villager's household still has its home. */
function holds(sim: Sim, id: number): boolean {
  return homeOf(sim, id) !== NO_HOME;
}

/**
 * Takes the unit out of the camp and turns the villager toward the door, or
 * puts the unit in the home there. Neither takes work ticks. A unit with no
 * walk to the door goes back into the camp.
 */
function work(sim: Sim, id: number): boolean {
  const { villagers, stores } = sim;
  const home = homeOf(sim, id);
  if (villagers.carried[id] === Good.None) {
    stores.outbound[CAMP_STORE] = stores.outbound[CAMP_STORE]! - 1;
    villagers.workTile[id] = villagers.destination[id]!;
    if (planPath(sim, id, villagers.workTile[id]!)) {
      stores.food[CAMP_STORE] = stores.food[CAMP_STORE]! - 1;
      villagers.carried[id] = Good.Food;
      return false;
    }
    stores.inbound[home] = stores.inbound[home]! - 1;
    villagers.destination[id] = -1;
    return true;
  }
  stores.inbound[home] = stores.inbound[home]! - 1;
  stores.food[home] = stores.food[home]! + 1;
  villagers.carried[id] = Good.None;
  villagers.destination[id] = -1;
  sim.tally.carriedHome += 1;
  return true;
}

/**
 * Gives back what the task still holds: the unit and its place in the home
 * until it is picked up, and the place after. A unit in the villager's hands is
 * put down where it stands, where it lies on open ground until it is gone.
 */
function release(sim: Sim, id: number): void {
  const { villagers, stores } = sim;
  if (villagers.destination[id]! < 0) return;
  const home = homeOf(sim, id);
  stores.inbound[home] = stores.inbound[home]! - 1;
  if (villagers.carried[id] === Good.None) {
    stores.outbound[CAMP_STORE] = stores.outbound[CAMP_STORE]! - 1;
    return;
  }
  putDownHeld(sim, id);
}

const nothing = () => {};

/** Carrying one unit of food from the camp to the villager's home, the most urgent kind of task. */
export const STOCKING: TaskKind = { take, holds, work, release, refresh: nothing, reopen: nothing };
