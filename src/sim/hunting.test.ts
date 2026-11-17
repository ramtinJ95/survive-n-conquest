import { describe, expect, it } from 'vitest';
import { ANIMALS, AnimalKind, AnimalState, addAnimal } from './animals';
import { finishBuilding } from './building';
import { Building, Job } from './buildings';
import { TICKS_PER_DAY, tickOfDay } from './calendar';
import { isNight } from './daylight';
import { Good } from './goods';
import { AIM_TICKS, FETCHING_KILL, HUNTING, shotHits } from './hunting';
import { jobOf } from './jobs';
import { generateMap } from './mapgen';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_STORE } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { NO_TASK, VillagerState } from './villagerState';

const HUNT = TASK_KINDS.indexOf(HUNTING) + 1;
const FETCH = TASK_KINDS.indexOf(FETCHING_KILL) + 1;

/** An open map of 38 by 38 tiles, too small for a deer of its own, with its camp at (18, 18). */
const openMap = () => mapFrom(Array.from({ length: 38 }, () => '.'.repeat(38)));

/** A simulation of `villagers` settlers on `openMap` with a lodge at (4, 4), finished at once, and `places` of its places filled. */
function lodge(villagers: number, places = 2): { sim: Sim; slot: number } {
  const sim = createSim(openMap(), { villagers, monsters: 0 });
  expect(sim.animals.living[AnimalKind.Deer]).toBe(0);
  expect(applyCommand(sim, { kind: 'place', building: Building.Lodge, x: 4, y: 4 })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, 4, 4)]!;
  finishBuilding(sim, slot);
  if (places < 2) applyCommand(sim, { kind: 'setPlaces', slot, places });
  return { sim, slot };
}

/** A deer at (x, y) that grazes where it stands until something frightens it. */
function deerAt(sim: Sim, x: number, y: number): number {
  const deer = addAnimal(sim.animals, AnimalKind.Deer, x, y);
  sim.animals.until[deer] = 1_000_000;
  return deer;
}

/** The first shot, from now, that hits or misses as asked. */
function setShot(sim: Sim, hit: boolean): void {
  while (shotHits(sim.seed, sim.animals.shots) !== hit) sim.animals.shots++;
}

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

function foodOnGround(sim: Sim): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Food) units += sim.map.stackSize[tile]!;
  return units;
}

const distance = (sim: Sim, id: number, deer: number) => Math.hypot(sim.animals.x[deer]! - sim.villagers.x[id]!, sim.animals.y[deer]! - sim.villagers.y[id]!);

/** Runs a hunt by villager 0 from its claim to its shot and returns when it began to aim and how many ticks it aimed. */
function huntUntilShot(sim: Sim, deer: number): { aimFrom: number; aimTicks: number } {
  runUntil(sim, () => sim.villagers.task[0] === HUNT, 20);
  expect([sim.animals.hunter[deer], sim.hunting.prey[0]]).toEqual([0, deer]);
  runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working, 400, () => {
    if (sim.villagers.state[0] === VillagerState.Walking) expect(sim.villagers.task[0]).toBe(HUNT);
  });
  const aimFrom = distance(sim, 0, deer);
  const firstAim = sim.tick - 1;
  runUntil(sim, () => sim.villagers.task[0] !== HUNT, 200);
  return { aimFrom, aimTicks: sim.tick - firstAim };
}

describe('a hunter', () => {
  it("takes a place at a finished hunter's lodge as a settler without a job does at a hut", () => {
    const { sim, slot } = lodge(3);
    expect(Array.from(sim.villagers.workplace).filter((place) => place === slot).length).toBe(2);
    expect([0, 1, 2].map((id) => jobOf(sim, id)).filter((job) => job === Job.Hunter).length).toBe(2);
  });

  it('stalks the nearest deer, aims for 4 seconds from 10 tiles, and a hit leaves the 6 food of the deer on its tile', () => {
    const { sim } = lodge(1);
    const deer = deerAt(sim, 30.5, 30.5);
    setShot(sim, true);
    const { aimFrom, aimTicks } = huntUntilShot(sim, deer);
    expect(aimFrom).toBeLessThanOrEqual(10);
    expect(aimFrom).toBeGreaterThan(9);
    expect(aimTicks).toBe(AIM_TICKS);
    expect(sim.animals.state[deer]).toBe(AnimalState.Gone);
    expect(sim.animals.living[AnimalKind.Deer]).toBe(0);
    expect(sim.map.stackGood[at(sim.map, 30, 30)]).toBe(Good.Food);
    expect(sim.map.stackSize[at(sim.map, 30, 30)]).toBe(ANIMALS[AnimalKind.Deer].food);
    expect(sim.hunting.kill[0]).toBe(at(sim.map, 30, 30));
    expect([sim.tally.shots, sim.tally.kills, sim.tally.hunted]).toEqual([1, 1, 6]);
  });

  it('aims from where it stands when a deer within 10 tiles is farther than 10 from the middle of its tile', () => {
    const { sim } = lodge(1);
    sim.villagers.x[0] = sim.villagers.targetX[0] = 20.9;
    sim.villagers.y[0] = sim.villagers.targetY[0] = 20.5;
    const deer = deerAt(sim, 30.8, 20.5);
    const { aimFrom } = huntUntilShot(sim, deer);
    expect(aimFrom).toBeLessThanOrEqual(10);
  });

  it('starts no aim, when hungry, at a deer that walked past 10 tiles after it stopped to aim', () => {
    const { sim } = lodge(1);
    sim.villagers.missedMeals[0] = 1;
    sim.villagers.x[0] = sim.villagers.targetX[0] = 10.5;
    sim.villagers.y[0] = sim.villagers.targetY[0] = 20.5;
    const deer = deerAt(sim, 22.5, 20.5);
    sim.animals.state[deer] = AnimalState.Walking;
    sim.animals.targetX[deer] = 37.5;
    sim.animals.targetY[deer] = 20.5;
    let seen = distance(sim, 0, deer);
    runUntil(
      sim,
      () => sim.hunting.aimed[0]! > 0,
      400,
      () => {
        if (sim.hunting.aimed[0] === 0) seen = distance(sim, 0, deer);
      },
    );
    expect(sim.villagers.task[0]).toBe(HUNT);
    expect(seen).toBeLessThanOrEqual(10);
  });

  it('sends the deer running from it with a miss, and stalks it again', () => {
    const { sim } = lodge(1);
    const deer = deerAt(sim, 30.5, 30.5);
    setShot(sim, false);
    huntUntilShot(sim, deer);
    expect(sim.animals.state[deer]).toBe(AnimalState.Fleeing);
    expect(sim.animals.hunter[deer]).toBe(-1);
    const away = [sim.animals.x[deer]! - sim.villagers.x[0]!, sim.animals.y[deer]! - sim.villagers.y[0]!];
    expect(sim.animals.fleeX[deer]! * away[0]! + sim.animals.fleeY[deer]! * away[1]!).toBeGreaterThan(0);
    expect([sim.tally.shots, sim.tally.kills, foodOnGround(sim)]).toEqual([1, 0, 0]);
    runUntil(sim, () => sim.villagers.task[0] === HUNT, 20);
    expect(sim.hunting.prey[0]).toBe(deer);
  });

  it('takes no shot at a deer that went farther than 12 tiles while it aimed', () => {
    const { sim } = lodge(1);
    const deer = deerAt(sim, 30.5, 30.5);
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working, 400);
    sim.animals.x[deer] = sim.villagers.x[0]! + 12.5;
    runUntil(sim, () => sim.villagers.task[0] !== HUNT, 200);
    expect(sim.tally.shots).toBe(0);
    expect(sim.animals.state[deer]).toBe(AnimalState.Grazing);
  });

  it('aims for 8 seconds when hungry, and stalks at full speed', () => {
    const fed = lodge(1);
    const hungry = lodge(1);
    hungry.sim.villagers.missedMeals[0] = 1;
    const fedHunt = huntUntilShot(fed.sim, deerAt(fed.sim, 30.5, 30.5));
    const hungryHunt = huntUntilShot(hungry.sim, deerAt(hungry.sim, 30.5, 30.5));
    expect(hungryHunt.aimFrom).toBe(fedHunt.aimFrom);
    expect(fedHunt.aimTicks).toBe(AIM_TICKS);
    expect(hungryHunt.aimTicks).toBeGreaterThanOrEqual(2 * AIM_TICKS - 2);
    expect(hungryHunt.aimTicks).toBeLessThanOrEqual(2 * AIM_TICKS);
  });

  it('never follows a deer that another hunter follows', () => {
    const { sim } = lodge(2);
    const first = deerAt(sim, 30.5, 30.5);
    runUntil(sim, () => sim.villagers.task[0] === HUNT || sim.villagers.task[1] === HUNT, 20);
    for (let tick = 0; tick < 20; tick++) step(sim);
    expect([sim.villagers.task[0], sim.villagers.task[1]].filter((task) => task === HUNT).length).toBe(1);
    const second = deerAt(sim, 6.5, 30.5);
    runUntil(sim, () => sim.villagers.task[0] === HUNT && sim.villagers.task[1] === HUNT, 20);
    expect(new Set([sim.hunting.prey[0], sim.hunting.prey[1]])).toEqual(new Set([first, second]));
    for (let tick = 0; tick < 100; tick++) {
      step(sim);
      if (sim.hunting.prey[0]! >= 0 && sim.hunting.prey[1]! >= 0) expect(sim.hunting.prey[0]).not.toBe(sim.hunting.prey[1]);
    }
  });

  it('gives its deer up at dusk and goes to the camp, and the deer is free for the next day', () => {
    const { sim } = lodge(1);
    runUntil(sim, () => tickOfDay(sim.tick) === TICKS_PER_DAY - 600 - 60, TICKS_PER_DAY);
    const deer = deerAt(sim, 5.5, 36.5);
    runUntil(sim, () => sim.villagers.task[0] === HUNT, 20);
    runUntil(sim, () => isNight(sim.tick), 100, () => expect(sim.villagers.state[0]).toBe(VillagerState.Walking));
    step(sim);
    expect(sim.villagers.task[0]).toBe(NO_TASK);
    expect(sim.villagers.state[0]).toBe(VillagerState.GoingToCamp);
    expect([sim.hunting.prey[0], sim.animals.hunter[deer]]).toEqual([-1, -1]);
    expect(sim.animals.state[deer]).not.toBe(AnimalState.Gone);
  });

  it('waits while no store has room, and hunts once one has', () => {
    const { sim } = lodge(1);
    deerAt(sim, 30.5, 30.5);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = sim.stores.campLimit;
    for (let tick = 0; tick < 50; tick++) step(sim);
    expect(sim.villagers.task[0]).toBe(NO_TASK);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = sim.stores.campLimit - 1;
    runUntil(sim, () => sim.villagers.task[0] === HUNT, 20);
  });

  it('hunts no deer beyond 40 tiles of its lodge', () => {
    const { sim } = lodge(1);
    const deer = deerAt(sim, 36.5, 36.5);
    for (let tick = 0; tick < 50; tick++) step(sim);
    expect(sim.villagers.task[0]).toBe(NO_TASK);
    sim.animals.x[deer] = 30.5;
    sim.animals.y[deer] = 30.5;
    runUntil(sim, () => sim.villagers.task[0] === HUNT, 20);
  });

  it('carries its kill to the camp 1 unit at a time, and a settler without a job helps', () => {
    const { sim, slot } = lodge(2, 1);
    const hunter = sim.villagers.workplace[0] === slot ? 0 : 1;
    const settler = 1 - hunter;
    const deer = deerAt(sim, 30.5, 30.5);
    setShot(sim, true);
    runUntil(sim, () => sim.animals.state[deer] === AnimalState.Gone, 600);
    const campBefore = sim.stores.held[Good.Food - 1]![CAMP_STORE]!;
    let pickups = 0;
    let held = Good.None as number;
    runUntil(sim, () => foodOnGround(sim) === 0 && sim.villagers.carried[hunter] === Good.None && sim.villagers.carried[settler] === Good.None, 1000, () => {
      if (held === Good.None && sim.villagers.carried[hunter] === Good.Food) {
        pickups++;
        expect(sim.villagers.task[hunter]).toBe(FETCH);
      }
      held = sim.villagers.carried[hunter]!;
    });
    expect(sim.stores.held[Good.Food - 1]![CAMP_STORE]! - campBefore).toBe(6);
    expect(sim.tally.huntedIn).toBe(pickups);
    expect(sim.tally.huntedIn + sim.tally.fromGround).toBe(6);
    expect(sim.tally.huntedIn).toBeGreaterThan(0);
    expect(sim.tally.fromGround).toBeGreaterThan(0);
    runUntil(sim, () => sim.hunting.kill[hunter] === -1, 20);
  });

  it('carries in every unit of a kill that spilled far, as from a deer killed inside a stockpile', () => {
    const { sim } = lodge(1);
    expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 22, y0: 22, x1: 26, y1: 26 } })).toMatchObject({ ok: true });
    const deer = deerAt(sim, 24.5, 24.5);
    setShot(sim, true);
    runUntil(sim, () => sim.animals.state[deer] === AnimalState.Gone, 600);
    expect(foodOnGround(sim)).toBe(6);
    const campBefore = sim.stores.held[Good.Food - 1]![CAMP_STORE]!;
    runUntil(sim, () => sim.hunting.kill[0] === -1, 1000);
    expect([foodOnGround(sim), sim.villagers.carried[0], sim.tally.huntedIn]).toEqual([0, Good.None, 6]);
    expect(sim.stores.held[Good.Food - 1]![CAMP_STORE]! - campBefore).toBe(6);
  });

  it('shoots the same deer at the same ticks from the same seed and commands', () => {
    const play = () => {
      const sim = createSim(generateMap(7), SETTLERS);
      expect(applyCommand(sim, { kind: 'place', building: Building.Lodge, x: 124, y: 124 })).toMatchObject({ ok: true });
      finishBuilding(sim, sim.orders.siteOf[at(sim.map, 124, 124)]!);
      const shots: number[] = [];
      for (let tick = 0; tick < TICKS_PER_DAY; tick++) {
        const before = sim.tally.shots;
        step(sim);
        if (sim.tally.shots > before) shots.push(sim.tick);
      }
      return { shots, tally: sim.tally, x: Array.from(sim.animals.x), state: Array.from(sim.animals.state) };
    };
    const first = play();
    expect(first.shots.length).toBeGreaterThan(2);
    expect(first.tally.kills).toBeGreaterThan(0);
    expect(play()).toEqual(first);
  });
});
