import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, firstTickOf, seasonAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { CUT_WORK_TICKS, FieldState, NOT_CUT, SOWING, SOW_WORK_TICKS, fieldState } from './fields';
import { frostTick } from './frost';
import { FIRST_YEAR_LOG_TREES, FIRST_YEAR_SEED } from './firstYear';
import { Good, putDown } from './goods';
import { CUTTING } from './harvest';
import { generateMap } from './mapgen';
import { type TileArea } from './orders';
import { NOBODY, SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_FOOD_LIMIT, CAMP_STORE } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { VillagerState } from './villagerState';

const SOW = TASK_KINDS.indexOf(SOWING) + 1;
const CUT = TASK_KINDS.indexOf(CUTTING) + 1;
const square = (x0: number, y0: number, x1 = x0, y1 = y0): TileArea => ({ x0, y0, x1, y1 });
const field = (sim: Sim, area: TileArea) => applyCommand(sim, { kind: 'markArea', order: 'field', area });
/** Open grass, `size` tiles a side, on seed 3, whose first frost falls at the dusk of day 8. */
const grass = (size: number) => mapFrom(Array.from({ length: size }, () => '.'.repeat(size)));

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

/** The first tick of the dawn of `day`, counted from 1 across the years. */
function dawnOf(day: number): number {
  let tick = firstTickOf(day - 1);
  while (!isDawn(tick)) tick++;
  return tick;
}

/** A farm on (16, 16), finished at once, with one place. Returns its slot. */
function farm(sim: Sim): number {
  expect(applyCommand(sim, { kind: 'place', building: Building.Farm, x: 16, y: 16 })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, 16, 16)]!;
  finishBuilding(sim, slot);
  applyCommand(sim, { kind: 'setPlaces', slot, places: 1 });
  return slot;
}

/** A farm as `farm` builds it, and a house whose firewood lasts the three winter nights, so the farmer lives into a second year. Returns the farm's slot. */
function farmAndHouse(sim: Sim): number {
  const slot = farm(sim);
  expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 8, y: 8 })).toMatchObject({ ok: true });
  const house = sim.orders.siteOf[at(sim.map, 8, 8)]!;
  finishBuilding(sim, house);
  sim.stores.held[Good.Firewood - 1]![house] = 6;
  return slot;
}

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

describe('the frost', () => {
  it('kills at its dusk the crop of every sown and every ripe tile that is not cut, and of the tile under a cut, and puts no food down for it', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0, animals: false, campFood: 10 });
    farm(sim);
    field(sim, square(18, 10, 21, 13));
    const tiles = Array.from({ length: 16 }, (_, at) => (10 + (at >> 2)) * 30 + 18 + (at & 3));
    sim.fields.frostAt = duskOf(6);
    runUntil(sim, () => sim.tick === sim.fields.frostAt, 6 * TICKS_PER_DAY);
    const underCut = sim.villagers.taskTile[0]!;
    expect([sim.villagers.task[0], sim.villagers.state[0]]).toEqual([CUT, VillagerState.Working]);
    expect(sim.fields.cutProgress[underCut]).toBeGreaterThan(0);
    expect(sim.fields.cutProgress[underCut]).toBeLessThan(CUT_WORK_TICKS);
    const before = tiles.map((tile) => fieldState(sim.fields, tile, sim.tick - 1));
    const count = (state: FieldState) => before.filter((each) => each === state).length;
    const standing = count(FieldState.Sown) + count(FieldState.Ripe);
    expect([count(FieldState.Sown) > 0, count(FieldState.Ripe) > 1, count(FieldState.Cut) > 0, standing + count(FieldState.Cut)]).toEqual([true, true, true, 16]);
    const { cut, reaped, ripened } = sim.tally;
    step(sim);
    expect([sim.tally.lost, sim.fields.lostThisYear]).toEqual([standing, standing]);
    expect(tiles.map((tile) => fieldState(sim.fields, tile, sim.tick))).toEqual(before.map((state) => (state === FieldState.Cut ? FieldState.Cut : FieldState.Killed)));
    expect(sim.villagers.task[0]).not.toBe(CUT);
    runUntil(sim, () => sim.tick === dawnOf(9) + 1, 3 * TICKS_PER_DAY, () => expect(sim.villagers.task[0]).not.toBe(CUT));
    expect([sim.tally.cut, sim.tally.reaped, sim.tally.ripened, sim.tally.lost]).toEqual([cut, reaped, ripened, standing]);
    expect([sim.fields.cutAt[underCut], sim.map.stackGood[underCut]]).toEqual([NOT_CUT, Good.None]);
    expect(tiles.filter((tile) => fieldState(sim.fields, tile, sim.tick) === FieldState.Killed)).toHaveLength(standing);
  });

  it('counts no crop lost for a tile cancelled on the frost\'s tick before its step, and reads the crop killed only after that step', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0, animals: false, campFood: 10 });
    const slot = farm(sim);
    field(sim, square(19, 16));
    const tile = at(sim.map, 19, 16);
    runUntil(sim, () => sim.tally.sown === 1, TICKS_PER_DAY);
    applyCommand(sim, { kind: 'setPlaces', slot, places: 0 });
    sim.fields.frostAt = duskOf(1);
    runUntil(sim, () => sim.tick === sim.fields.frostAt, TICKS_PER_DAY);
    expect([fieldState(sim.fields, tile, sim.tick), fieldState(sim.fields, tile, sim.tick + 1), sim.fields.standing]).toEqual([FieldState.Sown, FieldState.Killed, 1]);
    applyCommand(sim, { kind: 'markArea', order: 'cancel', area: square(19, 16) });
    expect(sim.fields.standing).toBe(0);
    step(sim);
    expect([sim.tally.lost, sim.fields.lostThisYear]).toEqual([0, 0]);
  });

  it('leaves the ground frozen until the first dawn of spring, when a killed tile is bare and is sown again, its cut work gone with its crop', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0, animals: false, campFood: 30 });
    const farm = farmAndHouse(sim);
    field(sim, square(19, 16));
    const tile = at(sim.map, 19, 16);
    runUntil(sim, () => sim.fields.cutProgress[tile]! >= 60, 6 * TICKS_PER_DAY);
    applyCommand(sim, { kind: 'setPlaces', slot: farm, places: 0 });
    expect(fieldState(sim.fields, tile, sim.tick)).toBe(FieldState.Ripe);
    runUntil(sim, () => sim.tick > sim.fields.frostAt, 3 * TICKS_PER_DAY);
    expect(dateAt(sim.tick - 1)).toMatchObject({ day: 8, season: 'Autumn' });
    applyCommand(sim, { kind: 'setPlaces', slot: farm, places: 1 });
    const spring = dawnOf(DAYS_PER_YEAR + 1);
    expect([fieldState(sim.fields, tile, sim.tick), fieldState(sim.fields, tile, spring - 1)]).toEqual([FieldState.Killed, FieldState.Killed]);
    const tasks = new Set<number>();
    runUntil(sim, () => sim.tick === spring, 5 * TICKS_PER_DAY, () => tasks.add(sim.villagers.task[0]!));
    expect([tasks.has(SOW), tasks.has(CUT), sim.tally.sown, sim.tally.cut, sim.tally.lost]).toEqual([false, false, 1, 0, 1]);
    expect(fieldState(sim.fields, tile, spring)).toBe(FieldState.Bare);
    let worked = 0;
    runUntil(sim, () => sim.tally.sown === 2, TICKS_PER_DAY, () => {
      if (sim.villagers.task[0] === SOW && sim.villagers.state[0] === VillagerState.Working) worked++;
    });
    expect(worked + 1).toBe(SOW_WORK_TICKS);
    expect(dateAt(sim.fields.sownAt[tile]!)).toMatchObject({ year: 2, season: 'Spring' });
    expect(fieldState(sim.fields, tile, sim.tick)).toBe(FieldState.Sown);
    expect([sim.fields.lostThisYear, sim.tally.froze, sim.tally.missed]).toEqual([0, 0, 0]);
  });

  it('does not hurt food that lies cut on a field, which spoils at its own second dawn', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0, animals: false, campFood: CAMP_FOOD_LIMIT });
    farm(sim);
    field(sim, square(19, 16));
    const tile = at(sim.map, 19, 16);
    const full = () => {
      sim.stores.held[Good.Food - 1]![CAMP_STORE] = CAMP_FOOD_LIMIT;
    };
    runUntil(sim, () => sim.tick === sim.fields.frostAt - 1, 9 * TICKS_PER_DAY, full);
    expect(putDown(sim, tile, Good.Food, 4)).toBe(true);
    runUntil(sim, () => sim.tick === dawnOf(10), 2 * TICKS_PER_DAY, full);
    expect([sim.tally.lost, sim.map.stackGood[tile], sim.map.stackSize[tile]]).toEqual([1, Good.Food, 4]);
    step(sim);
    expect([sim.map.stackGood[tile], sim.tally.spoiledOnFields]).toEqual([Good.None, 4]);
  });

  it('falls on a game with no field and changes nothing in it, tick for tick, from a game whose frost never comes', () => {
    const game = (frostAt?: number) => {
      const sim = createSim(generateMap(FIRST_YEAR_SEED), { ...SETTLERS, campFood: 400 });
      for (const [x, y] of FIRST_YEAR_LOG_TREES) applyCommand(sim, { kind: 'markArea', order: 'chop', area: square(x, y) });
      if (frostAt !== undefined) sim.fields.frostAt = frostAt;
      while (dateAt(sim.tick).day < 11 && !sim.over) step(sim);
      return sim;
    };
    const frosted = game();
    const never = game(Number.MAX_SAFE_INTEGER);
    expect([frosted.over, frosted.fields.frostAt < frosted.tick]).toEqual([false, true]);
    expect(frosted.tally).toEqual(never.tally);
    expect([frosted.tally.lost, frosted.fields.lostThisYear]).toEqual([0, 0]);
    expect(frosted.tally.felled).toBeGreaterThan(0);
    const { count } = frosted.villagers;
    for (const column of ['x', 'y', 'state', 'task', 'taskTile', 'carried', 'missedMeals'] as const) {
      expect(Array.from(frosted.villagers[column].subarray(0, count)), column).toEqual(Array.from(never.villagers[column].subarray(0, count)));
    }
    expect(frosted.stores.held).toEqual(never.stores.held);
  });
});
