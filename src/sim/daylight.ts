import { type Season, TICKS_PER_DAY, seasonAt, tickOfDay } from './calendar';

/** The share of each day and night cycle that is night, in percent. */
export const NIGHT_PERCENT: Readonly<Record<Season, number>> = {
  Spring: 40,
  Summer: 30,
  Autumn: 40,
  Winter: 55,
};

/**
 * The tick of the day at which the night ends. Midnight is the middle of the
 * night, so dusk comes this many ticks before the next midnight.
 */
export function dawnTick(season: Season): number {
  return (TICKS_PER_DAY * NIGHT_PERCENT[season]) / 200;
}

export function isNight(tick: number): boolean {
  const dawn = dawnTick(seasonAt(tick));
  const time = tickOfDay(tick);
  return time < dawn || time >= TICKS_PER_DAY - dawn;
}

/** The season whose nights are cold. */
export const COLD_SEASON: Season = 'Winter';

/** Whether the night that holds `tick` is cold: one whose dusk fell in the cold season. After midnight that is the dusk of the day before. */
export function isColdNight(tick: number): boolean {
  const time = tickOfDay(tick);
  return seasonAt(time < TICKS_PER_DAY / 2 ? tick - time - 1 : tick) === COLD_SEASON;
}

/** Whether the tick is the first of a day. */
export function isDawn(tick: number): boolean {
  return !isNight(tick) && isNight(tick - 1);
}

/**
 * How far the sun is through its daily course. It is 0 at dawn, 0.5 at noon,
 * 1 at dusk, 1.5 at midnight, and reaches 2 at the next dawn. The night is
 * every value from 1 up.
 */
export function sunCourse(tick: number): number {
  const dawn = dawnTick(seasonAt(tick));
  const dusk = TICKS_PER_DAY - dawn;
  const time = tickOfDay(tick);
  if (time < dawn) return 1.5 + (0.5 * time) / dawn;
  if (time < dusk) return (time - dawn) / (dusk - dawn);
  return 1 + (0.5 * (time - dusk)) / dawn;
}
