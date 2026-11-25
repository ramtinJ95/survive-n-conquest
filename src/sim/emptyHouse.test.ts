import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY } from './calendar';
import { Good } from './goods';
import { NO_VILLAGER, emptyHouse, formHousehold, loseMember } from './households';
import { type Sim, applyCommand, createSim, step } from './sim';
import { STOCKING } from './stocking';
import { CAMP_STORE } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { die } from './villagers';
import { Cause } from './villagerState';

const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;

const openMap = (size: number) => mapFrom(Array.from({ length: size }, () => '.'.repeat(size)));

function runUntil(sim: Sim, done: () => boolean, limit: number): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
  }
}

function finished(sim: Sim, kind: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

const food = (sim: Sim, store: number) => sim.stores.held[Good.Food - 1]![store]!;
const firewood = (sim: Sim, store: number) => sim.stores.held[Good.Firewood - 1]![store]!;
const vacant = (sim: Sim) => Array.from(sim.households.vacant.subarray(0, sim.households.vacantCount));

function dieOut(sim: Sim, household: number): void {
  for (let id = 0; id < sim.villagers.count; id++) if (sim.villagers.household[id] === household) die(sim, id, Cause.Hunger);
}

/**
 * Households on an open map of 64 tiles a side, its camp at the middle:
 * household 0 in the house on `home`, household 1 in the house on `left`,
 * which it leaves empty when it dies out, with `units` of food in it, and a
 * household of one in each house on `others`.
 */
function emptied(home: readonly [number, number], left: readonly [number, number], units: number, others: readonly (readonly [number, number])[] = []) {
  const sim = createSim(openMap(64), { villagers: 4 + others.length, monsters: 0 });
  const house = finished(sim, Building.House, ...home);
  const empty = finished(sim, Building.House, ...left);
  for (const [x, y] of others) finished(sim, Building.House, x, y);
  expect([sim.households.householdIn[house], sim.households.householdIn[empty], sim.households.atCamp]).toEqual([0, 1, 0]);
  dieOut(sim, 1);
  sim.stores.held[Good.Food - 1]![empty] = units;
  return { sim, house, empty };
}

describe('a house nobody lives in', () => {
  it('is counted as empty when it is finished with no household to take it, and when its last member dies', () => {
    const sim = createSim(openMap(64), { villagers: 2, monsters: 0 });
    const house = finished(sim, Building.House, 8, 13);
    const spare = finished(sim, Building.House, 8, 8);
    expect([sim.households.householdIn[house], vacant(sim)]).toEqual([0, [spare]]);
    dieOut(sim, 0);
    expect(vacant(sim)).toEqual([spare, house]);
    expect(emptyHouse(sim.households)).toBe(house);
  });

  it('is the source of a household that stocks its home when it is nearer than the camp, and its food leaves it unit by unit', () => {
    const { sim, house, empty } = emptied([8, 13], [8, 8], 10);
    expect(vacant(sim)).toEqual([empty]);
    runUntil(sim, () => food(sim, house) === 6, TICKS_PER_DAY);
    expect([food(sim, empty), food(sim, CAMP_STORE), sim.tally.carriedHome]).toEqual([4, 24, 6]);
  });

  it('keeps its food when the camp is nearer the home', () => {
    const { sim, house, empty } = emptied([32, 27], [8, 8], 10);
    runUntil(sim, () => food(sim, house) === 6, TICKS_PER_DAY);
    expect([food(sim, empty), food(sim, CAMP_STORE)]).toEqual([10, 18]);
  });

  it('is passed over when it holds no food, and the home is stocked from the camp', () => {
    const { sim, house, empty } = emptied([8, 13], [8, 8], 0);
    runUntil(sim, () => food(sim, house) === 6, TICKS_PER_DAY);
    expect([food(sim, empty), food(sim, CAMP_STORE)]).toEqual([0, 18]);
  });

  it('is given firewood by nobody, and gives its firewood to a home nearer it than any other source', () => {
    const { sim, house, empty } = emptied([8, 13], [8, 8], 0);
    sim.stores.held[Good.Firewood - 1]![empty] = 4;
    runUntil(sim, () => firewood(sim, house) === 4, TICKS_PER_DAY);
    expect([firewood(sim, empty), sim.stores.inbound[Good.Firewood - 1]![empty], sim.tally.firewoodHome]).toEqual([0, 0, 4]);
  });

  it('keeps the unit a carrier walks to when a new household takes the house, and the carrier gives it up', () => {
    const { sim, house, empty } = emptied([8, 13], [8, 8], 10, [[50, 50]]);
    const third = sim.households.home[2]!;
    expect(vacant(sim)).toEqual([empty]);
    const carrier = (id: number) => sim.villagers.task[id] === STOCK && sim.villagers.fromStore[id] === empty && sim.villagers.carried[id] === Good.None;
    runUntil(sim, () => carrier(0) || carrier(1), TICKS_PER_DAY);
    const id = carrier(0) ? 0 : 1;
    expect(sim.stores.outbound[Good.Food - 1]![empty]).toBe(1);
    loseMember(sim.households, sim.villagers, 4);
    const formed = formHousehold(sim.households, sim.villagers, 4, NO_VILLAGER, emptyHouse(sim.households), sim.dawns);
    expect([sim.households.home[formed], vacant(sim)]).toEqual([empty, [third]]);
    step(sim);
    expect([sim.villagers.fromStore[id] === empty && sim.villagers.task[id] === STOCK, sim.stores.outbound[Good.Food - 1]![empty], food(sim, empty)]).toEqual([false, 0, 10]);
    runUntil(sim, () => food(sim, house) === 6, TICKS_PER_DAY);
    expect(food(sim, empty)).toBe(10);
  });
});
