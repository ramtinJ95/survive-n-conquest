import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { BUILDINGS, Building } from './buildings';
import { isDawn, isNight } from './daylight';
import { Good } from './goods';
import { MAX_HOUSEHOLDS, NO_HOME, createHouseholds } from './households';
import { tileAt } from './map';
import { generateMap } from './mapgen';
import { NAMES, Sex, nameOf } from './names';
import { type OrderCommand, SiteState, setSiteWork } from './orders';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { at, mapFrom } from './testMaps';
import { THINK_GROUPS, VillagerState } from './villagers';

const house = (x: number, y: number): OrderCommand => ({ kind: 'place', building: Building.House, x, y });
const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

const ROW = [5, 11, 17, 23, 29];

/**
 * Room for houses centered on row 8 of an open 40 by 40 map at the columns of
 * `ROW`, each with its 12 logs and 6 stone lying four tiles below it. The camp
 * is at (19, 19). With `loose`, 80 more logs lie in the bottom right corner,
 * for a stockpile in the bottom left to take.
 */
function housesWithGoods(villagers: number, loose = false): Sim {
  const map = mapFrom(open(40));
  const lay = (x: number, y: number, good: Good, size: number) => {
    map.stackGood[at(map, x, y)] = good;
    map.stackSize[at(map, x, y)] = size;
  };
  for (const x of ROW) {
    lay(x, 12, Good.Log, 8);
    lay(x + 1, 12, Good.Log, 4);
    lay(x - 1, 12, Good.Stone, 6);
  }
  if (loose) for (let x = 28; x < 38; x++) lay(x, 34, Good.Log, 8);
  const sim = createSim(map, { villagers, monsters: 0 });
  if (loose) applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 2, y0: 30, x1: 6, y1: 37 } });
  return sim;
}

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

const ids = (sim: Sim) => Array.from(sim.villagers.state, (_, id) => id);
const homeOf = (sim: Sim, id: number) => sim.households.home[sim.villagers.household[id]!]!;
const tileOf = (sim: Sim, id: number) => tileAt(sim.map, sim.villagers.x[id]!, sim.villagers.y[id]!);
const atCamp = (sim: Sim, id: number) => sim.villagers.x[id] === sim.villagers.spotX[id] && sim.villagers.y[id] === sim.villagers.spotY[id];
const onCenter = (sim: Sim, id: number) => [sim.villagers.x[id]! % 1, sim.villagers.y[id]! % 1];
const logs = (sim: Sim) => {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Log) units += sim.map.stackSize[tile]!;
  return units + sim.villagers.carried.filter((good) => good === Good.Log).length;
};

/** The twelve tiles that share a side with one of a house's nine tiles. */
function besideHouse(sim: Sim, slot: number): number[] {
  const { x, y } = sim.orders.sites;
  const beside: number[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dy) <= 1) beside.push(at(sim.map, x[slot]! + dx, y[slot]! + dy));
      if (Math.abs(dy) === 2 && Math.abs(dx) <= 1) beside.push(at(sim.map, x[slot]! + dx, y[slot]! + dy));
    }
  }
  return beside;
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
    expect(createHouseholds(MAX_HOUSEHOLDS * 2).home.length).toBe(MAX_HOUSEHOLDS);
    expect(() => createHouseholds(MAX_HOUSEHOLDS * 2 + 1)).toThrow();
  });
});

describe('moving into a house', () => {
  it('gives each finished house to the lowest household with no home, in the order they finish, and leaves a house past the last household empty', () => {
    const sim = housesWithGoods(8);
    for (const x of ROW) applyCommand(sim, house(x, 8));
    const finished: number[] = [];
    runUntil(sim, () => finished.length === ROW.length, 6000, () => {
      for (let slot = 0; slot < ROW.length; slot++) {
        if (sim.orders.sites.state[slot] === SiteState.Built && !finished.includes(slot)) finished.push(slot);
      }
    });
    expect(finished).not.toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(sim.households.home)).toEqual(finished.slice(0, 4));
  });

  it('gives two houses finished in one tick to the two lowest households with no home, by internals', () => {
    const sim = housesWithGoods(8);
    for (const x of ROW.slice(0, 3)) applyCommand(sim, house(x, 8));
    finishBuilding(sim, 1);
    step(sim);
    finishBuilding(sim, 2);
    finishBuilding(sim, 0);
    expect(Array.from(sim.households.home)).toEqual([1, 2, 0, NO_HOME]);
  });

  it('leaves every household with no home at the start', () => {
    expect(Array.from(createSim(generateMap(7, 64), SETTLERS).households.home)).toEqual(Array(4).fill(NO_HOME));
  });
});

describe('a night with homes', () => {
  it('sees housed settlers put down what they carry and go into a tile beside their house, the others reach the camp, and all come out at dawn to work again', () => {
    const sim = housesWithGoods(8, true);
    applyCommand(sim, house(17, 8));
    applyCommand(sim, house(23, 8));
    runUntil(sim, () => isNight(sim.tick), 2000);
    const housed = ids(sim).filter((id) => homeOf(sim, id) !== NO_HOME);
    const homeless = ids(sim).filter((id) => homeOf(sim, id) === NO_HOME);
    expect(housed).toEqual([0, 1, 2, 3]);
    expect(housed.some((id) => sim.villagers.carried[id] !== Good.None)).toBe(true);
    const units = logs(sim);

    step(sim);
    expect(ids(sim).map((id) => [sim.villagers.task[id], sim.villagers.carried[id]])).toEqual(ids(sim).map(() => [0, Good.None]));
    expect(logs(sim)).toBe(units);

    const doors = new Map<number, number>();
    runUntil(sim, () => isDawn(sim.tick), 1500, () => {
      for (const id of housed) {
        if (sim.villagers.state[id] !== VillagerState.Inside) expect(doors.has(id), `villager ${id} came out at night`).toBe(false);
        else if (!doors.has(id)) doors.set(id, tileOf(sim, id));
        else expect(tileOf(sim, id)).toBe(doors.get(id));
      }
    });
    for (const id of housed) {
      expect(besideHouse(sim, homeOf(sim, id))).toContain(doors.get(id));
      expect(onCenter(sim, id)).toEqual([0.5, 0.5]);
      expect(sim.villagers.task[id]).toBe(0);
    }
    for (const id of homeless) expect(atCamp(sim, id), `villager ${id}`).toBe(true);

    step(sim);
    for (const id of housed) {
      expect(sim.villagers.state[id]).not.toBe(VillagerState.Inside);
      expect(tileOf(sim, id)).toBe(doors.get(id));
    }
    expect(sim.villagers.state[1]).toBe(VillagerState.Idle);
    runUntil(sim, () => housed.every((id) => sim.villagers.task[id] !== 0), 10);
  });

  it('sees housed settlers put down what they carry at dusk and stand until the tick of their group, then set out, all within a round of groups', () => {
    const sim = housesWithGoods(8, true);
    applyCommand(sim, house(17, 8));
    applyCommand(sim, house(23, 8));
    runUntil(sim, () => isNight(sim.tick), 2000);
    const housed = ids(sim).filter((id) => homeOf(sim, id) !== NO_HOME);
    expect(housed).toEqual([0, 1, 2, 3]);
    expect(housed.some((id) => sim.villagers.carried[id] !== Good.None)).toBe(true);
    const dusk = sim.tick;
    const setOut = new Map<number, number>();
    for (let round = 0; round < THINK_GROUPS; round++) {
      const tick = sim.tick;
      const before = housed.map((id) => [sim.villagers.x[id], sim.villagers.y[id]]);
      step(sim);
      housed.forEach((id, i) => {
        expect(sim.villagers.state[id]).toBe(VillagerState.GoingIn);
        expect([sim.villagers.task[id], sim.villagers.carried[id]]).toEqual([0, Good.None]);
        const moved = sim.villagers.x[id] !== before[i]![0] || sim.villagers.y[id] !== before[i]![1];
        if (moved && !setOut.has(id)) setOut.set(id, tick);
      });
    }
    for (const id of housed) {
      const tick = setOut.get(id);
      expect(tick, `villager ${id} set out`).toBeDefined();
      expect(tick! % THINK_GROUPS, `villager ${id}`).toBe(id % THINK_GROUPS);
      expect(tick! - dusk).toBeLessThan(THINK_GROUPS);
    }
    expect(housed.some((id) => setOut.get(id) !== dusk)).toBe(true);
  });

  it('sees a housed settler with no walk to the camp stay where it stands all night and plan no route, by internals for the house', () => {
    const rows = open(16);
    for (const y of [11, 12]) rows[y] = '~'.repeat(16);
    for (const y of [13, 14, 15]) rows[y] = '...' + '~'.repeat(13);
    const sim = createSim(mapFrom(rows), { villagers: 1, monsters: 0 });
    expect(applyCommand(sim, house(12, 3))).toMatchObject({ ok: true });
    finishBuilding(sim, 0);
    expect(sim.households.home[0]).toBe(0);
    runUntil(sim, () => isNight(sim.tick), 2000);
    sim.villagers.x[0] = 1.5;
    sim.villagers.y[0] = 14.5;
    const searches = sim.pathSearch.searches;
    runUntil(sim, () => isDawn(sim.tick), 1500, () => {
      expect(sim.pathSearch.searches).toBe(searches);
      expect([sim.villagers.x[0], sim.villagers.y[0]]).toEqual([1.5, 14.5]);
      expect(sim.villagers.state[0]).not.toBe(VillagerState.Inside);
    });
  });

  it('keeps a household that gets its home in the night at the camp until dawn, and sends it in at the next dusk, by internals for the house', () => {
    const sim = createSim(mapFrom(open(40)), SETTLERS);
    expect(applyCommand(sim, house(17, 8))).toMatchObject({ ok: true });
    runUntil(sim, () => isNight(sim.tick), 2000);
    runUntil(sim, () => ids(sim).every((id) => atCamp(sim, id)), 600);
    finishBuilding(sim, 0);
    expect(sim.households.home[0]).toBe(0);
    runUntil(sim, () => isDawn(sim.tick), 1500, () => {
      for (const id of ids(sim)) expect(atCamp(sim, id), `villager ${id} on tick ${sim.tick}`).toBe(true);
    });
    step(sim);
    runUntil(sim, () => isNight(sim.tick), 2000);
    runUntil(sim, () => sim.villagers.state[0] === VillagerState.Inside && sim.villagers.state[1] === VillagerState.Inside, 600);
    runUntil(sim, () => ids(sim).slice(2).every((id) => atCamp(sim, id)), 600);
  });

  it('sends a household whose builders finish its house on the last day tick into it at that dusk, with the site work set so it ends on that tick', () => {
    const sim = housesWithGoods(8);
    expect(applyCommand(sim, house(17, 8))).toMatchObject({ ok: true });
    runUntil(sim, () => sim.orders.sites.work[0]! > 0 && !isNight(sim.tick), 3000);
    runUntil(sim, () => isNight(sim.tick + 1), 3000, () => setSiteWork(sim.orders, 0, 1));
    expect(sim.orders.sites.work[0]).toBeGreaterThan(0);
    setSiteWork(sim.orders, 0, BUILDINGS[Building.House].workTicks - 1);
    const built = sim.tally.built;
    const finishedAtNight = isNight(sim.tick);
    step(sim);
    expect(sim.tally.built).toBe(built + 1);
    expect(finishedAtNight).toBe(false);
    expect(sim.orders.sites.state[0]).toBe(SiteState.Built);
    const members = ids(sim).filter((id) => homeOf(sim, id) === 0);
    const others = ids(sim).filter((id) => homeOf(sim, id) !== 0);
    expect(members).toHaveLength(2);
    runUntil(sim, () => members.every((id) => sim.villagers.state[id] === VillagerState.GoingIn), THINK_GROUPS);
    runUntil(sim, () => members.every((id) => sim.villagers.state[id] === VillagerState.Inside), 600, () => {
      for (const id of others) expect(sim.villagers.state[id], `villager ${id}`).not.toBe(VillagerState.Inside);
    });
    runUntil(sim, () => others.every((id) => atCamp(sim, id)), 600);
  });
});

describe('the simulation with homes', () => {
  it('reaches the same state through two dusks from one seed and the same commands', () => {
    const play = () => {
      const sim = housesWithGoods(8, true);
      for (const x of ROW) applyCommand(sim, house(x, 8));
      const insideAtNight: number[] = [];
      let wasNight = false;
      while (sim.tick < 4000 + 3000) {
        step(sim);
        if (isNight(sim.tick) && !wasNight) insideAtNight.push(0);
        wasNight = isNight(sim.tick);
        if (wasNight) {
          const inside = sim.villagers.state.filter((state) => state === VillagerState.Inside).length;
          insideAtNight[insideAtNight.length - 1] = Math.max(insideAtNight.at(-1)!, inside);
        }
      }
      return { sim, insideAtNight };
    };
    const first = play();
    const second = play();
    // Each household stocks its home before it builds again, so the fourth house is finished on the second day.
    expect(first.insideAtNight).toEqual([6, 8]);
    expect(second.sim.villagers).toEqual(first.sim.villagers);
    expect(second.sim.households).toEqual(first.sim.households);
    expect(second.sim).toEqual(first.sim);
  });
});
