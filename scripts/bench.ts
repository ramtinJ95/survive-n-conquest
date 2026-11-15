import { fullGC } from 'bun:jsc';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { TICKS_PER_DAY, TICKS_PER_SECOND, tickOfDay } from '../src/sim/calendar';
import { CARRYING } from '../src/sim/carrying';
import { isNight } from '../src/sim/daylight';
import { GATHERING } from '../src/sim/gathering';
import { GOOD_KINDS, Good } from '../src/sim/goods';
import { TileKind, type TileMap, tileAt, walkable } from '../src/sim/map';
import { campTile } from '../src/sim/camp';
import { generateMap } from '../src/sim/mapgen';
import { Claim } from '../src/sim/orders';
import { BENCHMARK_POPULATION, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { NO_TASK, TASK_KINDS } from '../src/sim/tasks';

const SEED = 7;
const SIZES = [256, 512];
const WARMUP_TICKS = 2_000;
const MEASURED_TICKS = 10_000;
const LIMIT_MS = 4;
const BUDGET_AT_8X_MS = 1000 / (TICKS_PER_SECOND * 8);
/** A measurement counts only while at least this share of daytime villager-ticks holds a task. */
const LEAST_BUSY = 0.9;
/** Grass within this many tiles of the camp, on either axis, stays bare on the benchmark map. */
const BARE_REACH = 16;
/**
 * Tiles whose x and y are both multiples of this get no tree on the benchmark
 * map, so a stockpile tile lies within a step of every grove and rock face. At
 * 3 the 256 map ends the measured ticks with room on a quarter of its stockpile
 * tiles, and at 4 it runs out of room.
 */
const STOCKPILE_SPACING = 2;
const KINDS = [
  ['carrying', TASK_KINDS.indexOf(CARRYING) + 1],
  ['gathering', TASK_KINDS.indexOf(GATHERING) + 1],
] as const;
const GOOD_NAMES = ['logs', 'stone'] as const;

const sum = (values: Uint32Array) => values.reduce((total, value) => total + value, 0);

function quantile(sorted: Float64Array, q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}

function offLand(map: TileMap, x: Float32Array, y: Float32Array): number {
  let count = 0;
  for (let id = 0; id < x.length; id++) {
    const inside = x[id]! >= 0 && y[id]! >= 0 && x[id]! < map.size && y[id]! < map.size;
    if (!inside || !walkable(map, tileAt(map, x[id]!, y[id]!))) count++;
  }
  return count;
}

/** The work done on the map so far, as the land and the villagers' hands show it. */
function workOf({ map, orders, villagers }: Sim) {
  let trees = 0;
  let stone = 0;
  let bare = 0;
  let stockpiled = 0;
  for (let tile = 0; tile < map.size * map.size; tile++) {
    trees += map.trees[tile]!;
    if (map.stackGood[tile] === Good.Stone) stone += map.stackSize[tile]!;
    if (map.kinds[tile] === TileKind.Bare) bare++;
    if (orders.claims[tile] === Claim.Stockpile) stockpiled += map.stackSize[tile]!;
  }
  for (let id = 0; id < villagers.carried.length; id++) if (villagers.carried[id] === Good.Stone) stone++;
  return { trees, stone, bare, stockpiled };
}

function atCamp(sim: Sim): number {
  let count = 0;
  for (let id = 0; id < sim.villagers.x.length; id++) {
    const { x, y, spotX, spotY } = sim.villagers;
    if (x[id] === spotX[id] && y[id] === spotY[id]) count++;
  }
  return count;
}

// JavaScriptCore scans the stack conservatively. Made in its own frame, the source map leaves no stale pointer that would keep it alive into the measured ticks.
// The generated forest has a tree on one tile in six, and 1500 villagers fell every one they can reach on the 256 map
// before the measured ticks end. The benchmark map keeps the seed's terrain and adds a tree to every forest tile, and to
// every grass tile farther than `BARE_REACH` from the camp, so the work lasts and still lies a walk away from the camp.
function setUp(size: number): Sim {
  const map = generateMap(SEED, size);
  const camp = campTile(map);
  for (let tile = 0; tile < size * size; tile++) {
    const x = tile % size;
    const y = Math.floor(tile / size);
    const far = Math.max(Math.abs(x - (camp % size)), Math.abs(y - Math.floor(camp / size))) > BARE_REACH;
    const lattice = x % STOCKPILE_SPACING === 0 && y % STOCKPILE_SPACING === 0;
    if (!lattice && (map.kinds[tile] === TileKind.Forest || (far && map.kinds[tile] === TileKind.Grass))) map.trees[tile] = 1;
  }
  const sim = createSim(map, BENCHMARK_POPULATION);
  applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 0, y0: 0, x1: size - 1, y1: size - 1 } });
  return sim;
}

function measure(size: number): boolean {
  const setupStart = performance.now();
  const sim = setUp(size);
  const setupMs = performance.now() - setupStart;

  for (let tick = 0; tick < WARMUP_TICKS; tick++) step(sim);
  const monsterDraws = sum(sim.monsters.draws);
  const workBefore = workOf(sim);
  const samples = new Float64Array(MEASURED_TICKS);
  const { task } = sim.villagers;
  const heldTask = new Uint8Array(task.length);
  let dayVillagerTicks = 0;
  let dayTaskTicks = 0;
  const dayKindTicks = new Float64Array(TASK_KINDS.length + 1);
  let fewestOpen = Infinity;
  const fewestRoom = new Float64Array(GOOD_KINDS).fill(Infinity);

  // JavaScriptCore reports its heap size only at a collection, so this sees what the ticks keep, not short-lived garbage.
  atCamp(sim);
  const midnights = new Int32Array(Math.ceil(MEASURED_TICKS / TICKS_PER_DAY) + 1);
  let nights = 0;
  const heapBefore = fullGC();
  for (let tick = 0; tick < MEASURED_TICKS; tick++) {
    const start = performance.now();
    step(sim);
    samples[tick] = performance.now() - start;
    if (tickOfDay(sim.tick) === 0) midnights[nights++] = atCamp(sim);
    const day = !isNight(sim.tick - 1);
    for (let id = 0; id < task.length; id++) {
      if (task[id] === NO_TASK) continue;
      heldTask[id] = 1;
      if (day) dayTaskTicks++;
      if (day) dayKindTicks[task[id]!]++;
    }
    if (!day) continue;
    dayVillagerTicks += task.length;
    fewestOpen = Math.min(fewestOpen, sim.gathering.count);
    for (let good = 0; good < GOOD_KINDS; good++) fewestRoom[good] = Math.min(fewestRoom[good]!, sim.goods.room[good]!.count);
  }
  const heapGrowth = fullGC() - heapBefore;
  const workAfter = workOf(sim);
  const villagers = task.length;
  const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)}%`;

  samples.sort();
  const median = quantile(samples, 0.5);
  const p99 = quantile(samples, 0.99);
  const busy = dayTaskTicks / dayVillagerTicks;
  const workHeld = busy >= LEAST_BUSY && fewestOpen > 0 && fewestRoom.every((room) => room > 0);
  const pass = p99 < LIMIT_MS && workHeld;
  const goalX = (sim.flow.goal % size) + 0.5 - size / 2;
  const goalY = Math.floor(sim.flow.goal / size) + 0.5 - size / 2;
  const ms = (value: number) => `${value.toFixed(3)} ms`;

  console.log(`\nmap ${size}x${size}`);
  console.log(`  median ${ms(median)}, p99 ${ms(p99)}, max ${ms(samples[samples.length - 1]!)}`);
  console.log(`  heap growth across the measured ticks, after a full collection at each end: ${heapGrowth} bytes`);
  console.log(`  p99 against the ${LIMIT_MS} ms limit: ${p99 < LIMIT_MS ? 'PASS' : 'FAIL'}, ${((p99 / BUDGET_AT_8X_MS) * 100).toFixed(1)}% of the ${BUDGET_AT_8X_MS} ms tick at 8x`);
  console.log(
    `  work in the measured ticks: ${workBefore.trees - workAfter.trees} trees felled, ${workAfter.stone - workBefore.stone} stone quarried, ` +
      `${workAfter.bare - workBefore.bare} rock tiles spent, ${workAfter.stockpiled - workBefore.stockpiled} units carried into stockpiles, ` +
      `${sum(sim.monsters.draws) - monsterDraws} monster arrivals at the goal`,
  );
  const held = heldTask.reduce((count, value) => count + value, 0);
  console.log(
    `  villagers that held a task in the measured ticks: ${held} of ${villagers} (${percent(held, villagers)}); ` +
      `daytime villager-ticks spent holding a task: ${percent(dayTaskTicks, dayVillagerTicks)} ` +
      `(${KINDS.map(([name, kind]) => `${name} ${percent(dayKindTicks[kind]!, dayVillagerTicks)}`).join(', ')})`,
  );
  console.log(
    `  gathering tasks open at the end: ${sim.gathering.count}, fewest open by day: ${fewestOpen}, set aside as out of reach: ${sim.gathering.setAsideCount}`,
  );
  console.log(
    `  stockpile tiles with room at the end: ${GOOD_NAMES.map((name, good) => `${name} ${sim.goods.room[good]!.count}`).join(', ')}; ` +
      `fewest by day: ${GOOD_NAMES.map((name, good) => `${name} ${fewestRoom[good]}`).join(', ')}; ` +
      `carrying tiles set aside as out of reach: ${sim.goods.setAsideCount}`,
  );
  console.log(
    `  work held through the measured ticks: ${workHeld ? 'PASS' : 'FAIL'}, needs ${percent(LEAST_BUSY, 1)} of daytime villager-ticks on a task, ` +
      `and a gathering task open and stockpile room for each good at every daytime tick`,
  );
  console.log(`  villagers on their spot at the camp at each measured midnight: ${midnights.subarray(0, nights).join(', ')} of ${villagers}`);
  console.log(
    `  units off land at the end: ${offLand(sim.map, sim.villagers.x, sim.villagers.y) + offLand(sim.map, sim.monsters.x, sim.monsters.y)}; ` +
      `camp ${Math.hypot(goalX, goalY).toFixed(1)} tiles from the center; setup ${ms(setupMs)}`,
  );
  return pass;
}

const [cpu] = cpus();
console.log('survive-n-conquest simulation benchmark');
console.log(
  `machine: ${cpu?.model ?? 'unknown cpu'}, ${cpus().length} cores, ${(totalmem() / 2 ** 30).toFixed(0)} GB, ` +
    `${platform()} ${arch()}, bun ${Bun.version}, load average ${loadavg().map((load) => load.toFixed(2)).join(' ')}`,
);
console.log(
  `load: ${BENCHMARK_POPULATION.villagers} villagers and ${BENCHMARK_POPULATION.monsters} monsters on seed ${SEED} with a tree on every forest tile and on grass beyond ${BARE_REACH} tiles of the camp, ` +
    `but none on a lattice every ${STOCKPILE_SPACING} tiles, every tree and rock tile marked, stockpile on every open tile, ` +
    `${WARMUP_TICKS} warm-up ticks, then ${MEASURED_TICKS} measured ticks`,
);
const results = SIZES.map(measure);
if (!results.every(Boolean)) process.exitCode = 1;
