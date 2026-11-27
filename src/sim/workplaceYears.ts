import { MAX_SITES } from './orders';

/** What each workplace's year brought, by site slot, for the calendar year the clock is in and the one before. */
export interface WorkplaceYears {
  /** Units of food each workplace's workers cut this calendar year, by site slot. */
  readonly broughtIn: Uint16Array;
  /** Field tiles whose crop, sown by each farm's farmers, the frost killed this calendar year, by site slot. */
  readonly lost: Uint16Array;
  /** `broughtIn` of the calendar year before. */
  readonly broughtInLastYear: Uint16Array;
  /** `lost` of the calendar year before. */
  readonly lostLastYear: Uint16Array;
}

export function createWorkplaceYears(): WorkplaceYears {
  return {
    broughtIn: new Uint16Array(MAX_SITES),
    lost: new Uint16Array(MAX_SITES),
    broughtInLastYear: new Uint16Array(MAX_SITES),
    lostLastYear: new Uint16Array(MAX_SITES),
  };
}

/** At the first tick of a calendar year: this year's counts become last year's, and this year's start from 0. */
export function turnWorkplaceYears(years: WorkplaceYears): void {
  years.broughtInLastYear.set(years.broughtIn);
  years.lostLastYear.set(years.lost);
  years.broughtIn.fill(0);
  years.lost.fill(0);
}

/** A site placed in `slot` starts its years from 0. */
export function resetWorkplaceYears(years: WorkplaceYears, slot: number): void {
  years.broughtIn[slot] = 0;
  years.lost[slot] = 0;
  years.broughtInLastYear[slot] = 0;
  years.lostLastYear[slot] = 0;
}
