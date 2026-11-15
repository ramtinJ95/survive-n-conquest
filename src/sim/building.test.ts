import { describe, expect, it } from 'vitest';
import { BUILDING, HOUSE_NEEDS, HOUSE_WORK_TICKS, arrived } from './building';
import { CARRYING } from './carrying';
import { isDawn, isNight } from './daylight';
import { createFlowField } from './flowField';
import { GATHERING } from './gathering';
import { Good } from './goods';
import { TileKind, tileAt, walkable } from './map';
import { type AreaOrder, type OrderCommand, SiteState, takeOrderChanges } from './orders';
import { type Sim, applyCommand, createSim, step } from './sim';
import { SUPPLYING } from './supplying';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { TILE_CHANGE_STRIDE, takeTileChanges } from './tileChanges';

const BUILD = TASK_KINDS.indexOf(BUILDING) + 1;
const SUPPLY = TASK_KINDS.indexOf(SUPPLYING) + 1;
const CARRY = TASK_KINDS.indexOf(CARRYING) + 1;
const GATHER = TASK_KINDS.indexOf(GATHERING) + 1;

const mark = (order: AreaOrder, x0: number, y0: number, x1 = x0, y1 = y0): OrderCommand => ({
  kind: 'markArea',
  order,
  area: { x0, y0, x1, y1 },
});
const house = (x: number, y: number): OrderCommand => ({ kind: 'placeHouse', x, y });

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
          if (units(sim, slot, good) + onTheirWay > HOUSE_NEEDS[good - 1]!) overbooked.push(`good ${good} on tick ${sim.tick}`);
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
  it('go to a settler in the order building, supplying, carrying, gathering, while every kind after the one it takes is open', () => {
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
    expect(order).toEqual([SUPPLY, BUILD, SUPPLY, CARRY, GATHER]);
    const firstBuild = takes.find(({ kind }) => kind === BUILD)!;
    expect(firstBuild).toEqual({ kind: BUILD, spareLies: true, secondLacks: true, treeStands: true });
    expect(takes[0]).toMatchObject({ kind: SUPPLY, spareLies: true, treeStands: true });
    expect(takes.find(({ kind }) => kind === CARRY)).toMatchObject({ treeStands: true });
    expect(sim.orders.sites.state[first]).toBe(SiteState.House);
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
      () => sim.orders.sites.state[slot] === SiteState.House,
      6000,
      () => {
        if (sim.villagers.task[0] === BUILD && !allArrived()) early++;
        if (sim.villagers.task[0] === BUILD && sim.villagers.state[0] === 2) working++;
        if (isNight(sim.tick) && workAtDusk < 0) workAtDusk = sim.orders.sites.work[slot]!;
        if (isDawn(sim.tick - 1)) workAtDawn = sim.orders.sites.work[slot]!;
      },
    );
    expect(early).toBe(0);
    expect(working + 1).toBe(HOUSE_WORK_TICKS);
    expect(workAtDusk).toBeGreaterThan(0);
    expect(workAtDusk).toBeLessThan(HOUSE_WORK_TICKS);
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
      () => sim.orders.sites.state[slot] === SiteState.House,
      3000,
      () => {
        const builders = holding(sim, BUILD);
        most = Math.max(most, builders.length);
        if (builders.length > 0 && started < 0) started = sim.tick;
        const spots = builders.map((id) => sim.villagers.workTile[id]!);
        if (new Set(spots).size !== spots.length || spots.some((tile) => !corners.includes(tile))) misstepped.push(`tick ${sim.tick}`);
        const done = sim.orders.sites.work[slot]!;
        const workers = builders.filter((id) => sim.villagers.state[id] === 2).length;
        if (sim.orders.sites.state[slot] === SiteState.Site && done - work !== workers) misstepped.push(`work on tick ${sim.tick}`);
        work = done;
      },
    );
    expect(misstepped).toEqual([]);
    expect(most).toBe(4);
    expect(sim.tick - started).toBeLessThan(HOUSE_WORK_TICKS / 4 + 40);
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
      () => sim.orders.sites.state[slot] === SiteState.House,
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
      expect([sim.map.kinds[tile], walkable(sim.map, tile), sim.map.stackSize[tile], sim.flow.next[tile]]).toEqual([TileKind.House, false, 0, -1]);
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
    for (const tile of nine) expect(changed.get(tile)).toEqual([TileKind.House, 0, Good.None, 0]);
    expect(Array.from(takeOrderChanges(sim.orders).sites)).toEqual([slot, 21, 15, SiteState.House, HOUSE_WORK_TICKS]);
    expect(applyCommand(sim, mark('cancel', 19, 13, 23, 17))).toEqual({ ok: false, order: 'cancel', refusal: 'nothing-to-cancel' });
    expect(sim.orders.sites.state[slot]).toBe(SiteState.House);
  });

  it('sends routes around it, never across it or past its corners', () => {
    const sim = siteWithGoods(8, [[16, 15, Good.Log, 8], [16, 14, Good.Stone, 8]]);
    applyCommand(sim, house(21, 15));
    applyCommand(sim, mark('stockpile', 26, 14, 26, 16));
    const slot = slotAt(sim, 21, 15);
    runUntil(sim, () => sim.orders.sites.state[slot] === SiteState.House, 3000);
    const isHouse = (x: number, y: number) => sim.map.kinds[at(sim.map, x, y)] === TileKind.House;
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
