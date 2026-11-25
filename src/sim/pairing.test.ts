import { describe, expect, it } from 'vitest';
import { GROWN_AGE } from './aging';
import { BIRTH_CHANCE, BIRTH_GAP, birthDraw } from './births';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { dateAt } from './calendar';
import { DAWN } from './dawn';
import { isColdNight, isDawn } from './daylight';
import { Good } from './goods';
import { NO_HOME, houseOf, peopleIn } from './households';
import { Sex } from './names';
import { storeOf } from './needs';
import { isSingle, pairSettlers } from './pairing';
import { type Sim, type StartingSettler, applyCommand, createSim, step } from './sim';
import { at, mapFrom } from './testMaps';
import { campLacks, lacks } from './stocking';
import { CAMP_STORE, DAYS_KEPT_AT_CAMP, HOUSE_FIREWOOD_LIMIT, MEALS_PER_DAY } from './stores';
import { Cause, VillagerState } from './villagerState';
import { die } from './villagers';

const FOOD = Good.Food - 1;
const FIREWOOD = Good.Firewood - 1;
const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));
const man = (age: number): StartingSettler => ({ sex: Sex.Man, age });
const woman = (age: number): StartingSettler => ({ sex: Sex.Woman, age });
/** A couple whose woman bears no more children. */
const PARENTS = [man(50), woman(48)];

const PLACES = [
  [6, 6],
  [24, 6],
  [6, 24],
  [24, 24],
] as const;

/** Households of stated members, a couple and then its children, on an open 32 by 32 map of `seed` with no animals and food at the camp, all at the camp. */
function settlement(households: readonly (readonly StartingSettler[])[], { seed = 7, seen = 0 } = {}): Sim {
  return createSim(mapFrom(open(32), seed), {
    villagers: households.flat().length,
    monsters: 0,
    campFood: 200,
    animals: false,
    settlers: households.map((members) => ({ members, dawnsSeen: seen })),
  });
}

/** Places a house at the `place`th of `PLACES` and returns its site slot. */
function site(sim: Sim, place: number): number {
  const [x, y] = PLACES[place]!;
  expect(applyCommand(sim, { kind: 'place', building: Building.House, x, y })).toMatchObject({ ok: true });
  return sim.orders.siteOf[at(sim.map, x, y)]!;
}

/** Finishes the house in `slot` and stocks it with 16 food. */
function finish(sim: Sim, slot: number): number {
  finishBuilding(sim, slot);
  sim.stores.held[FOOD]![slot] = 16;
  return slot;
}

const house = (sim: Sim, place: number) => finish(sim, site(sim, place));

/** The couples of the households from number `first` on, each as its man's and its woman's ids. */
function couplesFrom(sim: Sim, first: number): [number, number][] {
  const { households } = sim;
  return Array.from({ length: households.count - first }, (_, at) => [households.man[first + at]!, households.woman[first + at]!]);
}

/** The pairings of one dawn on the households as stated, as the couples of the households they formed. */
function pairings(households: readonly (readonly StartingSettler[])[], before: (sim: Sim) => void = () => {}): [number, number][] {
  const sim = settlement(households);
  before(sim);
  const first = sim.households.count;
  pairSettlers(sim);
  return couplesFrom(sim, first);
}

/** Runs until the dawn with the count `dawn` has run. `each` runs before every tick. */
function throughDawn(sim: Sim, dawn: number, each: () => void = () => {}): void {
  while (sim.dawns < dawn) {
    each();
    step(sim);
  }
}

describe('a single settler', () => {
  it(`is ${GROWN_AGE} or older`, () => {
    expect(GROWN_AGE).toBe(16);
    const sim = settlement([
      [...PARENTS, man(16)],
      [...PARENTS, woman(15)],
    ]);
    expect([isSingle(sim, 2), isSingle(sim, 5)]).toEqual([true, false]);
    expect(pairings([[...PARENTS, man(16)], [...PARENTS, woman(15)]])).toEqual([]);
    expect(pairings([[...PARENTS, man(16)], [...PARENTS, woman(16)]])).toEqual([[2, 5]]);
  });

  it('is never one of a couple, though its partner died', () => {
    const households = [[man(28), woman(28)], [...PARENTS, woman(27)], [...PARENTS, man(30)]];
    const sim = settlement(households);
    die(sim, 1, Cause.Hunger);
    expect([0, 1, 2, 3, 4, 7].map((id) => isSingle(sim, id))).toEqual([false, false, false, false, true, true]);
    expect(pairings(households)).toEqual([[7, 4]]);
    expect(pairings(households, (sim) => die(sim, 1, Cause.Hunger))).toEqual([[7, 4]]);
  });

  it('is the man of a starting household of one, who never had a partner', () => {
    const sim = createSim(mapFrom(open(32), 7), { villagers: 3, monsters: 0 });
    expect([0, 1, 2].map((id) => isSingle(sim, id))).toEqual([false, false, true]);
  });
});

describe('two single settlers', () => {
  it('pair as a man and a woman, never two of one sex', () => {
    expect(pairings([[...PARENTS, man(20)], [...PARENTS, man(21)]])).toEqual([]);
    expect(pairings([[...PARENTS, woman(20)], [...PARENTS, woman(21)]])).toEqual([]);
    expect(pairings([[...PARENTS, man(20)], [...PARENTS, woman(21)]])).toEqual([[2, 5]]);
  });

  it('never pair as a parent and its child', () => {
    const grown = [[...PARENTS, man(40)], [...PARENTS, woman(20)]];
    expect(pairings(grown)).toEqual([[2, 5]]);
    expect(pairings(grown, (sim) => (sim.villagers.father[5] = 2))).toEqual([]);
    expect(pairings([[...PARENTS, woman(40)], [...PARENTS, man(20)]], (sim) => (sim.villagers.mother[5] = 2))).toEqual([]);
  });

  it('never pair as brother and sister, who share both parents', () => {
    expect(pairings([[...PARENTS, man(20), woman(19)]])).toEqual([]);
  });

  it('never pair as half-siblings, who share one parent', () => {
    const apart = [[...PARENTS, man(20)], [...PARENTS, woman(20)]];
    expect(pairings(apart, (sim) => (sim.villagers.mother[5] = sim.villagers.mother[2]!))).toEqual([]);
    expect(pairings(apart, (sim) => (sim.villagers.father[5] = sim.villagers.father[2]!))).toEqual([]);
    expect(pairings(apart)).toEqual([[2, 5]]);
  });
});

describe('the pairings of a dawn', () => {
  it('go through the women from the oldest to the youngest, the lower id first at one age', () => {
    expect(pairings([[...PARENTS, man(25)], [...PARENTS, woman(20)], [...PARENTS, woman(24)]])).toEqual([[2, 8]]);
    expect(pairings([[...PARENTS, man(25)], [...PARENTS, woman(22)], [...PARENTS, woman(22)]])).toEqual([[2, 5]]);
  });

  it('give each woman the man nearest her in age, the older when two are as near, then the lower id', () => {
    expect(pairings([[...PARENTS, woman(24)], [...PARENTS, man(30)], [...PARENTS, man(22)]])).toEqual([[8, 2]]);
    expect(pairings([[...PARENTS, woman(24)], [...PARENTS, man(22)], [...PARENTS, man(26)]])).toEqual([[8, 2]]);
    expect(pairings([[...PARENTS, woman(24)], [...PARENTS, man(26)], [...PARENTS, man(26)]])).toEqual([[5, 2]]);
  });

  it('leave a woman single when the only man left is her brother, and try the next woman', () => {
    expect(pairings([[...PARENTS, man(20), woman(22)], [...PARENTS, woman(18)]])).toEqual([[2, 6]]);
  });

  it('number the households of one dawn in the order of the pairings', () => {
    const sim = settlement([[...PARENTS, man(30)], [...PARENTS, woman(20)], [...PARENTS, woman(25)], [...PARENTS, man(20)]]);
    pairSettlers(sim);
    expect(couplesFrom(sim, 4)).toEqual([
      [2, 8],
      [11, 5],
    ]);
    expect([sim.villagers.household[2], sim.villagers.household[8], sim.villagers.household[11], sim.villagers.household[5]]).toEqual([4, 4, 5, 5]);
    expect(sim.tally.paired).toBe(2);
  });

  it('change nothing on a new game, in which nobody is single', () => {
    const sim = createSim(mapFrom(open(32), 7), { villagers: 8, monsters: 0, campFood: 200, animals: false });
    expect(Array.from({ length: 8 }, (_, id) => isSingle(sim, id))).toEqual(Array(8).fill(false));
    const before = Array.from(sim.villagers.household.subarray(0, 8));
    throughDawn(sim, 2);
    expect([sim.tally.paired, sim.households.count]).toEqual([0, 4]);
    expect(Array.from(sim.villagers.household.subarray(0, 8))).toEqual(before);
  });
});

describe('a new household', () => {
  it('takes an empty house at once, the one finished first of two', () => {
    const sim = settlement([[...PARENTS, man(20), man(24)], [...PARENTS, woman(21), woman(25)]]);
    house(sim, 0);
    house(sim, 1);
    const later = site(sim, 2);
    const first = site(sim, 3);
    expect(later).toBeLessThan(first);
    finish(sim, first);
    finish(sim, later);
    pairSettlers(sim);
    expect(couplesFrom(sim, 2)).toEqual([
      [3, 7],
      [2, 6],
    ]);
    expect([sim.households.home[2], sim.households.home[3]]).toEqual([first, later]);
    expect([sim.households.householdIn[first], sim.households.householdIn[later], sim.households.atCamp]).toEqual([2, 3, 0]);
  });

  it("has no house while none stands empty, its two living on in their parents' houses, and moves into the next house finished", () => {
    const sim = settlement([[...PARENTS, man(20)], [...PARENTS, woman(21)]]);
    const parents = [house(sim, 0), house(sim, 1)];
    pairSettlers(sim);
    const { households, villagers } = sim;
    expect([households.home[2], households.atCamp]).toEqual([NO_HOME, 0]);
    expect([houseOf(households, villagers, 2), houseOf(households, villagers, 5)]).toEqual(parents);
    expect(parents.map((slot) => [households.lodgers[slot], peopleIn(households, slot)])).toEqual([
      [1, 3],
      [1, 3],
    ]);
    const slot = house(sim, 2);
    expect([households.home[2], households.householdIn[slot], households.atCamp]).toEqual([slot, 2, 0]);
    expect([houseOf(households, villagers, 2), houseOf(households, villagers, 5), villagers.lodging[2], villagers.lodging[5]]).toEqual([slot, slot, NO_HOME, NO_HOME]);
    expect(parents.map((at) => [households.lodgers[at], peopleIn(households, at)])).toEqual([
      [0, 2],
      [0, 2],
    ]);
  });

  it('moves into a house freed by the death of the last of its household', () => {
    const sim = settlement([[...PARENTS, man(20)], [...PARENTS, woman(21)], [man(70), woman(70)]]);
    house(sim, 0);
    house(sim, 1);
    const freed = house(sim, 2);
    pairSettlers(sim);
    expect(sim.households.home[3]).toBe(NO_HOME);
    die(sim, 6, Cause.OldAge);
    expect(sim.households.home[3]).toBe(NO_HOME);
    die(sim, 7, Cause.OldAge);
    expect([sim.households.home[3], sim.households.home[2], sim.households.householdIn[freed]]).toEqual([freed, NO_HOME, 3]);
  });
});

/** Runs to the last tick of the night that falls at the dusk of `day`, after every villager has come home and before the dawn. `each` runs before every tick. */
function lateNightOf(sim: Sim, day: number, each: () => void = () => {}): void {
  while (!(isDawn(sim.tick) && dateAt(sim.tick).day === day + 1)) {
    each();
    step(sim);
  }
}

describe('a new household while no house stands empty', () => {
  /**
   * A son of 20 and a daughter of 21 in their parents' houses, which hold 16
   * food and `firewood` at every tick, with no food at the camp. They pair at
   * the first dawn. Returns the sim at the last tick of the winter night of
   * day 10.
   */
  const winter = (firewood: number) => {
    const sim = createSim(mapFrom(open(32), 7), {
      villagers: 6,
      monsters: 0,
      campFood: 0,
      animals: false,
      settlers: [[...PARENTS, man(20)], [...PARENTS, woman(21)]].map((members) => ({ members, dawnsSeen: 0 })),
    });
    const parents = [house(sim, 0), house(sim, 1)];
    const kept = () => {
      for (const slot of parents) {
        sim.stores.held[FOOD]![slot] = 16;
        sim.stores.held[FIREWOOD]![slot] = firewood;
      }
    };
    throughDawn(sim, 1, kept);
    lateNightOf(sim, 10, kept);
    return { sim, parents };
  };

  it("sleeps each of its two in its own parents' house, warm by that house's fire through a winter night", () => {
    const { sim, parents } = winter(HOUSE_FIREWOOD_LIMIT);
    const { villagers, households } = sim;
    const [son, daughter] = [2, 5];
    expect(isColdNight(sim.tick)).toBe(true);
    expect([villagers.household[son], villagers.household[daughter], households.home[2], households.atCamp]).toEqual([2, 2, NO_HOME, 0]);
    expect([villagers.state[son], villagers.state[daughter]]).toEqual([VillagerState.Inside, VillagerState.Inside]);
    expect([houseOf(households, villagers, son), houseOf(households, villagers, daughter)]).toEqual(parents);
    expect([sim.stores.burning[parents[0]!], sim.stores.burning[parents[1]!], sim.stores.burning[CAMP_STORE]]).toEqual([1, 1, 0]);
    expect(Array.from(villagers.coldNights.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(villagers.missedMeals.subarray(0, 6))).toEqual([0, 0, 0, 0, 0, 0]);
    expect([sim.tally.coldNights, sim.tally.froze]).toEqual([0, 0]);
  });

  it("has a cold night in its parents' house when that house's fire does not burn, as its parents do", () => {
    const { sim } = winter(0);
    expect(Array.from(sim.villagers.coldNights.subarray(0, 6))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('takes the house it lodges in when the last of that house\'s household dies, ahead of a lower household at the camp', () => {
    const sim = settlement([[...PARENTS, man(20)], [man(30), woman(28)], [...PARENTS, woman(21)]]);
    const parents = house(sim, 0);
    const other = house(sim, 1);
    pairSettlers(sim);
    const { households } = sim;
    expect(Array.from(households.home.subarray(0, 4))).toEqual([parents, other, NO_HOME, NO_HOME]);
    die(sim, 0, Cause.OldAge);
    die(sim, 1, Cause.OldAge);
    expect(Array.from(households.home.subarray(0, 4))).toEqual([NO_HOME, other, NO_HOME, parents]);
    expect([households.lodgers[parents], households.atCamp, sim.villagers.lodging[2]]).toEqual([0, 2, NO_HOME]);
  });

  it("eats from its parents' house and keeps three days of food there for each who lives in it, while one of its two from the camp eats at the camp", () => {
    const sim = settlement([[...PARENTS, man(20)], [...PARENTS, woman(21)]]);
    const parents = house(sim, 0);
    const [son, daughter] = [2, 5];
    expect(storeOf(sim, son)).toBe(parents);
    const before = lacks(sim, 0);
    pairSettlers(sim);
    const { households, villagers } = sim;
    expect([households.home[2], houseOf(households, villagers, son), houseOf(households, villagers, daughter)]).toEqual([NO_HOME, parents, NO_HOME]);
    expect([storeOf(sim, son), storeOf(sim, daughter)]).toEqual([parents, CAMP_STORE]);
    expect([households.atCamp, households.lodgers[parents], peopleIn(households, parents), lacks(sim, 0)]).toEqual([3, 1, 3, before]);
    expect(campLacks(sim)).toBe(Math.min(DAYS_KEPT_AT_CAMP * MEALS_PER_DAY * 3, sim.stores.campLimit) - sim.stores.held[FOOD]![CAMP_STORE]!);
    throughDawn(sim, 1);
    lateNightOf(sim, 2);
    expect([villagers.state[son], villagers.state[daughter]]).toEqual([VillagerState.Inside, VillagerState.Settling]);
    const own = house(sim, 1);
    expect(households.home[1]).toBe(own);
    const next = house(sim, 2);
    expect([households.home[2], storeOf(sim, son), storeOf(sim, daughter), households.atCamp, households.lodgers[parents]]).toEqual([next, next, next, 0, 0]);
  });
});

describe('a settler who pairs', () => {
  it("leaves its parents' household, which counts its living, its workers, and those at the camp, and still carries for the house it lodges in", () => {
    const sim = settlement([[...PARENTS, man(18), woman(8)], [...PARENTS, woman(17)]]);
    house(sim, 0);
    die(sim, 0, Cause.Hunger);
    die(sim, 1, Cause.Hunger);
    const { households } = sim;
    expect([households.living[0], households.workers[0], households.living[1], households.workers[1], households.atCamp, households.unattended]).toEqual([2, 1, 3, 3, 3, 0]);
    pairSettlers(sim);
    expect(couplesFrom(sim, 2)).toEqual([[2, 6]]);
    expect([households.living[0], households.workers[0], households.living[1], households.workers[1], households.atCamp, households.unattended]).toEqual([1, 0, 2, 2, 3, 0]);
    expect([households.living[2], households.workers[2], households.home[2], households.lodgers[households.home[0]!]]).toEqual([2, 2, NO_HOME, 1]);
    die(sim, 2, Cause.Hunger);
    expect([households.atCamp, households.unattended, households.lodgers[households.home[0]!]]).toEqual([3, 1, 0]);
  });

  it('keeps the house it was the last member of, with its food and firewood, for its own new household, ahead of a lower household without a home', () => {
    const run = (households: readonly (readonly StartingSettler[])[]) => {
      const sim = settlement(households);
      const left = house(sim, 0);
      const other = house(sim, 1);
      die(sim, 0, Cause.Hunger);
      die(sim, 1, Cause.Hunger);
      sim.stores.held[FOOD]![left] = 9;
      sim.stores.held[FIREWOOD]![left] = 4;
      pairSettlers(sim);
      const { home, householdIn } = sim.households;
      return { left, other, homes: Array.from(home.subarray(0, sim.households.count)), livesIn: householdIn[left], kept: [sim.stores.held[FOOD]![left], sim.stores.held[FIREWOOD]![left]] };
    };
    const withHomeless = run([[...PARENTS, man(18)], [...PARENTS, woman(17)], [man(30), woman(28)]]);
    expect(withHomeless.homes).toEqual([NO_HOME, withHomeless.other, NO_HOME, withHomeless.left]);
    expect([withHomeless.livesIn, withHomeless.kept]).toEqual([3, [9, 4]]);
    const alone = run([[...PARENTS, man(18)], [...PARENTS, woman(17)]]);
    expect(alone.homes).toEqual([NO_HOME, alone.other, alone.left]);
    expect([alone.livesIn, alone.kept]).toEqual([2, [9, 4]]);
  });
});

describe('the order of a dawn', () => {
  /** The first seed whose draw for household `h` falls under the chance at each dawn of `lucky`. */
  const seedFor = (h: number, lucky: readonly number[]) => {
    for (let seed = 1; ; seed++) if (lucky.every((dawn) => birthDraw(seed, h, dawn) < BIRTH_CHANCE)) return seed;
  };

  it('pairs before the births: a daughter who leaves a house of 5 for an empty house makes room for a child at the same dawn', () => {
    expect(DAWN.map((stepOf) => stepOf.name)).toEqual(['breakDay', 'dieOfOldAge', 'startWork', 'pairSettlers', 'bearChildren']);
    const born = (suitor: number) => {
      const sim = settlement([[man(40), woman(38), woman(16), man(8), woman(6)], [...PARENTS, man(suitor)]], { seed: seedFor(0, [1]), seen: BIRTH_GAP });
      house(sim, 0);
      house(sim, 1);
      house(sim, 2);
      throughDawn(sim, 1);
      return { paired: sim.tally.paired, births: sim.tally.births, child: sim.villagers.household[sim.villagers.count - 1], living: sim.households.living[0] };
    };
    expect(born(17)).toEqual({ paired: 1, births: 1, child: 0, living: 5 });
    expect(born(15)).toEqual({ paired: 0, births: 0, child: 1, living: 5 });
  });

  it('counts a daughter who pairs with no house empty among the 5 of her parents\' house, so it has no child until she moves out', () => {
    const sim = settlement([[man(40), woman(38), woman(16), man(8), woman(6)], [...PARENTS, man(17)]], { seed: seedFor(0, [1, 2]), seen: BIRTH_GAP });
    const parents = house(sim, 0);
    throughDawn(sim, 1);
    const { households } = sim;
    expect([sim.tally.paired, sim.tally.births, households.living[0], peopleIn(households, parents)]).toEqual([1, 0, 4, 5]);
    house(sim, 1);
    expect([households.home[1], households.home[2], peopleIn(households, parents)]).toEqual([households.houses[1], NO_HOME, 5]);
    const own = house(sim, 2);
    expect([households.home[2], peopleIn(households, parents)]).toEqual([own, 4]);
    throughDawn(sim, 2);
    expect([sim.tally.births, households.living[0], peopleIn(households, parents)]).toEqual([1, 5, 5]);
  });

  it('runs a death of old age, a start of work, a pairing, and a birth at one dawn, in that order', () => {
    const lucky = 3;
    const sim = settlement(
      [
        [man(32), woman(30), man(9)],
        [{ sex: Sex.Man, age: 69, span: 70 }, woman(48), woman(15)],
        [...PARENTS, man(18)],
      ],
      { seed: seedFor(0, [lucky]), seen: BIRTH_GAP + 1 - lucky },
    );
    const [boy, old, daughter, son] = [2, 3, 5, 8];
    house(sim, 0);
    throughDawn(sim, lucky - 1);
    expect([sim.tally.oldAge, sim.tally.startedWork, sim.tally.paired, sim.tally.births]).toEqual([0, 0, 0, 0]);
    expect([sim.villagers.child[boy], sim.households.workers[0]]).toEqual([1, 2]);
    throughDawn(sim, lucky);
    expect([sim.tally.oldAge, sim.tally.startedWork, sim.tally.paired, sim.tally.births]).toEqual([1, 1, 1, 1]);
    expect(sim.villagers.cause[old]).toBe(Cause.OldAge);
    expect([sim.villagers.child[boy], sim.households.workers[0]]).toEqual([0, 3]);
    expect([sim.households.man[3], sim.households.woman[3], sim.households.living[1], sim.households.living[2]]).toEqual([son, daughter, 1, 2]);
    expect([sim.villagers.household[sim.villagers.count - 1], sim.households.living[0]]).toEqual([0, 4]);
  });

  it('pairs a working child stated at 15 at the dawn after it turns 16, and takes it out of its parents\' workers', () => {
    const sim = settlement([[...PARENTS, woman(15)], [...PARENTS, man(17)]]);
    const daughter = 2;
    throughDawn(sim, 2);
    expect([isSingle(sim, daughter), sim.villagers.child[daughter], sim.households.workers[0], sim.households.count]).toEqual([false, 0, 3, 2]);
    throughDawn(sim, 3);
    expect([sim.villagers.household[daughter], sim.households.woman[2], sim.households.workers[0], sim.households.workers[2]]).toEqual([2, daughter, 2, 2]);
  });

  it(`gives a new household no birth before it has seen more than ${BIRTH_GAP} dawns, though its draws fall under the chance`, () => {
    const first = BIRTH_GAP + 2;
    const seed = (() => {
      for (let seed = 1; ; seed++) {
        if (birthDraw(seed, 2, first) >= BIRTH_CHANCE) continue;
        if (Array.from({ length: BIRTH_GAP }, (_, at) => birthDraw(seed, 2, at + 2)).some((draw) => draw < BIRTH_CHANCE)) return seed;
      }
    })();
    const sim = settlement([[...PARENTS, man(20)], [...PARENTS, woman(20)]], { seed });
    const slots = [house(sim, 0), house(sim, 1), house(sim, 2)];
    const stocked = () => {
      for (const slot of slots) {
        sim.stores.held[FOOD]![slot] = 16;
        sim.stores.held[FIREWOOD]![slot] = 6;
      }
    };
    throughDawn(sim, 1, stocked);
    expect([sim.households.count, sim.households.home[2], sim.households.lastBirth[2], sim.tally.paired]).toEqual([3, slots[2], 1, 1]);
    const people = sim.villagers.count;
    throughDawn(sim, first - 1, stocked);
    expect(sim.villagers.count).toBe(people);
    throughDawn(sim, first, stocked);
    expect([sim.villagers.count, sim.villagers.household[people]]).toEqual([people + 1, 2]);
  });
});
