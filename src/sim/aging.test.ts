import { describe, expect, it } from 'vitest';
import { frameOf } from '../frame';
import { LIFE_SPANS, STARTING_AGES, lifeSpan, startingAge } from './aging';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_YEAR_OF_AGE, dateAt } from './calendar';
import { isDawn } from './daylight';
import { Good } from './goods';
import { MAX_HOUSEHOLDS, NO_HOME } from './households';
import { generateMap } from './mapgen';
import { Sex, nameOf } from './names';
import { SETTLERS, type Sim, type StartingHousehold, applyCommand, createSim, parseSettlers, populationFor, step } from './sim';
import { at, mapFrom } from './testMaps';
import { addVillager } from './villagers';
import { Cause, VILLAGER_ROWS, VillagerState } from './villagerState';

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));
const man = (age: number, span?: number) => (span === undefined ? { sex: Sex.Man, age } : { sex: Sex.Man, age, span });
const woman = (age: number, span?: number) => (span === undefined ? { sex: Sex.Woman, age } : { sex: Sex.Woman, age, span });

/** Settlers of stated ages on an open map with food and no animals, so nothing but age ends a life in the first days. */
function settlers(households: readonly StartingHousehold[]): Sim {
  return createSim(mapFrom(open(32)), { villagers: households.length * 2, monsters: 0, campFood: 200, animals: false, settlers: households });
}

function runTo(sim: Sim, tick: number): void {
  while (sim.tick < tick && !sim.over) step(sim);
}

const ageShown = (sim: Sim, id: number) => frameOf(sim).frame.ages[id];

/** The tick of the first dawn of `day`. */
function dawnOf(day: number): number {
  let tick = 0;
  while (!(isDawn(tick) && dateAt(tick).day === day)) tick++;
  return tick;
}

describe('a settler\'s age', () => {
  it('is its stated age on day 1 and turns a year older every 7,200 ticks, at 24 until tick 7199 and 25 from tick 7200', () => {
    const sim = settlers([[man(24), woman(22)]]);
    expect([ageShown(sim, 0), ageShown(sim, 1)]).toEqual([24, 22]);
    runTo(sim, 7199);
    expect(ageShown(sim, 0)).toBe(24);
    runTo(sim, 7200);
    expect([ageShown(sim, 0), ageShown(sim, 1)]).toEqual([25, 23]);
    expect(dateAt(7200)).toMatchObject({ day: 3, minuteOfDay: 17 * 60 + 36 });
    runTo(sim, 7200 * 2);
    expect(ageShown(sim, 0)).toBe(26);
  });

  it('stays at its age at death once the settler died', () => {
    const sim = settlers([[man(69, 70), woman(20)]]);
    runTo(sim, dawnOf(4) + 1);
    expect(sim.villagers.state[0]).toBe(VillagerState.Dead);
    runTo(sim, dawnOf(4) + 7200 * 2);
    expect(ageShown(sim, 0)).toBe(70);
    expect(ageShown(sim, 1)).toBe(23);
  });

  it('is drawn on seed 7 for the 8 starting settlers, each from 18 to 30, with a life span from 60 to 80', () => {
    const sim = createSim(generateMap(7), SETTLERS);
    const ages = Array.from({ length: 8 }, (_, id) => ageShown(sim, id));
    const spans = Array.from(sim.villagers.span.subarray(0, sim.villagers.count));
    expect(ages).toEqual([26, 29, 23, 25, 27, 27, 23, 18]);
    expect(spans).toEqual([77, 68, 68, 64, 74, 79, 77, 67]);
    expect(ages.every((age) => age! >= 18 && age! <= 30)).toBe(true);
    expect(spans.every((span) => span >= 60 && span <= 80)).toBe(true);
  });

  it('draws every whole age from 18 to 30 and every span from 60 to 80 across ids and seeds, and nothing outside them', () => {
    const ages = new Set<number>();
    const spans = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      for (let id = 0; id < 200; id++) {
        ages.add(startingAge(seed, id));
        spans.add(lifeSpan(seed, id));
      }
    }
    const range = ([low, high]: readonly [number, number]) => Array.from({ length: high - low + 1 }, (_, i) => low + i);
    expect([...ages].sort((a, b) => a - b)).toEqual(range(STARTING_AGES));
    expect([...spans].sort((a, b) => a - b)).toEqual(range(LIFE_SPANS));
  });
});

describe('death of old age', () => {
  it('comes at the first dawn after the tick a settler reaches its span, not at that tick, which is no dawn', () => {
    const sim = settlers([[man(69, 70), woman(20)]]);
    const reaches = 7200;
    const dawn = dawnOf(4);
    expect(isDawn(reaches)).toBe(false);
    expect(dawn).toBe(8450);
    runTo(sim, reaches + 1);
    expect(sim.villagers.state[0]).not.toBe(VillagerState.Dead);
    runTo(sim, dawn);
    expect(sim.villagers.state[0]).not.toBe(VillagerState.Dead);
    step(sim);
    expect(sim.villagers.state[0]).toBe(VillagerState.Dead);
    expect([sim.villagers.cause[0], sim.villagers.diedAt[0], sim.tally.oldAge, sim.living]).toEqual([Cause.OldAge, dawn, 1, 1]);
    expect(sim.villagers.state[1]).not.toBe(VillagerState.Dead);
  });

  it('comes at a dawn on which the settler reaches its span exactly, and a tick later the next dawn', () => {
    const dawn = dawnOf(4);
    const exactly = settlers([[man(20, 70), woman(20)]]);
    exactly.villagers.born[0] = dawn - 70 * TICKS_PER_YEAR_OF_AGE;
    runTo(exactly, dawn + 1);
    expect([exactly.villagers.cause[0], exactly.villagers.diedAt[0]]).toEqual([Cause.OldAge, dawn]);

    const later = settlers([[man(20, 70), woman(20)]]);
    later.villagers.born[0] = dawn + 1 - 70 * TICKS_PER_YEAR_OF_AGE;
    runTo(later, dawn + 1);
    expect(later.villagers.state[0]).not.toBe(VillagerState.Dead);
    runTo(later, dawnOf(5) + 1);
    expect([later.villagers.cause[0], later.villagers.diedAt[0]]).toEqual([Cause.OldAge, dawnOf(5)]);
  });

  it('takes the settler where it stood at the dawn', () => {
    const sim = settlers([[man(69, 70), woman(20)]]);
    runTo(sim, dawnOf(4));
    const where = [sim.villagers.x[0], sim.villagers.y[0]];
    step(sim);
    expect([sim.villagers.x[0], sim.villagers.y[0]]).toEqual(where);
  });

});

describe('the cause of death', () => {
  it('is none while a settler lives, and hunger for one that starves, at the tick it died', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 0, animals: false });
    expect([sim.villagers.cause[0], sim.villagers.diedAt[0]]).toEqual([Cause.None, -1]);
    let died = -1;
    while (sim.villagers.state[0] !== VillagerState.Dead) {
      died = sim.tick;
      step(sim);
    }
    expect([sim.villagers.cause[0], sim.villagers.diedAt[0]]).toEqual([Cause.Hunger, died]);
  });

  it('is cold for one that freezes', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    while (!sim.over) step(sim);
    expect([sim.villagers.cause[0], sim.villagers.cause[1], sim.tally.froze]).toEqual([Cause.Cold, Cause.Cold, 2]);
  });
});

describe('the villagers table', () => {
  it('holds 4,096 rows, of which a new game uses 8, and a frame carries only the rows in use', () => {
    const sim = createSim(generateMap(7), SETTLERS);
    expect([sim.villagers.count, sim.villagers.x.length, sim.villagers.state.length, VILLAGER_ROWS]).toEqual([8, 4096, 4096, 4096]);
    const { frame } = frameOf(sim);
    expect([frame.villagers.length, frame.states.length, frame.names.length, frame.causes.length, frame.ages.length]).toEqual([16, 8, 8, 8, 8]);
  });

  it('adds a villager in the next row, which a frame then carries, until the table is full', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0 });
    const child = { sex: Sex.Woman, household: 0, name: 3, born: 0, span: 70 };
    expect(addVillager(sim.villagers, sim.map, sim.flow, child)).toBe(2);
    expect(sim.villagers.count).toBe(3);
    const { frame } = frameOf(sim);
    expect([frame.states.length, nameOf(frame.sexes[2] as Sex, frame.names[2]!), frame.households[2], frame.ages[2]]).toEqual([3, nameOf(Sex.Woman, 3), 0, 0]);
    while (sim.villagers.count < VILLAGER_ROWS) addVillager(sim.villagers, sim.map, sim.flow, child);
    expect(addVillager(sim.villagers, sim.map, sim.flow, child)).toBe(-1);
    expect(sim.villagers.count).toBe(VILLAGER_ROWS);
  });
});

describe('the settlers setting', () => {
  it('reads households of a man and a woman with their ages and, when given, their spans', () => {
    expect(parseSettlers('m70:70,w66;m24,w22:75')).toEqual([
      [{ sex: Sex.Man, age: 70, span: 70 }, { sex: Sex.Woman, age: 66 }],
      [{ sex: Sex.Man, age: 24 }, { sex: Sex.Woman, age: 22, span: 75 }],
    ]);
    expect(parseSettlers('m0,w99:1')).toEqual([[{ sex: Sex.Man, age: 0 }, { sex: Sex.Woman, age: 99, span: 1 }]]);
  });

  it('ignores anything malformed', () => {
    const junk = [null, '', 'm24', 'w22,m24', 'm24,w22,w3', 'm24,m22', 'x24,w22', 'm100,w2', 'm-1,w2', 'm24:0,w22', 'm24:100,w22', 'm24,w22;', ';m24,w22', 'm24 ,w22', 'M24,w22', 'm24:,w22', 'm2.5,w22'];
    for (const text of junk) expect(parseSettlers(text), String(text)).toBeNull();
    expect(parseSettlers(Array.from({ length: MAX_HOUSEHOLDS + 1 }, () => 'm20,w20').join(';'))).toBeNull();
  });

  it('starts the settlers of a new game with the stated households and ages, with the names of today', () => {
    const stated = parseSettlers('m70:70,w66;m24,w22:75');
    const population = populationFor(null, null, null, stated);
    expect(population).toMatchObject({ villagers: 4, monsters: 0, settlers: stated });
    const sim = createSim(generateMap(7), population);
    const drawn = createSim(generateMap(7), SETTLERS);
    const { frame } = frameOf(sim);
    expect(Array.from(frame.ages)).toEqual([70, 66, 24, 22]);
    expect(Array.from(frame.households)).toEqual([0, 0, 1, 1]);
    expect(Array.from(frame.sexes)).toEqual([Sex.Man, Sex.Woman, Sex.Man, Sex.Woman]);
    expect(Array.from(frame.names)).toEqual(Array.from(drawn.villagers.name.subarray(0, 4)));
    expect([sim.villagers.span[0], sim.villagers.span[1], sim.villagers.span[2], sim.villagers.span[3]]).toEqual([70, lifeSpan(7, 1), lifeSpan(7, 2), 75]);
    expect([sim.households.count, sim.living]).toEqual([2, 4]);
  });

  it('leaves the benchmark load and the empty map as they are', () => {
    const stated = parseSettlers('m70:70,w66');
    expect(populationFor('on', null, null, stated).settlers).toBeUndefined();
    expect(populationFor('off', null, null, stated)).toEqual(populationFor('off'));
    expect(populationFor('on').mostLiving).toBe(1600);
  });
});

describe('a household one of whose couple dies of old age, under the rules of stages 3 and 4', () => {
  /** Household 0 in a finished house with 6 food, its man clothed and the one forager of a hut, and household 1 at the camp. */
  function widowed(households: readonly StartingHousehold[]) {
    const sim = settlers(households);
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 6, y: 6 })).toMatchObject({ ok: true });
    const house = sim.orders.siteOf[at(sim.map, 6, 6)]!;
    finishBuilding(sim, house);
    sim.stores.held[Good.Food - 1]![house] = 6;
    expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x: 24, y: 24 })).toMatchObject({ ok: true });
    const hut = sim.orders.siteOf[at(sim.map, 24, 24)]!;
    sim.villagers.x[0] = sim.villagers.targetX[0] = 25;
    sim.villagers.y[0] = sim.villagers.targetY[0] = 25;
    finishBuilding(sim, hut);
    applyCommand(sim, { kind: 'setPlaces', slot: hut, places: 1 });
    sim.villagers.worn[0] = Good.Clothing;
    expect([sim.villagers.workplace[0], sim.households.home[0]]).toEqual([hut, house]);
    return { sim, house, hut };
  }

  it('keeps the widow in its household and its house, gives the place at the workplace to a settler without a job, and the clothing goes with the dead', () => {
    const { sim, house, hut } = widowed([[man(69, 70), woman(20)], [man(20), woman(20)]]);
    runTo(sim, dawnOf(4) + 1);
    expect(sim.villagers.cause[0]).toBe(Cause.OldAge);
    expect([sim.villagers.household[1], sim.households.living[0], sim.households.home[0], sim.households.home[1]]).toEqual([0, 1, house, NO_HOME]);
    expect(sim.villagers.workplace[0]).toBe(-1);
    expect([1, 2, 3].filter((id) => sim.villagers.workplace[id] === hut)).toHaveLength(1);
    expect(sim.villagers.worn[0]).toBe(Good.Clothing);
    expect(sim.map.stackGood.includes(Good.Clothing)).toBe(false);
  });

  it('frees the house when both die, for the next household without one, with its food left in it', () => {
    const { sim, house } = widowed([[man(69, 70), woman(69, 70)], [man(20), woman(20)]]);
    runTo(sim, dawnOf(4));
    const food = sim.stores.held[Good.Food - 1]![house]!;
    step(sim);
    expect([sim.villagers.cause[0], sim.villagers.cause[1], sim.tally.oldAge]).toEqual([Cause.OldAge, Cause.OldAge, 2]);
    expect([sim.households.living[0], sim.households.home[0], sim.households.home[1]]).toEqual([0, NO_HOME, house]);
    expect(sim.stores.held[Good.Food - 1]![house]).toBe(food);
  });
});
