import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building, Job } from './buildings';
import { TICKS_PER_DAY, dateAt, tickOfDay } from './calendar';
import { isDawn, isNight } from './daylight';
import { EATING } from './eating';
import { GATHERING } from './gathering';
import { Good, putDown } from './goods';
import { jobOf } from './jobs';
import { type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_FIREWOOD_LIMIT, CAMP_STORE, HOUSE_FIREWOOD_LIMIT } from './stores';
import { taskKind } from './tasks';
import { at, mapFrom } from './testMaps';
import { VillagerState } from './villagerState';
import { Stop } from './workshops';

const FIREWOOD = Good.Firewood - 1;
const FOOD = Good.Food - 1;
const YEAR = TICKS_PER_DAY * 14;

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

/** An open map of 40 tiles a side with a 2 by 2 island at (2, 2) that no walk reaches. The camp is at its middle. */
function withIsland(): string[] {
  const rows = open(40);
  for (let y = 1; y <= 5; y++) rows[y] = '.~~~~~' + '.'.repeat(34);
  rows[2] = '.~..~~' + '.'.repeat(34);
  rows[3] = '.~..~~' + '.'.repeat(34);
  return rows;
}

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/** Runs to the first tick of the night that falls at the dusk of `day`, before any villager has set out for home. */
const duskOf = (sim: Sim, day: number, each?: () => void) =>
  runUntil(sim, () => dateAt(sim.tick).day === day && isNight(sim.tick) && tickOfDay(sim.tick) >= TICKS_PER_DAY / 2, YEAR, each);
/** Runs to the last tick of the night that falls at the dusk of `day`, so every villager has come home or never will, and the dawn has not run. */
const lateNightOf = (sim: Sim, day: number, each?: () => void) => runUntil(sim, () => isDawn(sim.tick) && dateAt(sim.tick).day === day + 1, YEAR, each);

const cold = (sim: Sim) => Array.from(sim.villagers.coldNights.subarray(0, sim.villagers.count));
const missed = (sim: Sim) => Array.from(sim.villagers.missedMeals.subarray(0, sim.villagers.count));
const states = (sim: Sim) => Array.from(sim.villagers.state.subarray(0, sim.villagers.count));
const firewood = (sim: Sim, store: number) => sim.stores.held[FIREWOOD]![store]!;
const firewoodOnGround = (sim: Sim) => {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Firewood) units += sim.map.stackSize[tile]!;
  return units;
};

/** A building of `kind` anchored on (x, y), finished at once. Returns its slot. */
function finished(sim: Sim, kind: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

/** Strands a villager on the island, from where it never reaches the camp or its door. */
function strand(sim: Sim, id: number): void {
  sim.villagers.x[id] = 2.5;
  sim.villagers.y[id] = 2.5;
}

/** One household of two settlers in a house finished at once on an island map, with `wood` firewood in the house and plenty of food at the camp. */
function housed(wood: number): { sim: Sim; house: number } {
  const sim = createSim(mapFrom(withIsland()), { villagers: 2, monsters: 0, campFood: 100, animals: false });
  const house = finished(sim, Building.House, 14, 14);
  sim.stores.held[FIREWOOD]![house] = wood;
  return { sim, house };
}

describe('a winter night at the camp', () => {
  it('is a cold night at each winter dusk, after its meal, and the third in a row kills, while no night before winter is cold', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    runUntil(sim, () => dateAt(sim.tick).season === 'Winter', YEAR, () => expect(cold(sim), `tick ${sim.tick}`).toEqual([0, 0]));
    expect(dateAt(sim.tick).day).toBe(10);
    expect(sim.tally.coldNights).toBe(0);
    for (const [day, nights] of [[10, 1], [11, 2]] as const) {
      lateNightOf(sim, day);
      expect(states(sim), `day ${day}`).toEqual([VillagerState.Settling, VillagerState.Settling]);
      expect(cold(sim), `day ${day}`).toEqual([nights, nights]);
      expect(sim.tally.coldNights, `day ${day}`).toBe(2 * nights);
    }
    const meals = sim.tally.meals;
    const food = sim.stores.held[FOOD]![CAMP_STORE]!;
    runUntil(sim, () => sim.over, TICKS_PER_DAY);
    expect(dateAt(sim.tick - 1)).toMatchObject({ day: 12, season: 'Winter' });
    expect(isNight(sim.tick - 1)).toBe(true);
    expect(states(sim)).toEqual([VillagerState.Dead, VillagerState.Dead]);
    expect(cold(sim)).toEqual([3, 3]);
    expect(missed(sim)).toEqual([0, 0]);
    expect(sim.tally).toMatchObject({ meals: meals + 2, missed: 0, starved: 0, froze: 2, died: 2, coldNights: 6 });
    expect(sim.stores.held[FOOD]![CAMP_STORE]).toBe(food - 2);
  });

  it('is warm outside winter, which clears the cold nights a settler had', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    sim.villagers.coldNights.fill(2);
    lateNightOf(sim, 1);
    expect(cold(sim)).toEqual([0, 0]);
    expect(sim.tally.coldNights).toBe(0);
  });

  it("is a cold night for a settler that never gets home on the winter's last night, judged at the spring dawn after it", () => {
    const sim = createSim(mapFrom(withIsland()), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    duskOf(sim, 12);
    sim.villagers.coldNights.fill(0);
    strand(sim, 0);
    lateNightOf(sim, 12);
    expect(states(sim)).toEqual([VillagerState.GoingToCamp, VillagerState.Settling]);
    expect(cold(sim)).toEqual([0, 1]);
    step(sim);
    expect(dateAt(sim.tick - 1)).toMatchObject({ day: 13, season: 'Spring' });
    expect(cold(sim)).toEqual([1, 1]);
    expect(missed(sim)).toEqual([1, 0]);
  });

  it('is no cold night for a settler that never gets home on the last night of autumn, judged at the winter dawn after it', () => {
    const sim = createSim(mapFrom(withIsland()), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    duskOf(sim, 9);
    strand(sim, 0);
    lateNightOf(sim, 9);
    expect(states(sim)).toEqual([VillagerState.GoingToCamp]);
    step(sim);
    expect(dateAt(sim.tick - 1)).toMatchObject({ day: 10, season: 'Winter' });
    expect(missed(sim)).toEqual([1]);
    expect(cold(sim)).toEqual([0]);
    expect(sim.tally.coldNights).toBe(0);
  });
});

describe('the camp fire', () => {
  it('takes 4 firewood when the first settler comes home on a winter night, once a night, and warms nobody without clothing', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    sim.stores.held[FIREWOOD]![CAMP_STORE] = 8;
    duskOf(sim, 10, () => {
      expect(firewood(sim, CAMP_STORE), `tick ${sim.tick}`).toBe(8);
      expect(sim.stores.burning[CAMP_STORE]).toBe(0);
    });
    runUntil(sim, () => states(sim).includes(VillagerState.Settling), TICKS_PER_DAY, () => {
      if (!states(sim).includes(VillagerState.Settling)) expect(firewood(sim, CAMP_STORE)).toBe(8);
    });
    expect([firewood(sim, CAMP_STORE), sim.stores.burning[CAMP_STORE], sim.tally.fires, sim.tally.burnt]).toEqual([4, 1, 1, 4]);
    lateNightOf(sim, 10);
    expect(states(sim)).toEqual([VillagerState.Settling, VillagerState.Settling]);
    expect([firewood(sim, CAMP_STORE), sim.tally.fires]).toEqual([4, 1]);
    expect(cold(sim)).toEqual([1, 1]);
    step(sim);
    expect(sim.stores.burning[CAMP_STORE]).toBe(0);
    lateNightOf(sim, 11);
    expect([firewood(sim, CAMP_STORE), sim.stores.burning[CAMP_STORE], sim.tally.fires, sim.tally.burnt]).toEqual([0, 1, 2, 8]);
    expect(cold(sim)).toEqual([2, 2]);
  });
});

describe('a house fire', () => {
  it('burns 2 firewood when the first member comes home on a winter night, once a night, and keeps both members warm', () => {
    const { sim, house } = housed(4);
    duskOf(sim, 10, () => expect(firewood(sim, house), `tick ${sim.tick}`).toBe(4));
    expect(sim.tally.fires).toBe(0);
    runUntil(sim, () => states(sim).includes(VillagerState.Inside), TICKS_PER_DAY, () => {
      if (!states(sim).includes(VillagerState.Inside)) expect(firewood(sim, house)).toBe(4);
    });
    expect([firewood(sim, house), sim.stores.burning[house], sim.tally.fires, sim.tally.burnt]).toEqual([2, 1, 1, 2]);
    lateNightOf(sim, 10);
    expect(states(sim)).toEqual([VillagerState.Inside, VillagerState.Inside]);
    expect([firewood(sim, house), sim.tally.fires]).toEqual([2, 1]);
    expect(cold(sim)).toEqual([0, 0]);
    step(sim);
    expect(sim.stores.burning[house]).toBe(0);
    lateNightOf(sim, 11);
    expect([firewood(sim, house), sim.stores.burning[house], sim.tally.fires, sim.tally.burnt]).toEqual([0, 1, 2, 4]);
    expect(cold(sim)).toEqual([0, 0]);
    lateNightOf(sim, 12);
    expect([sim.stores.burning[house], sim.tally.fires]).toEqual([0, 2]);
    expect(cold(sim)).toEqual([1, 1]);
  });

  it('does not burn in a house that holds 1 firewood, which it keeps, and both members are cold; a warm night after clears the count', () => {
    const { sim, house } = housed(1);
    lateNightOf(sim, 10);
    expect(states(sim)).toEqual([VillagerState.Inside, VillagerState.Inside]);
    expect([firewood(sim, house), sim.stores.burning[house], sim.tally.fires]).toEqual([1, 0, 0]);
    expect(cold(sim)).toEqual([1, 1]);
    sim.stores.held[FIREWOOD]![house] = 2;
    lateNightOf(sim, 11);
    expect([firewood(sim, house), sim.tally.fires]).toEqual([0, 1]);
    expect(cold(sim)).toEqual([0, 0]);
  });

  it('does not warm a member that never gets home, judged at dawn, while the member at home is warm by it', () => {
    const { sim, house } = housed(6);
    duskOf(sim, 11);
    strand(sim, 0);
    lateNightOf(sim, 11);
    expect(states(sim)).toEqual([VillagerState.GoingIn, VillagerState.Inside]);
    expect(sim.stores.burning[house]).toBe(1);
    expect(cold(sim)).toEqual([0, 0]);
    step(sim);
    expect(cold(sim)).toEqual([1, 0]);
    expect(missed(sim)).toEqual([1, 0]);
    expect(sim.tally.coldNights).toBe(1);
  });

  it('stays out on every night before winter, and the house keeps its firewood', () => {
    const { sim, house } = housed(6);
    duskOf(sim, 10, () => {
      expect(firewood(sim, house), `tick ${sim.tick}`).toBe(6);
      expect(sim.stores.burning[house]).toBe(0);
    });
    expect([sim.tally.fires, sim.tally.burnt]).toEqual([0, 0]);
  });
});

describe('the half rate of a cold settler', () => {
  /** Ticks a lone settler takes to walk to a marked tree and to fell it, after `coldNights` cold nights. */
  function fell(coldNights: number): { walk: number; work: number } {
    const rows = open(24);
    rows[4] = '.'.repeat(20) + 'T...';
    const sim = createSim(mapFrom(rows), { villagers: 1, monsters: 0 });
    sim.villagers.coldNights[0] = coldNights;
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 20, y0: 4, x1: 20, y1: 4 } });
    runUntil(sim, () => sim.villagers.task[0] !== 0, 20);
    const taken = sim.tick;
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working, 600);
    const working = sim.tick;
    runUntil(sim, () => sim.map.trees[at(sim.map, 20, 4)] === 0, 2000);
    return { walk: working - taken, work: sim.tick - working };
  }

  it('halves the rate a settler works at after 1 or 2 cold nights, and leaves its walk as fast', () => {
    const warm = fell(0);
    for (const nights of [1, 2]) {
      const chilled = fell(nights);
      expect(chilled.walk, `${nights} cold`).toBe(warm.walk);
      expect(Math.abs(chilled.work - 2 * warm.work), `${nights} cold: ${chilled.work} ticks against ${warm.work}`).toBeLessThanOrEqual(2);
    }
  });

  it('has a settler that is cold and hungry at once eat first, which ends its hunger and not its cold, and fell at half the rate after', () => {
    const warm = fell(0);
    const rows = open(24);
    rows[4] = '.'.repeat(20) + 'T...';
    const sim = createSim(mapFrom(rows), { villagers: 1, monsters: 0 });
    sim.villagers.coldNights[0] = 1;
    sim.villagers.missedMeals[0] = 1;
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 20, y0: 4, x1: 20, y1: 4 } });
    runUntil(sim, () => sim.villagers.task[0] !== 0, 20);
    expect(taskKind(sim, 0)).toBe(EATING);
    runUntil(sim, () => sim.villagers.missedMeals[0] === 0, 600);
    expect([sim.villagers.missedMeals[0], sim.villagers.coldNights[0]]).toEqual([0, 1]);
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Working && taskKind(sim, 0) === GATHERING, 1200);
    const working = sim.tick;
    runUntil(sim, () => sim.map.trees[at(sim.map, 20, 4)] === 0, 2000);
    expect(Math.abs(sim.tick - working - 2 * warm.work), `${sim.tick - working} ticks against ${warm.work}`).toBeLessThanOrEqual(2);
  });
});

describe('stocking firewood', () => {
  it('carries firewood home 1 unit at a time up to 6 after the food, by a member with a job', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    const house = finished(sim, Building.House, 16, 14);
    const shed = finished(sim, Building.Woodshed, 23, 14);
    expect(jobOf(sim, 0)).toBe(Job.Woodcutter);
    sim.stores.held[FIREWOOD]![shed] = 20;
    const landed: string[] = [];
    let before = [0, 0];
    runUntil(sim, () => firewood(sim, house) === HOUSE_FIREWOOD_LIMIT, TICKS_PER_DAY / 2, () => {
      const now = [sim.stores.held[FOOD]![house]!, firewood(sim, house)];
      if (now[0]! > before[0]!) landed.push(`${now[0]! - before[0]!} food`);
      if (now[1]! > before[1]!) landed.push(`${now[1]! - before[1]!} firewood`);
      expect(now[1]! + sim.stores.inbound[FIREWOOD]![house]!).toBeLessThanOrEqual(HOUSE_FIREWOOD_LIMIT);
      before = now;
    });
    expect(isNight(sim.tick)).toBe(false);
    expect(landed).toEqual([...Array(3).fill('1 food'), ...Array(6).fill('1 firewood')]);
    for (let tick = 0; tick < 300; tick++) step(sim);
    expect([firewood(sim, house), firewood(sim, shed), firewood(sim, CAMP_STORE)]).toEqual([6, 14, 0]);
    expect([sim.tally.firewoodHome, sim.tally.firewoodToCamp]).toEqual([6, 0]);
  });

  it('carries firewood from the woodshed to the camp up to 12 while a household sleeps there, by the settlers without a job only', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 4, monsters: 0, campFood: 100, animals: false });
    const shed = finished(sim, Building.Woodshed, 24, 14);
    sim.stores.held[FIREWOOD]![shed] = 20;
    const woodcutter = sim.villagers.workplace.indexOf(shed);
    expect(sim.households.atCamp).toBe(4);
    runUntil(sim, () => firewood(sim, CAMP_STORE) === CAMP_FIREWOOD_LIMIT, TICKS_PER_DAY / 2, () => {
      expect(firewood(sim, CAMP_STORE) + sim.stores.inbound[FIREWOOD]![CAMP_STORE]!).toBeLessThanOrEqual(CAMP_FIREWOOD_LIMIT);
      expect(sim.villagers.carried[woodcutter]).not.toBe(Good.Firewood);
    });
    expect(isNight(sim.tick)).toBe(false);
    for (let tick = 0; tick < 300; tick++) step(sim);
    expect([firewood(sim, CAMP_STORE), firewood(sim, shed), sim.tally.firewoodToCamp]).toEqual([12, 8, 12]);
  });

  it('carries no firewood to the camp when every household has a home', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    const house = finished(sim, Building.House, 16, 14);
    const shed = finished(sim, Building.Woodshed, 23, 14);
    sim.stores.held[FIREWOOD]![shed] = 20;
    expect(sim.households.atCamp).toBe(0);
    expect([0, 1].map((id) => jobOf(sim, id)).sort()).toEqual([Job.None, Job.Woodcutter].sort());
    runUntil(sim, () => firewood(sim, house) === HOUSE_FIREWOOD_LIMIT, TICKS_PER_DAY / 2);
    for (let tick = 0; tick < 300; tick++) step(sim);
    expect([firewood(sim, house), firewood(sim, shed), firewood(sim, CAMP_STORE), sim.stores.inbound[FIREWOOD]![CAMP_STORE]]).toEqual([6, 14, 0, 0]);
    expect(sim.tally.firewoodToCamp).toBe(0);
  });

  it('starts the woodcutter of a full shed again once a carrier takes firewood out', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 26, y0: 18, x1: 26, y1: 18 } })).toMatchObject({ ok: true });
    expect(putDown(sim, at(sim.map, 26, 18), Good.Log, 4)).toBe(true);
    const shed = finished(sim, Building.Woodshed, 23, 14);
    sim.stores.held[FIREWOOD]![shed] = 40;
    sim.stores.held[FIREWOOD]![CAMP_STORE] = CAMP_FIREWOOD_LIMIT;
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect([sim.workshops.stopped[shed], sim.tally.batches, firewood(sim, shed)]).toEqual([Stop.Full, 0, 40]);
    const house = finished(sim, Building.House, 16, 14);
    sim.stores.held[FIREWOOD]![CAMP_STORE] = 0;
    runUntil(sim, () => sim.tally.batches > 0, TICKS_PER_DAY / 2);
    expect(firewood(sim, house)).toBeGreaterThanOrEqual(2);
    expect(sim.workshops.stopped[shed]).not.toBe(Stop.Full);
  });
});

describe("stocking a home from the camp's firewood", () => {
  it('takes firewood for a home from the camp while no household sleeps there and the camp is nearer than the woodshed', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    const house = finished(sim, Building.House, 15, 15);
    const shed = finished(sim, Building.Woodshed, 34, 34);
    sim.stores.held[FIREWOOD]![shed] = 20;
    sim.stores.held[FIREWOOD]![CAMP_STORE] = CAMP_FIREWOOD_LIMIT;
    expect(sim.households.atCamp).toBe(0);
    runUntil(sim, () => firewood(sim, house) === HOUSE_FIREWOOD_LIMIT, TICKS_PER_DAY / 2);
    expect([firewood(sim, CAMP_STORE), firewood(sim, shed)]).toEqual([CAMP_FIREWOOD_LIMIT - HOUSE_FIREWOOD_LIMIT, 20]);
  });

  it('takes it from the woodshed when the woodshed is nearer, and from the camp once the woodshed is empty', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    const house = finished(sim, Building.House, 5, 5);
    const shed = finished(sim, Building.Woodshed, 9, 4);
    sim.stores.held[FIREWOOD]![shed] = 4;
    sim.stores.held[FIREWOOD]![CAMP_STORE] = CAMP_FIREWOOD_LIMIT;
    runUntil(sim, () => firewood(sim, house) === HOUSE_FIREWOOD_LIMIT, TICKS_PER_DAY / 2);
    expect([firewood(sim, shed), firewood(sim, CAMP_STORE)]).toEqual([0, CAMP_FIREWOOD_LIMIT - 2]);
  });

  it("leaves the camp's firewood to the camp while a household sleeps there", () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 4, monsters: 0, campFood: 100, animals: false });
    const house = finished(sim, Building.House, 15, 15);
    const shed = finished(sim, Building.Woodshed, 34, 34);
    sim.stores.held[FIREWOOD]![shed] = 20;
    sim.stores.held[FIREWOOD]![CAMP_STORE] = CAMP_FIREWOOD_LIMIT;
    expect(sim.households.atCamp).toBe(2);
    runUntil(sim, () => firewood(sim, house) === HOUSE_FIREWOOD_LIMIT, TICKS_PER_DAY / 2);
    expect([firewood(sim, CAMP_STORE), sim.tally.firewoodToCamp]).toEqual([CAMP_FIREWOOD_LIMIT, 0]);
  });
});

describe('loose firewood', () => {
  it('is carried by settlers without a job to the camp while the camp has room, and the rest lies on the ground', () => {
    const sim = createSim(mapFrom(open(24)), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    sim.stores.held[FIREWOOD]![CAMP_STORE] = CAMP_FIREWOOD_LIMIT - 3;
    expect(putDown(sim, at(sim.map, 4, 4), Good.Firewood, 5)).toBe(true);
    runUntil(sim, () => firewood(sim, CAMP_STORE) === CAMP_FIREWOOD_LIMIT, TICKS_PER_DAY / 3);
    for (let tick = 0; tick < 300; tick++) step(sim);
    expect([firewood(sim, CAMP_STORE), firewoodOnGround(sim)]).toEqual([CAMP_FIREWOOD_LIMIT, 2]);
    expect(sim.villagers.carried.includes(Good.Firewood)).toBe(false);
  });
});
