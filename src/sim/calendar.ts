export const TICKS_PER_SECOND = 10;
export const TICKS_PER_DAY = 3000;
export const DAYS_PER_SEASON = 3;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const SEASON_PARTS = ['Early', 'Mid', 'Late'] as const;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
export const MINUTES_PER_DAY = 24 * 60;

export type Season = (typeof SEASONS)[number];
export type SeasonPart = (typeof SEASON_PARTS)[number];

export interface CalendarDate {
  readonly day: number;
  readonly year: number;
  readonly season: Season;
  readonly part: SeasonPart;
  readonly minuteOfDay: number;
}

export function dateAt(tick: number): CalendarDate {
  const dayIndex = Math.floor(tick / TICKS_PER_DAY);
  const dayOfYear = dayIndex % DAYS_PER_YEAR;
  return {
    day: dayIndex + 1,
    year: Math.floor(dayIndex / DAYS_PER_YEAR) + 1,
    season: SEASONS[Math.floor(dayOfYear / DAYS_PER_SEASON)]!,
    part: SEASON_PARTS[dayOfYear % DAYS_PER_SEASON]!,
    minuteOfDay: Math.floor(((tick % TICKS_PER_DAY) * MINUTES_PER_DAY) / TICKS_PER_DAY),
  };
}
