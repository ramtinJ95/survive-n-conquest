import { ANYONE, Job, nearestDoor, siteMidX, siteMidY } from './buildings';
import { Good, putDownHeld } from './goods';
import { NO_HOME } from './households';
import { jobOf } from './jobs';
import { planPath } from './paths';
import type { Sim } from './sim';
import { CAMP_STORE, DAYS_KEPT_AT_CAMP, DAYS_KEPT_AT_HOME, MEALS_PER_DAY, Wants, limitOf, nearestCommonStore, storeDoor } from './stores';
import type { TaskKind } from './tasks';

/**
 * The units of food a household's home lacks to hold its living members'
 * meals for `DAYS_KEPT_AT_HOME`, up to what the house holds, counting the units
 * on their way in. A household must have a home.
 */
export function lacks(sim: Sim, household: number): number {
  const { households, stores } = sim;
  const home = households.home[household]!;
  const wanted = Math.min(DAYS_KEPT_AT_HOME * MEALS_PER_DAY * households.living[household]!, limitOf(sim.orders, stores.campLimit, home, Good.Food));
  return wanted - stores.held[Good.Food - 1]![home]! - stores.inbound[Good.Food - 1]![home]!;
}

/**
 * The units of food the camp lacks to hold `DAYS_KEPT_AT_CAMP` of meals for the
 * living members of the households with no home, who eat there, up to what
 * the camp holds, counting the units on their way in.
 */
export function campLacks(sim: Sim): number {
  const { stores } = sim;
  const wanted = Math.min(DAYS_KEPT_AT_CAMP * MEALS_PER_DAY * sim.households.atCamp, stores.campLimit);
  return wanted - stores.held[Good.Food - 1]![CAMP_STORE]! - stores.inbound[Good.Food - 1]![CAMP_STORE]!;
}

const homeOf = (sim: Sim, id: number) => sim.households.home[sim.villagers.household[id]!]!;

/**
 * Sends a villager with empty hands, whose home lacks food, to the common
 * store nearest its home that has a unit no carrier spoke for, the camp or a
 * barn, and reserves the unit and its place in the home. A villager without a
 * job whose home lacks nothing keeps the camp stocked the same way, from the
 * barn nearest the camp, for the households that eat there. The house is the
 * home of the villager's household, which stays its home while a member lives.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, stores, flow } = sim;
  if (villagers.carried[id] !== Good.None) return false;
  const home = homeOf(sim, id);
  let to: number;
  if (home !== NO_HOME && lacks(sim, villagers.household[id]!) > 0) to = home;
  else if (stores.barnCount > 0 && jobOf(sim, id) === Job.None && campLacks(sim) > 0) to = CAMP_STORE;
  else return false;
  const { size } = sim.map;
  const { sites } = sim.orders;
  const toCamp = to === CAMP_STORE;
  const from = toCamp
    ? nearestCommonStore(sim, (flow.goal % size) + 0.5, Math.floor(flow.goal / size) + 0.5, Wants.Food, true)
    : nearestCommonStore(sim, siteMidX(sites, home), siteMidY(sites, home), Wants.Food);
  if (from < 0) return false;
  const pickup = storeDoor(sim, from, villagers.x[id]!, villagers.y[id]!);
  if (pickup < 0) return false;
  const door = toCamp ? flow.goal : nearestDoor(sim, home, (pickup % size) + 0.5, Math.floor(pickup / size) + 0.5);
  if (door < 0 || !planPath(sim, id, pickup)) return false;
  stores.outbound[Good.Food - 1]![from]! += 1;
  stores.inbound[Good.Food - 1]![to]! += 1;
  villagers.fromStore[id] = from;
  villagers.toStore[id] = to;
  villagers.taskTile[id] = pickup;
  villagers.workTile[id] = pickup;
  villagers.destination[id] = door;
  return true;
}

/**
 * The unit still goes to the home of the villager's household, or to the camp
 * while the villager has no job, as one hired on its way does.
 */
function holds(sim: Sim, id: number): boolean {
  const to = sim.villagers.toStore[id]!;
  return to === CAMP_STORE ? jobOf(sim, id) === Job.None : to === homeOf(sim, id);
}

/**
 * Takes the unit out of its store and turns the villager toward the door, or
 * puts the unit in the store it goes to there. Neither takes work ticks. A
 * unit with no walk to the door stays in its store.
 */
function work(sim: Sim, id: number): boolean {
  const { villagers, stores } = sim;
  const from = villagers.fromStore[id]!;
  const to = villagers.toStore[id]!;
  if (villagers.carried[id] === Good.None) {
    stores.outbound[Good.Food - 1]![from]! -= 1;
    villagers.workTile[id] = villagers.destination[id]!;
    if (planPath(sim, id, villagers.workTile[id]!)) {
      stores.held[Good.Food - 1]![from]! -= 1;
      villagers.carried[id] = Good.Food;
      return false;
    }
    stores.inbound[Good.Food - 1]![to]! -= 1;
    villagers.toStore[id] = -1;
    return true;
  }
  stores.inbound[Good.Food - 1]![to]! -= 1;
  stores.held[Good.Food - 1]![to]! += 1;
  villagers.carried[id] = Good.None;
  villagers.toStore[id] = -1;
  if (to === CAMP_STORE) sim.tally.toCamp += 1;
  else sim.tally.carriedHome += 1;
  return true;
}

/**
 * Gives back what the task still holds: the unit and its place in the store
 * it goes to until it is picked up, and the place after. A unit in the
 * villager's hands is put down where it stands, where it lies on open ground
 * until a settler without a job carries it to a store or it is gone.
 */
function release(sim: Sim, id: number): void {
  const { villagers, stores } = sim;
  const to = villagers.toStore[id]!;
  if (to < 0) return;
  stores.inbound[Good.Food - 1]![to]! -= 1;
  villagers.toStore[id] = -1;
  if (villagers.carried[id] === Good.None) {
    const from = villagers.fromStore[id]!;
    stores.outbound[Good.Food - 1]![from]! -= 1;
    return;
  }
  putDownHeld(sim, id);
}

const nothing = () => {};

/** Carrying one unit of food from a common store to the villager's home, or from a barn to the camp, the most urgent kind of task. */
export const STOCKING: TaskKind = { job: ANYONE, take, holds, work, release, refresh: nothing, reopen: nothing };
