import { describe, expect, it } from 'vitest';
import { frameOf } from '../frame';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { MINUTES_PER_DAY, OPENING_MINUTE, TICKS_PER_DAY, TICKS_PER_YEAR, dateAt, firstTickOf } from './calendar';
import { isNight } from './daylight';
import { FIRST_YEAR_LOG_TREES, FIRST_YEAR_SEED } from './firstYear';
import { FOOD_PER_TILE, NOT_SOWN } from './fields';
import { Good } from './goods';
import { generateMap } from './mapgen';
import { type TileArea } from './orders';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { at, mapFrom } from './testMaps';

const square = (x0: number, y0: number, x1 = x0, y1 = y0): TileArea => ({ x0, y0, x1, y1 });
const field = (sim: Sim, area: TileArea) => expect(applyCommand(sim, { kind: 'markArea', order: 'field', area })).toMatchObject({ ok: true });
/** Open grass, `size` tiles a side, on seed 3, whose first frost falls at the dusk of day 8. */
const grass = (size: number) => mapFrom(Array.from({ length: size }, () => '.'.repeat(size)));
/** The first tick of calendar year 2: a year from the midnight before the opening minute of day 1. */
const YEAR_TWO = TICKS_PER_YEAR - (OPENING_MINUTE * TICKS_PER_DAY) / MINUTES_PER_DAY;

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/** The first night tick of `day`, counted from 1 across the years. */
function duskOf(day: number): number {
  let tick = firstTickOf(day - 1) + TICKS_PER_DAY / 2;
  while (!isNight(tick)) tick++;
  return tick;
}

/** A building anchored on (x, y), finished at once, with `places` places filled. Returns its slot. */
function finished(sim: Sim, building: Building, x: number, y: number, places: number): number {
  expect(applyCommand(sim, { kind: 'place', building, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  applyCommand(sim, { kind: 'setPlaces', slot, places });
  return slot;
}

/** A house whose firewood lasts the three winter nights, so its settlers live into a second year. */
function warmHouse(sim: Sim): void {
  expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 8, y: 8 })).toMatchObject({ ok: true });
  const house = sim.orders.siteOf[at(sim.map, 8, 8)]!;
  finishBuilding(sim, house);
  sim.stores.held[Good.Firewood - 1]![house] = 6;
}

const yearOf = (sim: Sim, slot: number) => {
  const { broughtIn, lost, broughtInLastYear, lostLastYear } = sim.workplaceYears;
  return { broughtIn: broughtIn[slot], lost: lost[slot], broughtInLastYear: broughtInLastYear[slot], lostLastYear: lostLastYear[slot] };
};
const standingByFarms = (sim: Sim) => sim.fields.standingBy.reduce((sum, tiles) => sum + tiles, 0);

/** One farmer on a farm on (16, 16) with a field of 64 tiles east of it, more than it cuts before the frost, and a warm house. Returns its slot. */
function bigField(): { sim: Sim; slot: number } {
  const sim = createSim(grass(40), { villagers: 1, monsters: 0, animals: false, campFood: 30 });
  const slot = finished(sim, Building.Farm, 16, 16, 1);
  warmHouse(sim);
  field(sim, square(19, 12, 26, 19));
  return { sim, slot };
}

describe("a farm's year", () => {
  it('counts the food its farmer cut and the tiles of its crop the frost killed, its standing crops adding up to all that stand at every tick', () => {
    const { sim, slot } = bigField();
    runUntil(sim, () => sim.tick === YEAR_TWO - 1, YEAR_TWO, () => expect(standingByFarms(sim), `tick ${sim.tick}`).toBe(sim.fields.standing));
    expect([sim.tally.cut > 0, sim.tally.lost > 0, sim.tally.reaped]).toEqual([true, true, sim.tally.cut * FOOD_PER_TILE]);
    expect(yearOf(sim, slot)).toEqual({ broughtIn: sim.tally.reaped, lost: sim.tally.lost, broughtInLastYear: 0, lostLastYear: 0 });
  });

  it('keeps its standing crops adding up to all that stand when a sown tile and then a killed tile are cancelled', () => {
    const { sim, slot } = bigField();
    runUntil(sim, () => sim.tally.sown >= 8, 2 * TICKS_PER_DAY);
    const sown = sim.fields.sownAt.findIndex((tick) => tick !== NOT_SOWN);
    const { size } = sim.map;
    applyCommand(sim, { kind: 'markArea', order: 'cancel', area: square(sown % size, Math.floor(sown / size)) });
    expect([sim.fields.standing, standingByFarms(sim), sim.fields.standingBy[slot]]).toEqual([7, 7, 7]);
    runUntil(sim, () => sim.tick > sim.fields.frostAt, YEAR_TWO, () => expect(standingByFarms(sim), `tick ${sim.tick}`).toBe(sim.fields.standing));
    const lost = sim.workplaceYears.lost[slot];
    applyCommand(sim, { kind: 'markArea', order: 'cancel', area: square(19, 12, 26, 19) });
    expect([standingByFarms(sim), sim.fields.standing, sim.workplaceYears.lost[slot], lost]).toEqual([0, 0, sim.tally.lost, sim.tally.lost]);
  });

  it('turns into last year at the first tick of the next year, not a tick before, and keeps it through the next spring sowing', () => {
    const { sim, slot } = bigField();
    runUntil(sim, () => sim.tick === YEAR_TWO - 1, YEAR_TWO);
    const yearOne = { broughtIn: sim.tally.reaped, lost: sim.tally.lost };
    expect(yearOf(sim, slot)).toEqual({ ...yearOne, broughtInLastYear: 0, lostLastYear: 0 });
    step(sim);
    expect(dateAt(sim.tick).year).toBe(2);
    expect(yearOf(sim, slot)).toEqual({ broughtIn: 0, lost: 0, broughtInLastYear: yearOne.broughtIn, lostLastYear: yearOne.lost });
    const { frame } = frameOf(sim);
    expect([frame.workplaceBroughtIn[slot], frame.workplaceLost[slot], frame.workplaceBroughtInLastYear[slot], frame.workplaceLostLastYear[slot]]).toEqual([
      0,
      0,
      yearOne.broughtIn,
      yearOne.lost,
    ]);
    const sown = sim.tally.sown;
    runUntil(sim, () => sim.tally.sown >= sown + 4, TICKS_PER_DAY, () => expect(standingByFarms(sim)).toBe(sim.fields.standing));
    expect(yearOf(sim, slot)).toEqual({ broughtIn: 0, lost: 0, broughtInLastYear: yearOne.broughtIn, lostLastYear: yearOne.lost });
  });

  it('counts the food of a tile in the reach of two farms for the farm of the farmer who cut it, and its loss for the farm whose farmer sowed it', () => {
    const sim = createSim(grass(40), { villagers: 1, monsters: 0, animals: false, campFood: 30 });
    const sower = finished(sim, Building.Farm, 12, 16, 1);
    const cutter = finished(sim, Building.Farm, 26, 16, 0);
    field(sim, square(18, 15, 20, 16));
    runUntil(sim, () => sim.tally.sown === 6, TICKS_PER_DAY);
    applyCommand(sim, { kind: 'setPlaces', slot: sower, places: 0 });
    applyCommand(sim, { kind: 'setPlaces', slot: cutter, places: 1 });
    expect(sim.villagers.workplace[0]).toBe(cutter);
    sim.fields.frostAt = duskOf(6);
    runUntil(sim, () => sim.tick > sim.fields.frostAt, 6 * TICKS_PER_DAY, () => expect(standingByFarms(sim)).toBe(sim.fields.standing));
    expect([sim.tally.cut > 0, sim.tally.lost > 0, sim.tally.cut + sim.tally.lost]).toEqual([true, true, 6]);
    expect(yearOf(sim, cutter)).toMatchObject({ broughtIn: sim.tally.reaped, lost: 0 });
    expect(yearOf(sim, sower)).toMatchObject({ broughtIn: 0, lost: sim.tally.lost });
  });

  it('starts from 0 for a farm placed in the slot of a cancelled farm site', () => {
    const sim = createSim(grass(40), { villagers: 0, monsters: 0, animals: false });
    expect(applyCommand(sim, { kind: 'place', building: Building.Farm, x: 16, y: 16 })).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[at(sim.map, 16, 16)]!;
    const { broughtIn, lost, broughtInLastYear, lostLastYear } = sim.workplaceYears;
    for (const column of [broughtIn, lost, broughtInLastYear, lostLastYear, sim.fields.standingBy]) column[slot] = 7;
    applyCommand(sim, { kind: 'markArea', order: 'cancel', area: square(16, 16) });
    expect(applyCommand(sim, { kind: 'place', building: Building.Farm, x: 30, y: 30 })).toMatchObject({ ok: true });
    expect(sim.orders.siteOf[at(sim.map, 30, 30)]).toBe(slot);
    expect(yearOf(sim, slot)).toEqual({ broughtIn: 0, lost: 0, broughtInLastYear: 0, lostLastYear: 0 });
    expect(sim.fields.standingBy[slot]).toBe(0);
  });

  it('stays at 0 in every slot of a game with no farm', () => {
    const sim = createSim(generateMap(FIRST_YEAR_SEED), { ...SETTLERS, campFood: 400 });
    for (const [x, y] of FIRST_YEAR_LOG_TREES) applyCommand(sim, { kind: 'markArea', order: 'chop', area: square(x, y) });
    while (sim.tick < YEAR_TWO + TICKS_PER_DAY && !sim.over) step(sim);
    expect([sim.tick > duskOf(9), sim.tally.felled > 0]).toEqual([true, true]);
    const { frame } = frameOf(sim);
    for (const column of [frame.workplaceBroughtIn, frame.workplaceLost, frame.workplaceBroughtInLastYear, frame.workplaceLostLastYear]) {
      expect(column.every((count) => count === 0)).toBe(true);
    }
  });
});
