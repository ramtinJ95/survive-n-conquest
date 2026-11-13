import { describe, expect, it } from 'vitest';
import { type Season, TICKS_PER_DAY, dateAt } from './calendar';
import { isNight, sunCourse } from './daylight';

const DAY = TICKS_PER_DAY;
/** The game opens at 08:00, so the first midnight is two thirds of a day in. */
const FIRST_MIDNIGHT = (DAY * 2) / 3;
/** The first tick of each whole day of the first year. Day 2 is the first, and day 13 opens the second spring. */
const DAYS: readonly (readonly [season: Season, day: number, start: number])[] = (
  ['Spring', 'Spring', 'Summer', 'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter', 'Winter', 'Winter', 'Spring'] as const
).map((season, index) => [season, index + 2, FIRST_MIDNIGHT + index * DAY] as const);
const NIGHT_SHARE: Readonly<Record<Season, number>> = { Spring: 0.4, Summer: 0.3, Autumn: 0.4, Winter: 0.55 };
const DAWN: Readonly<Record<Season, string>> = { Spring: '04:48', Summer: '03:36', Autumn: '04:48', Winter: '06:36' };
const DUSK: Readonly<Record<Season, string>> = { Spring: '19:12', Summer: '20:24', Autumn: '19:12', Winter: '17:24' };

const ticksOf = (start: number) => Array.from({ length: DAY }, (_, offset) => start + offset);

function timeAt(tick: number): string {
  const { minuteOfDay } = dateAt(tick);
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
}

describe('isNight', () => {
  it.each(DAYS)('is night for the %s share of day %i', (season, day, start) => {
    expect(dateAt(start)).toMatchObject({ season, day, minuteOfDay: 0 });
    const nightTicks = ticksOf(start).filter(isNight).length;
    expect(nightTicks / DAY).toBeCloseTo(NIGHT_SHARE[season], 10);
  });

  it.each(DAYS)('holds one unbroken day between the dawn and the dusk of %s, on day %i', (season, _day, start) => {
    const light = ticksOf(start).filter((tick) => !isNight(tick));
    expect(light.at(-1)! - light[0]!).toBe(light.length - 1);
    expect(timeAt(light[0]!)).toBe(DAWN[season]);
    expect(timeAt(light.at(-1)! + 1)).toBe(DUSK[season]);
  });

  it('is day when a new game opens', () => {
    expect(isNight(0)).toBe(false);
  });
});

describe('sunCourse', () => {
  it.each(DAYS)('is at dawn, noon, dusk, and midnight on time in %s, on day %i', (_season, _day, start) => {
    const light = ticksOf(start).filter((tick) => !isNight(tick));
    expect(sunCourse(light[0]!)).toBe(0);
    expect(sunCourse(start + DAY / 2)).toBe(0.5);
    expect(sunCourse(light.at(-1)! + 1)).toBe(1);
    expect(sunCourse(start)).toBe(1.5);
  });

  it('is in its night half exactly when it is night', () => {
    for (const tick of ticksOf(0).concat(...DAYS.map(([, , start]) => ticksOf(start)))) {
      expect(sunCourse(tick) >= 1, `tick ${tick}`).toBe(isNight(tick));
    }
  });

  it('moves forward all year and never jumps, across midnights and season changes', () => {
    const yearEnd = FIRST_MIDNIGHT + 12 * DAY;
    for (let tick = 1; tick <= yearEnd; tick++) {
      const moved = (sunCourse(tick) - sunCourse(tick - 1) + 2) % 2;
      expect(moved, `tick ${tick}`).toBeGreaterThan(0);
      expect(moved, `tick ${tick}`).toBeLessThan(0.002);
    }
  });
});
