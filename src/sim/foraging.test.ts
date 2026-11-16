import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY, dateAt, seasonAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { FORAGING, bears } from './foraging';
import { Good } from './goods';
import { Claim } from './orders';
import { type Sim, applyCommand, createSim, step } from './sim';
import { STOCKING, lacks } from './stocking';
import { CAMP_STORE } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { NO_TASK, VillagerState } from './villagerState';

const FORAGE = TASK_KINDS.indexOf(FORAGING) + 1;
const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;

/** An open map of `size` tiles a side with a tree on each tile in `trees`. */
function mapWith(size: number, trees: readonly (readonly [number, number])[]) {
  const rows = Array.from({ length: size }, () => '.'.repeat(size).split(''));
  for (const [x, y] of trees) rows[y]![x] = 'T';
  return mapFrom(rows.map((row) => row.join('')));
}

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/** A hut anchored on (x, y), finished at once. Returns its slot. */
function finishedHut(sim: Sim, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

const campFood = (sim: Sim) => sim.stores.food[CAMP_STORE]!;
const untilDusk = (sim: Sim, each?: () => void) => runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, each);

function foodOnGround(sim: Sim): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Food) units += sim.map.stackSize[tile]!;
  return units;
}

/** The tiles a forager took to pick, as it took them. */
function watchPicks(sim: Sim): { tiles: number[]; at: number[]; each: () => void } {
  const tiles: number[] = [];
  const ticks: number[] = [];
  const held = Uint8Array.from(sim.villagers.task);
  return {
    tiles,
    at: ticks,
    each: () => {
      for (let id = 0; id < held.length; id++) {
        const task = sim.villagers.task[id]!;
        if (task === FORAGE && held[id] !== FORAGE && sim.villagers.carried[id] === Good.None) {
          tiles.push(sim.villagers.taskTile[id]!);
          ticks.push(sim.tick);
        }
        held[id] = task;
      }
    },
  };
}

describe('a forager', () => {
  it('works a tree tile in reach for 20 seconds, picks 1 food, and carries it into the camp', () => {
    const sim = createSim(mapWith(40, [[26, 12]]), { villagers: 1, monsters: 0 });
    finishedHut(sim, 24, 14);
    const tree = at(sim.map, 26, 12);
    const before = campFood(sim);
    let working = 0;
    let pickedOn = -1;
    runUntil(sim, () => sim.tally.foragedIn === 1, TICKS_PER_DAY, () => {
      const { state, carried, taskTile } = sim.villagers;
      if (state[0] === VillagerState.Working && carried[0] === Good.None && taskTile[0] === tree) working++;
      if (pickedOn < 0 && carried[0] === Good.Food) pickedOn = sim.tick;
    });
    expect(working + 1).toBe(200);
    expect([sim.tally.foraged, campFood(sim) - before, sim.villagers.carried[0]]).toEqual([1, 1, Good.None]);
    expect(sim.villagers.x[0]! - 0.5).toBe(sim.flow.goal % 40);
    expect(bears(sim, tree)).toBe(false);
    expect(sim.foraging.ripeAt[tree]).toBe(pickedOn - 1 + 2 * TICKS_PER_DAY);
  });

  it('shares no tile with another forager, so two of them take the two trees in reach', () => {
    const sim = createSim(mapWith(40, [[26, 12], [27, 12]]), { villagers: 2, monsters: 0 });
    finishedHut(sim, 24, 14);
    const picks = watchPicks(sim);
    let shared = 0;
    untilDusk(sim, () => {
      picks.each();
      const { task, taskTile, carried } = sim.villagers;
      if (task[0] === FORAGE && task[1] === FORAGE && carried[0] === Good.None && carried[1] === Good.None && taskTile[0] === taskTile[1]) shared++;
    });
    expect(shared).toBe(0);
    expect(picks.tiles.sort((a, b) => a - b)).toEqual([at(sim.map, 26, 12), at(sim.map, 27, 12)]);
    expect(sim.tally.foraged).toBe(2);
  });

  it('finds the tile bearing again 2 days after the pick, and not a tick before', () => {
    const sim = createSim(mapWith(40, [[26, 12]]), { villagers: 1, monsters: 0 });
    finishedHut(sim, 24, 14);
    const tree = at(sim.map, 26, 12);
    const picks = watchPicks(sim);
    let picked = -1;
    runUntil(sim, () => picks.at.length === 2, TICKS_PER_DAY * 3, () => {
      picks.each();
      if (picked < 0 && sim.tally.foraged === 1) picked = sim.tick - 1;
      if (picked >= 0 && sim.tick === picked + 2 * TICKS_PER_DAY - 1) expect(bears(sim, tree)).toBe(false);
      if (picked >= 0 && sim.tick === picked + 2 * TICKS_PER_DAY) expect(bears(sim, tree)).toBe(true);
    });
    expect(picks.at[1]! - 1).toBeGreaterThanOrEqual(picked + 2 * TICKS_PER_DAY);
    expect(picks.at[1]! - 1).toBeLessThan(picked + 2 * TICKS_PER_DAY + 10);
  });

  it('picks nothing from a tree that is felled under it, nor from forest without a tree', () => {
    const rows = Array.from({ length: 32 }, () => '.'.repeat(32));
    rows[10] = '.'.repeat(16) + 'f' + '...' + 'T' + '.'.repeat(11);
    const sim = createSim(mapFrom(rows), { villagers: 2, monsters: 0 });
    const tree = at(sim.map, 20, 10);
    const slot = finishedHut(sim, 14, 4);
    applyCommand(sim, { kind: 'setPlaces', slot, places: 1 });
    const forager = sim.villagers.workplace[0] === slot ? 0 : 1;
    const chopper = 1 - forager;
    sim.villagers.x[chopper] = sim.villagers.targetX[chopper] = 21.5;
    sim.villagers.y[chopper] = sim.villagers.targetY[chopper] = 10.5;
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 20, y0: 10, x1: 20, y1: 10 } });
    let worked = false;
    untilDusk(sim, () => {
      worked ||= sim.villagers.task[forager] === FORAGE && sim.villagers.state[forager] === VillagerState.Working;
    });
    expect(worked).toBe(true);
    expect([sim.map.trees[tree], sim.tally.felled, sim.tally.foraged, bears(sim, tree)]).toEqual([0, 1, 0, false]);
    expect(bears(sim, at(sim.map, 16, 10))).toBe(false);
  });

  it('works at half the rate when hungry', () => {
    const ticks = (missedMeals: number) => {
      const sim = createSim(mapWith(40, [[26, 12]]), { villagers: 1, monsters: 0 });
      finishedHut(sim, 24, 14);
      sim.villagers.missedMeals[0] = missedMeals;
      let working = 0;
      runUntil(sim, () => sim.tally.foraged === 1, TICKS_PER_DAY, () => {
        if (sim.villagers.state[0] === VillagerState.Working && sim.villagers.carried[0] === Good.None) working++;
      });
      return working + 1;
    };
    expect(ticks(0)).toBe(200);
    expect(Math.abs(ticks(1) - 400)).toBeLessThanOrEqual(1);
  });

  it('picks only tiles whose centers lie within 20 tiles of the middle of its hut', () => {
    // The hut's middle is (21, 21). (40, 21) and (7, 35) lie 19.5 and 19.8 tiles from it, (41, 21) and (6, 35) 20.5.
    const inside = [[40, 21], [7, 35]] as const;
    const outside = [[41, 21], [6, 35]] as const;
    const sim = createSim(mapWith(64, [...inside, ...outside]), { villagers: 1, monsters: 0 });
    finishedHut(sim, 20, 20);
    const picks = watchPicks(sim);
    untilDusk(sim, picks.each);
    expect(picks.tiles.sort((a, b) => a - b)).toEqual(inside.map(([x, y]) => at(sim.map, x, y)).sort((a, b) => a - b));
    expect(sim.tally.foraged).toBe(2);
  });

  it('keeps a unit picked before dusk through the night and carries it into the camp in the morning', () => {
    const sim = createSim(mapWith(64, [[5, 9]]), { villagers: 1, monsters: 0 });
    finishedHut(sim, 4, 6);
    const tree = at(sim.map, 5, 9);
    let dusk = sim.tick;
    while (!isNight(dusk)) dusk++;
    sim.foraging.ripeAt[tree] = dusk - 550;
    untilDusk(sim);
    expect([sim.tally.foraged, sim.villagers.carried[0]]).toEqual([1, Good.Food]);
    const beforeNight = campFood(sim);
    runUntil(sim, () => isDawn(sim.tick), TICKS_PER_DAY);
    expect([sim.villagers.carried[0], sim.villagers.state[0], foodOnGround(sim)]).toEqual([Good.Food, VillagerState.Settling, 0]);
    expect([campFood(sim), sim.stores.inbound[CAMP_STORE]]).toEqual([beforeNight - 1, 0]);
    runUntil(sim, () => sim.tally.foragedIn === 1, 100);
    expect([campFood(sim), sim.villagers.carried[0]]).toEqual([beforeNight, Good.None]);
  });

  it('puts the unit down, and gives back its place in the camp, when the player frees its place', () => {
    const sim = createSim(mapWith(40, [[26, 12]]), { villagers: 1, monsters: 0 });
    const slot = finishedHut(sim, 24, 14);
    runUntil(sim, () => sim.villagers.carried[0] === Good.Food, TICKS_PER_DAY);
    expect(sim.stores.inbound[CAMP_STORE]).toBe(1);
    applyCommand(sim, { kind: 'setPlaces', slot, places: 0 });
    expect([sim.villagers.workplace[0], sim.villagers.task[0], sim.villagers.carried[0]]).toEqual([-1, NO_TASK, Good.None]);
    expect([foodOnGround(sim), sim.stores.inbound[CAMP_STORE]]).toEqual([1, 0]);
  });

  it('picks nothing while the camp is full, and puts no food on the ground', () => {
    const sim = createSim(mapWith(40, [[26, 12], [27, 12], [26, 13]]), { villagers: 2, monsters: 0, campFood: 39 });
    finishedHut(sim, 24, 14);
    untilDusk(sim, () => expect(campFood(sim) + sim.stores.inbound[CAMP_STORE]!).toBeLessThanOrEqual(40));
    expect([sim.tally.foraged, campFood(sim), foodOnGround(sim)]).toEqual([1, 40, 0]);
  });

  it('stocks its home before it forages, and forages once its home holds what it lacks', () => {
    const sim = createSim(mapWith(40, [[26, 12]]), { villagers: 2, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 8, y: 30 })).toMatchObject({ ok: true });
    finishBuilding(sim, sim.orders.siteOf[at(sim.map, 8, 30)]!);
    finishedHut(sim, 24, 14);
    const taken: number[] = [];
    const held = Uint8Array.from(sim.villagers.task);
    untilDusk(sim, () => {
      for (const id of [0, 1]) {
        const task = sim.villagers.task[id]!;
        if (task !== held[id] && task !== NO_TASK) {
          taken.push(task);
          if (task === FORAGE) expect(lacks(sim, 0)).toBeLessThanOrEqual(0);
        }
        held[id] = task;
      }
    });
    expect(taken.slice(0, 2)).toEqual([STOCK, STOCK]);
    expect(taken).toContain(FORAGE);
    expect(sim.stores.food[0]).toBe(6);
  });

  it('leaves a marked tree standing on the tile it forages and beside it', () => {
    const sim = createSim(mapWith(40, [[26, 12], [27, 12]]), { villagers: 1, monsters: 0 });
    finishedHut(sim, 24, 14);
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 26, y0: 12, x1: 27, y1: 12 } });
    untilDusk(sim);
    expect(sim.tally.foraged).toBe(2);
    expect([sim.map.trees[at(sim.map, 26, 12)], sim.map.trees[at(sim.map, 27, 12)], sim.tally.felled]).toEqual([1, 1, 0]);
    expect([sim.orders.claims[at(sim.map, 26, 12)], sim.orders.claims[at(sim.map, 27, 12)]]).toEqual([Claim.Chop, Claim.Chop]);
  });
});

describe('a forager in winter', () => {
  it('picks nothing, keeps its job, and forages again on the first day of spring', () => {
    const sim = createSim(mapWith(40, [[26, 12], [27, 12], [26, 13], [27, 13]]), { villagers: 1, monsters: 0 });
    const slot = finishedHut(sim, 24, 14);
    const dawnOfDay = (day: number) => isDawn(sim.tick) && dateAt(sim.tick).day === day;
    runUntil(sim, () => dawnOfDay(10), TICKS_PER_DAY * 10);
    expect(seasonAt(sim.tick)).toBe('Winter');
    const beforeWinter = sim.tally.foraged;
    expect(beforeWinter).toBeGreaterThan(0);
    runUntil(sim, () => dawnOfDay(13), TICKS_PER_DAY * 4, () => expect(sim.villagers.workplace[0]).toBe(slot));
    expect([seasonAt(sim.tick), sim.tally.foraged]).toEqual(['Spring', beforeWinter]);
    untilDusk(sim);
    expect(sim.tally.foraged).toBeGreaterThan(beforeWinter);
  });
});
