export const MAX_HOUSEHOLDS = 1024;
export const NO_HOME = -1;

/** The household table. Household `h` is villagers `2h` and `2h + 1`. */
export interface Households {
  readonly count: number;
  /** Site slot of each household's house, or NO_HOME. */
  readonly home: Int16Array;
}

export function createHouseholds(count: number): Households {
  if (count > MAX_HOUSEHOLDS) throw new Error(`${count} households is more than ${MAX_HOUSEHOLDS}`);
  return { count, home: new Int16Array(count).fill(NO_HOME) };
}

/** Gives the finished house in `slot` to the household with the lowest number that has no home. A house with no such household stays empty. */
export function moveInto(households: Households, slot: number): void {
  const homeless = households.home.indexOf(NO_HOME);
  if (homeless >= 0) households.home[homeless] = slot;
}
