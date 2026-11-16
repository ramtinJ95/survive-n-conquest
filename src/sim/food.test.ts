import { describe, expect, it } from 'vitest';
import { BUILDING, finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY, dateAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { GATHERING } from './gathering';
import { Good, putDown } from './goods';
import { NO_HOME } from './households';
import { generateMap } from './mapgen';
import { type Sex, nameOf } from './names';
import { SETTLERS, type Sim, applyCommand, createSim, populationFor, step, ticksPerSecond } from './sim';
import { STOCKING } from './stocking';
import { CAMP_FOOD, CAMP_STORE } from './stores';
import { NO_TASK, TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { VillagerState, die } from './villagers';

const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
const GATHER = TASK_KINDS.indexOf(GATHERING) + 1;
const BUILD = TASK_KINDS.indexOf(BUILDING) + 1;

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/** Runs through the next tick of the turn of the light, the first of a night or of a day. */
function through(sim: Sim, turn: (tick: number) => boolean): void {
  step(sim);
  runUntil(sim, () => turn(sim.tick - 1), TICKS_PER_DAY);
}
const dusk = (sim: Sim) => through(sim, (tick) => isNight(tick) && !isNight(tick - 1));
const dawn = (sim: Sim) => through(sim, isDawn);
/** Runs to the last tick of the night, so every villager has come home or never will. */
const lateNight = (sim: Sim) => runUntil(sim, () => isDawn(sim.tick), TICKS_PER_DAY);
const missed = (sim: Sim) => Array.from(sim.villagers.missedMeals);
const states = (sim: Sim) => Array.from(sim.villagers.state);
const campFood = (sim: Sim) => sim.stores.food[CAMP_STORE]!;

/** Units of food on the map's tiles. */
function foodOnGround(sim: Sim): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Food) units += sim.map.stackSize[tile]!;
  return units;
}

/** A house finished at (x, y) at once, the home of the next household without one. Returns its slot. */
function finishedHouse(sim: Sim, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: Building.House, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

describe('food on open ground', () => {
  it('lies through the first dawn after it was put down and is gone at the second', () => {
    const sim = createSim(mapFrom(open(20)), { villagers: 0, monsters: 0 });
    dusk(sim);
    expect(putDown(sim, at(sim.map, 3, 3), Good.Food, 1)).toBe(true);
    dawn(sim);
    expect(sim.map.stackSize[at(sim.map, 3, 3)]).toBe(1);
    dawn(sim);
    expect(sim.map.stackSize[at(sim.map, 3, 3)]).toBe(0);
    expect(sim.map.stackGood[at(sim.map, 3, 3)]).toBe(Good.None);
  });

  it('is never put on a stockpile tile', () => {
    const sim = createSim(mapFrom(open(20)), { villagers: 0, monsters: 0 });
    applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 2, y0: 2, x1: 4, y1: 4 } });
    expect(putDown(sim, at(sim.map, 3, 3), Good.Food, 1)).toBe(true);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) expect(sim.map.stackSize[at(sim.map, x, y)], `${x}, ${y}`).toBe(0);
    expect(foodOnGround(sim)).toBe(1);
  });

  it('put down on two days lies in two stacks, each gone on its own day', () => {
    const sim = createSim(mapFrom(open(20)), { villagers: 0, monsters: 0 });
    const tile = at(sim.map, 10, 3);
    expect(putDown(sim, tile, Good.Food, 1)).toBe(true);
    dawn(sim);
    expect(putDown(sim, tile, Good.Food, 1)).toBe(true);
    expect(sim.map.stackSize[tile]).toBe(1);
    expect(foodOnGround(sim)).toBe(2);
    dawn(sim);
    expect([sim.map.stackSize[tile], foodOnGround(sim)]).toEqual([0, 1]);
    dawn(sim);
    expect(foodOnGround(sim)).toBe(0);
  });
});

describe('meals', () => {
  it('are taken from the camp as each settler reaches the camp center at dusk', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 4, monsters: 0 });
    dusk(sim);
    runUntil(sim, () => states(sim).every((state) => state === VillagerState.Settling), 600, () => {
      const settled = states(sim).filter((state) => state === VillagerState.Settling).length;
      expect(campFood(sim)).toBe(CAMP_FOOD - settled);
    });
    lateNight(sim);
    expect([campFood(sim), sim.tally.meals, sim.tally.missed]).toEqual([CAMP_FOOD - 4, 4, 0]);
    expect(missed(sim)).toEqual([0, 0, 0, 0]);
  });

  it('are missed at dusk when the store is empty, and taken at dawn when food came in the night, which clears the count', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 0 });
    dusk(sim);
    lateNight(sim);
    expect(missed(sim)).toEqual([1, 1]);
    sim.stores.food[CAMP_STORE] = 1;
    step(sim);
    expect(isDawn(sim.tick - 1)).toBe(true);
    expect(missed(sim)).toEqual([0, 1]);
    expect([campFood(sim), sim.tally.meals, sim.tally.missed]).toEqual([0, 1, 2]);
    dusk(sim);
    lateNight(sim);
    expect(missed(sim)).toEqual([1, 2]);
  });

  it('of a household with a home come from its house, not the camp', () => {
    const sim = createSim(mapFrom(open(32)), { villagers: 4, monsters: 0 });
    const slot = finishedHouse(sim, 6, 6);
    dusk(sim);
    const houseAtDusk = sim.stores.food[slot]!;
    const campAtDusk = campFood(sim);
    lateNight(sim);
    expect(states(sim)).toEqual([VillagerState.Inside, VillagerState.Inside, VillagerState.Settling, VillagerState.Settling]);
    expect(sim.stores.food[slot]).toBe(houseAtDusk - 2);
    expect(campFood(sim)).toBe(campAtDusk - 2);
    expect(missed(sim)).toEqual([0, 0, 0, 0]);
  });

  it('are taken at dawn before any settler sets out to stock its home with the same food', () => {
    const sim = createSim(mapFrom(open(32)), { villagers: 4, monsters: 0, campFood: 0 });
    const slot = finishedHouse(sim, 6, 6);
    dusk(sim);
    lateNight(sim);
    expect(missed(sim)).toEqual([1, 1, 1, 1]);
    sim.stores.food[CAMP_STORE] = 2;
    step(sim);
    expect(missed(sim)).toEqual([1, 1, 0, 0]);
    expect([campFood(sim), sim.stores.outbound[CAMP_STORE], sim.stores.inbound[slot]]).toEqual([0, 0, 0]);
  });

  it('of a settler that walks to the camp come from the camp, though its household gains a house in the night', () => {
    const sim = createSim(mapFrom(open(32)), { villagers: 4, monsters: 0 });
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    const slot = finishedHouse(sim, 6, 6);
    sim.villagers.missedMeals.fill(2, 0, 2);
    for (const id of [2, 3]) {
      sim.villagers.x[id] = 30.5;
      sim.villagers.y[id] = 30.5;
    }
    const campAtDusk = campFood(sim);
    lateNight(sim);
    expect(states(sim)).toEqual([VillagerState.Dead, VillagerState.Dead, VillagerState.Settling, VillagerState.Settling]);
    expect(Array.from(sim.households.home)).toEqual([NO_HOME, slot]);
    expect(missed(sim).slice(2)).toEqual([0, 0]);
    expect(campFood(sim)).toBe(campAtDusk - 2);
  });

  it('are missed by a settler with no walk to the camp, counted at dawn though the camp has food', () => {
    const rows = open(24);
    for (let y = 1; y <= 5; y++) rows[y] = '.~~~~~' + '.'.repeat(18);
    rows[2] = '.~..~~' + '.'.repeat(18);
    rows[3] = '.~..~~' + '.'.repeat(18);
    const sim = createSim(mapFrom(rows), { villagers: 2, monsters: 0 });
    dusk(sim);
    sim.villagers.x[1] = 2.5;
    sim.villagers.y[1] = 2.5;
    lateNight(sim);
    expect(states(sim)).toEqual([VillagerState.Settling, VillagerState.GoingToCamp]);
    expect(missed(sim)).toEqual([0, 0]);
    step(sim);
    expect(missed(sim)).toEqual([0, 1]);
    expect([campFood(sim), sim.tally.meals, sim.tally.missed]).toEqual([CAMP_FOOD - 1, 1, 1]);
  });
});

describe('hunger', () => {
  /** Ticks a lone settler takes to walk to a marked tree and to fell it, after `missedMeals` missed meals. */
  function fell(missedMeals: number): { walk: number; work: number } {
    const rows = open(24);
    rows[4] = '.'.repeat(20) + 'T...';
    const sim = createSim(mapFrom(rows), { villagers: 1, monsters: 0 });
    sim.villagers.missedMeals[0] = missedMeals;
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 20, y0: 4, x1: 20, y1: 4 } });
    runUntil(sim, () => sim.villagers.task[0] === GATHER, 20);
    const taken = sim.tick;
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working, 600);
    const working = sim.tick;
    runUntil(sim, () => sim.map.trees[at(sim.map, 20, 4)] === 0, 2000);
    return { walk: working - taken, work: sim.tick - working };
  }

  it('halves the rate a hungry settler works at after 1 or 2 missed meals, and leaves its walk as fast', () => {
    const fed = fell(0);
    for (const meals of [1, 2]) {
      const hungry = fell(meals);
      expect(hungry.walk, `${meals} missed`).toBe(fed.walk);
      expect(Math.abs(hungry.work - 2 * fed.work), `${meals} missed: ${hungry.work} ticks against ${fed.work}`).toBeLessThanOrEqual(2);
    }
  });

  it('halves the rate of building work too', () => {
    const build = (missedMeals: number) => {
      const map = mapFrom(open(24));
      for (const [x, y, good, size] of [[10, 6, Good.Log, 8], [10, 7, Good.Log, 4], [10, 8, Good.Stone, 6]] as const) {
        map.stackGood[at(map, x, y)] = good;
        map.stackSize[at(map, x, y)] = size;
      }
      const sim = createSim(map, { villagers: 1, monsters: 0 });
      expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 7, y: 7 })).toMatchObject({ ok: true });
      sim.villagers.missedMeals[0] = missedMeals;
      const slot = sim.orders.siteOf[at(sim.map, 7, 7)]!;
      runUntil(sim, () => sim.villagers.task[0] === BUILD && sim.villagers.state[0] === VillagerState.Working, 1300);
      const start = sim.orders.sites.work[slot]!;
      for (let tick = 0; tick < 100; tick++) step(sim);
      return sim.orders.sites.work[slot]! - start;
    };
    expect(build(0)).toBe(100);
    expect(build(1)).toBe(50);
  });

  it('kills a settler at its third missed meal in a row', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 1 });
    sim.villagers.missedMeals[1] = 2;
    dusk(sim);
    lateNight(sim);
    expect(states(sim)).toEqual([VillagerState.Settling, VillagerState.Dead]);
    expect(missed(sim)).toEqual([0, 3]);
    expect([sim.tally.died, sim.living, sim.over]).toEqual([1, 1, false]);
  });

  it('leaves a dead settler off the map: it holds no task, puts down what it carries, and never moves again', () => {
    const rows = open(24);
    rows[4] = '.'.repeat(20) + 'T...';
    const sim = createSim(mapFrom(rows), { villagers: 2, monsters: 0 });
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 20, y0: 4, x1: 20, y1: 4 } });
    runUntil(sim, () => sim.villagers.task.includes(GATHER), 20);
    const chopper = sim.villagers.task.indexOf(GATHER);
    sim.villagers.carried[chopper] = Good.Food;
    die(sim, chopper);
    expect([sim.villagers.task[chopper], sim.villagers.carried[chopper], sim.villagers.state[chopper]]).toEqual([NO_TASK, Good.None, VillagerState.Dead]);
    expect(foodOnGround(sim)).toBe(1);
    const where = [sim.villagers.x[chopper], sim.villagers.y[chopper]];
    runUntil(sim, () => sim.villagers.task[1 - chopper] === GATHER, 20);
    for (let tick = 0; tick < TICKS_PER_DAY * 2; tick++) step(sim);
    expect([sim.villagers.x[chopper], sim.villagers.y[chopper]]).toEqual(where);
    expect([sim.villagers.state[chopper], sim.villagers.task[chopper]]).toEqual([VillagerState.Dead, NO_TASK]);
  });
});

describe('stocking a home', () => {
  /** Two households on an open map, the first with a house far enough from the camp that a trip takes a while. */
  function housed(campFood?: number) {
    const sim = createSim(mapFrom(open(40)), { villagers: 4, monsters: 0, ...(campFood === undefined ? {} : { campFood }) });
    const slot = finishedHouse(sim, 4, 4);
    return { sim, slot };
  }

  it('comes before every other kind of work', () => {
    const { sim } = housed();
    for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) sim.map.trees[at(sim.map, x, y)] = 1;
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 30, y0: 30, x1: 33, y1: 33 } });
    runUntil(sim, () => sim.villagers.task[0] !== NO_TASK && sim.villagers.task[1] !== NO_TASK, 20);
    expect([sim.villagers.task[0], sim.villagers.task[1]]).toEqual([STOCK, STOCK]);
  });

  it('fills the house to three days for its members, counting units on their way, so no more set out than it lacks', () => {
    const { sim, slot } = housed(100);
    sim.stores.food[slot] = 5;
    let mostOut = 0;
    runUntil(
      sim,
      () => sim.stores.food[slot] === 6 && sim.stores.inbound[slot] === 0,
      1300,
      () => {
        const out = [0, 1].filter((id) => sim.villagers.task[id] === STOCK).length;
        mostOut = Math.max(mostOut, out);
        expect(sim.stores.food[slot]! + sim.stores.inbound[slot]!).toBeLessThanOrEqual(6);
      },
    );
    expect(mostOut).toBe(1);
    expect(campFood(sim)).toBe(99);
    for (let tick = 0; tick < 300; tick++) step(sim);
    expect(sim.stores.food[slot]).toBe(6);
    expect(sim.tally.carriedHome).toBe(1);
  });

  it('keeps three days for the living members only', () => {
    const { sim, slot } = housed(100);
    die(sim, 1);
    runUntil(sim, () => sim.stores.food[slot] === 3, 1300);
    for (let tick = 0; tick < 300; tick++) step(sim);
    expect([sim.stores.food[slot], sim.stores.inbound[slot], sim.stores.outbound[CAMP_STORE]]).toEqual([3, 0, 0]);
    expect(campFood(sim)).toBe(97);
  });

  it('drops the unit in hands at dusk, where it lies on open ground until the second dawn', () => {
    const { sim, slot } = housed();
    for (let tick = 0; tick < 1300; tick++) step(sim);
    expect([sim.stores.food[slot], sim.stores.inbound[slot]]).toEqual([6, 0]);
    sim.stores.food[slot] = 5;
    runUntil(sim, () => sim.villagers.carried[0] === Good.Food || sim.villagers.carried[1] === Good.Food, 100);
    const carrier = sim.villagers.carried[0] === Good.Food ? 0 : 1;
    const before = sim.stores.food[slot]!;
    runUntil(sim, () => isNight(sim.tick - 1) || sim.villagers.carried[carrier] === Good.None, TICKS_PER_DAY);
    expect(isNight(sim.tick - 1)).toBe(true);
    expect(foodOnGround(sim)).toBe(1);
    expect(sim.villagers.carried[carrier]).toBe(Good.None);
    expect([sim.stores.inbound[slot], sim.stores.outbound[CAMP_STORE]]).toEqual([0, 0]);
    expect(sim.stores.food[slot]).toBeLessThanOrEqual(before);
    dawn(sim);
    expect(foodOnGround(sim)).toBe(1);
    dawn(sim);
    expect(foodOnGround(sim)).toBe(0);
  });
});

describe('households and death', () => {
  it('give the house of a household whose last member died, with its food, to the next living household without a home', () => {
    const sim = createSim(mapFrom(open(32)), { villagers: 6, monsters: 0 });
    const slot = finishedHouse(sim, 6, 6);
    expect(Array.from(sim.households.home)).toEqual([slot, NO_HOME, NO_HOME]);
    sim.stores.food[slot] = 9;
    die(sim, 2);
    die(sim, 3);
    die(sim, 0);
    expect(Array.from(sim.households.home)).toEqual([slot, NO_HOME, NO_HOME]);
    die(sim, 1);
    expect(Array.from(sim.households.home)).toEqual([NO_HOME, NO_HOME, slot]);
    expect(sim.stores.food[slot]).toBe(9);
  });

  it('never give a house to a household with nobody left, not even its own house back', () => {
    const sim = createSim(mapFrom(open(32)), { villagers: 4, monsters: 0 });
    die(sim, 2);
    die(sim, 3);
    const slot = finishedHouse(sim, 6, 6);
    expect(Array.from(sim.households.home)).toEqual([slot, NO_HOME]);
    die(sim, 0);
    die(sim, 1);
    expect(Array.from(sim.households.home)).toEqual([NO_HOME, NO_HOME]);
  });
});

describe('the end of the settlement', () => {
  it('stops the clock at the last death, and the speed controls no longer start it', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 0 });
    sim.villagers.missedMeals.fill(2);
    dusk(sim);
    runUntil(sim, () => sim.over, 600);
    const tick = sim.tick;
    expect([sim.living, sim.tally.died]).toEqual([0, 2]);
    applyCommand(sim, { kind: 'setSpeed', speed: 8 });
    applyCommand(sim, { kind: 'togglePause' });
    for (let i = 0; i < 100; i++) step(sim);
    expect([sim.tick, ticksPerSecond(sim), sim.speed, sim.paused]).toEqual([tick, 0, 1, false]);
  });

  it('never comes to a game with nobody in it', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 0, monsters: 0, campFood: 0 });
    for (let i = 0; i < TICKS_PER_DAY * 4; i++) step(sim);
    expect([sim.over, sim.tick]).toEqual([false, TICKS_PER_DAY * 4]);
  });
});

/** Where each settler of a run died, as `day HH:MM`, in id order, and the tick the run ended at. */
function deaths(sim: Sim, limit: number): string[] {
  const at: string[] = Array(sim.villagers.state.length).fill('');
  runUntil(sim, () => sim.over, limit, () => {
    for (let id = 0; id < at.length; id++) {
      if (sim.villagers.state[id] !== VillagerState.Dead || at[id]) continue;
      const { day, minuteOfDay } = dateAt(sim.tick - 1);
      at[id] = `${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
    }
  });
  return at;
}

describe('seed 7 with no orders', () => {
  it('eats the 24 meals of the camp on days 1 to 3 and dies out at dusk on day 6', () => {
    const sim = createSim(generateMap(7), SETTLERS);
    const names = Array.from(sim.villagers.name, (name, id) => nameOf(sim.villagers.sex[id] as Sex, name));
    expect(names).toEqual(['Merek', 'Elsi', 'Ulvar', 'Ysa', 'Jorrin', 'Fenna', 'Dorran', 'Nella']);
    const died = deaths(sim, TICKS_PER_DAY * 7);
    expect(Object.fromEntries(names.map((name, id) => [name, died[id]]))).toEqual({
      Ysa: '6 20:24',
      Jorrin: '6 20:31',
      Elsi: '6 20:40',
      Dorran: '6 20:41',
      Fenna: '6 20:45',
      Nella: '6 20:48',
      Merek: '6 20:53',
      Ulvar: '6 20:54',
    });
    expect(sim.tally).toMatchObject({ meals: 24, missed: 24, died: 8 });
    expect([sim.over, sim.living, campFood(sim)]).toEqual([true, 0, 0]);
  });

  it('reaches the same state at every dawn until the last death from one seed and the same commands', () => {
    const play = () => {
      const sim = createSim(generateMap(7), SETTLERS);
      const { size } = sim.map;
      const cx = sim.camp % size;
      const cy = Math.floor(sim.camp / size);
      applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: cx - 14, y0: cy - 14, x1: cx + 14, y1: cy + 14 } });
      applyCommand(sim, { kind: 'markArea', order: 'quarry', area: { x0: cx - 24, y0: cy - 24, x1: cx + 24, y1: cy + 24 } });
      for (let r = 4; r < 12 && sim.orders.sites.used === 0; r++) applyCommand(sim, { kind: 'place', building: Building.House, x: cx + r, y: cy + r });
      const dawns: unknown[] = [];
      runUntil(sim, () => sim.over, TICKS_PER_DAY * 10, () => {
        if (!isDawn(sim.tick - 1)) return;
        dawns.push(structuredClone({ villagers: sim.villagers, stores: sim.stores, stackGood: sim.map.stackGood, stackSize: sim.map.stackSize, homes: sim.households }));
      });
      return { sim, dawns };
    };
    const first = play();
    const second = play();
    expect(first.sim.tally.built).toBeGreaterThan(0);
    expect(first.sim.tally.carriedHome).toBeGreaterThan(0);
    expect(first.dawns.length).toBeGreaterThanOrEqual(5);
    expect(second.dawns).toEqual(first.dawns);
    expect(second.sim.tick).toBe(first.sim.tick);
  });
});

describe('the food URL setting', () => {
  it('starts the camp with a whole number of food, and leaves junk at the default', () => {
    expect(populationFor(null, '400')).toMatchObject({ villagers: 8, campFood: 400 });
    expect(createSim(mapFrom(open(16)), populationFor(null, '400')).stores).toMatchObject({ campLimit: 400 });
    for (const junk of [null, '', '-3', '2.5', 'lots', '99999999']) expect(populationFor(null, junk).campFood, String(junk)).toBeUndefined();
    expect(createSim(mapFrom(open(16)), populationFor(null, 'lots')).stores.food[CAMP_STORE]).toBe(CAMP_FOOD);
  });
});
