import { ANYONE, Job, nearestDoor, siteMidX, siteMidY } from './buildings';
import { Good, type Unit, putDownHeld } from './goods';
import { NO_HOME } from './households';
import { jobOf } from './jobs';
import { planPath } from './paths';
import type { Sim } from './sim';
import {
  CAMP_STORE,
  DAYS_KEPT_AT_CAMP,
  DAYS_KEPT_AT_HOME,
  MEALS_PER_DAY,
  Wants,
  limitOf,
  nearestCommonStore,
  nearestWorkshopWith,
  storeDoor,
} from './stores';
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

/** The units of firewood a store lacks to be full, counting the units on their way in. */
export function firewoodLacks(sim: Sim, store: number): number {
  const { stores } = sim;
  const index = Good.Firewood - 1;
  return limitOf(sim.orders, stores.campLimit, store, Good.Firewood) - stores.held[index]![store]! - stores.inbound[index]![store]!;
}

const homeOf = (sim: Sim, id: number) => sim.households.home[sim.villagers.household[id]!]!;

/**
 * The store a unit of `good` for store `to` comes from, nearest the point
 * (`px`, `py`): a common store for food, which for the camp is a barn, and a
 * workshop for firewood. Returns -1 when none has a unit no carrier spoke for.
 */
function sourceOf(sim: Sim, good: Unit, to: number, px: number, py: number): number {
  if (good === Good.Firewood) return nearestWorkshopWith(sim, px, py, Good.Firewood);
  return nearestCommonStore(sim, px, py, Wants.Unit, Good.Food, to === CAMP_STORE);
}

/**
 * Sends the villager with empty hands to fetch 1 unit of `good` from the
 * store nearest the point (`px`, `py`) that has one no carrier spoke for, for
 * store `to`, and reserves the unit and its place in `to`. Returns false when
 * no store has one or no walk reaches it.
 */
function fetchFor(sim: Sim, id: number, good: Unit, to: number, px: number, py: number): boolean {
  const { villagers, stores, flow } = sim;
  const from = sourceOf(sim, good, to, px, py);
  if (from < 0) return false;
  const { size } = sim.map;
  const pickup = storeDoor(sim, from, villagers.x[id]!, villagers.y[id]!);
  if (pickup < 0) return false;
  const door = to === CAMP_STORE ? flow.goal : nearestDoor(sim, to, (pickup % size) + 0.5, Math.floor(pickup / size) + 0.5);
  if (door < 0 || !planPath(sim, id, pickup)) return false;
  stores.outbound[good - 1]![from]! += 1;
  stores.inbound[good - 1]![to]! += 1;
  villagers.stockGood[id] = good;
  villagers.fromStore[id] = from;
  villagers.toStore[id] = to;
  villagers.taskTile[id] = pickup;
  villagers.workTile[id] = pickup;
  villagers.destination[id] = door;
  return true;
}

/**
 * Sends a villager with empty hands to stock the first store that lacks a
 * unit it can fetch, most urgent first. Food for its household's home comes
 * from the common store nearest the home, then firewood for the home from the
 * woodshed nearest it. A villager without a job then keeps the camp stocked
 * for the households that sleep there: food from the barn nearest the camp,
 * then firewood from the woodshed nearest it. The house is the home of the
 * villager's household, which stays its home while a member lives.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, stores, households, flow } = sim;
  if (villagers.carried[id] !== Good.None) return false;
  const home = homeOf(sim, id);
  if (home !== NO_HOME) {
    const { sites } = sim.orders;
    const hx = siteMidX(sites, home);
    const hy = siteMidY(sites, home);
    if (lacks(sim, villagers.household[id]!) > 0 && fetchFor(sim, id, Good.Food, home, hx, hy)) return true;
    if (firewoodLacks(sim, home) > 0 && fetchFor(sim, id, Good.Firewood, home, hx, hy)) return true;
  }
  if (jobOf(sim, id) !== Job.None) return false;
  const { size } = sim.map;
  const cx = (flow.goal % size) + 0.5;
  const cy = Math.floor(flow.goal / size) + 0.5;
  if (stores.barnCount > 0 && campLacks(sim) > 0 && fetchFor(sim, id, Good.Food, CAMP_STORE, cx, cy)) return true;
  return households.atCamp > 0 && firewoodLacks(sim, CAMP_STORE) > 0 && fetchFor(sim, id, Good.Firewood, CAMP_STORE, cx, cy);
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
  const { villagers, stores, tally } = sim;
  const from = villagers.fromStore[id]!;
  const to = villagers.toStore[id]!;
  const good = villagers.stockGood[id]! as Unit;
  const index = good - 1;
  if (villagers.carried[id] === Good.None) {
    stores.outbound[index]![from]! -= 1;
    villagers.workTile[id] = villagers.destination[id]!;
    if (planPath(sim, id, villagers.workTile[id]!)) {
      stores.held[index]![from]! -= 1;
      villagers.carried[id] = good;
      return false;
    }
    stores.inbound[index]![to]! -= 1;
    villagers.toStore[id] = -1;
    villagers.stockGood[id] = Good.None;
    return true;
  }
  stores.inbound[index]![to]! -= 1;
  stores.held[index]![to]! += 1;
  villagers.carried[id] = Good.None;
  villagers.toStore[id] = -1;
  villagers.stockGood[id] = Good.None;
  const toCamp = to === CAMP_STORE;
  if (good === Good.Firewood) {
    if (toCamp) tally.firewoodToCamp += 1;
    else tally.firewoodHome += 1;
  } else if (toCamp) tally.toCamp += 1;
  else tally.carriedHome += 1;
  return true;
}

/**
 * Gives back what the task still holds: the unit and its place in the store
 * it goes to until it is picked up, and the place after. A unit in the
 * villager's hands is put down where it stands. Food lies on open ground until
 * a settler without a job carries it to a store or it is gone. Firewood lies
 * there for good, because no carrier takes it off the ground.
 */
function release(sim: Sim, id: number): void {
  const { villagers, stores } = sim;
  const to = villagers.toStore[id]!;
  if (to < 0) return;
  const index = villagers.stockGood[id]! - 1;
  stores.inbound[index]![to]! -= 1;
  villagers.toStore[id] = -1;
  villagers.stockGood[id] = Good.None;
  if (villagers.carried[id] === Good.None) {
    stores.outbound[index]![villagers.fromStore[id]!]! -= 1;
    return;
  }
  putDownHeld(sim, id);
}

const nothing = () => {};

/** Carrying one unit of food or firewood into the villager's home, or into the camp, the most urgent kind of task. */
export const STOCKING: TaskKind = { job: ANYONE, take, holds, work, release, refresh: nothing, reopen: nothing };
