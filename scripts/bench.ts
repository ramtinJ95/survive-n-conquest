import { fullGC } from 'bun:jsc';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { BUILDING } from '../src/sim/building';
import { Building } from '../src/sim/buildings';
import { TICKS_PER_DAY, TICKS_PER_SECOND, tickOfDay } from '../src/sim/calendar';
import { CARRYING } from '../src/sim/carrying';
import { isDawn, isNight } from '../src/sim/daylight';
import { GATHERING } from '../src/sim/gathering';
import { TileKind, type TileMap, tileAt, walkable } from '../src/sim/map';
import { campTile } from '../src/sim/camp';
import { generateMap } from '../src/sim/mapgen';
import { BENCHMARK_POPULATION, type Sim, type Tally, applyCommand, createSim, step } from '../src/sim/sim';
import { SUPPLYING } from '../src/sim/supplying';
import { NO_HOME } from '../src/sim/households';
import { STOCKING } from '../src/sim/stocking';
import { CAMP_STORE } from '../src/sim/stores';
import { NO_TASK, TASK_KINDS } from '../src/sim/tasks';
import { THINK_GROUPS, VillagerState } from '../src/sim/villagers';

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
/**
 * House sites stand on a grid of this many by this many cells, one at the
 * center of each cell, so the 1500 villagers build across the whole map. A site
 * the rules refuse is left out. The grid stayed at 16 when `MAX_SITES` grew to
 * 1,024, so the load is the one measured before: a grid of 32 placed 728 sites
 * on the 256 map, raised supplying from 8% to 31% of the work, and still housed
 * no more households by the end.
 */
const SITE_GRID = 16;
const SUPPLY = TASK_KINDS.indexOf(SUPPLYING) + 1;
const CARRY = TASK_KINDS.indexOf(CARRYING) + 1;
const KINDS = [
  ['stocking', TASK_KINDS.indexOf(STOCKING) + 1],
  ['building', TASK_KINDS.indexOf(BUILDING) + 1],
  ['supplying', SUPPLY],
  ['carrying', CARRY],
  ['gathering', TASK_KINDS.indexOf(GATHERING) + 1],
] as const;
const TALLIED = ['felled', 'quarried', 'stocked', 'delivered', 'built'] as const satisfies readonly (keyof Tally)[];
const FED = ['meals', 'missed', 'carriedHome', 'died'] as const satisfies readonly (keyof Tally)[];
/** The goods a stockpile takes, at index `good - 1`. */
const GOOD_NAMES = ['logs', 'stone'] as const;
/** Every villager makes its dusk or dawn choice within one think cycle, so each turn of the light is measured over this many ticks. */
const TURN_TICKS = THINK_GROUPS;

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

function spentRock(map: TileMap): number {
  let bare = 0;
  for (let tile = 0; tile < map.size * map.size; tile++) if (map.kinds[tile] === TileKind.Bare) bare++;
  return bare;
}

/** The center tile of each cell of the site grid. */
function siteCenters(size: number): [number, number][] {
  const cell = size / SITE_GRID;
  return Array.from({ length: SITE_GRID * SITE_GRID }, (_, i) => [
    Math.floor(((i % SITE_GRID) + 0.5) * cell),
    Math.floor((Math.floor(i / SITE_GRID) + 0.5) * cell),
  ]);
}

function inside(sim: Sim): number {
  return sim.villagers.state.reduce((count, state) => count + (state === VillagerState.Inside ? 1 : 0), 0);
}

function hungry(sim: Sim): number {
  const { missedMeals, state } = sim.villagers;
  let count = 0;
  for (let id = 0; id < state.length; id++) if (missedMeals[id]! > 0 && state[id] !== VillagerState.Dead) count++;
  return count;
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
// The nine tiles of each site on the site grid keep no tree, so the site can be placed.
function setUp(size: number): { sim: Sim; sites: number } {
  const map = generateMap(SEED, size);
  const camp = campTile(map);
  for (let tile = 0; tile < size * size; tile++) {
    const x = tile % size;
    const y = Math.floor(tile / size);
    const far = Math.max(Math.abs(x - (camp % size)), Math.abs(y - Math.floor(camp / size))) > BARE_REACH;
    const lattice = x % STOCKPILE_SPACING === 0 && y % STOCKPILE_SPACING === 0;
    if (!lattice && (map.kinds[tile] === TileKind.Forest || (far && map.kinds[tile] === TileKind.Grass))) map.trees[tile] = 1;
  }
  const centers = siteCenters(size);
  for (const [x, y] of centers) {
    for (let ty = y - 1; ty <= y + 1; ty++) map.trees.fill(0, ty * size + x - 1, ty * size + x + 2);
  }
  const sim = createSim(map, BENCHMARK_POPULATION);
  const sites = centers.filter(([x, y]) => applyCommand(sim, { kind: 'place', building: Building.House, x, y })!.ok).length;
  applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 0, y0: 0, x1: size - 1, y1: size - 1 } });
  return { sim, sites };
}

/** The straight-line length of each trip from a unit to where it goes, for the tasks of a kind taken in the measured ticks. */
interface Trips {
  count: number;
  length: number;
}

function measure(size: number): boolean {
  const setupStart = performance.now();
  const { sim, sites } = setUp(size);
  const setupMs = performance.now() - setupStart;

  for (let tick = 0; tick < WARMUP_TICKS; tick++) step(sim);
  const monsterDraws = sum(sim.monsters.draws);
  const spentBefore = spentRock(sim.map);
  const tallyBefore = { ...sim.tally };
  const samples = new Float64Array(MEASURED_TICKS);
  const { task, taskTile, destination } = sim.villagers;
  const heldTask = new Uint8Array(task.length);
  const lastTask = Uint8Array.from(task);
  const toStockpile: Trips = { count: 0, length: 0 };
  const toSite: Trips = { count: 0, length: 0 };
  let dayVillagerTicks = 0;
  let dayTaskTicks = 0;
  const dayKindTicks = new Float64Array(TASK_KINDS.length + 1);
  let fewestOpen = Infinity;
  const fewestRoom = new Float64Array(GOOD_NAMES.length).fill(Infinity);

  // JavaScriptCore reports its heap size only at a collection, so this sees what the ticks keep, not short-lived garbage.
  atCamp(sim);
  const midnights = new Int32Array(Math.ceil(MEASURED_TICKS / TICKS_PER_DAY) + 1);
  const insideAtMidnight = new Int32Array(midnights.length);
  let nights = 0;
  const turns = { dusk: new Float64Array(MEASURED_TICKS / TURN_TICKS), dawn: new Float64Array(MEASURED_TICKS / TURN_TICKS) };
  const turnCount = { dusk: 0, dawn: 0 };
  let turn: 'dusk' | 'dawn' | undefined;
  let turnLeft = 0;
  const heapBefore = fullGC();
  for (let tick = 0; tick < MEASURED_TICKS; tick++) {
    if (isDawn(sim.tick) || (isNight(sim.tick) && !isNight(sim.tick - 1))) {
      turn = isDawn(sim.tick) ? 'dawn' : 'dusk';
      turnCount[turn]++;
      turnLeft = TURN_TICKS;
    }
    const start = performance.now();
    step(sim);
    samples[tick] = performance.now() - start;
    if (turn && turnLeft-- > 0) turns[turn][turnCount[turn] - 1] = Math.max(turns[turn][turnCount[turn] - 1]!, samples[tick]!);
    if (tickOfDay(sim.tick) === 0) {
      insideAtMidnight[nights] = inside(sim);
      midnights[nights++] = atCamp(sim);
    }
    const day = !isNight(sim.tick - 1);
    for (let id = 0; id < task.length; id++) {
      const taken = task[id] !== lastTask[id] && taskTile[id]! >= 0;
      const trip = !taken ? undefined : task[id] === SUPPLY ? toSite : task[id] === CARRY ? toStockpile : undefined;
      if (trip) {
        trip.count++;
        trip.length += Math.hypot((taskTile[id]! % size) - (destination[id]! % size), Math.floor(taskTile[id]! / size) - Math.floor(destination[id]! / size));
      }
      lastTask[id] = task[id]!;
      if (task[id] === NO_TASK) continue;
      heldTask[id] = 1;
      if (day) dayTaskTicks++;
      if (day) dayKindTicks[task[id]!]++;
    }
    if (!day) continue;
    dayVillagerTicks += task.length;
    fewestOpen = Math.min(fewestOpen, sim.gathering.count);
    for (let good = 0; good < GOOD_NAMES.length; good++) fewestRoom[good] = Math.min(fewestRoom[good]!, sim.goods.room[good]!.count);
  }
  const heapGrowth = fullGC() - heapBefore;
  const work = Object.fromEntries(TALLIED.map((name) => [name, sim.tally[name] - tallyBefore[name]])) as Record<(typeof TALLIED)[number], number>;
  const fed = Object.fromEntries(FED.map((name) => [name, sim.tally[name] - tallyBefore[name]])) as Record<(typeof FED)[number], number>;
  const allWork = TALLIED.every((name) => work[name] > 0);
  const villagers = task.length;
  const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)}%`;

  samples.sort();
  const median = quantile(samples, 0.5);
  const p99 = quantile(samples, 0.99);
  const busy = dayTaskTicks / dayVillagerTicks;
  const workHeld = busy >= LEAST_BUSY && fewestOpen > 0 && fewestRoom.every((room) => room > 0);
  const pass = p99 < LIMIT_MS && workHeld && allWork;
  const goalX = (sim.flow.goal % size) + 0.5 - size / 2;
  const goalY = Math.floor(sim.flow.goal / size) + 0.5 - size / 2;
  const ms = (value: number) => `${value.toFixed(3)} ms`;

  console.log(`\nmap ${size}x${size}`);
  console.log(`  median ${ms(median)}, p99 ${ms(p99)}, max ${ms(samples[samples.length - 1]!)}`);
  for (const name of ['dusk', 'dawn'] as const) {
    const largest = Array.from(turns[name].subarray(0, turnCount[name]), ms).join(', ');
    console.log(`  largest tick in the ${TURN_TICKS} ticks from each ${name}: ${largest || 'no ' + name + ' in the measured ticks'}`);
  }
  console.log(`  heap growth across the measured ticks, after a full collection at each end: ${heapGrowth} bytes`);
  console.log(`  p99 against the ${LIMIT_MS} ms limit: ${p99 < LIMIT_MS ? 'PASS' : 'FAIL'}, ${((p99 / BUDGET_AT_8X_MS) * 100).toFixed(1)}% of the ${BUDGET_AT_8X_MS} ms tick at 8x`);
  console.log(
    `  work in the measured ticks: ${work.felled} trees felled, ${work.quarried} stone quarried, ${spentRock(sim.map) - spentBefore} rock tiles spent, ` +
      `${work.stocked} units carried onto stockpile tiles, ${work.delivered} units delivered to sites, ${work.built} houses built, ` +
      `${sum(sim.monsters.draws) - monsterDraws} monster arrivals at the goal`,
  );
  console.log(
    `  every kind of work done in the measured ticks: ${allWork ? 'PASS' : 'FAIL'}, needs trees felled, stone quarried, units stocked, units delivered, and houses built`,
  );
  console.log(
    `  food in the measured ticks: ${fed.meals} meals eaten, ${fed.missed} meals missed, ${fed.carriedHome} units carried home, ` +
      `${fed.died} villagers died; at the end ${hungry(sim)} living villagers hungry, ` +
      `${sim.stores.food[CAMP_STORE]} food left at the camp of ${BENCHMARK_POPULATION.campFood} at the start`,
  );
  console.log(
    `  house sites: ${sites} placed on a grid of ${SITE_GRID} by ${SITE_GRID}, ${tallyBefore.built} built in the warm-up ticks, ` +
      `${work.built} in the measured ticks, ${sites - sim.tally.built} unfinished at the end`,
  );
  const mean = ({ count, length }: Trips) => (count === 0 ? 'none' : `${(length / count).toFixed(1)} tiles over ${count} trips`);
  console.log(
    `  straight line from a unit to where it goes, for tasks taken in the measured ticks: to a stockpile ${mean(toStockpile)}, ` +
      `to a site ${mean(toSite)}`,
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
    `  villagers inside their house at each measured midnight: ${insideAtMidnight.subarray(0, nights).join(', ')}; ` +
      `households with a home at the end: ${sim.households.home.reduce((count, home) => count + (home === NO_HOME ? 0 : 1), 0)} of ${sim.households.count}`,
  );
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
    `but none on a lattice every ${STOCKPILE_SPACING} tiles, every tree and rock tile marked, up to ${SITE_GRID * SITE_GRID} house sites, stockpile on every other open tile, ` +
    `${WARMUP_TICKS} warm-up ticks, then ${MEASURED_TICKS} measured ticks`,
);
const results = SIZES.map(measure);
if (!results.every(Boolean)) process.exitCode = 1;
