import { describe, expect, it } from 'vitest';
import { CARRYING } from './carrying';
import { isDawn, isNight } from './daylight';
import { Good } from './goods';
import { tileAt } from './map';
import { generateMap } from './mapgen';
import { type AreaOrder, Claim, type OrderCommand } from './orders';
import { type Command, type Sim, applyCommand, createSim, step } from './sim';
import { NO_TASK, TASK_KINDS, endTask, takeTask } from './tasks';
import { at, mapFrom } from './testMaps';
import { VillagerState } from './villagers';

const CARRY = TASK_KINDS.indexOf(CARRYING) + 1;

const mark = (order: AreaOrder, x0: number, y0: number, x1 = x0, y1 = y0): OrderCommand => ({
  kind: 'markArea',
  order,
  area: { x0, y0, x1, y1 },
});

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

const stack = (sim: Sim, tile: number) => [sim.map.stackGood[tile], sim.map.stackSize[tile]];

/** Every stack on the map as [x, y, good, size], in tile order. */
function stacks(sim: Sim): number[][] {
  const found: number[][] = [];
  sim.map.stackSize.forEach((size, tile) => {
    if (size > 0) found.push([tile % sim.map.size, Math.floor(tile / sim.map.size), sim.map.stackGood[tile]!, size]);
  });
  return found;
}

/** Units of a good in stockpiles, and on the ground. */
function tally(sim: Sim, good: Good): { stockpiled: number; ground: number } {
  let stockpiled = 0;
  let ground = 0;
  sim.map.stackSize.forEach((size, tile) => {
    if (sim.map.stackGood[tile] !== good) return;
    if (sim.orders.claims[tile] === Claim.Stockpile) stockpiled += size;
    else ground += size;
  });
  return { stockpiled, ground };
}

const villagerIds = (sim: Sim) => Array.from(sim.villagers.task, (_, id) => id);
const carriers = (sim: Sim) => villagerIds(sim).filter((id) => sim.villagers.task[id] === CARRY);
const busy = (sim: Sim) => villagerIds(sim).filter((id) => sim.villagers.task[id] !== NO_TASK);
/** The villagers that hold a carrying task for a unit on the tile and have not picked it up. */
const walkersFor = (sim: Sim, tile: number) =>
  carriers(sim).filter((id) => sim.villagers.carried[id] === Good.None && sim.villagers.taskTile[id] === tile);
const standsOn = (sim: Sim, id: number) => tileAt(sim.map, sim.villagers.x[id]!, sim.villagers.y[id]!);

/** Counts the carrying tasks taken while the simulation runs, from the villagers' task columns after each step. */
function countTakes(sim: Sim): () => number {
  let held = Uint8Array.from(sim.villagers.task);
  let takes = 0;
  return () => {
    sim.villagers.task.forEach((task, id) => {
      if (task === CARRY && held[id] !== CARRY) takes++;
    });
    held = Uint8Array.from(sim.villagers.task);
    return takes;
  };
}

describe('carrying to a stockpile', () => {
  it('sends one settler for each unit while the others stay free, and stacks every unit in the stockpile', () => {
    const sim = simWith(open(24), 8, [
      [3, 4, Good.Log, 2],
      [5, 6, Good.Log, 1],
      [20, 4, Good.Stone, 1],
    ]);
    const sources = [at(sim.map, 3, 4), at(sim.map, 5, 6), at(sim.map, 20, 4)];
    applyCommand(sim, mark('stockpile', 18, 18, 19, 19));
    const takes = countTakes(sim);
    const overbooked: string[] = [];
    let most = 0;
    runUntil(
      sim,
      () => tally(sim, Good.Log).stockpiled === 3 && tally(sim, Good.Stone).stockpiled === 1 && busy(sim).length === 0,
      1000,
      () => {
        takes();
        for (const tile of sources) {
          if (walkersFor(sim, tile).length > sim.map.stackSize[tile]!) overbooked.push(`tile ${tile} on tick ${sim.tick}`);
        }
        expect(busy(sim)).toEqual(carriers(sim));
        most = Math.max(most, carriers(sim).length);
      },
    );
    expect(overbooked).toEqual([]);
    expect(most).toBe(4);
    expect(takes()).toBe(4);
    expect(tally(sim, Good.Log)).toEqual({ stockpiled: 3, ground: 0 });
    expect(tally(sim, Good.Stone)).toEqual({ stockpiled: 1, ground: 0 });
  });

  it('sends only as many settlers as the stockpile has places, leaves the rest on the ground, and carries them once more stockpile is marked', () => {
    const sim = simWith(open(24), 12, [
      [3, 3, Good.Log, 8],
      [4, 3, Good.Log, 8],
    ]);
    const place = at(sim.map, 20, 20);
    applyCommand(sim, mark('stockpile', 20, 20));
    const takes = countTakes(sim);
    let most = 0;
    runUntil(sim, () => sim.map.stackSize[place] === 8 && busy(sim).length === 0, 1000, () => {
      takes();
      most = Math.max(most, carriers(sim).length);
    });
    expect(most).toBe(8);
    expect(takes()).toBe(8);
    expect(stack(sim, place)).toEqual([Good.Log, 8]);
    expect(tally(sim, Good.Log)).toEqual({ stockpiled: 8, ground: 8 });

    let heldWhileFull = 0;
    for (let i = 0; i < 200; i++) {
      step(sim);
      heldWhileFull += busy(sim).length;
    }
    expect(heldWhileFull).toBe(0);

    const more = at(sim.map, 20, 18);
    applyCommand(sim, mark('stockpile', 20, 18));
    runUntil(sim, () => sim.map.stackSize[more] === 8, 1000);
    expect(isNight(sim.tick)).toBe(false);
    expect(tally(sim, Good.Log)).toEqual({ stockpiled: 16, ground: 0 });
  });

  it('comes before chopping, even when the tree is nearer', () => {
    const rows = open(24);
    rows[11] = '..........T.............';
    const sim = simWith(rows, 1, [[11, 17, Good.Log, 1]]);
    const tree = at(sim.map, 10, 11);
    applyCommand(sim, mark('chop', 10, 11));
    applyCommand(sim, mark('stockpile', 20, 20));
    runUntil(sim, () => sim.villagers.task[0] !== NO_TASK, 20);
    expect([sim.villagers.task[0], sim.villagers.taskTile[0]]).toEqual([CARRY, at(sim.map, 11, 17)]);
    runUntil(sim, () => tally(sim, Good.Log).stockpiled === 1, 500);
    expect(sim.map.trees[tree]).toBe(1);
    runUntil(sim, () => sim.map.trees[tree] === 0, 1000);
  });

  it('stacks one good on a stockpile tile, up to 8, and keeps the goods that lay there when it joined the zone', () => {
    const sim = simWith(open(24), 8, [
      [16, 16, Good.Log, 5],
      [4, 4, Good.Log, 5],
      [6, 4, Good.Stone, 3],
    ]);
    const [pile, logs, stone] = [at(sim.map, 16, 16), at(sim.map, 4, 4), at(sim.map, 6, 4)];
    applyCommand(sim, mark('stockpile', 16, 16));
    expect(tally(sim, Good.Log)).toEqual({ stockpiled: 5, ground: 5 });
    const fetchedFrom = new Set<number>();
    let fewestKept = 5;
    runUntil(sim, () => sim.map.stackSize[pile] === 8 && busy(sim).length === 0, 1000, () => {
      for (const id of carriers(sim)) fetchedFrom.add(sim.villagers.taskTile[id]!);
      fewestKept = Math.min(fewestKept, sim.map.stackSize[pile]!);
    });
    for (let i = 0; i < 200; i++) step(sim);
    expect(fewestKept).toBe(5);
    expect([...fetchedFrom]).toEqual([logs]);
    expect(stack(sim, pile)).toEqual([Good.Log, 8]);
    expect(stack(sim, logs)).toEqual([Good.Log, 2]);
    expect(stack(sim, stone)).toEqual([Good.Stone, 3]);
  });

  it.each([
    ['there is no stockpile', [] as Lying[]],
    ['the stockpile is full', [[18, 18, Good.Log, 8]] as Lying[]],
  ])('leaves goods where they lie and sends nobody for them when %s', (_, piles) => {
    const sim = simWith(open(24), 8, [[4, 4, Good.Log, 3], [6, 4, Good.Stone, 2], ...piles]);
    if (piles.length > 0) applyCommand(sim, mark('stockpile', 18, 18));
    const before = stacks(sim);
    let unsettled = 0;
    for (let i = 0; i < 600; i++) {
      step(sim);
      unsettled += sim.villagers.state.filter((state) => state !== VillagerState.Idle).length;
    }
    expect(unsettled).toBe(0);
    expect(stacks(sim)).toEqual(before);
  });

  it('takes a unit a settler still holds to a stockpile before other work, and gathers nothing while its hands are full', () => {
    const rows = open(24);
    rows[11] = '..........T.............';
    const sim = simWith(rows, 1, []);
    const [tree, place] = [at(sim.map, 10, 11), at(sim.map, 20, 20)];
    sim.villagers.carried[0] = Good.Stone;
    applyCommand(sim, mark('chop', 10, 11));
    let held = 0;
    for (let i = 0; i < 300; i++) {
      step(sim);
      held += busy(sim).length;
    }
    expect(held).toBe(0);
    expect(sim.map.trees[tree]).toBe(1);

    applyCommand(sim, mark('stockpile', 20, 20));
    runUntil(sim, () => sim.villagers.carried[0] === Good.None, 300);
    expect(stack(sim, place)).toEqual([Good.Stone, 1]);
    expect(sim.map.trees[tree]).toBe(1);
    runUntil(sim, () => sim.map.trees[tree] === 0, 1000);
  });
});

describe('a carrier', () => {
  it('puts its unit down where it stands at dusk, walks to the camp, and frees its place at once', () => {
    const sim = simWith(open(24), 2, [
      [22, 1, Good.Log, 7],
      [11, 15, Good.Log, 1],
    ]);
    const place = at(sim.map, 22, 1);
    runUntil(sim, () => sim.tick === 1310, 1310);
    applyCommand(sim, mark('stockpile', 22, 1));
    runUntil(sim, () => isNight(sim.tick), 200);
    const carrier = carriers(sim);
    expect(carrier).toHaveLength(1);
    const [id] = carrier as [number];
    expect([sim.villagers.carried[id], sim.villagers.destination[id]]).toEqual([Good.Log, place]);
    const standing = standsOn(sim, id);

    step(sim);
    expect([sim.villagers.task[id], sim.villagers.carried[id], sim.villagers.state[id]]).toEqual([
      NO_TASK,
      Good.None,
      VillagerState.GoingHome,
    ]);
    expect(stack(sim, standing)).toEqual([Good.Log, 1]);
    expect(stack(sim, place)).toEqual([Good.Log, 7]);

    const other = 1 - id;
    expect(takeTask(sim, other)).toBe(true);
    expect([sim.villagers.taskTile[other], sim.villagers.destination[other]]).toEqual([standing, place]);
    endTask(sim, other);

    runUntil(sim, () => sim.villagers.state[id] === VillagerState.Settling, 600);
    expect(isNight(sim.tick)).toBe(true);
    runUntil(sim, () => isDawn(sim.tick), 2000);
    runUntil(sim, () => sim.map.stackSize[place] === 8, 600);
  });

  it('gives up at once when its stockpile tile is cancelled, puts its unit down, and frees its place', () => {
    const sim = simWith(open(24), 2, [
      [20, 3, Good.Log, 7],
      [4, 18, Good.Log, 1],
    ]);
    const place = at(sim.map, 20, 3);
    applyCommand(sim, mark('stockpile', 20, 3));
    runUntil(sim, () => carriers(sim).some((id) => sim.villagers.carried[id] === Good.Log), 400);
    const [id] = carriers(sim) as [number];
    for (let i = 0; i < 30; i++) step(sim);
    const standing = standsOn(sim, id);
    expect(sim.villagers.carried[id]).toBe(Good.Log);

    applyCommand(sim, mark('cancel', 20, 3));
    step(sim);
    expect([sim.villagers.task[id], sim.villagers.carried[id], sim.villagers.state[id]]).toEqual([
      NO_TASK,
      Good.None,
      VillagerState.Waiting,
    ]);
    expect(standsOn(sim, id)).toBe(standing);
    expect(stack(sim, standing)).toEqual([Good.Log, 1]);
    expect([sim.orders.claims[place], ...stack(sim, place)]).toEqual([Claim.None, Good.Log, 7]);

    applyCommand(sim, mark('stockpile', 20, 3));
    const other = 1 - id;
    expect(takeTask(sim, other)).toBe(true);
    expect([sim.villagers.taskTile[other], sim.villagers.destination[other]]).toEqual([standing, place]);
  });

  it('gives up at once when its stockpile tile is cancelled and marked again in one pause, and the unit is carried afresh', () => {
    const sim = simWith(open(24), 1, [
      [20, 3, Good.Log, 7],
      [4, 18, Good.Log, 1],
    ]);
    const place = at(sim.map, 20, 3);
    applyCommand(sim, mark('stockpile', 20, 3));
    runUntil(sim, () => sim.villagers.carried[0] === Good.Log, 400);
    for (let i = 0; i < 30; i++) step(sim);
    const standing = standsOn(sim, 0);

    applyCommand(sim, { kind: 'togglePause' });
    applyCommand(sim, mark('cancel', 20, 3));
    applyCommand(sim, mark('stockpile', 20, 3));
    applyCommand(sim, { kind: 'togglePause' });
    expect([sim.villagers.task[0], sim.villagers.carried[0]]).toEqual([NO_TASK, Good.None]);
    expect(stack(sim, standing)).toEqual([Good.Log, 1]);
    expect([sim.orders.claims[place], ...stack(sim, place)]).toEqual([Claim.Stockpile, Good.Log, 7]);

    const takes = countTakes(sim);
    runUntil(sim, () => sim.map.stackSize[place] === 8 && busy(sim).length === 0, 600, takes);
    expect(takes()).toBe(1);
    expect(tally(sim, Good.Log)).toEqual({ stockpiled: 8, ground: 0 });
  });

  it('gives up at once when stockpile is marked over the unit it walks for, and that unit stays in the new stack', () => {
    const sim = simWith(open(24), 2, [
      [3, 20, Good.Log, 1],
      [20, 3, Good.Log, 7],
      [21, 5, Good.Log, 1],
    ]);
    const [unit, place, other] = [at(sim.map, 3, 20), at(sim.map, 20, 3), at(sim.map, 21, 5)];
    sim.villagers.x[0] = sim.villagers.y[0] = 9.5;
    sim.villagers.x[1] = sim.villagers.y[1] = 14.5;
    applyCommand(sim, mark('stockpile', 20, 3));
    step(sim);
    expect([sim.villagers.task[0], sim.villagers.taskTile[0], sim.villagers.destination[0]]).toEqual([CARRY, unit, place]);
    for (let i = 0; i < 20; i++) step(sim);
    expect(busy(sim)).toEqual([0]);

    applyCommand(sim, mark('stockpile', 3, 20));
    step(sim);
    expect(sim.villagers.task[0]).toBe(NO_TASK);
    let fetched = 0;
    runUntil(sim, () => sim.map.stackSize[place] === 8 && busy(sim).length === 0, 600, () => {
      fetched += walkersFor(sim, unit).length;
    });
    expect(fetched).toBe(0);
    expect(stack(sim, unit)).toEqual([Good.Log, 1]);
    expect(stack(sim, other)).toEqual([Good.None, 0]);
  });

  it('leaves the goods of a cancelled stockpile tile where they lie, as goods on the ground', () => {
    const sim = simWith(open(24), 4, [[4, 4, Good.Stone, 3]]);
    const [cancelled, kept] = [at(sim.map, 4, 4), at(sim.map, 20, 20)];
    applyCommand(sim, mark('stockpile', 4, 4));
    applyCommand(sim, mark('stockpile', 20, 20));
    for (let i = 0; i < 100; i++) step(sim);
    expect(busy(sim)).toEqual([]);

    applyCommand(sim, mark('cancel', 4, 4));
    step(sim);
    expect([sim.orders.claims[cancelled], ...stack(sim, cancelled)]).toEqual([Claim.None, Good.Stone, 3]);
    runUntil(sim, () => sim.map.stackSize[kept] === 3, 600);
    expect(stack(sim, cancelled)).toEqual([Good.None, 0]);
  });
});

describe('a felled tree', () => {
  it('never puts its logs on a stockpile place that a unit on its way has reserved', () => {
    const rows = open(32);
    rows[2] = '..T' + '.'.repeat(29);
    const sim = simWith(rows, 2, [
      [2, 2, Good.Stone, 8],
      [3, 2, Good.Log, 6],
      [29, 29, Good.Log, 1],
    ]);
    const [tree, place, west] = [at(sim.map, 2, 2), at(sim.map, 3, 2), at(sim.map, 1, 2)];
    applyCommand(sim, mark('stockpile', 3, 2));
    applyCommand(sim, mark('chop', 2, 2));
    runUntil(sim, () => sim.map.trees[tree] === 0, 1000);
    const [carrier] = carriers(sim) as [number];
    expect([sim.villagers.carried[carrier], sim.villagers.destination[carrier]]).toEqual([Good.Log, place]);
    expect(stack(sim, place)).toEqual([Good.Log, 7]);
    expect(stack(sim, west)).toEqual([Good.Log, 1]);

    runUntil(sim, () => sim.villagers.task[carrier] === NO_TASK, 1000);
    expect(stack(sim, place)).toEqual([Good.Log, 8]);
    expect(stack(sim, at(sim.map, 29, 29))).toEqual([Good.None, 0]);
    expect(tally(sim, Good.Log)).toEqual({ stockpiled: 8, ground: 1 });
  });
});

describe('the simulation with goods on their way', () => {
  it('reaches the same state through a dusk and a dawn from one seed and the same commands', () => {
    const map = generateMap(7, 64);
    const whole = { x0: 0, y0: 0, x1: 63, y1: 63 };
    const script: readonly { tick: number; command: Command }[] = [
      { tick: 0, command: { kind: 'markArea', order: 'chop', area: whole } },
      { tick: 0, command: { kind: 'markArea', order: 'quarry', area: whole } },
      { tick: 0, command: mark('stockpile', 26, 26, 38, 38) },
      { tick: 900, command: mark('cancel', 26, 26, 30, 38) },
      { tick: 2000, command: mark('stockpile', 10, 10, 20, 20) },
    ];
    const play = () => {
      const sim = createSim(map, { villagers: 40, monsters: 20 });
      let onTheirWayAtDusk = 0;
      while (sim.tick < 4000) {
        for (const { tick, command } of script) if (tick === sim.tick) applyCommand(sim, command);
        if (!isNight(sim.tick) && isNight(sim.tick + 1)) {
          for (let id = 0; id < 40; id++) if (sim.villagers.carried[id] !== Good.None) onTheirWayAtDusk++;
        }
        step(sim);
      }
      return { sim, onTheirWayAtDusk };
    };
    const first = play();
    const second = play();
    expect(first.onTheirWayAtDusk).toBeGreaterThan(3);
    expect(tally(first.sim, Good.Log).stockpiled).toBeGreaterThan(0);
    expect(tally(first.sim, Good.Stone).stockpiled).toBeGreaterThan(0);
    expect(second.sim.villagers).toEqual(first.sim.villagers);
    expect(second.sim.map).toEqual(first.sim.map);
    expect(second).toEqual(first);
  });
});
