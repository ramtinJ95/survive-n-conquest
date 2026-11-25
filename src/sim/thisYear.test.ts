import { describe, expect, it } from 'vitest';
import { frameOf } from '../frame';
import { BIRTH_CHANCE, BIRTH_GAP, birthDraw } from './births';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { MINUTES_PER_DAY, OPENING_MINUTE, TICKS_PER_DAY, TICKS_PER_YEAR, dateAt, startsYear } from './calendar';
import { Good } from './goods';
import { Sex } from './names';
import { type Sim, type StartingSettler, applyCommand, createSim, step } from './sim';
import { at, mapFrom } from './testMaps';
import { Cause } from './villagerState';

const FOOD = Good.Food - 1;
const FIREWOOD = Good.Firewood - 1;
const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));
const man = (age: number, span?: number): StartingSettler => (span === undefined ? { sex: Sex.Man, age } : { sex: Sex.Man, age, span });
const woman = (age: number): StartingSettler => ({ sex: Sex.Woman, age });

/** The first seed whose draw for household 0 falls under the chance at dawn 1. */
const SEED = (() => {
  let seed = 1;
  while (birthDraw(seed, 0, 1) >= BIRTH_CHANCE) seed++;
  return seed;
})();

/** The first tick of calendar year 2: a year from the midnight before the opening minute of day 1. */
const YEAR_TWO = TICKS_PER_YEAR - (OPENING_MINUTE * TICKS_PER_DAY) / MINUTES_PER_DAY;

/**
 * Three households on an open map of `SEED` with food at the camp and no
 * animals. Household 0, a young couple, and household 1, whose man reaches his
 * span of 61 in year 2, each live in a house with 16 food and the firewood of
 * the three winter nights. Household 2 lives at the camp: its man of 60 dies of
 * old age at the first dawn, and its woman freezes in the first winter.
 */
function settlement(): Sim {
  const households = [[man(30), woman(28)], [man(55, 61), woman(20)], [man(60, 60), woman(55)]];
  const sim = createSim(mapFrom(open(32), SEED), {
    villagers: households.flat().length,
    monsters: 0,
    campFood: 400,
    animals: false,
    settlers: households.map((members) => ({ members, dawnsSeen: BIRTH_GAP })),
  });
  for (const [x, y] of [[6, 6], [24, 24]] as const) {
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x, y })).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
    finishBuilding(sim, slot);
    sim.stores.held[FOOD]![slot] = 16;
    sim.stores.held[FIREWOOD]![slot] = 6;
  }
  return sim;
}

const thisYear = (sim: Sim) => ({ ...sim.thisYear });

describe("the year's births and deaths", () => {
  it('count every birth and every death of the first year, of old age and of cold, as the tallies since the start do', () => {
    const sim = settlement();
    expect(thisYear(sim)).toEqual({ born: 0, died: 0 });
    while (sim.tick < YEAR_TWO - 1) {
      step(sim);
      expect(thisYear(sim), `tick ${sim.tick}`).toEqual({ born: sim.tally.births, died: sim.tally.died });
    }
    expect(dateAt(sim.tick).year).toBe(1);
    expect(sim.tally).toMatchObject({ oldAge: 1, froze: 1, starved: 0, died: 2 });
    expect(sim.tally.births).toBeGreaterThanOrEqual(1);
  });

  it('start again from 0 at the first tick of year 2, which reads them in the frame, and count what happens after it', () => {
    const sim = settlement();
    while (sim.tick < YEAR_TWO - 1) step(sim);
    const yearOne = { born: sim.tally.births, died: sim.tally.died };
    expect(thisYear(sim)).toEqual(yearOne);
    expect(startsYear(sim.tick)).toBe(false);
    step(sim);
    expect([startsYear(sim.tick), dateAt(sim.tick - 1).year, dateAt(sim.tick).year]).toEqual([true, 1, 2]);
    expect(thisYear(sim)).toEqual({ born: 0, died: 0 });
    const { frame } = frameOf(sim);
    expect([frame.bornThisYear, frame.diedThisYear]).toEqual([0, 0]);

    while (sim.villagers.cause[2] === Cause.None) {
      step(sim);
      expect(thisYear(sim), `tick ${sim.tick}`).toEqual({ born: sim.tally.births - yearOne.born, died: sim.tally.died - yearOne.died });
    }
    expect([sim.villagers.cause[2], dateAt(sim.tick).year]).toEqual([Cause.OldAge, 2]);
    expect(sim.thisYear.died).toBe(1);
  });

  it('count the deaths of hunger, and stay as they were once the settlement has died out', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 0, animals: false });
    while (!sim.over) step(sim);
    expect(sim.tally).toMatchObject({ starved: 2, died: 2 });
    expect(thisYear(sim)).toEqual({ born: 0, died: 2 });
    for (let tick = 0; tick < 100; tick++) step(sim);
    const { frame } = frameOf(sim);
    expect([frame.bornThisYear, frame.diedThisYear]).toEqual([0, 2]);
  });
});
