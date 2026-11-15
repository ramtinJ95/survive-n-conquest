import { describe, expect, it } from 'vitest';
import { campTile } from './camp';
import { ENTRY_BAND, type FlowField, createFlowField, openFlowTile } from './flowField';
import { DIRECTIONS, TileKind, type TileMap, copyMap, stepLength, stepTo, tileAt, walkable } from './map';
import { generateMap } from './mapgen';
import { MONSTER_STEP } from './monsters';
import { hash } from './noise';
import { BENCHMARK_POPULATION, type Population, type Sim, createSim, step } from './sim';
import { VILLAGER_STEP, WANDER_REACH } from './villagers';

const SIZE = 96;
const map = generateMap(7, SIZE);
const POPULATION: Population = { villagers: 300, monsters: 600 };
/** Float32 positions round each step by up to a few millionths of a tile. */
const ROUNDING = 1e-5;

function run(sim: Sim, ticks: number, afterEach: () => void = () => {}): Sim {
  for (let tick = 0; tick < ticks; tick++) {
    step(sim);
    afterEach();
  }
  return sim;
}

const entrancesOf = (flow: FlowField) => Array.from(flow.entrances.subarray(0, flow.entranceCount));

function tileCenter(on: TileMap, tile: number): [number, number] {
  return [(tile % on.size) + 0.5, Math.floor(tile / on.size) + 0.5];
}

function tilesWhere(on: TileMap, keep: (tile: number) => boolean): number[] {
  return Array.from({ length: on.size * on.size }, (_, tile) => tile).filter(keep);
}

function standingOnWaterOrRock(on: TileMap, xs: Float32Array, ys: Float32Array): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) if (!walkable(on, tileAt(on, xs[i]!, ys[i]!))) count++;
  return count;
}

describe('the units', () => {
  it('end in the same state when two runs start from one seed', () => {
    const first = run(createSim(map, POPULATION), 1000);
    const second = run(createSim(map, POPULATION), 1000);
    expect(second).toEqual(first);
    expect(first.villagers.x).not.toEqual(createSim(map, POPULATION).villagers.x);
    expect(first.monsters.x).not.toEqual(createSim(map, POPULATION).monsters.x);
  });

  it('end in a different state from another seed', () => {
    const other = generateMap(8, SIZE);
    expect(run(createSim(other, POPULATION), 50).villagers.x).not.toEqual(run(createSim(map, POPULATION), 50).villagers.x);
  });

  it('never cut a corner beside water or rock', () => {
    const big = generateMap(7, 256);
    const sim = createSim(big, BENCHMARK_POPULATION);
    const tables = [sim.villagers, sim.monsters];
    const lastX = tables.map(({ x }) => new Float32Array(x.length));
    const lastY = tables.map(({ y }) => new Float32Array(y.length));
    const squeezes: string[] = [];
    for (let tick = 0; tick < 1000; tick++) {
      tables.forEach(({ x, y }, table) => {
        lastX[table]!.set(x);
        lastY[table]!.set(y);
      });
      step(sim);
      tables.forEach(({ x, y }, table) => {
        for (let id = 0; id < x.length; id++) {
          const [fromX, fromY] = [Math.floor(lastX[table]![id]!), Math.floor(lastY[table]![id]!)];
          const [toX, toY] = [Math.floor(x[id]!), Math.floor(y[id]!)];
          if (Math.abs(toX - fromX) !== 1 || Math.abs(toY - fromY) !== 1) continue;
          const besideClear = walkable(sim.map, fromY * big.size + toX) && walkable(sim.map, toY * big.size + fromX);
          if (!besideClear) squeezes.push(`table ${table} unit ${id} at tick ${tick}`);
        }
      });
    }
    expect(squeezes).toEqual([]);
  });

  it('never stand on water or rock', () => {
    const sim = createSim(map, POPULATION);
    let violations = 0;
    run(sim, 3000, () => {
      violations += standingOnWaterOrRock(map, sim.villagers.x, sim.villagers.y);
      violations += standingOnWaterOrRock(map, sim.monsters.x, sim.monsters.y);
    });
    expect(violations).toBe(0);
  });
});

describe('the villagers', () => {
  it('walk 1.5 tiles per second and spend most ticks walking', () => {
    const sim = createSim(map, POPULATION);
    const { x, y } = sim.villagers;
    const lastX = new Float32Array(x.length);
    const lastY = new Float32Array(y.length);
    let longest = 0;
    let fullSteps = 0;
    for (let tick = 0; tick < 1000; tick++) {
      lastX.set(x);
      lastY.set(y);
      step(sim);
      for (let id = 0; id < x.length; id++) {
        const moved = Math.hypot(x[id]! - lastX[id]!, y[id]! - lastY[id]!);
        longest = Math.max(longest, moved);
        if (moved > VILLAGER_STEP - ROUNDING) fullSteps++;
      }
    }
    expect(VILLAGER_STEP * 10).toBeCloseTo(1.5, 10);
    expect(longest).toBeLessThan(VILLAGER_STEP + ROUNDING);
    expect(fullSteps / (1000 * x.length)).toBeGreaterThan(0.9);
  });

  it('wander away from the camp by day and stay within reach of it', () => {
    const sim = createSim(map, POPULATION);
    const campX = (sim.camp % SIZE) + 0.5;
    const campY = Math.floor(sim.camp / SIZE) + 0.5;
    const farthest = new Float32Array(POPULATION.villagers);
    run(sim, 1000, () => {
      for (let id = 0; id < farthest.length; id++) {
        const away = Math.max(Math.abs(sim.villagers.x[id]! - campX), Math.abs(sim.villagers.y[id]! - campY));
        farthest[id] = Math.max(farthest[id]!, away);
      }
    });
    expect(Math.max(...farthest)).toBeLessThanOrEqual(WANDER_REACH);
    expect(farthest.filter((away) => away > WANDER_REACH / 2).length / farthest.length).toBeGreaterThan(0.9);
  });
});

describe('the monsters', () => {
  it('walk 1 tile per second', () => {
    const sim = createSim(map, POPULATION);
    const { x, y } = sim.monsters;
    const lastX = new Float32Array(x.length);
    const lastY = new Float32Array(y.length);
    let longest = 0;
    for (let tick = 0; tick < 500; tick++) {
      lastX.set(x);
      lastY.set(y);
      step(sim);
      for (let id = 0; id < x.length; id++) {
        if (tileAt(map, lastX[id]!, lastY[id]!) === sim.flow.goal) continue;
        longest = Math.max(longest, Math.hypot(x[id]! - lastX[id]!, y[id]! - lastY[id]!));
      }
    }
    expect(MONSTER_STEP * 10).toBeCloseTo(1, 10);
    expect(longest).toBeLessThan(MONSTER_STEP + ROUNDING);
  });

  it('all reach the goal and enter again from the map edge', () => {
    const sim = createSim(map, POPULATION);
    const startDraws = Uint32Array.from(sim.monsters.draws);
    const entered = new Set<number>();
    const { x, y } = sim.monsters;
    let wasAtGoal = new Uint8Array(x.length);
    run(sim, 3000, () => {
      const atGoal = new Uint8Array(x.length);
      for (let id = 0; id < x.length; id++) {
        const tile = tileAt(map, x[id]!, y[id]!);
        if (wasAtGoal[id]) entered.add(tile);
        atGoal[id] = tile === sim.flow.goal ? 1 : 0;
      }
      wasAtGoal = atGoal;
    });
    const arrivals = sim.monsters.draws.filter((draws, id) => draws > startDraws[id]!).length;
    expect(arrivals).toBe(POPULATION.monsters);
    expect(entered.size).toBeGreaterThan(50);
    for (const tile of entered) expect(entrancesOf(sim.flow)).toContain(tile);
  });
});

describe('the flow field', () => {
  function expectRoutesEndAtGoal(on: TileMap) {
    const flow = createFlowField(on, campTile(on));
    const { size } = on;
    const badSteps: number[] = [];
    let routes = 0;
    for (let tile = 0; tile < size * size; tile++) {
      if (flow.next[tile] === -1 || tile === flow.goal) continue;
      routes++;
      const to = flow.next[tile]!;
      const [ax, ay] = tileCenter(on, tile);
      const [tx, ty] = tileCenter(on, to);
      const oneStep = Math.max(Math.abs(tx - ax), Math.abs(ty - ay)) === 1;
      const clearCorner = walkable(on, tileAt(on, tx, ay)) && walkable(on, tileAt(on, ax, ty));
      if (!oneStep || !walkable(on, to) || !clearCorner) badSteps.push(tile);
    }
    expect(badSteps).toEqual([]);

    const reachesGoal = new Uint8Array(size * size);
    reachesGoal[flow.goal] = 1;
    const unfinished: number[] = [];
    for (let tile = 0; tile < size * size; tile++) {
      if (flow.next[tile] === -1) continue;
      const route: number[] = [];
      let at = tile;
      while (!reachesGoal[at] && route.length <= size * size) {
        route.push(at);
        at = flow.next[at]!;
      }
      if (!reachesGoal[at]) unfinished.push(tile);
      for (const visited of route) reachesGoal[visited] = 1;
    }
    expect(unfinished).toEqual([]);
    return { flow, routes };
  }

  it('leads every tile with a route one walkable step at a time to the goal, cutting no blocked corner', () => {
    const { flow, routes } = expectRoutesEndAtGoal(map);
    expect(routes).toBeGreaterThan(SIZE * SIZE * 0.5);
    const [gx, gy] = tileCenter(map, flow.goal);
    expect(Math.hypot(gx - SIZE / 2, gy - SIZE / 2)).toBeLessThan(2);
  });

  it('lists entrances only near the map edge and only where a route starts', () => {
    const flow = createFlowField(map, campTile(map));
    expect(flow.entranceCount).toBeGreaterThan(0);
    for (const tile of entrancesOf(flow)) {
      const [x, y] = tileCenter(map, tile).map(Math.floor) as [number, number];
      expect(Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y)).toBeLessThan(ENTRY_BAND);
      expect(flow.next[tile]).not.toBe(-1);
    }
  });

  it('moves the goal to the nearest land the edge reaches when water or rock cuts off the center', () => {
    const cutOff = generateMap(24, 256);
    const { flow } = expectRoutesEndAtGoal(cutOff);
    const center = tileAt(cutOff, 128, 128);
    expect(flow.next[center]).toBe(-1);
    expect(flow.entranceCount).toBeGreaterThan(0);
  });

  it('keeps the shortest walks of a fresh build while rock tiles open one by one', () => {
    const opened = copyMap(generateMap(7, 128));
    const { size } = opened;
    const flow = createFlowField(opened, campTile(opened));
    const face = (tile: number) =>
      opened.kinds[tile] === TileKind.Rock &&
      [1, -1, size, -size].some((side) => walkable(opened, tile + side) && Math.abs((tile % size) - ((tile + side) % size)) <= 1);
    let longest = 0;
    let shortened = 0;
    for (let i = 0; i < 400; i++) {
      const faces = tilesWhere(opened, face);
      const tile = faces.reduce((best, at) => (hash(91, at, i) < hash(91, best, i) ? at : best));
      const before = flow.walk.slice();
      opened.kinds[tile] = TileKind.Bare;
      openFlowTile(opened, flow, tile);
      shortened += flow.walk.filter((walk, at) => walk < before[at]!).length;
      if (i % 50 !== 49) continue;
      const fresh = createFlowField(opened, flow.goal);
      for (let at = 0; at < size * size; at++) {
        if (fresh.walk[at] === Infinity) expect(flow.walk[at], `tile ${at}`).toBe(Infinity);
        else longest = Math.max(longest, Math.abs(flow.walk[at]! - fresh.walk[at]!));
      }
      expect(entrancesOf(flow).sort((a, b) => a - b)).toEqual(entrancesOf(fresh).sort((a, b) => a - b));
    }
    expect(longest).toBeLessThan(1e-9);
    expect(shortened).toBeGreaterThan(1000);

    const badSteps: number[] = [];
    for (let tile = 0; tile < size * size; tile++) {
      const to = flow.next[tile]!;
      if (to === -1 || tile === flow.goal) continue;
      const x = tile % size;
      const y = Math.floor(tile / size);
      let length = NaN;
      for (let direction = 0; direction < DIRECTIONS; direction++) {
        if (stepTo(opened, x, y, direction) === to) length = stepLength(direction);
      }
      const consistent = Math.abs(flow.walk[tile]! - (flow.walk[to]! + length)) < 1e-9;
      if (!(flow.walk[to]! < flow.walk[tile]!) || !consistent) badSteps.push(tile);
    }
    expect(badSteps).toEqual([]);
  });
});
