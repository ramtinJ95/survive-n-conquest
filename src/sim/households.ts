import { works } from './jobs';
import { MAX_SITES } from './orders';
import { VillagerState } from './villagerState';
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
 * couple while they live, and the children of its couples. A household that
 * joined another at a pairing keeps its number and its last couple, and has
 * no member.
 */
export interface Households {
  count: number;
  /** Site slot of each household's house, or NO_HOME. */
  readonly home: Int16Array;
  /** The household living in each site slot's house, or -1. */
  readonly householdIn: Int16Array;
  /** The site slots of the finished houses, in the order they were finished. The first `houseCount` hold one. */
  readonly houses: Int16Array;
  houseCount: number;
  /** The site slots of the finished houses no household lives in, the first `vacantCount` of them, in the order they were emptied. Stocking takes food and firewood out of them. */
  readonly vacant: Int16Array;
  vacantCount: number;
  /** The members of each household still alive. */
  readonly living: Uint8Array;
  /** The living members of each household who work, and so can carry for it. */
  readonly workers: Uint8Array;
  /**
   * The couple of each household: the man and the woman who formed it, or
   * `NO_VILLAGER`, until one whose partner died pairs again. Then the new
   * pair holds both places. A household's earlier couple lives on only in its
   * children's parents.
   */
  readonly man: Int32Array;
  readonly woman: Int32Array;
  /** The dawn of each household's last birth or the later dawn its couple paired, as a count of `Sim.dawns`. One that formed before the map's first tick has a negative one. */
  readonly lastBirth: Int32Array;
  /** Scratch for a dawn's births, not part of the state: 1 for each household one of whose living members is wanting. */
  readonly wanting: Uint8Array;
  /** Scratch for a dawn's births: at `2h + sex`, bit `i` set when a living member of household `h` bears name `i` of that sex. */
  readonly names: Uint32Array;
  /**
   * The people living in each site slot's house who are not of its household:
   * grown children of it who paired while no house stood empty, and live on
   * in it until their own household has a house.
   */
  readonly lodgers: Uint8Array;
  /** The living members of the households with no home who do not lodge in a house, and so sleep and eat at the camp. */
  atCamp: number;
  /** The households with a living member and no living worker, whose homes the settlers without a job stock. */
  unattended: number;
}

export function createHouseholds(): Households {
  return {
    count: 0,
    home: new Int16Array(MAX_HOUSEHOLDS).fill(NO_HOME),
    householdIn: new Int16Array(MAX_SITES).fill(-1),
    houses: new Int16Array(MAX_SITES),
    houseCount: 0,
    vacant: new Int16Array(MAX_SITES),
    vacantCount: 0,
    living: new Uint8Array(MAX_HOUSEHOLDS),
    workers: new Uint8Array(MAX_HOUSEHOLDS),
    man: new Int32Array(MAX_HOUSEHOLDS).fill(NO_VILLAGER),
    woman: new Int32Array(MAX_HOUSEHOLDS).fill(NO_VILLAGER),
    lastBirth: new Int32Array(MAX_HOUSEHOLDS),
    wanting: new Uint8Array(MAX_HOUSEHOLDS),
    names: new Uint32Array(MAX_HOUSEHOLDS * 2),
    lodgers: new Uint8Array(MAX_SITES),
    atCamp: 0,
    unattended: 0,
  };
}

/**
 * Whether household `h` has a living member and nobody who can carry for its
 * house: no living member who works, and nobody lodging in it, who all work.
 */
export const isUnattended = (households: Households, h: number) =>
  households.living[h]! > 0 && households.workers[h] === 0 && (households.home[h] === NO_HOME || households.lodgers[households.home[h]!] === 0);

/** The site slot of the house villager `id` lives in: its household's, or the one it lodges in while its household has none. NO_HOME at the camp. */
export function houseOf(households: Households, villagers: Villagers, id: number): number {
  const home = households.home[villagers.household[id]!]!;
  return home === NO_HOME ? villagers.lodging[id]! : home;
}

/** The people who live in the house in `slot`, which has a household: the living of that household and those who lodge there. */
export const peopleIn = (households: Households, slot: number) => households.living[households.householdIn[slot]!]! + households.lodgers[slot]!;

/** Villager `id` lodges in the house in `slot` from now on, or does nothing for NO_HOME. */
function lodge(households: Households, villagers: Villagers, id: number, slot: number): void {
  if (slot === NO_HOME) return;
  const h = households.householdIn[slot]!;
  const was = isUnattended(households, h);
  villagers.lodging[id] = slot;
  households.lodgers[slot] = households.lodgers[slot]! + 1;
  households.unattended += Number(isUnattended(households, h)) - Number(was);
}

/** Villager `id` lodges no longer, as one that died or whose household got a house. */
function unlodge(households: Households, villagers: Villagers, id: number): void {
  const slot = villagers.lodging[id]!;
  const h = households.householdIn[slot]!;
  const was = isUnattended(households, h);
  villagers.lodging[id] = NO_HOME;
  households.lodgers[slot] = households.lodgers[slot]! - 1;
  households.unattended += Number(isUnattended(households, h)) - Number(was);
}

/** Adds villager `id` to household `h` as a member, counting it among the workers when it works. */
export function addMember(households: Households, villagers: Villagers, h: number, id: number): void {
  const was = isUnattended(households, h);
  villagers.household[id] = h;
  households.living[h] = households.living[h]! + 1;
  if (works(villagers, id)) households.workers[h] = households.workers[h]! + 1;
  if (households.home[h] === NO_HOME && villagers.lodging[id] === NO_HOME) households.atCamp += 1;
  households.unattended += Number(isUnattended(households, h)) - Number(was);
}

/** Villager `id`, a child of its household, starts to work, and its household counts it among its workers. */
export function startWorking(households: Households, villagers: Villagers, id: number): void {
  const h = villagers.household[id]!;
  const was = isUnattended(households, h);
  villagers.child[id] = 0;
  households.workers[h] = households.workers[h]! + 1;
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
  if (man !== NO_VILLAGER) addMember(households, villagers, h, man);
  if (woman !== NO_VILLAGER) addMember(households, villagers, h, woman);
  if (home !== NO_HOME) moveIn(households, villagers, h, home);
  return h;
}

/**
 * Whether `id`, one of the couple of household `h` or `NO_VILLAGER`, still
 * belongs to it and lodges in the house in `slot`, or in any house for
 * NO_HOME. A man of a starting household of one stays its man after he pairs
 * and leaves it, so the couple alone does not say who belongs.
 */
const lodgerOf = (villagers: Villagers, h: number, id: number, slot = NO_HOME) =>
  id !== NO_VILLAGER && villagers.household[id] === h && villagers.lodging[id] !== NO_HOME && (slot === NO_HOME || villagers.lodging[id] === slot);

/** Villager `id` of household `h`'s couple lodges no longer if it did. Returns whether it did. */
function leaveLodging(households: Households, villagers: Villagers, h: number, id: number): boolean {
  if (!lodgerOf(villagers, h, id)) return false;
  unlodge(households, villagers, id);
  return true;
}

/**
 * Gives household `h`, which has none, the empty house in `slot`, with what it
 * holds, and takes the house off the list of vacant houses. Its members who
 * lodged in a house, and those at the camp, live in it from now on. This is
 * the one place a household gets a house.
 */
function moveIn(households: Households, villagers: Villagers, h: number, slot: number): void {
  const was = isUnattended(households, h);
  const lodged = Number(leaveLodging(households, villagers, h, households.man[h]!)) + Number(leaveLodging(households, villagers, h, households.woman[h]!));
  households.home[h] = slot;
  households.householdIn[slot] = h;
  const { vacant } = households;
  let at = 0;
  while (vacant[at] !== slot) at++;
  vacant.copyWithin(at, at + 1, households.vacantCount);
  households.vacantCount -= 1;
  households.atCamp -= households.living[h]! - lodged;
  households.unattended += Number(isUnattended(households, h)) - Number(was);
}

/** Whether household `h` has no home, and one of its couple who still belongs to it lodges in the house in `slot`. */
function lodgesIn(households: Households, villagers: Villagers, h: number, slot: number): boolean {
  return households.home[h] === NO_HOME && (lodgerOf(villagers, h, households.man[h]!, slot) || lodgerOf(villagers, h, households.woman[h]!, slot));
}

/**
 * Gives the house in `slot`, which has no household, to the household with
 * the lowest number that has no home and one of whose couple lodges in it, so
 * a house is never freed under a settler who lives in it. With nobody lodging
 * there it goes to the household with the lowest number that has no home and
 * a living member. A house with no such household stays empty.
 */
export function moveInto(households: Households, villagers: Villagers, slot: number): void {
  const { home, living } = households;
  const lodged = households.lodgers[slot]! > 0;
  for (let h = 0; h < households.count; h++) {
    if (lodged ? !lodgesIn(households, villagers, h, slot) : home[h] !== NO_HOME || living[h] === 0) continue;
    moveIn(households, villagers, h, slot);
    return;
  }
}

/** Records the house in `slot` as finished and empty, after every house finished before it, and gives it to a household that needs one. */
export function openHouse(households: Households, villagers: Villagers, slot: number): void {
  households.houses[households.houseCount] = slot;
  households.houseCount += 1;
  households.vacant[households.vacantCount++] = slot;
  moveInto(households, villagers, slot);
}

/** The site slot of the empty house that was finished first, or NO_HOME when every house has its household. */
export function emptyHouse(households: Households): number {
  for (let at = 0; at < households.houseCount; at++) {
    const slot = households.houses[at]!;
    if (households.householdIn[slot] === -1) return slot;
  }
  return NO_HOME;
}

/**
 * Takes villager `id` out of the count of household `h`, its own, as one that
 * died, or of the household it leaves to form one. One that lodged in a house
 * lodges there no longer. When it was the last, the house of `h`, with the
 * food and the firewood in it, joins the vacant houses and goes at once to the
 * household of one who lodges in it, or else stays empty until the next
 * household that needs one takes it.
 */
export function loseMember(households: Households, villagers: Villagers, id: number, h = villagers.household[id]!): void {
  const { home, living } = households;
  const was = isUnattended(households, h);
  living[h] = living[h]! - 1;
  if (works(villagers, id)) households.workers[h] = households.workers[h]! - 1;
  if (home[h] === NO_HOME) {
    if (villagers.lodging[id] === NO_HOME) households.atCamp -= 1;
    else unlodge(households, villagers, id);
  }
  households.unattended += Number(isUnattended(households, h)) - Number(was);
  if (living[h] !== 0 || home[h] === NO_HOME) return;
  const slot = home[h]!;
  vacate(households, h);
  moveInto(households, villagers, slot);
}

/** Household `h` leaves its house, which joins the vacant houses with what it holds. */
function vacate(households: Households, h: number): void {
  const slot = households.home[h]!;
  households.home[h] = NO_HOME;
  households.householdIn[slot] = -1;
  households.vacant[households.vacantCount++] = slot;
}

/**
 * The partner of villager `id`: the other place of its own household's couple
 * when it holds one, or `NO_VILLAGER`. The partner can have died.
 */
export function partnerOf(households: Households, villagers: Villagers, id: number): number {
  const h = villagers.household[id]!;
  if (households.man[h] === id) return households.woman[h]!;
  if (households.woman[h] === id) return households.man[h]!;
  return NO_VILLAGER;
}

/**
 * Living villager `id` leaves its household and joins household `h`, and
 * lives where `h` lives: in its house, or, while `h` has none, where it lived
 * before. One of the couple of `h` from a house lodges in it, and a lodger
 * lodges on. Anyone else of a household with no house is at the camp. A house
 * it was the last member of goes at once to a household lodging in it.
 */
function join(households: Households, villagers: Villagers, h: number, id: number): void {
  const from = villagers.household[id]!;
  const lodged = villagers.lodging[id]!;
  const houseless = households.home[h] === NO_HOME;
  const couple = households.man[h] === id || households.woman[h] === id;
  if (houseless && couple && households.home[from] !== NO_HOME) lodge(households, villagers, id, households.home[from]!);
  addMember(households, villagers, h, id);
  loseMember(households, villagers, id, from);
  if (houseless && households.home[h] === NO_HOME && lodged !== NO_HOME) lodge(households, villagers, id, lodged);
}

/**
 * Single settlers `man` and `woman` pair at the dawn `dawn`, and the number of
 * the household whose couple they are is returned, or -1 when they need a new
 * household and the table is full. This is the one place a pairing changes
 * households, in one of three ways.
 *
 * - Two who never had a partner leave their households and form one of their
 *   own. Each goes on living where it lived: one from a house lodges in it,
 *   and one from the camp stays there. A house that one of them was the last
 *   member of goes to the new household at once.
 * - One whose partner died, and so still holds a place in its household's
 *   couple, keeps its household, its number, its house and its children,
 *   and the other joins it.
 * - Two whose partners died make one household of their two. The household
 *   with the lower number stays, and everyone of the other joins it, the
 *   widowed one first. It keeps its house, or, with none, takes the house of
 *   the other at once, with anyone lodging in it. A house the two leave empty
 *   is freed by `loseMember`.
 *
 * The household's couple is the two from then on, and it waits for a birth
 * from this dawn, as a new household does. Without a house it takes the empty
 * house finished first, or none while none stands.
 */
export function pair(households: Households, villagers: Villagers, man: number, woman: number, dawn: number): number {
  const hisWidowed = partnerOf(households, villagers, man) !== NO_VILLAGER;
  const herWidowed = partnerOf(households, villagers, woman) !== NO_VILLAGER;
  const his = villagers.household[man]!;
  const hers = villagers.household[woman]!;
  let h: number;
  if (hisWidowed || herWidowed) {
    h = hisWidowed && (!herWidowed || his < hers) ? his : hers;
    const other = h === his ? hers : his;
    const joining = h === his ? woman : man;
    households.man[h] = man;
    households.woman[h] = woman;
    households.lastBirth[h] = dawn;
    const merge = hisWidowed && herWidowed;
    if (merge && households.home[h] === NO_HOME && households.home[other] !== NO_HOME) {
      const was = isUnattended(households, other);
      const slot = households.home[other]!;
      vacate(households, other);
      households.atCamp += households.living[other]!;
      households.unattended += Number(isUnattended(households, other)) - Number(was);
      moveIn(households, villagers, h, slot);
    }
    join(households, villagers, h, joining);
    if (merge) {
      for (let id = 0; id < villagers.count && households.living[other]! > 0; id++) {
        if (villagers.household[id] === other && villagers.state[id] !== VillagerState.Dead) join(households, villagers, h, id);
      }
    }
  } else {
    if (households.count >= MAX_HOUSEHOLDS) return -1;
    lodge(households, villagers, man, households.home[his]!);
    lodge(households, villagers, woman, households.home[hers]!);
    h = formHousehold(households, villagers, man, woman, NO_HOME, dawn);
    loseMember(households, villagers, man, his);
    loseMember(households, villagers, woman, hers);
  }
  const empty = emptyHouse(households);
  if (households.home[h] === NO_HOME && empty !== NO_HOME) moveIn(households, villagers, h, empty);
  return h;
}
