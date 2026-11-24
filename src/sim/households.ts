/** At most this many households on a map, half the villagers table's rows, so the households cannot run out first. */
export const MAX_HOUSEHOLDS = 2048;
export const NO_HOME = -1;

/** The household table. Household `h` is villagers `2h` and `2h + 1`. */
export interface Households {
  readonly count: number;
  /** Site slot of each household's house, or NO_HOME. */
  readonly home: Int16Array;
  /** The members of each household still alive. */
  readonly living: Uint8Array;
  /** The living members of the households with no home, who eat at the camp. */
  atCamp: number;
}

/** Households of two members each, the last of one when `villagers` is odd. */
export function createHouseholds(villagers: number): Households {
  const count = Math.ceil(villagers / 2);
  if (count > MAX_HOUSEHOLDS) throw new Error(`${count} households is more than ${MAX_HOUSEHOLDS}`);
  const living = new Uint8Array(count).fill(2);
  if (villagers % 2 === 1) living[count - 1] = 1;
  return { count, home: new Int16Array(count).fill(NO_HOME), living, atCamp: villagers };
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
    households.atCamp -= living[h]!;
    return;
  }
}

/** Counts a member of household `h` dead. When it was the last, its house, with the food in it, goes to the next household that needs one. */
export function loseMember(households: Households, h: number): void {
  const { home, living } = households;
  living[h] = living[h]! - 1;
  if (home[h] === NO_HOME) households.atCamp -= 1;
  if (living[h] !== 0 || home[h] === NO_HOME) return;
  const slot = home[h]!;
  home[h] = NO_HOME;
  moveInto(households, slot);
}
