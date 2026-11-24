import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY, dateAt, tickOfDay } from './calendar';
import { isDawn, isNight } from './daylight';
import { Good } from './goods';
import { nightsToCome, readinessOf, wouldBeCold } from './readiness';
import { type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_STORE } from './stores';
import { at, mapFrom } from './testMaps';
import { VillagerState } from './villagerState';

const FIREWOOD = Good.Firewood - 1;
const YEAR = TICKS_PER_DAY * 14;
const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

function runUntil(sim: Sim, done: () => boolean, limit = YEAR): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
  }
}

const noonOf = (sim: Sim, day: number) => runUntil(sim, () => dateAt(sim.tick).day === day && dateAt(sim.tick).minuteOfDay >= 12 * 60);
const lateNightOf = (sim: Sim, day: number) => runUntil(sim, () => isDawn(sim.tick) && dateAt(sim.tick).day === day + 1);

function finished(sim: Sim, kind: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

/**
 * Four households on an open map with no woodshed, so no firewood moves. Households 0 and 1 live in houses that hold
 * `houseWood` firewood each, and households 2 and 3 sleep at the camp, which holds `campWood`. The ids in `dressed`
 * wear clothing.
 */
function settlement(houseWood: readonly [number, number], campWood: number, dressed: readonly number[]) {
  const sim = createSim(mapFrom(open(40)), { villagers: 8, monsters: 0, campFood: 200, animals: false });
  const houses = [finished(sim, Building.House, 8, 8), finished(sim, Building.House, 30, 8)];
  houses.forEach((house, index) => (sim.stores.held[FIREWOOD]![house] = houseWood[index]!));
  sim.stores.held[FIREWOOD]![CAMP_STORE] = campWood;
  for (const id of dressed) sim.villagers.worn[id] = Good.Clothing;
  return { sim, houses };
}

const coldNow = (sim: Sim) => Array.from(sim.villagers.state.subarray(0, sim.villagers.count).keys()).filter((id) => sim.villagers.state[id] !== VillagerState.Dead && wouldBeCold(sim, id));

describe('the cold nights still to come', () => {
  it('are 3 from the first tick of autumn to the first winter dusk, one fewer after each winter dusk, and none in spring and summer', () => {
    const seen = new Map<string, Set<number>>();
    for (let tick = 0; tick < YEAR; tick++) {
      const { day, season } = dateAt(tick);
      const part = isNight(tick) && tickOfDay(tick) >= TICKS_PER_DAY / 2 ? 'evening' : 'day';
      const key = `${season} ${day} ${part}`;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(nightsToCome(tick));
    }
    const of = (key: string) => [...(seen.get(key) ?? [])];
    for (const day of [1, 4]) expect(of(`${day <= 3 ? 'Spring' : 'Summer'} ${day} day`)).toEqual([0]);
    expect(of('Summer 6 evening')).toEqual([0]);
    for (const day of [7, 8, 9]) {
      expect(of(`Autumn ${day} day`)).toEqual([3]);
      expect(of(`Autumn ${day} evening`)).toEqual([3]);
    }
    expect(of('Winter 10 day')).toEqual([3]);
    expect(of('Winter 10 evening')).toEqual([2]);
    expect(of('Winter 11 day')).toEqual([2]);
    expect(of('Winter 11 evening')).toEqual([1]);
    expect(of('Winter 12 day')).toEqual([1]);
    expect(of('Winter 12 evening')).toEqual([0]);
    expect(of('Spring 13 day')).toEqual([0]);
  });
});

describe('the reading of readiness', () => {
  it('is null before autumn and from the last winter dusk on, and reads from the first tick of autumn', () => {
    const { sim } = settlement([6, 6], 12, []);
    expect(readinessOf(sim)).toBeNull();
    runUntil(sim, () => dateAt(sim.tick).season === 'Autumn');
    expect(readinessOf(sim)).not.toBeNull();
    sim.tick -= 1;
    expect(readinessOf(sim)).toBeNull();
    sim.tick += 1;
    runUntil(sim, () => dateAt(sim.tick).day === 12 && isNight(sim.tick) && tickOfDay(sim.tick) >= TICKS_PER_DAY / 2);
    expect(readinessOf(sim)).toBeNull();
    sim.tick -= 1;
    expect(readinessOf(sim)).toMatchObject({ nights: 1 });
  });

  it('counts the households in a house, the houses with firewood for the nights to come, the clothed settlers, the cold ones, and the camp fire', () => {
    const { sim, houses } = settlement([6, 2], 4, [2, 4]);
    runUntil(sim, () => dateAt(sim.tick).season === 'Autumn');
    sim.stores.held[FIREWOOD]![houses[0]!] = 6;
    sim.stores.held[FIREWOOD]![houses[1]!] = 2;
    sim.stores.held[FIREWOOD]![CAMP_STORE] = 4;
    expect(readinessOf(sim)).toEqual({
      nights: 3,
      housed: 2,
      households: 4,
      stocked: 1,
      houses: 2,
      clothed: 2,
      settlers: 8,
      cold: 3,
      camp: { firewood: 4, burns: 4, lights: true },
    });
    expect(coldNow(sim)).toEqual([5, 6, 7]);
    sim.stores.held[FIREWOOD]![CAMP_STORE] = 3;
    expect(readinessOf(sim)).toMatchObject({ cold: 4, camp: { firewood: 3, burns: 4, lights: false } });
  });

  it('reads no camp fire once every household has a house, and counts a dead settler and a household that died out nowhere', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 4, monsters: 0, campFood: 200, animals: false });
    finished(sim, Building.House, 8, 8);
    finished(sim, Building.House, 30, 8);
    runUntil(sim, () => dateAt(sim.tick).season === 'Autumn');
    expect(readinessOf(sim)).toMatchObject({ housed: 2, households: 2, settlers: 4, camp: null });
    sim.villagers.state[2] = VillagerState.Dead;
    sim.villagers.state[3] = VillagerState.Dead;
    sim.households.living[1] = 0;
    expect(readinessOf(sim)).toMatchObject({ housed: 1, households: 1, settlers: 2, houses: 2 });
  });

  it('names as cold tonight the settlers that the next winter dusk gives a cold night, when nothing changes in between', () => {
    const cases: [readonly [number, number], number, readonly number[]][] = [
      [[6, 0], 4, [2, 4]],
      [[2, 1], 3, [0, 1, 2, 4, 5]],
      [[0, 0], 12, []],
      [[6, 6], 12, [4, 5, 6, 7]],
    ];
    for (const [houseWood, campWood, dressed] of cases) {
      const { sim } = settlement(houseWood, campWood, dressed);
      noonOf(sim, 10);
      const predicted = coldNow(sim);
      expect(readinessOf(sim)!.cold).toBe(predicted.length);
      const before = Array.from(sim.villagers.coldNights.subarray(0, sim.villagers.count));
      lateNightOf(sim, 10);
      const judged = Array.from(sim.villagers.coldNights.subarray(0, sim.villagers.count).keys()).filter((id) => sim.villagers.coldNights[id]! > before[id]!);
      expect(judged, JSON.stringify({ houseWood, campWood, dressed })).toEqual(predicted);
    }
  });

  it("keeps last night's fires through the day after a winter night, and none after a night outside winter", () => {
    const { sim, houses } = settlement([6, 1], 4, []);
    noonOf(sim, 10);
    expect(Array.from(sim.stores.burnedLastNight)).toEqual(Array.from(sim.stores.burnedLastNight).fill(0));
    noonOf(sim, 11);
    expect([sim.stores.burnedLastNight[houses[0]!], sim.stores.burnedLastNight[houses[1]!], sim.stores.burnedLastNight[CAMP_STORE]]).toEqual([1, 0, 1]);
    expect(sim.stores.burning[houses[0]!]).toBe(0);
  });
});
