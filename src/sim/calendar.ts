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

const OPENING_TICK_OF_DAY = (OPENING_MINUTE * TICKS_PER_DAY) / MINUTES_PER_DAY;
const TICKS_PER_YEAR = SEASONS.length * TICKS_PER_SEASON;

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

/** Ticks since the season began, at the midnight that opens its first day. */
export function tickOfSeason(tick: number): number {
  return (tick + OPENING_TICK_OF_DAY) % TICKS_PER_SEASON;
}

/** The place of the season in `SEASONS`. */
export function seasonIndexAt(tick: number): number {
  return Math.floor(((tick + OPENING_TICK_OF_DAY) % TICKS_PER_YEAR) / TICKS_PER_SEASON);
}

export function seasonAt(tick: number): Season {
  return SEASONS[seasonIndexAt(tick)]!;
}

export function dateAt(tick: number): CalendarDate {
  const dayIndex = Math.floor((tick + OPENING_TICK_OF_DAY) / TICKS_PER_DAY);
  return {
    day: dayIndex + 1,
    year: Math.floor(dayIndex / DAYS_PER_YEAR) + 1,
    season: seasonAt(tick),
    part: SEASON_PARTS[dayIndex % DAYS_PER_SEASON]!,
    minuteOfDay: Math.floor((tickOfDay(tick) * MINUTES_PER_DAY) / TICKS_PER_DAY),
  };
}
