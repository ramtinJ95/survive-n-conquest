import { works } from './jobs';
import { MAX_SITES } from './orders';
import type { Villagers } from './villagers';

/** At most this many households on a map, half the villagers table's rows, so the households cannot run out first. */
export const MAX_HOUSEHOLDS = 2048;
export const NO_HOME = -1;
/** A couple's place that no villager holds, as the woman of a starting household of one man. */
export const NO_VILLAGER = -1;

/**
 * The household table. Every column has `MAX_HOUSEHOLDS` rows, and the first
 * `count` are households that formed. A household's number is never used
 * twice. Its members are the villagers whose household column names it: its
 * couple while they live, and their children.
 */
export interface Households {
  count: number;
  /** Site slot of each household's house, or NO_HOME. */
  readonly home: Int16Array;
  /** The household living in each site slot's house, or -1. */
  readonly householdIn: Int16Array;
  /** The members of each household still alive. */
  readonly living: Uint8Array;
  /** The living members of each household who work, and so can carry for it. */
  readonly workers: Uint8Array;
  /** The couple that formed each household: the man and the woman, or `NO_VILLAGER`. */
  readonly man: Int32Array;
  readonly woman: Int32Array;
  /** The dawn of each household's last birth, as a count of `Sim.dawns`, or the dawn it formed at until its first. One that formed before the map's first tick has a negative one. */
  readonly lastBirth: Int32Array;
  /** Scratch for a dawn's births, not part of the state: 1 for each household one of whose living members is wanting. */
  readonly wanting: Uint8Array;
  /** Scratch for a dawn's births: at `2h + sex`, bit `i` set when a living member of household `h` bears name `i` of that sex. */
  readonly names: Uint32Array;
  /** The living members of the households with no home, who eat at the camp. */
  atCamp: number;
  /** The households with a living member and no living worker, whose homes the settlers without a job stock. */
  unattended: number;
}

export function createHouseholds(): Households {
  return {
    count: 0,
    home: new Int16Array(MAX_HOUSEHOLDS).fill(NO_HOME),
    householdIn: new Int16Array(MAX_SITES).fill(-1),
    living: new Uint8Array(MAX_HOUSEHOLDS),
    workers: new Uint8Array(MAX_HOUSEHOLDS),
    man: new Int32Array(MAX_HOUSEHOLDS).fill(NO_VILLAGER),
    woman: new Int32Array(MAX_HOUSEHOLDS).fill(NO_VILLAGER),
    lastBirth: new Int32Array(MAX_HOUSEHOLDS),
    wanting: new Uint8Array(MAX_HOUSEHOLDS),
    names: new Uint32Array(MAX_HOUSEHOLDS * 2),
    atCamp: 0,
    unattended: 0,
  };
}

/** Whether household `h` has a living member and nobody alive in it who works. */
export const isUnattended = (households: Households, h: number) => households.living[h]! > 0 && households.workers[h] === 0;

/** Adds villager `id` to household `h` as a member, counting it among the workers when it works. */
export function addMember(households: Households, villagers: Villagers, h: number, id: number): void {
  const was = isUnattended(households, h);
  villagers.household[id] = h;
  households.living[h] = households.living[h]! + 1;
  if (works(villagers, id)) households.workers[h] = households.workers[h]! + 1;
  if (households.home[h] === NO_HOME) households.atCamp += 1;
  households.unattended += Number(isUnattended(households, h)) - Number(was);
}

/**
 * Forms a household of the couple `man` and `woman`, either of which may be
 * `NO_VILLAGER`, with its house `home` or NO_HOME, at the dawn `dawn`, and
 * returns its number, or -1 when the table is full. This is the one place a
 * household forms.
 */
export function formHousehold(households: Households, villagers: Villagers, man: number, woman: number, home: number, dawn: number): number {
  const h = households.count;
  if (h >= MAX_HOUSEHOLDS) return -1;
  households.count = h + 1;
  households.man[h] = man;
  households.woman[h] = woman;
  households.lastBirth[h] = dawn;
  households.home[h] = home;
  if (home !== NO_HOME) households.householdIn[home] = h;
  if (man !== NO_VILLAGER) addMember(households, villagers, h, man);
  if (woman !== NO_VILLAGER) addMember(households, villagers, h, woman);
  return h;
}

/**
 * Gives the house in `slot` to the household with the lowest number that has
 * no home and a living member. A house with no such household stays empty.
 */
export function moveInto(households: Households, slot: number): void {
  const { home, living } = households;
  for (let h = 0; h < households.count; h++) {
    if (home[h] !== NO_HOME || living[h] === 0) continue;
    home[h] = slot;
    households.householdIn[slot] = h;
    households.atCamp -= living[h]!;
    return;
  }
}

/** Counts villager `id` of its household dead. When it was the last, its house, with the food in it, goes to the next household that needs one. */
export function loseMember(households: Households, villagers: Villagers, id: number): void {
  const { home, living } = households;
  const h = villagers.household[id]!;
  const was = isUnattended(households, h);
  living[h] = living[h]! - 1;
  if (works(villagers, id)) households.workers[h] = households.workers[h]! - 1;
  households.unattended += Number(isUnattended(households, h)) - Number(was);
  if (home[h] === NO_HOME) households.atCamp -= 1;
  if (living[h] !== 0 || home[h] === NO_HOME) return;
  const slot = home[h]!;
  home[h] = NO_HOME;
  households.householdIn[slot] = -1;
  moveInto(households, slot);
}
