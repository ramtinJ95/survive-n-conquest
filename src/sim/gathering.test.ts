import { describe, expect, it } from 'vitest';
import { isDawn, isNight } from './daylight';
import { Good } from './goods';
import { TileKind, tileAt, walkable } from './map';
import { generateMap } from './mapgen';
import { type AreaOrder, Claim, type OrderCommand, takeOrderChanges } from './orders';
import { type Command, type Sim, applyCommand, createSim, step } from './sim';
import { endTask, takeTask } from './tasks';
import { at, mapFrom } from './testMaps';
import { TILE_CHANGE_STRIDE, takeTileChanges } from './tileChanges';
import { VillagerState, WANDER_REACH } from './villagers';

const mark = (order: AreaOrder, x0: number, y0: number, x1 = x0, y1 = y0): OrderCommand => ({
  kind: 'markArea',
  order,
  area: { x0, y0, x1, y1 },
});

function simOn(rows: readonly string[], villagers: number): Sim {
  return createSim(mapFrom(rows), { villagers, monsters: 0 });
}

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

/** The villagers that hold the task on a tile. */
function holders(sim: Sim, tile: number): number[] {
  const found: number[] = [];
  for (let id = 0; id < sim.villagers.task.length; id++) {
    if (sim.villagers.task[id] !== 0 && sim.villagers.taskTile[id] === tile) found.push(id);
  }
  return found;
}

const standsOn = (sim: Sim, id: number) => tileAt(sim.map, sim.villagers.x[id]!, sim.villagers.y[id]!);
const working = (sim: Sim, id: number, tile: number) =>
  sim.villagers.state[id] === VillagerState.Working && sim.villagers.taskTile[id] === tile;
const shareASide = (sim: Sim, a: number, b: number) => {
  const { size } = sim.map;
  return Math.abs((a % size) - (b % size)) + Math.abs(Math.floor(a / size) - Math.floor(b / size)) === 1;
};

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/**
 * Steps until the tree on `tile` falls, and returns the ticks of work on it:
 * the ticks after which a villager is working it, and the tick it fell, whose
 * work ends the task.
 */
function fell(sim: Sim, tile: number, limit: number): number {
  let ticks = 0;
  runUntil(
    sim,
    () => sim.map.trees[tile] === 0,
    limit,
    () => {
      for (let id = 0; id < sim.villagers.task.length; id++) if (working(sim, id, tile)) ticks++;
      if (sim.map.trees[tile] === 0) ticks++;
    },
  );
  return ticks;
}

function stoneOnTheGround(sim: Sim): number {
  let stone = 0;
  sim.map.stackSize.forEach((size, tile) => {
    if (sim.map.stackGood[tile] === Good.Stone) stone += size;
  });
  return stone;
}

function groupsOf(changes: Int32Array): number[][] {
  const groups: number[][] = [];
  for (let i = 0; i < changes.length; i += TILE_CHANGE_STRIDE) groups.push(Array.from(changes.subarray(i, i + TILE_CHANGE_STRIDE)));
  return groups;
}

describe('chopping', () => {
  it('fells a marked tree after 200 ticks of work and leaves 2 logs on its tile', () => {
    const rows = open(24);
    rows[3] = '...T' + '.'.repeat(20);
    const sim = simOn(rows, 1);
    const tree = at(sim.map, 3, 3);
    applyCommand(sim, mark('chop', 0, 0, 23, 23));
    takeOrderChanges(sim.orders);
    takeTileChanges(sim);

    expect(fell(sim, tree, 1000)).toBe(200);
    expect([sim.map.stackGood[tree], sim.map.stackSize[tree]]).toEqual([Good.Log, 2]);
    expect(sim.map.kinds[tree]).toBe(TileKind.Forest);
    expect(sim.orders.claims[tree]).toBe(Claim.None);
    expect(Array.from(takeOrderChanges(sim.orders).claims)).toEqual([tree, Claim.None]);
    expect(groupsOf(takeTileChanges(sim))).toEqual([[tree, TileKind.Forest, 0, Good.Log, 2]]);
    expect(sim.villagers.task[0]).toBe(0);
  });

  it('chops from the tree tile, and an idle villager far from the camp walks back near it', () => {
    const rows = open(24);
    rows[2] = '..T' + '.'.repeat(21);
    const sim = simOn(rows, 1);
    const tree = at(sim.map, 2, 2);
    const campX = (sim.camp % 24) + 0.5;
    const campY = Math.floor(sim.camp / 24) + 0.5;
    expect(Math.max(Math.abs(2.5 - campX), Math.abs(2.5 - campY))).toBeGreaterThan(WANDER_REACH);
    applyCommand(sim, mark('chop', 2, 2));
    runUntil(sim, () => working(sim, 0, tree), 500);
    expect([sim.villagers.x[0], sim.villagers.y[0]]).toEqual([2.5, 2.5]);
    runUntil(sim, () => sim.map.trees[tree] === 0, 500);
    runUntil(
      sim,
      () => Math.max(Math.abs(sim.villagers.x[0]! - campX), Math.abs(sim.villagers.y[0]! - campY)) <= WANDER_REACH,
      200,
    );
    expect(sim.villagers.state[0]).toBe(VillagerState.Idle);
  });

  it('lets one villager at a time work a tree, while others work trees of their own', () => {
    const rows = open(24);
    rows[4] = '....T.T.T' + '.'.repeat(15);
    const sim = simOn(rows, 8);
    const trees = [at(sim.map, 4, 4), at(sim.map, 6, 4), at(sim.map, 8, 4)];
    applyCommand(sim, mark('chop', 0, 0, 23, 23));
    let crowded = 0;
    let busiest = 0;
    runUntil(
      sim,
      () => trees.every((tree) => sim.map.trees[tree] === 0),
      1000,
      () => {
        for (const tree of trees) crowded += holders(sim, tree).length > 1 ? 1 : 0;
        busiest = Math.max(busiest, trees.filter((tree) => holders(sim, tree).length === 1).length);
      },
    );
    expect(crowded).toBe(0);
    expect(busiest).toBe(3);
  });
});

describe('quarrying', () => {
  // A rock tile walls off the land east of the water from the camp, with a tree on that land.
  const WALL = [
    '......~.....',
    '......~.....',
    '......~.....',
    '......~.....',
    '......~.....',
    '......#.....',
    '......~.....',
    '......~..T..',
    '......~.....',
    '......~.....',
    '......~.....',
    '......~.....',
  ];

  it('works a rock tile from a side neighbor, stacks a stone there each 200 ticks, and opens bare ground after 8', () => {
    const sim = simOn(WALL, 2);
    const rock = at(sim.map, 6, 5);
    const tree = at(sim.map, 9, 7);
    const height = sim.map.heights[rock];
    applyCommand(sim, mark('quarry', 0, 0, 11, 11));
    applyCommand(sim, mark('chop', 0, 0, 11, 11));
    takeTileChanges(sim);

    const stands = new Set<number>();
    let quarryTicks = 0;
    let stone = 0;
    let spentOn = -1;
    let treeTakenOn = -1;
    runUntil(
      sim,
      () => sim.map.trees[tree] === 0,
      12000,
      () => {
        for (let id = 0; id < 2; id++) {
          if (!working(sim, id, rock)) continue;
          quarryTicks++;
          stands.add(standsOn(sim, id));
        }
        const stoneNow = stoneOnTheGround(sim);
        // The tick of work that yields a stone ends the task, so the villager is no longer working after it.
        quarryTicks += stoneNow - stone;
        stone = stoneNow;
        if (treeTakenOn < 0 && holders(sim, tree).length > 0) treeTakenOn = sim.tick - 1;
        if (spentOn < 0 && sim.map.kinds[rock] === TileKind.Bare) spentOn = sim.tick - 1;
      },
    );

    expect([...stands]).toEqual([at(sim.map, 5, 5)]);
    const [worker] = [...stands];
    expect(shareASide(sim, worker!, rock)).toBe(true);
    expect([sim.map.stackGood[worker!], sim.map.stackSize[worker!]]).toEqual([Good.Stone, 8]);
    expect(stone).toBe(8);
    expect(quarryTicks).toBe(8 * 200);
    expect(sim.map.kinds[rock]).toBe(TileKind.Bare);
    expect(walkable(sim.map, rock)).toBe(true);
    expect(sim.map.heights[rock]).toBe(height);
    expect(sim.orders.claims[rock]).toBe(Claim.None);
    expect(groupsOf(takeTileChanges(sim))).toContainEqual([rock, TileKind.Bare, 0, Good.None, 0]);

    // The tree beyond was out of reach until the rock tile opened, and was taken before the next dawn.
    expect(treeTakenOn).toBeGreaterThan(spentOn);
    expect(isNight(spentOn)).toBe(false);
    for (let tick = spentOn; tick <= treeTakenOn; tick++) expect(isNight(tick), `tick ${tick}`).toBe(false);
    expect([sim.map.stackGood[tree], sim.map.stackSize[tree]]).toEqual([Good.Log, 2]);
  });

  it('walks settlers across a spent rock tile', () => {
    const sim = simOn(WALL, 2);
    const rock = at(sim.map, 6, 5);
    applyCommand(sim, mark('quarry', 0, 0, 11, 11));
    applyCommand(sim, mark('chop', 0, 0, 11, 11));
    let crossed = false;
    runUntil(
      sim,
      () => sim.map.trees[at(sim.map, 9, 7)] === 0,
      12000,
      () => {
        for (let id = 0; id < 2; id++) if (standsOn(sim, id) === rock) crossed = true;
      },
    );
    expect(crossed).toBe(true);
  });

  it('leaves a rock tile with no walkable side until a neighbor is spent, then quarries it from there', () => {
    const rows = Array.from({ length: 12 }, (_, y) => (y === 5 ? '......##~~~~' : '......~~~~~~'));
    const sim = simOn(rows, 3);
    const [outer, inner] = [at(sim.map, 6, 5), at(sim.map, 7, 5)];
    applyCommand(sim, mark('quarry', 0, 0, 11, 11));
    let innerWorkedBeforeSpent = 0;
    const innerStands = new Set<number>();
    runUntil(
      sim,
      () => sim.map.kinds[inner] === TileKind.Bare,
      30000,
      () => {
        for (let id = 0; id < 3; id++) {
          if (!working(sim, id, inner)) continue;
          if (sim.map.kinds[outer] !== TileKind.Bare) innerWorkedBeforeSpent++;
          innerStands.add(standsOn(sim, id));
        }
      },
    );
    expect(innerWorkedBeforeSpent).toBe(0);
    expect([...innerStands]).toEqual([outer]);
    expect([sim.map.stackGood[outer], sim.map.stackSize[outer]]).toEqual([Good.Stone, 8]);
  });

  it('lets several villagers quarry an outcrop side by side', () => {
    const rows = open(16);
    rows[10] = '....######......';
    const sim = simOn(rows, 8);
    applyCommand(sim, mark('quarry', 0, 0, 15, 15));
    let most = 0;
    runUntil(sim, () => sim.tick === 400, 400, () => {
      let workers = 0;
      for (let id = 0; id < 8; id++) if (sim.villagers.state[id] === VillagerState.Working) workers++;
      most = Math.max(most, workers);
    });
    expect(most).toBe(6);
  });
});

describe('a task', () => {
  it('goes to an idle villager only on the tick of its group', () => {
    const map = generateMap(7, 64);
    const sim = createSim(map, { villagers: 20, monsters: 0 });
    applyCommand(sim, mark('chop', 0, 0, 63, 63));
    const firstTook = new Array<number>(20).fill(-1);
    const offGroup: string[] = [];
    let takes = 0;
    let held = Uint8Array.from(sim.villagers.task);
    runUntil(sim, () => sim.tick === 1000, 1000, () => {
      for (let id = 0; id < 20; id++) {
        if (held[id] !== 0 || sim.villagers.task[id] === 0) continue;
        const tick = sim.tick - 1;
        takes++;
        if (firstTook[id] === -1) firstTook[id] = tick;
        if (tick % 10 !== id % 10) offGroup.push(`villager ${id} on tick ${tick}`);
      }
      held = Uint8Array.from(sim.villagers.task);
    });
    expect(firstTook).toEqual(Array.from({ length: 20 }, (_, id) => id % 10));
    expect(takes).toBeGreaterThan(40);
    expect(offGroup).toEqual([]);
  });

  it('goes to the nearest open one in a straight line, even when another is a shorter walk', () => {
    const rows = open(16).map((row, y) => (y <= 12 ? row.slice(0, 8) + '#' + row.slice(9) : row));
    rows[2] = rows[2]!.slice(0, 6) + 'T' + rows[2]!.slice(7);
    rows[9] = rows[9]!.slice(0, 10) + 'T' + rows[9]!.slice(11);
    const sim = simOn(rows, 1);
    const [across, beside] = [at(sim.map, 10, 9), at(sim.map, 6, 2)];
    sim.villagers.x[0] = 6.5;
    sim.villagers.y[0] = 9.5;
    applyCommand(sim, mark('chop', 0, 0, 15, 15));
    step(sim);
    expect(holders(sim, across)).toEqual([0]);
    expect(holders(sim, beside)).toEqual([]);
    // The tree beside lies 7 straight steps up, and the route around the wall to the one across takes 10.
    expect(sim.villagers.pathLength[0]).toBe(11);
  });

  it('goes to the nearest open one in a straight line from anywhere on a large map', () => {
    const sim = createSim(generateMap(7, 96), { villagers: 1, monsters: 0 });
    applyCommand(sim, mark('chop', 0, 0, 95, 95));
    applyCommand(sim, mark('quarry', 0, 0, 95, 95));
    const { size } = sim.map;
    const land = Array.from({ length: size * size }, (_, tile) => tile).filter((tile) => sim.flow.next[tile] !== -1);
    const missed: string[] = [];
    for (let i = 0; i < 60; i++) {
      const from = land[Math.floor((i * land.length) / 60)]!;
      const px = (from % size) + 0.5;
      const py = Math.floor(from / size) + 0.5;
      let nearest = -1;
      let best = Infinity;
      sim.gathering.open.forEach((isOpen, tile) => {
        const distance = ((tile % size) + 0.5 - px) ** 2 + (Math.floor(tile / size) + 0.5 - py) ** 2;
        if (isOpen && distance < best) [nearest, best] = [tile, distance];
      });
      sim.villagers.x[0] = px;
      sim.villagers.y[0] = py;
      expect(takeTask(sim, 0)).toBe(true);
      if (sim.villagers.taskTile[0] !== nearest) missed.push(`from ${from}: took ${sim.villagers.taskTile[0]}, nearest ${nearest}`);
      endTask(sim, 0);
    }
    expect(missed).toEqual([]);
  });

  it('is given up at dusk, and at dawn the work goes on from where it stopped', () => {
    const rows = open(12);
    rows[3] = '...T........';
    const sim = simOn(rows, 1);
    const tree = at(sim.map, 3, 3);
    runUntil(sim, () => sim.tick === 1300, 1300);
    applyCommand(sim, mark('chop', 3, 3));
    let ticks = 0;
    let workedAtDusk = false;
    let tickAfterDusk: number[] = [];
    runUntil(
      sim,
      () => sim.map.trees[tree] === 0,
      4000,
      () => {
        if (working(sim, 0, tree)) ticks++;
        if (sim.map.trees[tree] === 0) ticks++;
        if (!isNight(sim.tick - 1) && isNight(sim.tick) && working(sim, 0, tree)) workedAtDusk = true;
        if (isNight(sim.tick - 1) && !isNight(sim.tick - 2)) {
          tickAfterDusk = [sim.villagers.task[0]!, sim.villagers.state[0]!, holders(sim, tree).length];
        }
        if (isNight(sim.tick - 1)) expect(sim.villagers.task[0]).toBe(0);
      },
    );
    expect(workedAtDusk).toBe(true);
    expect(tickAfterDusk).toEqual([0, VillagerState.GoingHome, 0]);
    expect(ticks).toBe(200);
    expect(isNight(sim.tick)).toBe(false);
    expect(sim.tick).toBeGreaterThan(2600);
  });

  it('is given up on the next tick when its mark is cancelled, and a new mark keeps the work done', () => {
    const rows = open(12);
    rows[3] = '...T........';
    const sim = simOn(rows, 1);
    const tree = at(sim.map, 3, 3);
    applyCommand(sim, mark('chop', 3, 3));
    let ticks = 0;
    runUntil(sim, () => ticks === 120, 400, () => {
      if (working(sim, 0, tree)) ticks++;
    });
    applyCommand(sim, mark('cancel', 2, 2, 4, 4));
    step(sim);
    expect(sim.villagers.task[0]).toBe(0);
    expect(sim.villagers.state[0]).toBe(VillagerState.Idle);
    expect(sim.map.trees[tree]).toBe(1);
    for (let i = 0; i < 50; i++) step(sim);
    expect(holders(sim, tree)).toEqual([]);

    applyCommand(sim, mark('chop', 3, 3));
    expect(ticks + fell(sim, tree, 400)).toBe(200);
  });

  it('that one villager cannot reach is set aside for every villager until dawn', () => {
    const rows = open(16);
    rows[13] = '~~~~~~~~~~~~~~~~';
    rows[14] = '~~~~~~~~~~~~~~~~';
    rows[6] = '......T.........';
    const sim = simOn(rows, 4);
    const tree = at(sim.map, 6, 6);
    // Villager 0 stands on land that no walk from the camp reaches, which nothing in play allows.
    sim.villagers.x[0] = 2.5;
    sim.villagers.y[0] = 15.5;
    applyCommand(sim, mark('chop', 6, 6));
    expect(sim.flow.next[tree]).not.toBe(-1);

    let heldByDay = 0;
    runUntil(sim, () => isNight(sim.tick), 2000, () => {
      heldByDay += holders(sim, tree).length;
    });
    expect(heldByDay).toBe(0);
    expect(sim.map.trees[tree]).toBe(1);

    runUntil(sim, () => isDawn(sim.tick), 2000);
    sim.villagers.x[0] = sim.villagers.spotX[0]!;
    sim.villagers.y[0] = sim.villagers.spotY[0]!;
    const dawn = sim.tick;
    runUntil(sim, () => holders(sim, tree).length > 0, 10);
    expect(sim.tick - dawn).toBeLessThanOrEqual(10);
  });

  it('stays ready with its work done when the land has no room for the logs, and falls once there is room', () => {
    const rows = ['~~~~~~~~', '~~~~~~~~', '~~...~~~', '~~...~~~', '~~..T~~~', '~~~~~~~~', '~~~~~~~~', '~~~~~~~~'];
    const sim = simOn(rows, 1);
    const tree = at(sim.map, 4, 4);
    const land: number[] = [];
    for (let tile = 0; tile < 64; tile++) {
      if (!walkable(sim.map, tile)) continue;
      land.push(tile);
      sim.map.stackGood[tile] = Good.Stone;
      sim.map.stackSize[tile] = 8;
    }
    applyCommand(sim, mark('chop', 4, 4));
    let ticks = 0;
    let givenUp = 0;
    let holding = false;
    runUntil(sim, () => sim.tick === 600, 600, () => {
      if (working(sim, 0, tree)) ticks++;
      if (holding && sim.villagers.task[0] === 0) givenUp++;
      holding = sim.villagers.task[0] !== 0;
    });
    // The 200th tick of work finds no room, so it ends the task instead of leaving the villager working.
    expect(ticks).toBe(199);
    expect(givenUp).toBeGreaterThan(2);
    expect(sim.map.trees[tree]).toBe(1);
    expect(sim.orders.claims[tree]).toBe(Claim.Chop);
    expect(land.map((tile) => [sim.map.stackGood[tile], sim.map.stackSize[tile]])).toEqual(land.map(() => [Good.Stone, 8]));

    const freed = at(sim.map, 2, 2);
    sim.map.stackSize[freed] = 0;
    sim.map.stackGood[freed] = Good.None;
    let workAfterRoom = 0;
    runUntil(sim, () => sim.map.trees[tree] === 0, 100, () => {
      if (working(sim, 0, tree)) workAfterRoom++;
    });
    expect(workAfterRoom).toBe(0);
    expect([sim.map.stackGood[freed], sim.map.stackSize[freed]]).toEqual([Good.Log, 2]);
  });
});

describe('the simulation with work in progress', () => {
  it('reaches the same state through a dusk and a dawn from one seed and the same commands', () => {
    const map = generateMap(7, 64);
    const whole = { x0: 0, y0: 0, x1: 63, y1: 63 };
    const script: readonly { tick: number; command: Command }[] = [
      { tick: 0, command: { kind: 'markArea', order: 'chop', area: whole } },
      { tick: 0, command: { kind: 'markArea', order: 'quarry', area: whole } },
      { tick: 900, command: mark('cancel', 20, 20, 40, 40) },
      { tick: 2000, command: mark('chop', 20, 20, 40, 40) },
      { tick: 2000, command: mark('quarry', 20, 20, 40, 40) },
    ];
    const play = () => {
      const sim = createSim(map, { villagers: 40, monsters: 20 });
      let workingAtDusk = 0;
      while (sim.tick < 4000) {
        for (const { tick, command } of script) if (tick === sim.tick) applyCommand(sim, command);
        if (!isNight(sim.tick) && isNight(sim.tick + 1)) {
          for (let id = 0; id < 40; id++) if (sim.villagers.state[id] === VillagerState.Working) workingAtDusk++;
        }
        step(sim);
      }
      return { sim, workingAtDusk };
    };
    const first = play();
    const second = play();
    expect(first.workingAtDusk).toBeGreaterThan(10);
    expect(first.sim.map.trees).not.toEqual(map.trees);
    expect(first.sim.map.stackSize).not.toEqual(map.stackSize);
    expect(second).toEqual(first);
  });
});
