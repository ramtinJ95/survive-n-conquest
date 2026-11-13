import { fullGC } from 'bun:jsc';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { TICKS_PER_SECOND } from '../src/sim/calendar';
import { type TileMap, tileAt, walkable } from '../src/sim/map';
import { generateMap } from '../src/sim/mapgen';
import { BENCHMARK_POPULATION, createSim, step } from '../src/sim/sim';

const SEED = 7;
const SIZES = [256, 512];
const WARMUP_TICKS = 2_000;
const MEASURED_TICKS = 10_000;
const LIMIT_MS = 4;
const BUDGET_AT_8X_MS = 1000 / (TICKS_PER_SECOND * 8);

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

function measure(size: number): boolean {
  const setupStart = performance.now();
  const map = generateMap(SEED, size);
  const sim = createSim(map, BENCHMARK_POPULATION);
  const setupMs = performance.now() - setupStart;

  for (let tick = 0; tick < WARMUP_TICKS; tick++) step(sim);
  const villagerDraws = sum(sim.villagers.draws);
  const monsterDraws = sum(sim.monsters.draws);
  const samples = new Float64Array(MEASURED_TICKS);

  // JavaScriptCore reports its heap size only at a collection, so this sees what the ticks keep, not short-lived garbage.
  const heapBefore = fullGC();
  for (let tick = 0; tick < MEASURED_TICKS; tick++) {
    const start = performance.now();
    step(sim);
    samples[tick] = performance.now() - start;
  }
  const heapGrowth = fullGC() - heapBefore;

  samples.sort();
  const median = quantile(samples, 0.5);
  const p99 = quantile(samples, 0.99);
  const pass = p99 < LIMIT_MS;
  const goalX = (sim.flow.goal % size) + 0.5 - size / 2;
  const goalY = Math.floor(sim.flow.goal / size) + 0.5 - size / 2;
  const ms = (value: number) => `${value.toFixed(3)} ms`;

  console.log(`\nmap ${size}x${size}`);
  console.log(`  median ${ms(median)}, p99 ${ms(p99)}, max ${ms(samples[samples.length - 1]!)}`);
  console.log(`  heap growth across the measured ticks, after a full collection at each end: ${heapGrowth} bytes`);
  console.log(`  p99 against the ${LIMIT_MS} ms limit: ${pass ? 'PASS' : 'FAIL'}, ${((p99 / BUDGET_AT_8X_MS) * 100).toFixed(1)}% of the ${BUDGET_AT_8X_MS} ms tick at 8x`);
  console.log(
    `  work in the measured ticks: ${(sum(sim.villagers.draws) - villagerDraws) / 2} villager targets drawn, ` +
      `${sum(sim.monsters.draws) - monsterDraws} monster arrivals at the goal`,
  );
  console.log(
    `  units off land at the end: ${offLand(map, sim.villagers.x, sim.villagers.y) + offLand(map, sim.monsters.x, sim.monsters.y)}; ` +
      `goal ${Math.hypot(goalX, goalY).toFixed(1)} tiles from the center; setup ${ms(setupMs)}`,
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
  `load: ${BENCHMARK_POPULATION.villagers} villagers and ${BENCHMARK_POPULATION.monsters} monsters on seed ${SEED}, ` +
    `${WARMUP_TICKS} warm-up ticks, then ${MEASURED_TICKS} measured ticks`,
);
const results = SIZES.map(measure);
if (!results.every(Boolean)) process.exitCode = 1;
