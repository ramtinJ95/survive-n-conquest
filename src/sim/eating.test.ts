import { describe, expect, it } from 'vitest';
import { AnimalKind, addAnimal } from './animals';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY, dateAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { EATING } from './eating';
import { FORAGING } from './foraging';
import { GATHERING } from './gathering';
import { Good } from './goods';
import { HUNTING } from './hunting';
import { type Sim, applyCommand, createSim, step } from './sim';
import { STOCKING } from './stocking';
import { CAMP_STORE } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { NO_TASK, VillagerState } from './villagerState';

const EAT = TASK_KINDS.indexOf(EATING) + 1;
const FORAGE = TASK_KINDS.indexOf(FORAGING) + 1;
const GATHER = TASK_KINDS.indexOf(GATHERING) + 1;
const HUNT = TASK_KINDS.indexOf(HUNTING) + 1;
const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

const untilDusk = (sim: Sim, each?: () => void) => runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, each);

/** The day and the time of a tick, as `day HH:MM`. */
function clock(tick: number): string {
  const { day, minuteOfDay } = dateAt(tick);
  return `${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
}

/** A building of `kind` anchored on (x, y), finished at once. Returns its slot. */
function finished(sim: Sim, kind: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

/** Puts a villager on the center of tile (x, y), idle there. */
function standAt(sim: Sim, id: number, x: number, y: number): void {
  sim.villagers.x[id] = sim.villagers.targetX[id] = x + 0.5;
  sim.villagers.y[id] = sim.villagers.targetY[id] = y + 0.5;
}

/** Marks trees on the tiles of an area for felling. */
function chopTrees(sim: Sim, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sim.map.trees[at(sim.map, x, y)] = 1;
  applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0, y0, x1, y1 } });
}

describe('eating first', () => {
  it('fetches a unit home to an empty house while the camp has food, and eats it there that day, not at dusk', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 1, monsters: 0 });
    const house = finished(sim, Building.House, 4, 4);
    sim.villagers.missedMeals[0] = 1;
    const camp = sim.stores.held[Good.Food - 1]![CAMP_STORE]!;
    let meal = '';
    let from = -1;
    let houseFood = sim.stores.held[Good.Food - 1]![house]!;
    let campFood = camp;
    untilDusk(sim, () => {
      if (meal === '' && sim.villagers.missedMeals[0] === 0) {
        meal = clock(sim.tick - 1);
        from = sim.stores.held[Good.Food - 1]![house]! < houseFood ? house : sim.stores.held[Good.Food - 1]![CAMP_STORE]! < campFood ? CAMP_STORE : -1;
        expect(sim.tally.carriedHome).toBe(1);
      }
      houseFood = sim.stores.held[Good.Food - 1]![house]!;
      campFood = sim.stores.held[Good.Food - 1]![CAMP_STORE]!;
    });
    expect(from).toBe(house);
    expect(meal).toMatch(/^1 (0[89]|1[01]):\d\d$/);
    expect(sim.tally.meals).toBe(1);
  });

  it('takes a forager off its tile when the camp gets food, keeps the tile its work, and has it forage again after it ate', () => {
    const rows = open(40).map((row) => row.split(''));
    rows[12]![26] = 'T';
    const sim = createSim(mapFrom(rows.map((row) => row.join(''))), { villagers: 1, monsters: 0, campFood: 0 });
    finished(sim, Building.Hut, 24, 14);
    const tree = at(sim.map, 26, 12);
    sim.villagers.missedMeals[0] = 1;
    runUntil(sim, () => sim.foraging.progress[tree]! >= 50, TICKS_PER_DAY);
    expect(sim.villagers.task[0]).toBe(FORAGE);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 1;
    runUntil(sim, () => sim.villagers.task[0] === EAT, 10);
    const worked = sim.foraging.progress[tree]!;
    expect(sim.foraging.taker[tree]).toBe(-1);
    expect(worked).toBeGreaterThanOrEqual(50);
    expect(sim.villagers.workTile[0]).toBe(sim.camp);
    runUntil(sim, () => sim.tally.meals === 1, 400, () => expect(sim.foraging.progress[tree]).toBe(worked));
    expect([sim.stores.held[Good.Food - 1]![CAMP_STORE], sim.villagers.missedMeals[0]]).toEqual([0, 0]);
    runUntil(sim, () => sim.villagers.task[0] === FORAGE, 20);
    expect([sim.villagers.taskTile[0], sim.foraging.progress[tree]]).toEqual([tree, worked]);
    runUntil(sim, () => sim.tally.foraged === 1, TICKS_PER_DAY);
  });

  it('frees the deer a hunter stalks when the camp gets food, and walks it to eat', () => {
    const sim = createSim(mapFrom(open(38)), { villagers: 1, monsters: 0, campFood: 0 });
    finished(sim, Building.Lodge, 4, 4);
    const deer = addAnimal(sim.animals, AnimalKind.Deer, 30.5, 30.5);
    sim.animals.until[deer] = 1_000_000;
    sim.villagers.missedMeals[0] = 1;
    runUntil(sim, () => sim.villagers.task[0] === HUNT, 20);
    for (let tick = 0; tick < 30; tick++) step(sim);
    expect([sim.villagers.state[0], sim.animals.hunter[deer]]).toEqual([VillagerState.Walking, 0]);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 1;
    runUntil(sim, () => sim.villagers.task[0] === EAT, 10);
    expect([sim.animals.hunter[deer], sim.hunting.prey[0], sim.hunting.aimed[0]]).toEqual([-1, -1, 0]);
    runUntil(sim, () => sim.tally.meals === 1, 400);
    runUntil(sim, () => sim.villagers.task[0] === HUNT, 20);
  });

  it('has a settler that carries a unit when the camp gets food deliver it first, then eat', () => {
    const rows = open(40).map((row) => row.split(''));
    rows[12]![26] = 'T';
    const sim = createSim(mapFrom(rows.map((row) => row.join(''))), { villagers: 1, monsters: 0, campFood: 0 });
    finished(sim, Building.Hut, 24, 14);
    sim.villagers.missedMeals[0] = 1;
    runUntil(sim, () => sim.villagers.carried[0] === Good.Food, TICKS_PER_DAY);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 1;
    runUntil(sim, () => sim.tally.foragedIn === 1, 400, () => {
      if (sim.tally.foragedIn === 0) expect(sim.villagers.task[0]).toBe(FORAGE);
    });
    expect([sim.tally.meals, sim.stores.held[Good.Food - 1]![CAMP_STORE]]).toEqual([0, 2]);
    runUntil(sim, () => sim.tally.meals === 1, 20, () => expect([FORAGE, EAT, NO_TASK]).toContain(sim.villagers.task[0]));
    expect(sim.stores.held[Good.Food - 1]![CAMP_STORE]).toBe(1);
  });

  it('feeds only one of two hungry settlers from one unit, and the other keeps working at half the rate', () => {
    const sim = createSim(mapFrom(open(32)), { villagers: 2, monsters: 0, campFood: 1 });
    chopTrees(sim, 28, 4, 29, 4);
    standAt(sim, 0, 29, 6);
    standAt(sim, 1, 29, 6);
    sim.villagers.missedMeals.fill(1);
    const ate = [false, false];
    const working = [0, 0];
    const watch = () => {
      for (const id of [0, 1]) {
        if (sim.villagers.task[id] === EAT) ate[id] = true;
        if (sim.villagers.state[id] === VillagerState.Working && sim.villagers.task[id] === GATHER) working[id]!++;
      }
    };
    runUntil(sim, () => sim.tally.meals === 1, 400, watch);
    const eater = sim.villagers.missedMeals[0] === 0 ? 0 : 1;
    const other = 1 - eater;
    expect([ate[eater], ate[other], sim.villagers.missedMeals[other]]).toEqual([true, false, 1]);
    const tree = sim.villagers.taskTile[other]!;
    expect(sim.villagers.task[other]).toBe(GATHER);
    runUntil(sim, () => sim.map.trees[tree] === 0, 1000, watch);
    expect(ate[other]).toBe(false);
    expect(Math.abs(working[other]! - 400)).toBeLessThanOrEqual(2);
    expect(sim.tally.meals).toBe(1);
  });

  it('does not walk a hungry settler to a store with no food, and walks it there on its next think tick once food comes', () => {
    const sim = createSim(mapFrom(open(32)), { villagers: 1, monsters: 0, campFood: 0 });
    chopTrees(sim, 28, 4, 28, 4);
    standAt(sim, 0, 28, 6);
    sim.villagers.missedMeals[0] = 1;
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working, 100);
    for (let tick = 0; tick < 100; tick++) {
      step(sim);
      expect(sim.villagers.task[0]).toBe(GATHER);
    }
    expect(sim.gathering.progress[at(sim.map, 28, 4)]).toBe(50);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 1;
    runUntil(sim, () => sim.villagers.task[0] === EAT, 10);
    step(sim);
    expect(sim.villagers.state[0]).toBe(VillagerState.Walking);
    runUntil(sim, () => sim.tally.meals === 1, 400);
  });

  it('keeps a hungry settler at work while its house holds food behind water it cannot cross, and searches no route to it', () => {
    const rows = open(32).map((row, y) => Array.from(row, (c, x) => ((x === 22 && y <= 12) || (y === 12 && x >= 22) ? '~' : c)).join(''));
    const sim = createSim(mapFrom(rows), { villagers: 1, monsters: 0, campFood: 0 });
    const house = finished(sim, Building.House, 27, 5);
    expect(sim.households.home[sim.villagers.household[0]!]).toBe(house);
    sim.stores.held[Good.Food - 1]![house] = 2;
    chopTrees(sim, 8, 20, 8, 20);
    standAt(sim, 0, 8, 22);
    sim.villagers.missedMeals[0] = 1;
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working, 100);
    const searches = sim.pathSearch.searches;
    for (let tick = 0; tick < 100; tick++) {
      step(sim);
      expect(sim.villagers.task[0]).toBe(GATHER);
    }
    expect([sim.gathering.progress[at(sim.map, 8, 20)], sim.pathSearch.searches - searches, sim.tally.meals]).toEqual([50, 0, 0]);
  });

  it('keeps the dawn meal: a settler that came home hungry eats at dawn when food came in the night, and not again before dusk', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 1, monsters: 0, campFood: 0 });
    untilDusk(sim);
    runUntil(sim, () => isDawn(sim.tick), TICKS_PER_DAY);
    expect(sim.villagers.missedMeals[0]).toBe(1);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 2;
    step(sim);
    expect([sim.tally.meals, sim.villagers.missedMeals[0]]).toEqual([1, 0]);
    untilDusk(sim, () => expect(sim.villagers.task[0]).not.toBe(EAT));
    expect([sim.tally.meals, sim.stores.held[Good.Food - 1]![CAMP_STORE]]).toEqual([1, 1]);
  });

  it('turns to its new house when its household gains one on the walk to the camp, and leaves the camp its unit', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 1, monsters: 0 });
    standAt(sim, 0, 36, 36);
    sim.villagers.missedMeals[0] = 1;
    const camp = sim.stores.held[Good.Food - 1]![CAMP_STORE]!;
    runUntil(sim, () => sim.villagers.task[0] === EAT, 20);
    expect(sim.villagers.taskTile[0]).toBe(sim.flow.goal);
    step(sim);
    const house = finished(sim, Building.House, 30, 30);
    sim.stores.held[Good.Food - 1]![house] = 2;
    runUntil(sim, () => sim.tally.meals === 1, 600);
    expect([sim.stores.held[Good.Food - 1]![house], sim.stores.held[Good.Food - 1]![CAMP_STORE], sim.stores.outbound[Good.Food - 1]![CAMP_STORE]]).toEqual([1, camp, 0]);
  });

  it('eats from a house that holds food before it stocks the house', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 1, monsters: 0 });
    const house = finished(sim, Building.House, 4, 4);
    sim.stores.held[Good.Food - 1]![house] = 1;
    sim.villagers.missedMeals[0] = 1;
    runUntil(sim, () => sim.villagers.task[0] !== NO_TASK, 20);
    expect(sim.villagers.task[0]).toBe(EAT);
    runUntil(sim, () => sim.tally.meals === 1, 400);
    runUntil(sim, () => sim.villagers.task[0] !== NO_TASK, 20);
    expect(sim.villagers.task[0]).toBe(STOCK);
  });
});
