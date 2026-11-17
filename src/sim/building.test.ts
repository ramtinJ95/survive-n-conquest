import { describe, expect, it } from 'vitest';
import { BUILDING, arrived } from './building';
import { BUILDINGS, Building, needOf } from './buildings';
import { TICKS_PER_DAY } from './calendar';
import { CARRYING } from './carrying';
import { isDawn, isNight } from './daylight';
import { createFlowField } from './flowField';
import { GATHERING } from './gathering';
import { Good } from './goods';
import { NO_HOME } from './households';
import { DEFAULT_MAP_SIZE, TileKind, tileAt, walkable } from './map';
import { generateMap } from './mapgen';
import { type AreaOrder, type OrderCommand, SiteState, siteRefusal, takeOrderChanges } from './orders';
import { type Command, SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { STOCKING } from './stocking';
import { StoreKind, foodLimit, storeKind } from './stores';
import { SUPPLYING } from './supplying';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { TILE_CHANGE_STRIDE, takeTileChanges } from './tileChanges';
import { VillagerState } from './villagerState';

const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
const BUILD = TASK_KINDS.indexOf(BUILDING) + 1;
const SUPPLY = TASK_KINDS.indexOf(SUPPLYING) + 1;
const CARRY = TASK_KINDS.indexOf(CARRYING) + 1;
const GATHER = TASK_KINDS.indexOf(GATHERING) + 1;

const mark = (order: AreaOrder, x0: number, y0: number, x1 = x0, y1 = y0): OrderCommand => ({
  kind: 'markArea',
  order,
  area: { x0, y0, x1, y1 },
});
const house = (x: number, y: number): OrderCommand => ({ kind: 'place', building: Building.House, x, y });
const hut = (x: number, y: number): OrderCommand => ({ kind: 'place', building: Building.Hut, x, y });

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

type Lying = readonly [x: number, y: number, good: Good, size: number];

/** A simulation on a map drawn as in `mapFrom`, with these stacks lying on it from the start. */
function simWith(rows: readonly string[], villagers: number, stacks: readonly Lying[]): Sim {
  const map = mapFrom(rows);
  for (const [x, y, good, size] of stacks) {
    map.stackGood[at(map, x, y)] = good;
    map.stackSize[at(map, x, y)] = size;
  }
  return createSim(map, { villagers, monsters: 0 });
}

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

const ids = (sim: Sim) => Array.from(sim.villagers.task, (_, id) => id);
const holding = (sim: Sim, kind: number) => ids(sim).filter((id) => sim.villagers.task[id] === kind);
const slotAt = (sim: Sim, x: number, y: number) => sim.orders.siteOf[at(sim.map, x, y)]!;
const units = (sim: Sim, slot: number, good: Good) => arrived(sim.map, sim.orders, slot, good);
const stack = (sim: Sim, x: number, y: number) => [sim.map.stackGood[at(sim.map, x, y)], sim.map.stackSize[at(sim.map, x, y)]];

/** The good of the unit a supplying villager carries, or walks to pick up. */
function supplied(sim: Sim, id: number): Good {
  const { carried, taskTile } = sim.villagers;
  return carried[id] !== Good.None ? (carried[id] as Good) : (sim.map.stackGood[taskTile[id]!] as Good);
}

/** Calls `taken` with each villager whose task changed to `kind` on the last step, and the tile of that task. */
function watchTakes(sim: Sim, kind: number, taken: (id: number, tile: number) => void): () => void {
  let held = Uint8Array.from(sim.villagers.task);
  return () => {
    sim.villagers.task.forEach((task, id) => {
      if (task === kind && held[id] !== kind) taken(id, sim.villagers.taskTile[id]!);
    });
    held = Uint8Array.from(sim.villagers.task);
  };
}

describe('supplying a site', () => {
  it('sets out no more units than the site lacks, takes the nearest from the ground and from stockpiles, and stacks them on its tiles', () => {
    const sim = simWith(open(32), 12, [
      [28, 24, Good.Log, 8],
      [24, 19, Good.Log, 6],
      [5, 5, Good.Log, 8],
      [20, 24, Good.Stone, 4],
      [24, 28, Good.Stone, 4],
      [5, 8, Good.Stone, 8],
    ]);
    applyCommand(sim, mark('stockpile', 28, 24));
    applyCommand(sim, mark('stockpile', 24, 28));
    expect(applyCommand(sim, house(24, 24))).toMatchObject({ ok: true });
    const slot = slotAt(sim, 24, 24);
    const sources = new Map<string, number>();
    const overbooked: string[] = [];
    const watch = watchTakes(sim, SUPPLY, (_, tile) => {
      const key = `${tile % 32},${Math.floor(tile / 32)}`;
      sources.set(key, (sources.get(key) ?? 0) + 1);
    });
    runUntil(
      sim,
      () => units(sim, slot, Good.Log) === 12 && units(sim, slot, Good.Stone) === 6,
      3000,
      () => {
        watch();
        for (const good of [Good.Log, Good.Stone]) {
          const onTheirWay = holding(sim, SUPPLY).filter((id) => supplied(sim, id) === good).length;
          if (units(sim, slot, good) + onTheirWay > needOf(BUILDINGS[Building.House], good)) overbooked.push(`good ${good} on tick ${sim.tick}`);
        }
      },
    );
    expect(overbooked).toEqual([]);
    expect(Object.fromEntries(sources)).toEqual({ '28,24': 8, '24,19': 4, '20,24': 4, '24,28': 2 });
    expect([stack(sim, 23, 23), stack(sim, 24, 23), stack(sim, 25, 25)]).toEqual([
      [Good.Log, 8],
      [Good.Log, 4],
      [Good.Stone, 6],
    ]);
    for (const [x, y] of [[25, 23], [23, 24], [24, 24], [25, 24], [23, 25], [24, 25]] as const) {
      expect(stack(sim, x, y)).toEqual([Good.None, 0]);
    }
    expect(sim.tally.delivered).toBe(18);
    expect(sim.orders.sites.state[slot]).toBe(SiteState.Site);
  });
});

describe('the kinds of task', () => {
  it('go to a settler in the order stocking, building, supplying, carrying, gathering, while every kind after the one it takes is open', () => {
    const rows = open(32);
    rows[4] = '.'.repeat(28) + 'T...';
    const sim = simWith(rows, 1, [
      [7, 10, Good.Log, 8],
      [7, 11, Good.Log, 4],
      [7, 12, Good.Stone, 6],
      [27, 24, Good.Log, 1],
    ]);
    const [tree, spare] = [at(sim.map, 28, 4), at(sim.map, 27, 24)];
    applyCommand(sim, mark('chop', 28, 4));
    applyCommand(sim, mark('stockpile', 16, 28));
    applyCommand(sim, house(11, 11));
    applyCommand(sim, house(24, 24));
    const [first, second] = [slotAt(sim, 11, 11), slotAt(sim, 24, 24)];
    const takes: { kind: number; spareLies: boolean; secondLacks: boolean; treeStands: boolean }[] = [];
    let held = 0;
    runUntil(
      sim,
      () => sim.map.trees[tree] === 0,
      12000,
      () => {
        const kind = sim.villagers.task[0]!;
        if (kind !== 0 && kind !== held) {
          takes.push({
            kind,
            spareLies: sim.map.stackSize[spare] === 1 && sim.villagers.taskTile[0] !== spare,
            secondLacks: sim.orders.sites.state[second] === SiteState.Site && units(sim, second, Good.Log) === 0,
            treeStands: sim.map.trees[tree] === 1,
          });
        }
        held = kind;
        if (sim.orders.sites.state[second] === SiteState.Site && units(sim, second, Good.Log) === 1) {
          applyCommand(sim, mark('cancel', 23, 23, 25, 25));
        }
      },
    );
    const order = takes.map(({ kind }) => kind).filter((kind, i, all) => i === 0 || all[i - 1] !== kind);
    expect(order).toEqual([SUPPLY, BUILD, STOCK, SUPPLY, CARRY, GATHER]);
    const firstBuild = takes.find(({ kind }) => kind === BUILD)!;
    expect(firstBuild).toEqual({ kind: BUILD, spareLies: true, secondLacks: true, treeStands: true });
    expect(takes[0]).toMatchObject({ kind: SUPPLY, spareLies: true, treeStands: true });
    expect(takes.find(({ kind }) => kind === CARRY)).toMatchObject({ treeStands: true });
    expect(sim.orders.sites.state[first]).toBe(SiteState.Built);
  });
});

/** A site centered on (21, 15) with its 12 logs and 6 stone lying a few tiles below it. */
function siteWithGoods(villagers: number, extra: readonly Lying[] = []): Sim {
  return simWith(open(32), villagers, [[21, 19, Good.Log, 8], [22, 19, Good.Log, 4], [20, 19, Good.Stone, 6], ...extra]);
}

describe('building', () => {
  it('starts only when the last unit arrives, and takes one settler 90 seconds of work that stays on the site through the night', () => {
    const sim = siteWithGoods(1);
    applyCommand(sim, house(21, 15));
    const slot = slotAt(sim, 21, 15);
    const allArrived = () => units(sim, slot, Good.Log) === 12 && units(sim, slot, Good.Stone) === 6;
    let early = 0;
    let working = 0;
    let workAtDusk = -1;
    let workAtDawn = -1;
    runUntil(
      sim,
      () => sim.orders.sites.state[slot] === SiteState.Built,
      6000,
      () => {
        if (sim.villagers.task[0] === BUILD && !allArrived()) early++;
        if (sim.villagers.task[0] === BUILD && sim.villagers.state[0] === VillagerState.Working) working++;
        if (isNight(sim.tick) && workAtDusk < 0) workAtDusk = sim.orders.sites.work[slot]!;
        if (isDawn(sim.tick - 1)) workAtDawn = sim.orders.sites.work[slot]!;
      },
    );
    expect(early).toBe(0);
    expect(working + 1).toBe(BUILDINGS[Building.House].workTicks);
    expect(workAtDusk).toBeGreaterThan(0);
    expect(workAtDusk).toBeLessThan(BUILDINGS[Building.House].workTicks);
    expect(workAtDawn).toBe(workAtDusk);
    expect(sim.tally.built).toBe(1);
  });

  it('is shared by up to 4 settlers, each on a corner of its own, and never by a 5th', () => {
    const sim = siteWithGoods(6);
    applyCommand(sim, house(21, 15));
    const slot = slotAt(sim, 21, 15);
    const corners = [at(sim.map, 20, 14), at(sim.map, 22, 14), at(sim.map, 20, 16), at(sim.map, 22, 16)];
    let most = 0;
    let started = -1;
    let work = 0;
    const misstepped: string[] = [];
    runUntil(
      sim,
      () => sim.orders.sites.state[slot] === SiteState.Built,
      3000,
      () => {
        const builders = holding(sim, BUILD);
        most = Math.max(most, builders.length);
        if (builders.length > 0 && started < 0) started = sim.tick;
        const spots = builders.map((id) => sim.villagers.workTile[id]!);
        if (new Set(spots).size !== spots.length || spots.some((tile) => !corners.includes(tile))) misstepped.push(`tick ${sim.tick}`);
        const done = sim.orders.sites.work[slot]!;
        const workers = builders.filter((id) => sim.villagers.state[id] === VillagerState.Working).length;
        if (sim.orders.sites.state[slot] === SiteState.Site && done - work !== workers) misstepped.push(`work on tick ${sim.tick}`);
        work = done;
      },
    );
    expect(misstepped).toEqual([]);
    expect(most).toBe(4);
    expect(sim.tick - started).toBeLessThan(BUILDINGS[Building.House].workTicks / 4 + 40);
  });
});

describe("a forager's hut", () => {
  it('takes 8 logs and no stone, and one settler 30 seconds of work once the last log arrives', () => {
    const sim = siteWithGoods(1);
    applyCommand(sim, hut(21, 15));
    const slot = slotAt(sim, 21, 15);
    let early = 0;
    let working = 0;
    runUntil(
      sim,
      () => sim.orders.sites.state[slot] === SiteState.Built,
      3000,
      () => {
        if (sim.villagers.task[0] === BUILD && units(sim, slot, Good.Log) < 8) early++;
        if (sim.villagers.task[0] === BUILD && sim.villagers.state[0] === VillagerState.Working) working++;
      },
    );
    expect([early, working + 1]).toEqual([0, 300]);
    expect(sim.tally).toMatchObject({ delivered: 8, built: 1 });
    expect([stack(sim, 20, 19), stack(sim, 21, 19), stack(sim, 22, 19)]).toEqual([
      [Good.Stone, 6],
      [Good.None, 0],
      [Good.Log, 4],
    ]);
  });

  it('blocks its four tiles when finished, and is neither a home nor a store', () => {
    const sim = siteWithGoods(2);
    applyCommand(sim, hut(21, 15));
    const slot = slotAt(sim, 21, 15);
    runUntil(sim, () => sim.orders.sites.state[slot] === SiteState.Built, 3000);
    for (const [x, y] of [[21, 15], [22, 15], [21, 16], [22, 16]] as const) {
      const tile = at(sim.map, x, y);
      expect([sim.map.kinds[tile], walkable(sim.map, tile), sim.flow.next[tile]]).toEqual([TileKind.Built, false, -1]);
    }
    for (const [x, y] of [[20, 15], [23, 15], [21, 14], [22, 17]] as const) expect(walkable(sim.map, at(sim.map, x, y))).toBe(true);
    expect(Array.from(sim.households.home)).toEqual([NO_HOME]);
    expect([storeKind(sim.orders, slot), foodLimit(sim.orders, sim.stores.campLimit, slot)]).toEqual([StoreKind.None, 0]);
  });
});

describe('a finished house', () => {
  it('blocks its nine tiles, moves its builders off them, keeps the routes of a fresh build, and cannot be cancelled', () => {
    const sim = siteWithGoods(4);
    applyCommand(sim, house(21, 15));
    const slot = slotAt(sim, 21, 15);
    const nine = Array.from({ length: 9 }, (_, i) => at(sim.map, 20 + (i % 3), 14 + Math.floor(i / 3)));
    let corners = new Map<number, number>();
    runUntil(
      sim,
      () => sim.orders.sites.state[slot] === SiteState.Built,
      3000,
      () => {
        if (sim.orders.sites.state[slot] !== SiteState.Site) return;
        corners = new Map(holding(sim, BUILD).map((id) => [id, sim.villagers.workTile[id]!]));
        takeTileChanges(sim);
        takeOrderChanges(sim.orders);
      },
    );
    expect(corners.size).toBe(4);
    for (const tile of nine) {
      expect([sim.map.kinds[tile], walkable(sim.map, tile), sim.map.stackSize[tile], sim.flow.next[tile]]).toEqual([TileKind.Built, false, 0, -1]);
    }
    for (const [id, corner] of corners) {
      const tile = tileAt(sim.map, sim.villagers.x[id]!, sim.villagers.y[id]!);
      expect(sim.villagers.task[id]).toBe(0);
      expect([sim.villagers.x[id]! % 1, sim.villagers.y[id]! % 1]).toEqual([0.5, 0.5]);
      expect(sim.flow.next[tile]).not.toBe(-1);
      expect(Math.abs((tile % 32) - (corner % 32)) + Math.abs(Math.floor(tile / 32) - Math.floor(corner / 32))).toBe(1);
    }
    const fresh = createFlowField(sim.map, sim.flow.goal);
    for (let tile = 0; tile < 32 * 32; tile++) {
      if (fresh.walk[tile] === Infinity) expect(sim.flow.walk[tile], `tile ${tile}`).toBe(Infinity);
      else expect(Math.abs(sim.flow.walk[tile]! - fresh.walk[tile]!), `tile ${tile}`).toBeLessThan(1e-9);
    }
    const groups = takeTileChanges(sim);
    const changed = new Map<number, number[]>();
    for (let i = 0; i < groups.length; i += TILE_CHANGE_STRIDE) changed.set(groups[i]!, Array.from(groups.subarray(i + 1, i + TILE_CHANGE_STRIDE)));
    for (const tile of nine) expect(changed.get(tile)).toEqual([TileKind.Built, 0, Good.None, 0]);
    expect(Array.from(takeOrderChanges(sim.orders).sites)).toEqual([slot, 21, 15, SiteState.Built, BUILDINGS[Building.House].workTicks, Building.House, 0]);
    expect(applyCommand(sim, mark('cancel', 19, 13, 23, 17))).toEqual({ ok: false, order: 'cancel', refusal: 'nothing-to-cancel' });
    expect(sim.orders.sites.state[slot]).toBe(SiteState.Built);
  });

  it('sends routes around it, never across it or past its corners', () => {
    const sim = siteWithGoods(8, [[16, 15, Good.Log, 8], [16, 14, Good.Stone, 8]]);
    applyCommand(sim, house(21, 15));
    applyCommand(sim, mark('stockpile', 26, 14, 26, 16));
    const slot = slotAt(sim, 21, 15);
    runUntil(sim, () => sim.orders.sites.state[slot] === SiteState.Built, 3000);
    const isHouse = (x: number, y: number) => sim.map.kinds[at(sim.map, x, y)] === TileKind.Built;
    const lastX = Float32Array.from(sim.villagers.x);
    const lastY = Float32Array.from(sim.villagers.y);
    const trespasses: string[] = [];
    const stocked = () => stack(sim, 26, 14)[1]! + stack(sim, 26, 15)[1]! + stack(sim, 26, 16)[1]!;
    runUntil(
      sim,
      () => stocked() === 16,
      1500,
      () => {
        for (const id of ids(sim)) {
          const [fromX, fromY] = [Math.floor(lastX[id]!), Math.floor(lastY[id]!)];
          const [toX, toY] = [Math.floor(sim.villagers.x[id]!), Math.floor(sim.villagers.y[id]!)];
          if (isHouse(toX, toY) || (fromX !== toX && fromY !== toY && (isHouse(toX, fromY) || isHouse(fromX, toY)))) {
            trespasses.push(`villager ${id} on tick ${sim.tick}`);
          }
        }
        lastX.set(sim.villagers.x);
        lastY.set(sim.villagers.y);
      },
    );
    expect(trespasses).toEqual([]);
  });
});

/** Every unit of a good on the map and in the villagers' hands. */
function everywhere(sim: Sim, good: Good): number {
  let count = 0;
  sim.map.stackSize.forEach((size, tile) => {
    if (sim.map.stackGood[tile] === good) count += size;
  });
  return count + sim.villagers.carried.filter((carried) => carried === good).length;
}

describe('a cancelled site', () => {
  it('loses its work, frees its builders at once, and leaves its goods as goods on the ground, even outside the area', () => {
    const sim = siteWithGoods(4);
    applyCommand(sim, mark('stockpile', 4, 4, 5, 5));
    applyCommand(sim, house(21, 15));
    const slot = slotAt(sim, 21, 15);
    runUntil(sim, () => sim.orders.sites.work[slot]! >= 100, 3000);
    expect(holding(sim, BUILD).length).toBeGreaterThan(0);

    expect(applyCommand(sim, mark('cancel', 22, 16, 25, 19))).toMatchObject({ ok: true, order: 'cancel' });
    expect(holding(sim, BUILD)).toEqual([]);
    expect([sim.orders.sites.state[slot], sim.orders.sites.work[slot], slotAt(sim, 20, 14)]).toEqual([SiteState.Free, 0, -1]);
    expect([stack(sim, 20, 14), stack(sim, 21, 14), stack(sim, 22, 16)]).toEqual([
      [Good.Log, 8],
      [Good.Log, 4],
      [Good.Stone, 6],
    ]);

    const stockpiled = () => [stack(sim, 4, 4), stack(sim, 5, 4), stack(sim, 4, 5), stack(sim, 5, 5)].reduce((sum, [, size]) => sum + size!, 0);
    runUntil(sim, () => stockpiled() === 18, 3000);
    expect(applyCommand(sim, house(21, 15))).toMatchObject({ ok: true });
    expect(sim.orders.sites.work[slotAt(sim, 21, 15)]).toBe(0);
  });

  it('frees every settler on its way to it at once, and placed again in the same pause, gets no unit that set out for the old one', () => {
    const sim = siteWithGoods(6);
    applyCommand(sim, house(21, 15));
    const slot = slotAt(sim, 21, 15);
    const carrying = () => holding(sim, SUPPLY).filter((id) => sim.villagers.carried[id] !== Good.None);
    const delivered = () => units(sim, slot, Good.Log) + units(sim, slot, Good.Stone);
    runUntil(sim, () => carrying().length >= 2 && holding(sim, SUPPLY).length > carrying().length, 600);
    expect(delivered()).toBe(0);
    const suppliers = holding(sim, SUPPLY);
    const feet = carrying().map((id) => [id, tileAt(sim.map, sim.villagers.x[id]!, sim.villagers.y[id]!), sim.villagers.carried[id]!]);

    applyCommand(sim, { kind: 'togglePause' });
    applyCommand(sim, mark('cancel', 20, 14, 22, 16));
    expect(applyCommand(sim, house(21, 15))).toMatchObject({ ok: true });
    applyCommand(sim, { kind: 'togglePause' });
    expect(slotAt(sim, 21, 15)).toBe(slot);
    expect(suppliers.map((id) => [sim.villagers.task[id], sim.villagers.carried[id]])).toEqual(suppliers.map(() => [0, Good.None]));
    for (const [, tile, good] of feet) expect(sim.map.stackGood[tile!]).toBe(good);
    expect([everywhere(sim, Good.Log), everywhere(sim, Good.Stone)]).toEqual([12, 6]);

    const before = sim.tally.delivered;
    runUntil(sim, () => sim.orders.sites.state[slot] === SiteState.Built, 6000);
    expect(sim.tally.delivered - before).toBe(18);
  });
});

describe('a site at dusk', () => {
  it('sees its settlers put down what they carry and walk to the camp, then gets its tasks taken again at dawn and is finished', () => {
    const sim = siteWithGoods(4);
    runUntil(sim, () => sim.tick === 1310, 1310);
    applyCommand(sim, house(21, 15));
    const slot = slotAt(sim, 21, 15);
    runUntil(sim, () => isNight(sim.tick), 200);
    expect(holding(sim, SUPPLY).some((id) => sim.villagers.carried[id] !== Good.None)).toBe(true);
    step(sim);
    expect(ids(sim).map((id) => [sim.villagers.task[id], sim.villagers.carried[id], sim.villagers.state[id]])).toEqual(
      ids(sim).map(() => [0, Good.None, VillagerState.GoingToCamp]),
    );
    expect([everywhere(sim, Good.Log), everywhere(sim, Good.Stone)]).toEqual([12, 6]);
    let takenAtNight = 0;
    runUntil(sim, () => isDawn(sim.tick), 2000, () => {
      takenAtNight += ids(sim).filter((id) => sim.villagers.task[id] !== 0).length;
    });
    expect(takenAtNight).toBe(0);
    runUntil(sim, () => sim.orders.sites.state[slot] === SiteState.Built, 1500);
    expect(isNight(sim.tick)).toBe(false);
  });
});

describe('a house that cuts off land', () => {
  it('closes the tasks and goods on land that reached the camp only across its site, and leaves no settler there', () => {
    const rows = open(24);
    rows[9] = '.'.repeat(19) + '#####';
    rows[10] = '.'.repeat(19) + '#TTT#';
    rows[11] = '.'.repeat(19) + '#T.T#';
    rows[12] = '.'.repeat(19) + '#...#';
    rows[13] = '.'.repeat(19) + '#T.T#';
    rows[14] = '.'.repeat(19) + '#TTT#';
    rows[15] = '.'.repeat(19) + '#####';
    const sim = simWith(rows, 6, [
      [14, 12, Good.Log, 8],
      [14, 13, Good.Log, 3],
      [14, 11, Good.Stone, 6],
      [21, 12, Good.Log, 5],
    ]);
    const inPocket = (tile: number) => tile % 24 >= 19 && Math.floor(tile / 24) >= 9 && Math.floor(tile / 24) <= 15;
    const standing = () => ids(sim).filter((id) => inPocket(tileAt(sim.map, sim.villagers.x[id]!, sim.villagers.y[id]!)));
    expect(applyCommand(sim, house(17, 12))).toMatchObject({ ok: true });
    applyCommand(sim, mark('quarry', 19, 12));
    applyCommand(sim, mark('chop', 20, 10, 22, 14));
    const slot = slotAt(sim, 17, 12);
    let beforeFinish = 0;
    runUntil(sim, () => sim.orders.sites.state[slot] === SiteState.Built, 9000, () => {
      if (sim.orders.sites.state[slot] === SiteState.Site) beforeFinish = standing().length;
    });
    expect(sim.map.kinds[at(sim.map, 19, 12)]).toBe(TileKind.Bare);
    expect(beforeFinish).toBeGreaterThan(0);
    expect(standing()).toEqual([]);

    const pocket = Array.from({ length: 24 * 24 }, (_, tile) => tile).filter(inPocket);
    const goodsThere = () => pocket.map((tile) => [sim.map.trees[tile], sim.map.stackGood[tile], sim.map.stackSize[tile]]);
    const left = goodsThere();
    expect(left.some(([, , size]) => size! > 0)).toBe(true);
    expect(left.some(([tree]) => tree === 1)).toBe(true);
    const intrusions: string[] = [];
    runUntil(sim, () => isNight(sim.tick), 3000, () => {
      for (const id of standing()) intrusions.push(`villager ${id} stands there on tick ${sim.tick}`);
      for (const id of ids(sim)) {
        if (sim.villagers.task[id] !== 0 && inPocket(sim.villagers.taskTile[id]!)) intrusions.push(`villager ${id} works there on tick ${sim.tick}`);
      }
    });
    expect(intrusions).toEqual([]);
    expect(goodsThere()).toEqual(left);
  });
});

describe('the simulation with a house', () => {
  it('reaches the same state from one seed and the same commands, from an empty site to a finished house', () => {
    const map = generateMap(7, 64);
    const probe = createSim(map, { villagers: 0, monsters: 0 });
    const [campX, campY] = [probe.camp % 64, Math.floor(probe.camp / 64)];
    const nearCamp = (count: number) => {
      const spots: [number, number][] = [];
      for (let y = 1; y < 63; y++) for (let x = 1; x < 63; x++) if (siteRefusal(probe.map, probe.orders, Building.House, x, y) === null) spots.push([x, y]);
      return spots.sort(([ax, ay], [bx, by]) => Math.hypot(ax - campX, ay - campY) - Math.hypot(bx - campX, by - campY)).slice(0, count);
    };
    const [hx, hy] = nearCamp(1)[0]!;
    applyCommand(probe, house(hx, hy));
    const [cx, cy] = nearCamp(1)[0]!;
    const script: readonly { tick: number; command: Command }[] = [
      { tick: 0, command: house(hx, hy) },
      { tick: 0, command: house(cx, cy) },
      { tick: 0, command: mark('chop', 0, 0, 63, 63) },
      { tick: 0, command: mark('quarry', 0, 0, 63, 63) },
      { tick: 300, command: mark('cancel', cx, cy) },
      { tick: 600, command: mark('stockpile', 26, 26, 38, 38) },
    ];
    const play = () => {
      const sim = createSim(map, { villagers: 8, monsters: 10 });
      while (sim.tick < 6000) {
        for (const { tick, command } of script) if (tick === sim.tick) applyCommand(sim, command);
        step(sim);
      }
      return sim;
    };
    const first = play();
    const second = play();
    expect(first.tally.built).toBe(1);
    expect(first.orders.sites.state[first.orders.siteOf[hy * 64 + hx]!]).toBe(SiteState.Built);
    expect(second.villagers).toEqual(first.villagers);
    expect(second.map).toEqual(first.map);
    expect(second).toEqual(first);
  });
});

describe('the first house on seed 7', () => {
  /**
   * The layout a player would give: the house on the open site nearest the
   * camp, a stockpile beside the camp, and every tree and rock tile within 40
   * tiles of the house marked. The brief's target is two spring days.
   */
  it('takes 8 settlers 1196 ticks from placement to the finished house, all 1196 of them in daylight', () => {
    const sim = createSim(generateMap(7, DEFAULT_MAP_SIZE), SETTLERS);
    expect(sim.camp).toBe(127 * DEFAULT_MAP_SIZE + 127);
    for (const command of [
      house(127, 123),
      mark('stockpile', 131, 125, 134, 128),
      mark('chop', 87, 83, 167, 163),
      mark('quarry', 87, 83, 167, 163),
    ]) {
      expect(applyCommand(sim, command)).toMatchObject({ ok: true });
    }
    const slot = slotAt(sim, 127, 123);
    let daylight = 0;
    runUntil(sim, () => sim.orders.sites.state[slot] === SiteState.Built, 2 * TICKS_PER_DAY, () => {
      if (!isNight(sim.tick - 1)) daylight++;
    });
    expect({ ticks: sim.tick, daylight }).toEqual({ ticks: 1196, daylight: 1196 });
  });
});
