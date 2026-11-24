import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building, Job } from './buildings';
import { TICKS_PER_DAY, dateAt } from './calendar';
import { EATING } from './eating';
import { isDawn, isNight } from './daylight';
import { GATHERING } from './gathering';
import { Good, putDown } from './goods';
import { jobOf } from './jobs';
import { type Sim, applyCommand, createSim, step } from './sim';
import { STOCKING } from './stocking';
import { CAMP_STORE, TAILOR_CLOTHING_LIMIT } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { NO_TASK, THINK_GROUPS, VillagerState } from './villagerState';
import { VILLAGER_STEP, die } from './villagers';
import { WEARING } from './wearing';
import { Stop, WORKSHOP } from './workshops';

const WEAR = TASK_KINDS.indexOf(WEARING) + 1;
const EAT = TASK_KINDS.indexOf(EATING) + 1;
const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
const GATHER = TASK_KINDS.indexOf(GATHERING) + 1;
const WORK = TASK_KINDS.indexOf(WORKSHOP) + 1;
const CLOTHING = Good.Clothing - 1;
const FIREWOOD = Good.Firewood - 1;
const YEAR = TICKS_PER_DAY * 14;

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

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

/** A finished tailor's hut on (x, y) with no tailor, holding `pieces` pieces of clothing. */
function hutWith(sim: Sim, x: number, y: number, pieces: number): number {
  const hut = finished(sim, Building.Tailor, x, y);
  applyCommand(sim, { kind: 'setPlaces', slot: hut, places: 0 });
  sim.stores.held[CLOTHING]![hut] = pieces;
  return hut;
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

/** The kinds of task the villager took, in the order it took them, each once in a row. */
function tasksTaken(sim: Sim, id: number, ticks: number): number[] {
  const taken: number[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    step(sim);
    const task = sim.villagers.task[id]!;
    if (task !== NO_TASK && taken.at(-1) !== task) taken.push(task);
  }
  return taken;
}

const pieces = (sim: Sim, hut: number) => sim.stores.held[CLOTHING]![hut]!;
const wearing = (sim: Sim) => Array.from(sim.villagers.worn.subarray(0, sim.villagers.count), (good) => good === Good.Clothing);
const clothingOnGround = (sim: Sim) => {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Clothing) units += sim.map.stackSize[tile]!;
  return units;
};
/** Whether tile (tx, ty) shares a side with one of the 2 by 2 tiles of the hut anchored on (x, y). */
const besideHut = (tx: number, ty: number, x: number, y: number) =>
  (tx >= x && tx <= x + 1 && (ty === y - 1 || ty === y + 2)) || (ty >= y && ty <= y + 1 && (tx === x - 1 || tx === x + 2));

describe('fetching clothing', () => {
  it("walks to the door of the nearest tailor's hut with a piece, carrying nothing, and puts the piece on there", () => {
    const sim = createSim(mapFrom(open(48)), { villagers: 1, monsters: 0, animals: false });
    const far = hutWith(sim, 4, 24, 2);
    const near = hutWith(sim, 34, 24, 2);
    standAt(sim, 0, 28, 24);
    const carried = new Set<number>();
    let door = { x: -1, y: -1 };
    runUntil(sim, () => sim.villagers.worn[0] === Good.Clothing, 600, () => {
      carried.add(sim.villagers.carried[0]!);
      if (sim.villagers.task[0] === WEAR) door = { x: Math.floor(sim.villagers.x[0]!), y: Math.floor(sim.villagers.y[0]!) };
    });
    expect(besideHut(door.x, door.y, 34, 24), `put on at (${door.x}, ${door.y})`).toBe(true);
    expect([...carried]).toEqual([Good.None]);
    expect([pieces(sim, near), pieces(sim, far), sim.stores.outbound[CLOTHING]![near], sim.tally.dressed]).toEqual([1, 2, 0, 1]);
    expect(sim.villagers.task[0]).toBe(NO_TASK);
    runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 2, TICKS_PER_DAY, () => expect(sim.villagers.task[0]).not.toBe(WEAR));
    expect(pieces(sim, near)).toBe(1);
  });

  it('comes after a missed meal and before every other kind of work', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 1, monsters: 0, animals: false });
    hutWith(sim, 30, 20, 1);
    chopTrees(sim, 10, 10, 10, 10);
    sim.villagers.missedMeals[0] = 1;
    expect(tasksTaken(sim, 0, 600)).toEqual([EAT, WEAR, GATHER]);
  });

  it("comes after stocking the home with food and firewood, and before every other kind of work, for a settler with a job too", () => {
    const sim = createSim(mapFrom(open(48)), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    finished(sim, Building.House, 14, 14);
    const shed = finished(sim, Building.Woodshed, 18, 14);
    sim.stores.held[FIREWOOD]![shed] = 20;
    applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 22, y0: 14, x1: 22, y1: 14 } });
    expect(putDown(sim, at(sim.map, 22, 14), Good.Log, 2)).toBe(true);
    hutWith(sim, 30, 14, 1);
    expect(jobOf(sim, 0)).toBe(Job.Woodcutter);
    const taken = tasksTaken(sim, 0, TICKS_PER_DAY / 3);
    expect(taken.slice(0, 3)).toEqual([STOCK, WEAR, WORK]);
    expect(sim.tally.carriedHome + sim.tally.firewoodHome).toBe(3 + 6);
    expect(wearing(sim)).toEqual([true]);
  });

  it('has a tailor put on a piece from its own hut before it works the next batch', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 1, monsters: 0, animals: false });
    const hut = finished(sim, Building.Tailor, 30, 20);
    expect(jobOf(sim, 0)).toBe(Job.Tailor);
    sim.stores.held[CLOTHING]![hut] = 1;
    sim.workshops.input[hut] = 2;
    expect(tasksTaken(sim, 0, 600).slice(0, 2)).toEqual([WEAR, WORK]);
    expect(pieces(sim, hut)).toBe(0);
  });

  it('sends one settler for one piece: the first to look for work after the piece lands speaks for it, and the other keeps working', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 3, monsters: 0, animals: false });
    sim.villagers.worn.fill(Good.Clothing);
    chopTrees(sim, 8, 8, 12, 12);
    const hut = hutWith(sim, 30, 20, 0);
    runUntil(sim, () => sim.villagers.state.subarray(0, sim.villagers.count).every((state) => state === VillagerState.Working), 600);
    sim.villagers.worn[1] = Good.None;
    sim.villagers.worn[2] = Good.None;
    runUntil(sim, () => sim.tick % THINK_GROUPS === 0, THINK_GROUPS);
    sim.stores.held[CLOTHING]![hut] = 1;
    const walkers = new Set<number>();
    runUntil(sim, () => sim.tally.dressed === 1, 1200, () => {
      const going = Array.from(sim.villagers.task.subarray(0, sim.villagers.count), (task, id) => (task === WEAR ? id : -1)).filter((id) => id >= 0);
      expect(going.length, `tick ${sim.tick}`).toBeLessThanOrEqual(1);
      for (const id of going) walkers.add(id);
    });
    expect([...walkers]).toHaveLength(1);
    const other = [...walkers][0] === 1 ? 2 : 1;
    expect(wearing(sim)[other]).toBe(false);
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect(sim.villagers.task[other]).toBe(GATHER);
    expect(pieces(sim, hut)).toBe(0);
  });

  it('gives up a walk whose piece is gone and takes other work at its next look, without standing still', () => {
    const sim = createSim(mapFrom(open(48)), { villagers: 1, monsters: 0, animals: false });
    chopTrees(sim, 10, 10, 10, 10);
    const hut = hutWith(sim, 40, 24, 1);
    runUntil(sim, () => sim.villagers.task[0] === WEAR, 20);
    step(sim);
    sim.stores.held[CLOTHING]![hut] = 0;
    step(sim);
    expect([sim.villagers.task[0], sim.stores.outbound[CLOTHING]![hut]]).toEqual([NO_TASK, 0]);
    runUntil(sim, () => sim.villagers.task[0] === GATHER, THINK_GROUPS + 1);
    expect(wearing(sim)).toEqual([false]);
  });

  it("searches no route for a settler cut off from every tailor's hut, and keeps it at its work", () => {
    const rows = open(32).map((row, y) => Array.from(row, (c, x) => ((x === 22 && y <= 12) || (y === 12 && x >= 22) ? '~' : c)).join(''));
    const sim = createSim(mapFrom(rows), { villagers: 1, monsters: 0, animals: false });
    hutWith(sim, 26, 4, 2);
    let searches = sim.pathSearch.searches;
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect([sim.pathSearch.searches - searches, sim.villagers.task[0], wearing(sim)[0]]).toEqual([0, NO_TASK, false]);

    chopTrees(sim, 8, 20, 8, 20);
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working, 200);
    searches = sim.pathSearch.searches;
    for (let tick = 0; tick < 100; tick++) {
      step(sim);
      expect(sim.villagers.task[0]).toBe(GATHER);
    }
    expect(sim.pathSearch.searches - searches).toBe(0);
  });

  it('searches no route from land that no walk joins to the camp', () => {
    const rows = open(40);
    for (let y = 1; y <= 5; y++) rows[y] = '.~~~~~' + '.'.repeat(34);
    rows[2] = '.~..~~' + '.'.repeat(34);
    rows[3] = '.~..~~' + '.'.repeat(34);
    const sim = createSim(mapFrom(rows), { villagers: 1, monsters: 0, animals: false });
    hutWith(sim, 26, 20, 2);
    standAt(sim, 0, 2, 2);
    const searches = sim.pathSearch.searches;
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect([sim.pathSearch.searches - searches, wearing(sim)[0]]).toEqual([0, false]);
  });

  it('starts the tailor of a full hut again once a settler takes a piece', () => {
    const sim = createSim(mapFrom(open(48)), { villagers: 2, monsters: 0, animals: false });
    applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 34, y0: 30, x1: 34, y1: 30 } });
    expect(putDown(sim, at(sim.map, 34, 30), Good.Hide, 4)).toBe(true);
    const hut = finished(sim, Building.Tailor, 30, 26);
    const tailor = sim.villagers.workplace.indexOf(hut);
    const other = 1 - tailor;
    sim.villagers.worn[tailor] = Good.Clothing;
    sim.villagers.worn[other] = Good.Clothing;
    sim.stores.held[CLOTHING]![hut] = TAILOR_CLOTHING_LIMIT;
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect([sim.workshops.stopped[hut], sim.tally.made]).toEqual([Stop.Full, 0]);
    sim.villagers.worn[other] = Good.None;
    runUntil(sim, () => sim.tally.dressed === 1, 600);
    expect(pieces(sim, hut)).toBe(TAILOR_CLOTHING_LIMIT - 1);
    runUntil(sim, () => sim.tally.made === 1, TICKS_PER_DAY / 3);
    expect(pieces(sim, hut)).toBe(TAILOR_CLOTHING_LIMIT);
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect(sim.workshops.stopped[hut]).toBe(Stop.Full);
  });

  it('gives up its walk at dusk and goes for the piece again on the next morning, before its work', () => {
    const sim = createSim(mapFrom(open(64)), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    const hut = hutWith(sim, 60, 32, 0);
    runUntil(sim, () => isNight(sim.tick + 100), TICKS_PER_DAY);
    sim.stores.held[CLOTHING]![hut] = 1;
    runUntil(sim, () => sim.villagers.task[0] === WEAR, THINK_GROUPS);
    runUntil(sim, () => isNight(sim.tick), 100, () => expect(sim.villagers.task[0]).toBe(WEAR));
    step(sim);
    expect([sim.villagers.task[0], sim.villagers.state[0], sim.stores.outbound[CLOTHING]![hut], wearing(sim)[0]]).toEqual([NO_TASK, VillagerState.GoingToCamp, 0, false]);
    runUntil(sim, () => isDawn(sim.tick), TICKS_PER_DAY);
    chopTrees(sim, 30, 40, 30, 40);
    expect(tasksTaken(sim, 0, 1200).slice(0, 2)).toEqual([WEAR, GATHER]);
    expect([wearing(sim)[0], pieces(sim, hut)]).toEqual([true, 0]);
  });

  it('walks at full speed to the hut while cold and hungry', () => {
    const sim = createSim(mapFrom(open(48)), { villagers: 1, monsters: 0, animals: false });
    hutWith(sim, 40, 24, 1);
    sim.villagers.coldNights[0] = 2;
    sim.villagers.missedMeals[0] = 1;
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 0;
    runUntil(sim, () => sim.villagers.task[0] === WEAR && sim.villagers.state[0] === VillagerState.Walking, 40);
    const x = sim.villagers.x[0]!;
    const y = sim.villagers.y[0]!;
    step(sim);
    expect(Math.hypot(sim.villagers.x[0]! - x, sim.villagers.y[0]! - y)).toBeCloseTo(VILLAGER_STEP, 5);
  });

  it('is gone with the settler that wears it when it dies, back to no hut and onto no tile', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 2, monsters: 0, animals: false });
    const hut = hutWith(sim, 30, 20, 1);
    runUntil(sim, () => sim.tally.dressed === 1, 600);
    const wearer = sim.villagers.worn.indexOf(Good.Clothing);
    die(sim, wearer);
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect([pieces(sim, hut), clothingOnGround(sim), sim.tally.dressed]).toEqual([0, 0, 1]);
  });
});

/** Runs to the last tick of the night that falls at the dusk of `day`, so every villager has come home or never will, and the dawn has not run. */
const lateNightOf = (sim: Sim, day: number) => runUntil(sim, () => isDawn(sim.tick) && dateAt(sim.tick).day === day + 1, YEAR);

describe('warmth with clothing on a winter night, two of three', () => {
  /** Two settlers of one household, the first clothed and the second not, who sleep in a house or at the camp holding `wood` firewood, or never get home. Returns who is warm. */
  function night(where: 'house' | 'camp' | 'away', wood: number): boolean[] {
    const rows = open(40);
    for (let y = 1; y <= 5; y++) rows[y] = '.~~~~~' + '.'.repeat(34);
    rows[2] = '.~..~~' + '.'.repeat(34);
    rows[3] = '.~..~~' + '.'.repeat(34);
    const sim = createSim(mapFrom(rows), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    if (where === 'house') sim.stores.held[FIREWOOD]![finished(sim, Building.House, 14, 14)] = wood;
    else sim.stores.held[FIREWOOD]![CAMP_STORE] = wood;
    sim.villagers.worn[0] = Good.Clothing;
    runUntil(sim, () => dateAt(sim.tick).day === 10 && isNight(sim.tick), YEAR);
    if (where === 'away') for (const id of [0, 1]) standAt(sim, id, 2, 2);
    lateNightOf(sim, 10);
    step(sim);
    return Array.from(sim.villagers.coldNights.subarray(0, sim.villagers.count), (nights) => nights === 0);
  }

  it.each([
    ['in a house with a fire, clothed or not', 'house', 2, [true, true]],
    ['in a house without a fire, only clothed', 'house', 0, [true, false]],
    ["at the camp with the camp's fire, only clothed", 'camp', 4, [true, false]],
    ["at the camp without the camp's fire, clothed or not", 'camp', 3, [false, false]],
    ['never at home, clothed or not', 'away', 0, [false, false]],
  ] as const)('is warm %s', (_name, where, wood, warm) => {
    expect(night(where, wood)).toEqual(warm);
  });
});
