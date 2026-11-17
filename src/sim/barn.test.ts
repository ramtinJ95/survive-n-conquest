import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY } from './calendar';
import { isDawn, isNight } from './daylight';
import { FORAGING } from './foraging';
import { Good, putDown } from './goods';
import { type Sim, applyCommand, createSim, step } from './sim';
import { STOCKING } from './stocking';
import { BARN_FOOD_LIMIT, CAMP_STORE, StoreKind, limitOf, storeKind } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';

const FORAGE = TASK_KINDS.indexOf(FORAGING) + 1;
const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;

/** An open map of `size` tiles a side with a tree on each tile in `trees`. Its camp stands at its middle. */
function mapWith(size: number, trees: readonly (readonly [number, number])[] = []) {
  const rows = Array.from({ length: size }, () => '.'.repeat(size).split(''));
  for (const [x, y] of trees) rows[y]![x] = 'T';
  return mapFrom(rows.map((row) => row.join('')));
}

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/** A building of `kind` anchored on (x, y), finished at once. Returns its slot. */
function finished(sim: Sim, kind: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

const food = (sim: Sim, store: number) => sim.stores.held[Good.Food - 1]![store]!;
const dawnsUntil = (sim: Sim, dawns: number) => runUntil(sim, () => sim.dawns === dawns, TICKS_PER_DAY * (dawns - sim.dawns + 1));

function foodOnGround(sim: Sim): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Food) units += sim.map.stackSize[tile]!;
  return units;
}

describe('a barn', () => {
  it('stores nothing until it is finished, and then holds up to 120 food as a common store', () => {
    const sim = createSim(mapWith(40), { villagers: 0, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.Barn, x: 8, y: 8 })).toMatchObject({ ok: true, order: 'barn', tiles: 9 });
    const slot = sim.orders.siteOf[at(sim.map, 8, 8)]!;
    expect([storeKind(sim.orders, slot), limitOf(sim.orders, sim.stores.campLimit, slot, Good.Food), sim.stores.barnCount]).toEqual([StoreKind.None, 0, 0]);
    finishBuilding(sim, slot);
    expect([storeKind(sim.orders, slot), limitOf(sim.orders, sim.stores.campLimit, slot, Good.Food), BARN_FOOD_LIMIT]).toEqual([StoreKind.Common, 120, 120]);
    expect(Array.from(sim.stores.barns.subarray(0, sim.stores.barnCount))).toEqual([slot]);
  });

  it('keeps its food through the nights and the dawns', () => {
    const sim = createSim(mapWith(40), { villagers: 0, monsters: 0 });
    const barn = finished(sim, Building.Barn, 8, 8);
    sim.stores.held[Good.Food - 1]![barn] = 50;
    dawnsUntil(sim, 3);
    expect(food(sim, barn)).toBe(50);
  });
});

describe('a forager with a barn', () => {
  it('carries each unit to the nearest store with room, a barn beside its hut before the camp', () => {
    const sim = createSim(mapWith(64, [[6, 9], [7, 9], [6, 10]]), { villagers: 1, monsters: 0 });
    const barn = finished(sim, Building.Barn, 9, 4);
    finished(sim, Building.Hut, 4, 6);
    runUntil(sim, () => sim.tally.foragedIn === 2, TICKS_PER_DAY);
    expect([food(sim, barn), food(sim, CAMP_STORE)]).toEqual([2, 24]);
  });

  it('counts the units on their way into the barn, and takes the next one to the camp once the barn has no room', () => {
    const sim = createSim(mapWith(64, [[6, 9], [7, 9]]), { villagers: 2, monsters: 0 });
    const barn = finished(sim, Building.Barn, 9, 4);
    sim.stores.held[Good.Food - 1]![barn] = BARN_FOOD_LIMIT - 1;
    finished(sim, Building.Hut, 4, 6);
    runUntil(sim, () => sim.villagers.task[0] === FORAGE && sim.villagers.task[1] === FORAGE, 100);
    expect([sim.stores.inbound[Good.Food - 1]![barn], sim.stores.inbound[Good.Food - 1]![CAMP_STORE]]).toEqual([1, 1]);
    runUntil(sim, () => sim.tally.foragedIn === 2, TICKS_PER_DAY);
    expect([food(sim, barn), food(sim, CAMP_STORE)]).toEqual([BARN_FOOD_LIMIT, 25]);
  });

  it('waits only when no store has room: a full camp leaves it picking for the barn', () => {
    const sim = createSim(mapWith(64, [[30, 33]]), { villagers: 1, monsters: 0, campFood: 40 });
    const barn = finished(sim, Building.Barn, 40, 32);
    finished(sim, Building.Hut, 28, 34);
    runUntil(sim, () => sim.tally.foragedIn === 1, TICKS_PER_DAY);
    expect([food(sim, barn), food(sim, CAMP_STORE)]).toEqual([1, 40]);
    sim.stores.held[Good.Food - 1]![barn] = BARN_FOOD_LIMIT;
    sim.foraging.ripeAt.fill(0);
    for (let tick = 0; tick < 50; tick++) step(sim);
    expect([sim.villagers.task[0], sim.tally.foraged]).toEqual([0, 1]);
  });
});

describe('food on the ground with a barn', () => {
  it('is carried by a settler without a job to the nearest store with room, and is gone at the second dawn when nobody carries it', () => {
    const sim = createSim(mapWith(64), { villagers: 1, monsters: 0 });
    const barn = finished(sim, Building.Barn, 12, 12);
    expect(putDown(sim, at(sim.map, 12, 16), Good.Food, 1)).toBe(true);
    runUntil(sim, () => sim.tally.fromGround === 1, TICKS_PER_DAY);
    expect([food(sim, barn), foodOnGround(sim)]).toEqual([1, 0]);

    finished(sim, Building.Hut, 50, 50);
    expect(sim.villagers.workplace[0]).toBeGreaterThanOrEqual(0);
    const put = sim.dawns;
    expect(putDown(sim, at(sim.map, 12, 16), Good.Food, 1)).toBe(true);
    dawnsUntil(sim, put + 1);
    expect([foodOnGround(sim), sim.tally.fromGround]).toEqual([1, 1]);
    dawnsUntil(sim, put + 2);
    expect([foodOnGround(sim), food(sim, barn)]).toEqual([0, 1]);
  });

  it('is put down at dusk by its carrier, and carried in the next day', () => {
    const sim = createSim(mapWith(64), { villagers: 1, monsters: 0, campFood: 40 });
    const barn = finished(sim, Building.Barn, 56, 56);
    runUntil(sim, () => isNight(sim.tick + 120), TICKS_PER_DAY);
    expect(putDown(sim, at(sim.map, 34, 34), Good.Food, 1)).toBe(true);
    runUntil(sim, () => sim.villagers.carried[0] === Good.Food, 120);
    expect(sim.stores.inbound[Good.Food - 1]![barn]).toBe(1);
    runUntil(sim, () => isNight(sim.tick - 1), 120);
    expect([sim.villagers.carried[0], foodOnGround(sim), sim.stores.inbound[Good.Food - 1]![barn]]).toEqual([Good.None, 1, 0]);
    runUntil(sim, () => sim.tally.fromGround === 1, TICKS_PER_DAY);
    expect(foodOnGround(sim)).toBe(0);
  });
});

describe('a household that fetches its food', () => {
  it('stocks its home from the nearest store that has food, the barn beside it before the camp', () => {
    const sim = createSim(mapWith(64), { villagers: 2, monsters: 0 });
    const barn = finished(sim, Building.Barn, 8, 8);
    sim.stores.held[Good.Food - 1]![barn] = 20;
    const house = finished(sim, Building.House, 8, 13);
    runUntil(sim, () => food(sim, house) === 6, TICKS_PER_DAY);
    expect([food(sim, barn), food(sim, CAMP_STORE), sim.tally.carriedHome]).toEqual([14, 24, 6]);
  });

  it('stocks its home from the camp when the camp is nearer than the barn', () => {
    const sim = createSim(mapWith(64), { villagers: 2, monsters: 0 });
    const barn = finished(sim, Building.Barn, 6, 6);
    sim.stores.held[Good.Food - 1]![barn] = 20;
    const house = finished(sim, Building.House, 32, 27);
    runUntil(sim, () => food(sim, house) === 6, TICKS_PER_DAY);
    expect([food(sim, barn), food(sim, CAMP_STORE)]).toEqual([20, 18]);
  });

  it('with no house, eats at the camp: when the camp is empty and a barn is full, settlers without a job carry food from the barn to the camp for the households there', () => {
    const sim = createSim(mapWith(64), { villagers: 4, monsters: 0, campFood: 0 });
    const barn = finished(sim, Building.Barn, 8, 8);
    sim.stores.held[Good.Food - 1]![barn] = BARN_FOOD_LIMIT;
    const taken: number[] = [];
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, () => {
      for (let id = 0; id < 4; id++) if (sim.villagers.task[id] === STOCK && !taken.includes(id)) taken.push(id);
    });
    expect([food(sim, CAMP_STORE), food(sim, barn), sim.tally.toCamp]).toEqual([4, BARN_FOOD_LIMIT - 4, 4]);
    expect(taken.length).toBeGreaterThan(0);
    runUntil(sim, () => isDawn(sim.tick), TICKS_PER_DAY);
    expect([sim.tally.meals, sim.tally.missed, food(sim, CAMP_STORE)]).toEqual([4, 0, 0]);
  });

  it('leaves the camp to settlers without a job: a forager never carries food from a barn to the camp', () => {
    const sim = createSim(mapWith(64), { villagers: 2, monsters: 0, campFood: 0 });
    const barn = finished(sim, Building.Barn, 8, 8);
    sim.stores.held[Good.Food - 1]![barn] = BARN_FOOD_LIMIT;
    const hut = finished(sim, Building.Hut, 50, 50);
    applyCommand(sim, { kind: 'setPlaces', slot: hut, places: 2 });
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    expect([food(sim, CAMP_STORE), sim.tally.toCamp, sim.tally.missed]).toEqual([0, 0, 0]);
    runUntil(sim, () => isDawn(sim.tick), TICKS_PER_DAY);
    expect(sim.tally.missed).toBe(2);
  });

  it('passes over a barn that no walk reaches and stocks its home from the camp', () => {
    const rows = Array.from({ length: 64 }, () => '.'.repeat(64).split(''));
    for (let i = 5; i <= 11; i++) for (const [x, y] of [[i, 5], [i, 11], [5, i], [11, i]] as const) rows[y]![x] = '#';
    const sim = createSim(mapFrom(rows.map((row) => row.join(''))), { villagers: 2, monsters: 0 });
    const barn = finished(sim, Building.Barn, 8, 8);
    sim.stores.held[Good.Food - 1]![barn] = 20;
    const house = finished(sim, Building.House, 14, 8);
    runUntil(sim, () => food(sim, house) === 6, TICKS_PER_DAY);
    expect([food(sim, barn), food(sim, CAMP_STORE)]).toEqual([20, 18]);
  });

  it('gives up carrying food from a barn to the camp when the carrier is hired on its way', () => {
    const sim = createSim(mapWith(64), { villagers: 2, monsters: 0, campFood: 0 });
    const barn = finished(sim, Building.Barn, 8, 8);
    sim.stores.held[Good.Food - 1]![barn] = BARN_FOOD_LIMIT;
    runUntil(sim, () => sim.villagers.task[0] === STOCK && sim.villagers.toStore[0] === CAMP_STORE, 100);
    expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x: 50, y: 50 })).toMatchObject({ ok: true });
    const hut = sim.orders.siteOf[at(sim.map, 50, 50)]!;
    finishBuilding(sim, hut);
    expect([sim.villagers.workplace[0], sim.villagers.workplace[1]]).toEqual([hut, hut]);
    step(sim);
    expect([sim.villagers.task[0], sim.stores.outbound[Good.Food - 1]![barn], sim.stores.inbound[Good.Food - 1]![CAMP_STORE]]).toEqual([0, 0, 0]);
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    expect(sim.tally.toCamp).toBe(0);
  });
});
