import { hashUnit } from './noise';

/** What a year draws from the seed. */
export const YearDraw = { Frost: 0 } as const;
export type YearDraw = (typeof YearDraw)[keyof typeof YearDraw];

const YEAR_SALT = 0x2c9e_71a5;

/** The draw of `what` for calendar year `year`, 0 for the first, in [0, 1). It is a stream of its own, keyed by the seed, the year, and what is drawn. */
export function yearDraw(seed: number, year: number, what: YearDraw): number {
  return hashUnit(seed ^ YEAR_SALT, year, what);
}
