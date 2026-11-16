import { describe, expect, it } from 'vitest';
import { finishHouse } from './building';
import { Good } from './goods';
import { MAX_HOUSEHOLDS, NO_HOME, createHouseholds } from './households';
import { generateMap } from './mapgen';
import { NAMES, Sex, nameOf } from './names';
import { type OrderCommand, SiteState } from './orders';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { at, mapFrom } from './testMaps';

const house = (x: number, y: number): OrderCommand => ({ kind: 'placeHouse', x, y });
const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

/** Houses centered on row 8 of an open 40 by 40 map, each with its 12 logs and 6 stone lying four tiles below it. The camp is at (19, 19). */
const ROW = [5, 11, 17, 23, 29];
function housesWithGoods(villagers: number): Sim {
  const map = mapFrom(open(40));
  for (const x of ROW) {
    for (const [dx, good, size] of [[0, Good.Log, 8], [1, Good.Log, 4], [-1, Good.Stone, 6]] as const) {
      map.stackGood[at(map, x + dx, 12)] = good;
      map.stackSize[at(map, x + dx, 12)] = size;
    }
  }
  return createSim(map, { villagers, monsters: 0 });
}

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

const namesOf = (sim: Sim) => Array.from(sim.villagers.name, (name, id) => nameOf(sim.villagers.sex[id] as Sex, name));

describe('the households', () => {
  it('pair the 8 settlers into 4 households of a man and a woman, with 8 names the seed chooses', () => {
    const sim = createSim(generateMap(7, 64), SETTLERS);
    const { household, sex } = sim.villagers;
    expect(sim.households.count).toBe(4);
    expect(Array.from(household)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    for (let h = 0; h < 4; h++) expect([sex[2 * h], sex[2 * h + 1]]).toEqual([Sex.Man, Sex.Woman]);
    const names = namesOf(sim);
    expect(new Set(names).size).toBe(8);
    names.forEach((name, id) => expect(NAMES[sex[id] as Sex]).toContain(name));
    expect(namesOf(createSim(generateMap(7, 64), SETTLERS))).toEqual(names);
    expect(namesOf(createSim(generateMap(8, 64), SETTLERS))).not.toEqual(names);
  });

  it('give no two villagers of a sex one name while the names last', () => {
    const sim = createSim(generateMap(7, 64), { villagers: 2 * NAMES[Sex.Woman].length, monsters: 0 });
    expect(new Set(namesOf(sim)).size).toBe(sim.villagers.name.length);
  });

  it('leave the last household of an odd count with one member', () => {
    const sim = createSim(generateMap(7, 64), { villagers: 3, monsters: 0 });
    expect(sim.households.count).toBe(2);
    expect(Array.from(sim.villagers.household)).toEqual([0, 0, 1]);
  });

  it(`hold at most ${MAX_HOUSEHOLDS}`, () => {
    expect(createHouseholds(MAX_HOUSEHOLDS).home.length).toBe(MAX_HOUSEHOLDS);
    expect(() => createHouseholds(MAX_HOUSEHOLDS + 1)).toThrow();
  });
});

describe('moving into a house', () => {
  it('gives each finished house to the lowest household with no home, in the order they finish, and leaves a house past the last household empty', () => {
    const sim = housesWithGoods(8);
    for (const x of ROW) applyCommand(sim, house(x, 8));
    const finished: number[] = [];
    runUntil(sim, () => finished.length === ROW.length, 6000, () => {
      for (let slot = 0; slot < ROW.length; slot++) {
        if (sim.orders.sites.state[slot] === SiteState.House && !finished.includes(slot)) finished.push(slot);
      }
    });
    expect(finished).not.toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(sim.households.home)).toEqual(finished.slice(0, 4));
  });

  it('gives two houses finished in one tick to the two lowest households with no home, by internals', () => {
    const sim = housesWithGoods(8);
    for (const x of ROW.slice(0, 3)) applyCommand(sim, house(x, 8));
    finishHouse(sim, 1);
    step(sim);
    finishHouse(sim, 2);
    finishHouse(sim, 0);
    expect(Array.from(sim.households.home)).toEqual([1, 2, 0, NO_HOME]);
  });

  it('leaves every household with no home at the start', () => {
    expect(Array.from(createSim(generateMap(7, 64), SETTLERS).households.home)).toEqual(Array(4).fill(NO_HOME));
  });
});
