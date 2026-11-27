import { DAYS_PER_YEAR, TICKS_PER_DAY, firstTickOf, seasonAt } from './calendar';
import { dawnDayAt, dawnTick } from './daylight';
import type { Sim } from './sim';
import { YearDraw, yearDraw } from './years';

/** A year's frost falls at the dusk of this day of the year, counted from 0: day 9, the last day of autumn. */
export const FROST_DAY = 8;
/** In this share of the years, drawn by the seed and the year, the frost falls a day early, at the dusk of day 8. */
export const EARLY_FROST_CHANCE = 1 / 4;

/** The tick of the frost of calendar year `year`, 0 for the first: the first night tick of its day. */
export function frostTick(seed: number, year: number): number {
  const early = yearDraw(seed, year, YearDraw.Frost) < EARLY_FROST_CHANCE;
  const start = firstTickOf(year * DAYS_PER_YEAR + FROST_DAY - (early ? 1 : 0));
  return start + TICKS_PER_DAY - dawnTick(seasonAt(start));
}

/** A step of `DAWN`: at the first dawn of spring the fields turn to the frost of the new year. */
export function turnToNewFrost(sim: Sim): void {
  const day = dawnDayAt(sim.tick);
  if (day % DAYS_PER_YEAR === 0) sim.fields.frostAt = frostTick(sim.seed, day / DAYS_PER_YEAR);
}

/** The frost of the year falls: every crop that stands is lost. */
export function frost(sim: Sim): void {
  const { fields, tally } = sim;
  fields.lostThisYear += fields.standing;
  tally.lost += fields.standing;
  fields.standing = 0;
  fields.ripening.fill(0);
}
