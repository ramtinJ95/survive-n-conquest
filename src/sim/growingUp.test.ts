import { describe, expect, it } from 'vitest';
import { WORK_AGE, ageAt, startWork } from './aging';
import { BIRTH_CHANCE, BIRTH_GAP, birthDraw } from './births';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY, TICKS_PER_YEAR_OF_AGE, dateAt } from './calendar';
import { isDawn } from './daylight';
import { DAWN } from './dawn';
import { GATHERING } from './gathering';
import { Good } from './goods';
import { works } from './jobs';
import { Sex } from './names';
import { readinessOf } from './readiness';
import { type Population, type Sim, type StartingSettler, applyCommand, createSim, step } from './sim';
import { STOCKING } from './stocking';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { Cause, NO_TASK } from './villagerState';
import { die } from './villagers';
import { WEARING } from './wearing';

const FOOD = Good.Food - 1;
const CLOTHING = Good.Clothing - 1;
const GATHER = TASK_KINDS.indexOf(GATHERING) + 1;
const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
const WEAR = TASK_KINDS.indexOf(WEARING) + 1;
const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));
const man = (age: number, span?: number): StartingSettler => (span === undefined ? { sex: Sex.Man, age } : { sex: Sex.Man, age, span });
const woman = (age: number): StartingSettler => ({ sex: Sex.Woman, age });
const COUPLE = [man(30), woman(28)];

/** The first seed whose draw for household 0 falls under the chance at dawn 1. */
const SEED = (() => {
  let seed = 1;
  while (birthDraw(seed, 0, 1) >= BIRTH_CHANCE) seed++;
  return seed;
})();

/** Households of stated members on an open 32 by 32 map, with food at the camp and no animals, the first `houses` in a finished house holding 16 food. No child is born unless `mostLiving` lets one. */
function settlement(households: readonly (readonly StartingSettler[])[], { houses = households.length, ...population }: { houses?: number } & Partial<Population> = {}) {
  const sim = createSim(mapFrom(open(32), SEED), {
    villagers: households.flat().length,
    monsters: 0,
    campFood: 200,
    animals: false,
    mostLiving: 0,
    settlers: households.map((members) => ({ members, dawnsSeen: BIRTH_GAP })),
    ...population,
  });
  const slots = [[6, 6], [24, 6], [6, 24]].slice(0, houses).map(([x, y]) => finished(sim, Building.House, x!, y!));
  for (const slot of slots) sim.stores.held[FOOD]![slot] = 16;
  return { sim, slots };
}

function finished(sim: Sim, kind: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

/** Runs to the tick of the dawn with the count `dawn`, before it runs. */
function toDawn(sim: Sim, dawn: number): void {
  while (!(isDawn(sim.tick) && sim.dawns === dawn - 1)) step(sim);
}

/** Makes villager `id` turn `WORK_AGE` at `tick`. */
function turnsTenAt(sim: Sim, id: number, tick: number): void {
  sim.villagers.born[id] = tick - WORK_AGE * TICKS_PER_YEAR_OF_AGE;
}

/** The kinds of task the villager held over `ticks` ticks, each once. */
function tasksHeld(sim: Sim, id: number, ticks: number): Set<number> {
  const held = new Set<number>();
  for (let tick = 0; tick < ticks; tick++) {
    step(sim);
    if (sim.villagers.task[id] !== NO_TASK) held.add(sim.villagers.task[id]!);
  }
  return held;
}

/** Plants trees on the 10 by 10 tiles from (20, 20) and marks them for felling, more than two settlers fell in four days. */
function chopTrees(sim: Sim): void {
  for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) sim.map.trees[at(sim.map, x, y)] = 1;
  applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 20, y0: 20, x1: 29, y1: 29 } });
}

describe('the start of work', () => {
  it(`comes at the first dawn at which a child is ${WORK_AGE}: a boy of 9 on day 1 is 10 at 17:36 on day 3 and works from the dawn of day 4`, () => {
    const { sim } = settlement([[...COUPLE, man(9)]]);
    while (ageAt(sim.villagers, 2, sim.tick) < WORK_AGE) step(sim);
    expect(dateAt(sim.tick)).toMatchObject({ day: 3, minuteOfDay: 17 * 60 + 36 });
    toDawn(sim, 3);
    expect([works(sim.villagers, 2), sim.households.workers[0], sim.tally.startedWork]).toEqual([false, 2, 0]);
    step(sim);
    expect(dateAt(sim.tick - 1)).toMatchObject({ day: 4 });
    expect([works(sim.villagers, 2), sim.villagers.child[2], sim.households.workers[0], sim.tally.startedWork]).toEqual([true, 0, 3, 1]);
    expect([sim.villagers.household[2], sim.households.living[0]], 'it still lives with its household').toEqual([0, 3]);
  });

  it('leaves a child that turns 10 at midday playing until the next dawn', () => {
    const { sim } = settlement([[...COUPLE, man(9)]]);
    chopTrees(sim);
    toDawn(sim, 1);
    step(sim);
    const noon = sim.tick + TICKS_PER_DAY / 6;
    turnsTenAt(sim, 2, noon);
    const held = new Set<number>();
    while (!isDawn(sim.tick)) {
      step(sim);
      if (sim.villagers.task[2] !== NO_TASK) held.add(sim.villagers.task[2]!);
      if (sim.tick === noon + 1) expect(ageAt(sim.villagers, 2, sim.tick)).toBe(WORK_AGE);
    }
    expect([...held], 'it took no task that day').toEqual([]);
    expect(sim.villagers.child[2]).toBe(1);
    step(sim);
    expect(sim.villagers.child[2]).toBe(0);
    expect(tasksHeld(sim, 2, TICKS_PER_DAY / 3)).toContain(GATHER);
  });

  it('comes after the deaths of old age and before the births: a death, a start of work, and a birth at one dawn', () => {
    expect(DAWN.map((stepOf) => stepOf.name)).toEqual(['breakDay', 'dieOfOldAge', 'startWork', 'bearChildren']);
    const { sim } = settlement([[...COUPLE, man(9), man(70, 70)]], { mostLiving: 10 });
    turnsTenAt(sim, 2, 100);
    expect([sim.households.living[0], sim.households.workers[0]]).toEqual([4, 3]);
    toDawn(sim, 1);
    step(sim);
    expect([sim.tally.oldAge, sim.tally.startedWork, sim.tally.births]).toEqual([1, 1, 1]);
    expect([sim.villagers.cause[3], sim.villagers.child[2], sim.villagers.child[4]]).toEqual([Cause.OldAge, 0, 1]);
    expect([sim.households.living[0], sim.households.workers[0]], 'one worker died, one started, and the newborn is a child').toEqual([4, 3]);
  });
});

describe('the new settler', () => {
  it('takes orders to the land, which it took none of as a child', () => {
    const { sim } = settlement([[...COUPLE, man(9)]]);
    chopTrees(sim);
    const asChild = new Set<number>();
    while (!(isDawn(sim.tick) && sim.dawns === 2)) {
      step(sim);
      if (sim.villagers.task[2] !== NO_TASK) asChild.add(sim.villagers.task[2]!);
    }
    expect(asChild).not.toContain(GATHER);
    const felled = sim.tally.felled;
    expect(tasksHeld(sim, 2, TICKS_PER_DAY / 2)).toContain(GATHER);
    expect(sim.tally.felled).toBeGreaterThan(felled);
  });

  it('fills an open place at a workplace at its dawn, as the one settler without a job and so the nearest', () => {
    const { sim } = settlement([[...COUPLE, man(9)]]);
    const hut = finished(sim, Building.Hut, 12, 12);
    const lodge = finished(sim, Building.Lodge, 20, 6);
    expect([sim.villagers.workplace[0], sim.villagers.workplace[1]].sort()).toEqual([hut, hut].sort());
    expect(sim.villagers.workplace[2], 'a child takes no place').toBe(-1);
    toDawn(sim, 3);
    expect(sim.villagers.workplace[2]).toBe(-1);
    step(sim);
    expect(sim.villagers.workplace[2]).toBe(lodge);
  });

  it('stocks its home', () => {
    const { sim, slots } = settlement([[...COUPLE, man(9)]]);
    finished(sim, Building.Hut, 12, 12);
    toDawn(sim, 3);
    step(sim);
    sim.stores.held[FOOD]![slots[0]!] = 0;
    expect(tasksHeld(sim, 2, TICKS_PER_DAY / 4)).toContain(STOCK);
  });

  it('fetches clothing and wears it', () => {
    const { sim } = settlement([[...COUPLE, man(9)]]);
    const tailor = finished(sim, Building.Tailor, 26, 24);
    applyCommand(sim, { kind: 'setPlaces', slot: tailor, places: 0 });
    sim.stores.held[CLOTHING]![tailor] = 3;
    toDawn(sim, 3);
    expect(sim.villagers.worn.subarray(0, 3)).toEqual(Uint8Array.of(Good.Clothing, Good.Clothing, Good.None));
    expect(tasksHeld(sim, 2, TICKS_PER_DAY / 4)).toContain(WEAR);
    expect(sim.villagers.worn[2]).toBe(Good.Clothing);
  });
});

describe('the household of a child who starts to work', () => {
  /** A boy of 9 whose parents died, alone in his house with no food, and a couple without a job at the camp. */
  function orphan() {
    const { sim, slots } = settlement([[...COUPLE, man(9)], [man(26), woman(25)]], { houses: 1 });
    die(sim, 0, Cause.Hunger);
    die(sim, 1, Cause.Hunger);
    sim.stores.held[FOOD]![slots[0]!] = 0;
    return { sim, home: slots[0]! };
  }

  it('can carry again from that dawn, so the settlers without a job stop stocking its home', () => {
    const { sim, home } = orphan();
    expect([sim.households.workers[0], sim.households.unattended]).toEqual([0, 1]);
    toDawn(sim, 3);
    step(sim);
    expect([sim.households.workers[0], sim.households.unattended]).toEqual([1, 0]);
    sim.stores.held[FOOD]![home] = 0;
    for (let tick = 0; tick < TICKS_PER_DAY / 4; tick++) {
      step(sim);
      for (const id of [3, 4]) if (sim.villagers.task[id] === STOCK) expect(sim.villagers.toStore[id]).not.toBe(home);
    }
    expect(sim.stores.held[FOOD]![home], 'the boy stocks it himself').toBeGreaterThan(0);
  });

  it('gives up the unit a settler without a job carries to its home once the household can carry, by the rule of #49, with the step run by day because every task ends at dusk', () => {
    const { sim, home } = orphan();
    toDawn(sim, 1);
    let carrier = -1;
    while (carrier < 0) {
      step(sim);
      carrier = [3, 4].find((id) => sim.villagers.task[id] === STOCK && sim.villagers.toStore[id] === home) ?? -1;
    }
    expect(sim.stores.inbound[FOOD]![home]).toBe(1);
    turnsTenAt(sim, 2, sim.tick);
    startWork(sim);
    expect(STOCKING.holds(sim, carrier)).toBe(false);
    step(sim);
    expect([sim.villagers.task[carrier], sim.stores.inbound[FOOD]![home]]).toEqual([NO_TASK, 0]);
  });
});

describe('the readiness reading', () => {
  it('counts the new settler among the settlers who can wear clothing from its dawn', () => {
    const { sim } = settlement([[...COUPLE, man(5)]]);
    while (readinessOf(sim) === null) step(sim);
    turnsTenAt(sim, 2, sim.tick);
    while (!isDawn(sim.tick)) step(sim);
    expect(readinessOf(sim)!.settlers).toBe(2);
    step(sim);
    expect(readinessOf(sim)!.settlers).toBe(3);
  });
});
