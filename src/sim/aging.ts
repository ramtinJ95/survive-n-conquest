import { TICKS_PER_YEAR_OF_AGE } from './calendar';
import { startWorking } from './households';
import { fillPlaces } from './jobs';
import { hashUnit } from './noise';
import type { Sim } from './sim';
import { Cause, VillagerState } from './villagerState';
import { type Villagers, die } from './villagers';

/** A starting settler's age is a whole number of years in this range, every age as likely as another. */
export const STARTING_AGES = [18, 30] as const;
/** A villager starts to work at the first dawn at which it is this old. A child is younger. */
export const WORK_AGE = 10;
/** A settler is grown at this age. */
export const GROWN_AGE = 16;
/** A villager's life span is a whole number of years in this range, every number as likely as another. */
export const LIFE_SPANS = [60, 80] as const;

const AGE_SALT = 0x1a6e_d052;
const SPAN_SALT = 0x7c35_9e21;

/** A whole number from `low` to `high`, every one as likely, drawn from a fraction in [0, 1). */
const wholeIn = ([low, high]: readonly [number, number], unit: number) => low + Math.floor(unit * (high - low + 1));

/** The age the seed gives starting settler `id` on day 1. */
export function startingAge(seed: number, id: number): number {
  return wholeIn(STARTING_AGES, hashUnit(seed ^ AGE_SALT, id, 0));
}

/** The life span the seed gives villager `id`, keyed by the seed and the id alone. */
export function lifeSpan(seed: number, id: number): number {
  return wholeIn(LIFE_SPANS, hashUnit(seed ^ SPAN_SALT, id, 0));
}

/** The birth tick of a villager that is `age` years old at tick 0 and a year older at each `TICKS_PER_YEAR_OF_AGE` after it. */
export function bornAt(age: number): number {
  return -age * TICKS_PER_YEAR_OF_AGE;
}

/** The villager's age in whole years at `tick`. */
export function ageAt(villagers: Villagers, id: number, tick: number): number {
  return Math.floor((tick - villagers.born[id]!) / TICKS_PER_YEAR_OF_AGE);
}

/** The age the interface shows: at `tick` while the villager lives, and at its death once it died. */
export function ageOf(villagers: Villagers, id: number, tick: number): number {
  return ageAt(villagers, id, villagers.state[id] === VillagerState.Dead ? villagers.diedAt[id]! : tick);
}

/** Every living villager that has reached its life span dies of old age where it stands. It runs at a dawn. */
export function dieOfOldAge(sim: Sim): void {
  const { villagers } = sim;
  for (let id = 0; id < villagers.count; id++) {
    if (villagers.state[id] === VillagerState.Dead) continue;
    if (sim.tick - villagers.born[id]! < villagers.span[id]! * TICKS_PER_YEAR_OF_AGE) continue;
    sim.tally.oldAge += 1;
    die(sim, id, Cause.OldAge);
  }
}

/**
 * Every living child of `WORK_AGE` or older starts to work, step 3 of a dawn.
 * Its household counts it among its workers, and the open places at the
 * workplaces are filled by the nearest rule, now that it can take one.
 */
export function startWork(sim: Sim): void {
  const { villagers } = sim;
  const started = sim.tally.startedWork;
  for (let id = 0; id < villagers.count; id++) {
    if (villagers.child[id] === 0 || villagers.state[id] === VillagerState.Dead) continue;
    if (sim.tick - villagers.born[id]! < WORK_AGE * TICKS_PER_YEAR_OF_AGE) continue;
    startWorking(sim.households, villagers, id);
    sim.tally.startedWork += 1;
  }
  if (sim.tally.startedWork !== started) fillPlaces(sim);
}
