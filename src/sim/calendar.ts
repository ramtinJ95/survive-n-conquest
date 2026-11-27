export const TICKS_PER_SECOND = 10;
export const TICKS_PER_DAY = 3000;
export const DAYS_PER_SEASON = 3;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const SEASON_PARTS = ['Early', 'Mid', 'Late'] as const;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
export const MINUTES_PER_DAY = 24 * 60;
export const TICKS_PER_SEASON = DAYS_PER_SEASON * TICKS_PER_DAY;
/** A new game opens at this minute of day 1, so that it opens in daylight. Tick 0 is that moment. */
export const OPENING_MINUTE = 8 * 60;

export const TICKS_PER_YEAR = SEASONS.length * TICKS_PER_SEASON;
/** A villager ages this many years in a game year. */
export const YEARS_OF_AGE_PER_YEAR = 5;
/** A villager is a year older every this many ticks, which is 2.4 days. */
export const TICKS_PER_YEAR_OF_AGE = TICKS_PER_YEAR / YEARS_OF_AGE_PER_YEAR;

const OPENING_TICK_OF_DAY = (OPENING_MINUTE * TICKS_PER_DAY) / MINUTES_PER_DAY;

export type Season = (typeof SEASONS)[number];
export type SeasonPart = (typeof SEASON_PARTS)[number];

export interface CalendarDate {
  readonly day: number;
  readonly year: number;
  readonly season: Season;
  readonly part: SeasonPart;
  readonly minuteOfDay: number;
}

/** Ticks since the last midnight. */
export function tickOfDay(tick: number): number {
  return (tick + OPENING_TICK_OF_DAY) % TICKS_PER_DAY;
}

/** The index of the day that holds `tick`, 0 for day 1. */
export function dayIndexAt(tick: number): number {
  return Math.floor((tick + OPENING_TICK_OF_DAY) / TICKS_PER_DAY);
}

/** The first tick of the day with index `dayIndex`, 0 for day 1: its midnight. Tick 0 opens in the middle of day 1, so day 1's is below 0. */
export function firstTickOf(dayIndex: number): number {
  return dayIndex * TICKS_PER_DAY - OPENING_TICK_OF_DAY;
}

/** Ticks since the season began, at the midnight that opens its first day. */
export function tickOfSeason(tick: number): number {
  return (tick + OPENING_TICK_OF_DAY) % TICKS_PER_SEASON;
}

/** The place of the season in `SEASONS`. */
export function seasonIndexAt(tick: number): number {
  return Math.floor(((tick + OPENING_TICK_OF_DAY) % TICKS_PER_YEAR) / TICKS_PER_SEASON);
}

/** Whether `tick` is the first tick of a calendar year, the midnight that opens its first day. */
export function startsYear(tick: number): boolean {
  return (tick + OPENING_TICK_OF_DAY) % TICKS_PER_YEAR === 0;
}

export function seasonAt(tick: number): Season {
  return SEASONS[seasonIndexAt(tick)]!;
}

export function dateAt(tick: number): CalendarDate {
  const dayIndex = dayIndexAt(tick);
  return {
    day: dayIndex + 1,
    year: Math.floor(dayIndex / DAYS_PER_YEAR) + 1,
    season: seasonAt(tick),
    part: SEASON_PARTS[dayIndex % DAYS_PER_SEASON]!,
    minuteOfDay: Math.floor((tickOfDay(tick) * MINUTES_PER_DAY) / TICKS_PER_DAY),
  };
}
