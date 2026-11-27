import { describe, expect, it } from 'vitest';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, seasonAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { frostTick } from './frost';
import { NOBODY, createSim, step } from './sim';
import { mapFrom } from './testMaps';

/** The day of its year, counted from 1, on which the frost of `year` falls. */
const frostDay = (seed: number, year: number) => {
  const { day } = dateAt(frostTick(seed, year));
  return day - year * DAYS_PER_YEAR;
};

describe("a year's frost", () => {
  it('falls at the first night tick of day 9, or of day 8, in autumn: tick 25,400 or 22,400 in the first year', () => {
    const late = Array.from({ length: 50 }, (_, seed) => seed).find((seed) => frostDay(seed, 0) === 9)!;
    const early = Array.from({ length: 50 }, (_, seed) => seed).find((seed) => frostDay(seed, 0) === 8)!;
    expect([frostTick(late, 0), frostTick(early, 0)]).toEqual([25_400, 22_400]);
    for (let year = 0; year < 40; year++) {
      const tick = frostTick(7, year);
      expect(isNight(tick) && !isNight(tick - 1), `year ${year + 1}`).toBe(true);
      expect(seasonAt(tick)).toBe('Autumn');
      expect([8, 9]).toContain(frostDay(7, year));
    }
  });

  it('falls on the same days on every run of a seed, and on other days for another seed', () => {
    const days = (seed: number) => Array.from({ length: 20 }, (_, year) => frostDay(seed, year));
    const map = mapFrom(['..', '..'], 7);
    expect(createSim(map, NOBODY).fields.frostAt).toBe(createSim(map, NOBODY).fields.frostAt);
    expect(days(7)).toEqual(days(7));
    expect(days(7)).not.toEqual(days(8));
  });

  it('comes a day early in about 1 year in 4 over 4,000 years', () => {
    for (const seed of [7, 1234]) {
      let early = 0;
      for (let year = 0; year < 4000; year++) if (frostDay(seed, year) === 8) early++;
      expect(Math.abs(early / 4000 - 1 / 4), `seed ${seed}: ${early} early`).toBeLessThan(0.02);
    }
  });

  it("is the year's own in the simulation until the first dawn of the next spring, then the new year's", () => {
    const sim = createSim(mapFrom(['..', '..'], 7), NOBODY);
    expect(sim.fields.frostAt).toBe(frostTick(7, 0));
    const turns: { day: number; dawn: boolean; frostAt: number }[] = [];
    while (sim.tick < 3 * DAYS_PER_YEAR * TICKS_PER_DAY) {
      const before = sim.fields.frostAt;
      const tick = sim.tick;
      step(sim);
      if (sim.fields.frostAt !== before) turns.push({ day: dateAt(tick).day, dawn: isDawn(tick), frostAt: sim.fields.frostAt });
    }
    expect(turns).toEqual([1, 2, 3].map((year) => ({ day: year * DAYS_PER_YEAR + 1, dawn: true, frostAt: frostTick(7, year) })));
  });
});
