import { describe, expect, it } from 'vitest';
import { lifeSpan } from './aging';
import { BEARING_AGES, BIRTH_CHANCE, BIRTH_GAP, FULL_HOUSE, birthDraw, sexAtBirth } from './births';
import { finishBuilding } from './building';
import { Building, EVERYONE, nearestDoor } from './buildings';
import { DAYS_PER_SEASON, TICKS_PER_DAY, dateAt, tickOfDay } from './calendar';
import { isDawn, isNight } from './daylight';
import { DAWN } from './dawn';
import { Good } from './goods';
import { NO_HOME } from './households';
import { works } from './jobs';
import { NAMES, Sex } from './names';
import { type Population, type Sim, type StartingSettler, WORK_AGE, applyCommand, createSim, parseSettlers, step } from './sim';
import { CAMP_STORE } from './stores';
import { STOCKING } from './stocking';
import { TASK_KINDS, takeTask } from './tasks';
import { at, mapFrom } from './testMaps';
import { Cause, NO_TASK, VILLAGER_ROWS, VillagerState } from './villagerState';
import { addVillager, die } from './villagers';

const FOOD = Good.Food - 1;
const FIREWOOD = Good.Firewood - 1;
const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));
const man = (age: number, span?: number): StartingSettler => (span === undefined ? { sex: Sex.Man, age } : { sex: Sex.Man, age, span });
const woman = (age: number, span?: number): StartingSettler => (span === undefined ? { sex: Sex.Woman, age } : { sex: Sex.Woman, age, span });

/** The first seed whose draw for household 0 falls under the chance at dawn 1, and at no other dawn up to `BIRTH_GAP + 1`. */
const SEED = (() => {
  for (let seed = 1; ; seed++) {
    if (birthDraw(seed, 0, 1) >= BIRTH_CHANCE) continue;
    if (Array.from({ length: BIRTH_GAP }, (_, at) => birthDraw(seed, 0, at + 2)).some((draw) => draw < BIRTH_CHANCE)) return seed;
  }
})();

/** The first dawn after `after` at which household `h`'s draw on `seed` falls under the chance. */
function nextLuckyDawn(seed: number, h: number, after: number): number {
  let dawn = after + 1;
  while (birthDraw(seed, h, dawn) >= BIRTH_CHANCE) dawn++;
  return dawn;
}

const HOUSES = [
  [6, 6],
  [24, 6],
  [6, 24],
  [24, 24],
] as const;

/**
 * Households of stated members on an open 32 by 32 map of `SEED`, with no
 * animals and food at the camp, each of the first `houses` of them in a
 * finished house holding 16 food. Every household has seen `seen` dawns.
 */
function settlement(households: readonly (readonly StartingSettler[])[], { seen = BIRTH_GAP, houses = households.length, ...population }: { seen?: number; houses?: number } & Partial<Population> = {}) {
  const sim = createSim(mapFrom(open(32), SEED), {
    villagers: households.flat().length,
    monsters: 0,
    campFood: 200,
    animals: false,
    settlers: households.map((members) => ({ members, dawnsSeen: seen })),
    ...population,
  });
  const slots = HOUSES.slice(0, houses).map(([x, y]) => {
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x, y })).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
    finishBuilding(sim, slot);
    sim.stores.held[FOOD]![slot] = 16;
    return slot;
  });
  return { sim, slots };
}

/** Runs until the dawn with the count `dawn` has run, and returns the villagers born at it. `each` runs before every tick. */
function throughDawn(sim: Sim, dawn: number, each: () => void = () => {}): number[] {
  const before = sim.villagers.count;
  while (sim.dawns < dawn && !sim.over) {
    each();
    step(sim);
  }
  return Array.from({ length: sim.villagers.count - before }, (_, at) => before + at);
}

/** Runs to the tick of the dawn with the count `dawn`, before it runs. */
function toDawn(sim: Sim, dawn: number): void {
  while (!(isDawn(sim.tick) && sim.dawns === dawn - 1)) step(sim);
}

const COUPLE = [man(30), woman(28)];

/** How far villager `id` stands from the nearest door of the house in `slot`, in tiles on the farther axis. A door is a tile whose nearest door is itself. */
function fromDoor(sim: Sim, slot: number, id: number): number {
  const { size } = sim.map;
  let nearest = Infinity;
  for (let tile = 0; tile < size * size; tile++) {
    const x = (tile % size) + 0.5;
    const y = Math.floor(tile / size) + 0.5;
    if (nearestDoor(sim, slot, x, y) !== tile) continue;
    nearest = Math.min(nearest, Math.max(Math.abs(sim.villagers.x[id]! - x), Math.abs(sim.villagers.y[id]! - y)));
  }
  return nearest;
}

describe('a birth', () => {
  it(`comes at the first dawn to a household with a house that has seen more than ${BIRTH_GAP} dawns, when its draw falls under 1 in 4`, () => {
    expect(BIRTH_CHANCE).toBe(1 / 4);
    const { sim } = settlement([COUPLE]);
    expect(throughDawn(sim, 1)).toEqual([2]);
    expect(dateAt(sim.villagers.born[2]!)).toMatchObject({ day: 2 });
    expect([sim.tally.births, sim.living, sim.households.living[0]]).toEqual([1, 3, 3]);
  });

  describe('needs each condition on its own', () => {
    const born = (households: readonly (readonly StartingSettler[])[], options?: Parameters<typeof settlement>[1], before?: (sim: Sim) => void) => {
      const { sim } = settlement(households, options);
      toDawn(sim, 1);
      before?.(sim);
      return throughDawn(sim, 1).length;
    };

    it('a house: a household at the camp has no child', () => {
      expect(born([COUPLE], { houses: 0 })).toBe(0);
    });

    it(`fewer than ${FULL_HOUSE} people in the house`, () => {
      expect(FULL_HOUSE).toBe(5);
      expect(born([[...COUPLE, woman(6), man(4)]])).toBe(1);
      expect(born([[...COUPLE, woman(6), man(4), woman(2)]])).toBe(0);
    });

    it('both of its couple alive', () => {
      expect(born([COUPLE], {}, (sim) => die(sim, 0, Cause.Hunger))).toBe(0);
      expect(born([COUPLE], {}, (sim) => die(sim, 1, Cause.Hunger))).toBe(0);
    });

    it(`a woman from ${BEARING_AGES[0]} and younger than ${BEARING_AGES[1]}`, () => {
      expect([15, 16, 39, 40].map((age) => born([[man(30), woman(age)]]))).toEqual([0, 1, 1, 0]);
    });

    it('no member with a missed meal after the dawn, while one that eats at the dawn does not stop it', () => {
      const hungry = (food: number) => (sim: Sim) => {
        sim.villagers.missedMeals[2] = 1;
        sim.stores.held[FOOD]![sim.households.home[0]!] = food;
      };
      expect(born([[...COUPLE, woman(6)]], {}, hungry(0))).toBe(0);
      expect(born([[...COUPLE, woman(6)]], {}, hungry(16))).toBe(1);
    });

    it('no member with a cold night', () => {
      expect(born([[...COUPLE, woman(6)]], {}, (sim) => (sim.villagers.coldNights[2] = 1))).toBe(0);
    });

    it(`more than ${BIRTH_GAP} dawns since it formed`, () => {
      expect(born([COUPLE], { seen: BIRTH_GAP - 1 })).toBe(0);
      expect(born([COUPLE], { seen: BIRTH_GAP })).toBe(1);
    });

    it(`more than ${BIRTH_GAP} dawns since its last birth, though its draw falls under the chance before`, () => {
      const { sim, slots } = settlement([COUPLE], { mostLiving: 4 });
      const stocked = () => {
        sim.stores.held[FOOD]![slots[0]!] = 16;
        sim.stores.held[FIREWOOD]![slots[0]!] = 6;
      };
      expect(throughDawn(sim, 1, stocked)).toEqual([2]);
      for (let dawn = 2; dawn <= BIRTH_GAP + 1; dawn++) expect(throughDawn(sim, dawn, stocked), `dawn ${dawn}`).toEqual([]);
      const next = nextLuckyDawn(SEED, 0, BIRTH_GAP + 1);
      expect(throughDawn(sim, next - 1, stocked)).toEqual([]);
      expect(throughDawn(sim, next, stocked)).toEqual([3]);
    });
  });

  it('is drawn from the seed, the household, and the dawn: the same commands give the same births, and the birth moves no draw that exists', () => {
    const run = () => {
      const { sim } = settlement([COUPLE, [man(25), woman(22)], [man(33), woman(31)]]);
      throughDawn(sim, 30);
      return Array.from({ length: sim.villagers.count }, (_, id) => [sim.villagers.household[id], sim.villagers.born[id], sim.villagers.name[id], sim.villagers.sex[id]]);
    };
    const first = run();
    expect(first.length).toBeGreaterThan(6);
    expect(run()).toEqual(first);
    expect(birthDraw(SEED, 1, 9)).toBe(birthDraw(SEED, 1, 9));
    expect(birthDraw(SEED, 1, 9)).not.toBe(birthDraw(SEED, 2, 9));

    const bearing = settlement([COUPLE]).sim;
    const barren = settlement([COUPLE], { mostLiving: 2 }).sim;
    toDawn(bearing, 1);
    toDawn(barren, 1);
    step(bearing);
    step(barren);
    expect([bearing.villagers.count, barren.villagers.count]).toEqual([3, 2]);
    expect(Array.from(bearing.villagers.draws.subarray(0, 2))).toEqual(Array.from(barren.villagers.draws.subarray(0, 2)));
    expect(Array.from(bearing.villagers.x.subarray(0, 2))).toEqual(Array.from(barren.villagers.x.subarray(0, 2)));
  });

  it('gives the child its sex, span, and a name from the list no living member bears, its household and both parents, and stands it at the door nearest its mother', () => {
    const { sim, slots } = settlement([[...COUPLE, woman(6), man(4)]]);
    toDawn(sim, 1);
    const [child] = throughDawn(sim, 1);
    const { villagers } = sim;
    expect(child).toBe(4);
    expect(villagers.sex[4]).toBe(sexAtBirth(SEED, 4));
    expect(villagers.span[4]).toBe(lifeSpan(SEED, 4));
    expect([villagers.household[4], villagers.mother[4], villagers.father[4], villagers.child[4], villagers.born[4]]).toEqual([0, 1, 0, 1, sim.tick - 1]);
    const living = [0, 1, 2, 3].filter((id) => villagers.sex[id] === villagers.sex[4]).map((id) => villagers.name[id]);
    expect(living).not.toContain(villagers.name[4]);
    expect(villagers.name[4]).toBeLessThan(NAMES[villagers.sex[4] as Sex].length);
    const door = nearestDoor(sim, slots[0]!, villagers.x[1]!, villagers.y[1]!);
    expect([villagers.x[4], villagers.y[4]]).toEqual([(door % 32) + 0.5, Math.floor(door / 32) + 0.5]);
    expect(works(villagers, 4)).toBe(false);
  });

  it('keeps its parents valid after they die, as a row is never used twice', () => {
    const { sim } = settlement([COUPLE]);
    throughDawn(sim, 1);
    die(sim, 0, Cause.Hunger);
    die(sim, 1, Cause.Hunger);
    expect([sim.villagers.mother[2], sim.villagers.father[2], sim.villagers.state[1]]).toEqual([1, 0, VillagerState.Dead]);
    expect(addVillager(sim.villagers, sim.map, sim.flow, { sex: Sex.Man, household: 0, name: 0, born: 0, span: 70, child: true, mother: -1, father: -1 })).toBe(3);
  });

  it('follows the deaths of old age at a dawn: a death frees a place in a house of 5, and the child is born at the same dawn', () => {
    expect(DAWN.map((stepOf) => stepOf.name)).toEqual(['breakDay', 'dieOfOldAge', 'bearChildren']);
    const { sim } = settlement([[...COUPLE, woman(6), man(4), woman(5, 5)]]);
    toDawn(sim, 1);
    expect(sim.households.living[0]).toBe(FULL_HOUSE);
    expect(throughDawn(sim, 1)).toEqual([5]);
    expect([sim.villagers.cause[4], sim.villagers.diedAt[4], sim.villagers.born[5]]).toEqual([Cause.OldAge, sim.tick - 1, sim.tick - 1]);
    expect([sim.tally.oldAge, sim.tally.births, sim.households.living[0]]).toEqual([1, 1, FULL_HOUSE]);
  });

  it('never comes while the cap of the living live, or once the table is full', () => {
    expect(throughDawn(settlement([COUPLE], { mostLiving: 2 }).sim, 1)).toEqual([]);
    expect(throughDawn(settlement([COUPLE], { mostLiving: 3 }).sim, 1)).toEqual([2]);
    const { sim } = settlement([COUPLE]);
    while (sim.villagers.count < VILLAGER_ROWS) addVillager(sim.villagers, sim.map, sim.flow, { sex: Sex.Man, household: 0, name: 0, born: 0, span: 70, child: false, mother: -1, father: -1 });
    toDawn(sim, 1);
    expect(throughDawn(sim, 1)).toEqual([]);
    expect(sim.tally.births).toBe(0);
  });
});

describe('a child', () => {
  /** A couple and their girl of 6 in a house, the couple clothed, with no more births. */
  const family = () => settlement([[...COUPLE, woman(6)]], { mostLiving: 3 });

  it('plays within 3 tiles of a door of its house by day, and goes inside with its household at dusk', () => {
    const { sim, slots } = family();
    throughDawn(sim, 1);
    let farthest = 0;
    while (!isNight(sim.tick)) {
      step(sim);
      if (sim.tick % 50 === 0) farthest = Math.max(farthest, fromDoor(sim, slots[0]!, 2));
    }
    expect(farthest).toBeGreaterThan(0.5);
    expect(farthest).toBeLessThanOrEqual(3 + 1e-6);
    while (sim.villagers.state[0] !== VillagerState.Inside || sim.villagers.state[1] !== VillagerState.Inside) step(sim);
    let ticks = 0;
    while (sim.villagers.state[2] !== VillagerState.Inside && ticks++ < TICKS_PER_DAY / 4) step(sim);
    expect(sim.villagers.state[2]).toBe(VillagerState.Inside);
  });

  it('walks to its house when its household gains one by day, though it stood at the camp', () => {
    const { sim } = settlement([[...COUPLE, woman(6)]], { mostLiving: 3, houses: 0 });
    for (let tick = 0; tick < 200; tick++) step(sim);
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 6, y: 6 })).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[at(sim.map, 6, 6)]!;
    finishBuilding(sim, slot);
    expect(fromDoor(sim, slot, 2)).toBeGreaterThan(3);
    for (let tick = 0; tick < 400; tick++) step(sim);
    expect(fromDoor(sim, slot, 2)).toBeLessThanOrEqual(3);
  });

  it('does no work: it takes no order, no place, and stocks nothing, while it still eats a missed meal by day', () => {
    const { sim, slots } = family();
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 0, y0: 0, x1: 31, y1: 31 } });
    expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x: 24, y: 24 })).toMatchObject({ ok: true });
    finishBuilding(sim, sim.orders.siteOf[at(sim.map, 24, 24)]!);
    sim.stores.held[FOOD]![slots[0]!] = 0;
    for (let tick = 0; tick < TICKS_PER_DAY / 3; tick++) {
      step(sim);
      if (sim.villagers.task[2] !== NO_TASK) expect(TASK_KINDS[sim.villagers.task[2]! - 1]!.job).toBe(EVERYONE);
    }
    expect([sim.villagers.workplace[2], sim.villagers.carried[2]]).toEqual([-1, Good.None]);
    expect([sim.villagers.workplace[0]!, sim.villagers.workplace[1]!].filter((slot) => slot >= 0)).toHaveLength(2);
    sim.villagers.missedMeals[2] = 1;
    sim.stores.held[FOOD]![slots[0]!] = 2;
    expect(takeTask(sim, 2)).toBe(true);
    expect(TASK_KINDS[sim.villagers.task[2]! - 1]!.job).toBe(EVERYONE);
  });

  it('eats 1 meal from its household\'s store at dusk', () => {
    const { sim, slots } = family();
    throughDawn(sim, 1);
    const food = sim.stores.held[FOOD]![slots[0]!]!;
    while (sim.villagers.state[2] !== VillagerState.Inside) step(sim);
    const meals = sim.tally.meals;
    throughDawn(sim, 2);
    expect(sim.tally.meals - meals).toBe(2);
    expect(sim.villagers.missedMeals[2]).toBe(0);
    expect(sim.stores.held[FOOD]![slots[0]!]).toBeLessThan(food);
  });

  it('on a winter night is warm only in a house whose fire burns, where its clothed parents are warm without one', () => {
    const night = (firewood: number) => {
      const { sim, slots } = family();
      sim.villagers.worn[0] = sim.villagers.worn[1] = Good.Clothing;
      while (dateAt(sim.tick).day < 3 * DAYS_PER_SEASON + 1 || !isNight(sim.tick) || tickOfDay(sim.tick) < TICKS_PER_DAY / 2) {
        sim.stores.held[FOOD]![slots[0]!] = 16;
        sim.stores.held[FIREWOOD]![slots[0]!] = firewood;
        step(sim);
      }
      while (!isDawn(sim.tick)) step(sim);
      return Array.from(sim.villagers.coldNights.subarray(0, 3));
    };
    expect(night(6)).toEqual([0, 0, 0]);
    expect(night(0)).toEqual([0, 0, 1]);
  });

  it('dies of its third missed meal and of its third cold night, as an adult does', () => {
    const hungry = family().sim;
    hungry.villagers.missedMeals[2] = 2;
    hungry.stores.held[FOOD]![hungry.households.home[0]!] = 0;
    hungry.stores.held[FOOD]![CAMP_STORE] = 0;
    throughDawn(hungry, 1);
    expect([hungry.villagers.state[2], hungry.villagers.cause[2]]).toEqual([VillagerState.Dead, Cause.Hunger]);

    const { sim, slots } = family();
    while (dateAt(sim.tick).day < 3 * DAYS_PER_SEASON + 1) {
      sim.stores.held[FOOD]![slots[0]!] = 16;
      step(sim);
    }
    for (let nights = 0; nights < 3 && sim.villagers.state[2] !== VillagerState.Dead; nights++) {
      while (!isDawn(sim.tick)) step(sim);
      while (!isNight(sim.tick)) {
        sim.stores.held[FOOD]![slots[0]!] = 16;
        sim.stores.held[FIREWOOD]![slots[0]!] = 0;
        step(sim);
      }
      while (sim.villagers.state[2] !== VillagerState.Inside && sim.villagers.state[2] !== VillagerState.Dead) step(sim);
    }
    expect([sim.villagers.state[2], sim.villagers.cause[2]]).toEqual([VillagerState.Dead, Cause.Cold]);
  });
});

describe('a home in which nobody can carry', () => {
  /** Households 0 and 1 are children whose couples died, households 2 and 3 settlers without a job. */
  function orphans(houses: number) {
    const { sim, slots } = settlement([[...COUPLE, woman(6)], [...COUPLE, man(4)], COUPLE, [man(26), woman(25)]], { houses, mostLiving: 0 });
    for (const id of [0, 1, 3, 4]) die(sim, id, Cause.Hunger);
    for (const slot of slots) sim.stores.held[FOOD]![slot] = 0;
    return { sim, slots };
  }
  const stocks = (sim: Sim, id: number) => {
    if (!STOCKING.take(sim, id)) return null;
    const to = sim.villagers.toStore[id]!;
    const good = sim.villagers.stockGood[id]!;
    STOCKING.release(sim, id);
    return { to, good };
  };

  it('is stocked by the settlers without a job, food for each such home, the lowest household first, before the camp', () => {
    const { sim, slots } = orphans(2);
    expect(sim.households.unattended).toBe(2);
    expect(applyCommand(sim, { kind: 'place', building: Building.Barn, x: 24, y: 24 })).toMatchObject({ ok: true });
    const barn = sim.orders.siteOf[at(sim.map, 24, 24)]!;
    finishBuilding(sim, barn);
    sim.stores.held[FOOD]![barn] = 50;
    sim.stores.held[FOOD]![CAMP_STORE] = 0;
    expect(stocks(sim, 6)).toEqual({ to: slots[0], good: Good.Food });
    sim.stores.held[FOOD]![slots[0]!] = 3;
    expect(stocks(sim, 6)).toEqual({ to: slots[1], good: Good.Food });
    sim.stores.held[FOOD]![slots[1]!] = 3;
    expect(stocks(sim, 6)).toEqual({ to: CAMP_STORE, good: Good.Food });
    expect(takeTask(sim, 2), 'a child stocks nothing').toBe(false);
  });

  it('takes its firewood after the food of every such home, in the same order', () => {
    const { sim, slots } = orphans(4);
    sim.stores.held[FIREWOOD]![CAMP_STORE] = 12;
    for (const slot of slots.slice(2)) {
      sim.stores.held[FOOD]![slot] = 16;
      sim.stores.held[FIREWOOD]![slot] = 6;
    }
    for (const slot of slots.slice(0, 2)) sim.stores.held[FOOD]![slot] = 3;
    expect(stocks(sim, 6)).toEqual({ to: slots[0], good: Good.Firewood });
    sim.stores.held[FIREWOOD]![slots[0]!] = 6;
    expect(stocks(sim, 6)).toEqual({ to: slots[1], good: Good.Firewood });
    sim.stores.held[FIREWOOD]![slots[1]!] = 6;
    expect(stocks(sim, 6)).toBeNull();
  });

  it('loses its carrier once the carrier is hired, as a unit for the camp does', () => {
    const { sim, slots } = orphans(2);
    sim.stores.held[FOOD]![CAMP_STORE] = 50;
    expect(takeTask(sim, 6)).toBe(true);
    expect([sim.villagers.toStore[6], STOCKING.holds(sim, 6)]).toEqual([slots[0], true]);
    expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x: 24, y: 24 })).toMatchObject({ ok: true });
    const hut = sim.orders.siteOf[at(sim.map, 24, 24)]!;
    finishBuilding(sim, hut);
    applyCommand(sim, { kind: 'setPlaces', slot: hut, places: 2 });
    expect([6, 7, 8, 9].filter((id) => sim.villagers.workplace[id] === hut)).toContain(6);
    expect([sim.villagers.task[6], sim.stores.inbound[FOOD]![slots[0]!]]).toEqual([NO_TASK, 0]);
  });
});

describe('the settlers setting with children', () => {
  it('reads the members after the couple as its children, and the dawns a household has seen', () => {
    expect(parseSettlers('m30,w28,w9,m10@6;m24,w22')).toEqual([
      { members: [man(30), woman(28), woman(9), man(10)], dawnsSeen: 6 },
      { members: [man(24), woman(22)] },
    ]);
  });

  it(`makes a stated member younger than ${WORK_AGE} a child of the couple, and one of ${WORK_AGE} a settler who works, each with its own name`, () => {
    const sim = createSim(mapFrom(open(24), 7), { villagers: 6, monsters: 0, settlers: parseSettlers('m30,w28,w9,m10,w9@6') ?? [] });
    const { villagers, households } = sim;
    expect(Array.from(villagers.child.subarray(0, 5))).toEqual([0, 0, 1, 0, 1]);
    expect(Array.from(villagers.mother.subarray(0, 5))).toEqual([-1, -1, 1, 1, 1]);
    expect(Array.from(villagers.father.subarray(0, 5))).toEqual([-1, -1, 0, 0, 0]);
    expect(new Set([0, 2, 4].map((id) => villagers.name[id])).size).toBe(3);
    expect([households.man[0], households.woman[0], households.living[0], households.workers[0], households.lastBirth[0]]).toEqual([0, 1, 5, 3, -6]);
  });

  it('leaves the seed\'s new game as it is: two settlers to a household, none a child, no household with a dawn behind it', () => {
    const sim = createSim(mapFrom(open(24), 7), { villagers: 8, monsters: 0 });
    expect(Array.from(sim.villagers.child.subarray(0, 8))).toEqual(Array(8).fill(0));
    expect(Array.from(sim.households.lastBirth.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(sim.households.man.subarray(0, 4))).toEqual([0, 2, 4, 6]);
    expect(sim.households.home.subarray(0, 4).every((home) => home === NO_HOME)).toBe(true);
  });
});
