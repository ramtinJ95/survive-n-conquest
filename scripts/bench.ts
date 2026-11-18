import { fullGC } from 'bun:jsc';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { BUILDING } from '../src/sim/building';
import { AnimalKind } from '../src/sim/animals';
import { BUILDINGS, Building, Job } from '../src/sim/buildings';
import { TICKS_PER_DAY, TICKS_PER_SECOND, tickOfDay } from '../src/sim/calendar';
import { CARRYING } from '../src/sim/carrying';
import { isDawn, isNight } from '../src/sim/daylight';
import { EATING } from '../src/sim/eating';
import { FORAGING } from '../src/sim/foraging';
import { Good } from '../src/sim/goods';
import { GATHERING } from '../src/sim/gathering';
import { FETCHING_KILL, HUNTING } from '../src/sim/hunting';
import { jobOf } from '../src/sim/jobs';
import { TileKind, type TileMap, tileAt, walkable } from '../src/sim/map';
import { campTile } from '../src/sim/camp';
import { generateMap } from '../src/sim/mapgen';
import { Claim, MAX_SITES, SiteState } from '../src/sim/orders';
import { BENCHMARK_POPULATION, type Sim, type Tally, applyCommand, createSim, step } from '../src/sim/sim';
import { SUPPLYING } from '../src/sim/supplying';
import { NO_HOME } from '../src/sim/households';
import { STOCKING } from '../src/sim/stocking';
import { CAMP_STORE } from '../src/sim/stores';
import { TASK_KINDS } from '../src/sim/tasks';
import { NO_TASK, THINK_GROUPS, VillagerState } from '../src/sim/villagerState';
import { Stop, WORKSHOP } from '../src/sim/workshops';

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
/**
 * Forager's huts stand on a grid of this many by this many cells, anchored at
 * the center of each cell, between the house sites. A hut the rules refuse is
 * left out. At 8 the 20-tile reaches of the huts cover 98% of the 256 map and
 * 31% of the 512 map. Every tree is marked, so the choppers fell much of the
 * forage under the foragers.
 */
const HUT_GRID = 8;
/**
 * Barns stand on a grid of this many by this many cells, centered on each
 * cell, apart from the house sites and the huts. A barn the rules refuse is
 * left out.
 */
const BARN_GRID = 4;
/**
 * Hunter's lodges stand on a grid of this many by this many cells, anchored a
 * quarter of a cell east of each barn's center, so no lodge lies on a barn,
 * a hut, or a house site. A lodge the rules refuse is left out.
 */
const LODGE_GRID = 4;
/**
 * Woodsheds stand on a grid of this many by this many cells, anchored a
 * quarter of a cell west of each barn's center, so no woodshed lies on a barn,
 * a lodge, a hut, or a house site. A woodshed the rules refuse is left out.
 * `--no-woodsheds` places none, and leaves their trees standing, for the load
 * measured before them.
 */
const WOODSHED_GRID = process.argv.includes('--no-woodsheds') ? 0 : 4;
/**
 * Tailor's huts stand on the lodges' grid, each 3 tiles south of its lodge's
 * anchor, so the hides of the lodge's kills lie within its 30 tiles. Every open
 * tile is a stockpile, so a hide goes onto the stockpile tile nearest its kill:
 * a quarter of a cell north of the barns, with a lodge a quarter of a cell east,
 * the huts on the 256 map took no hide. A tailor's hut the rules refuse is left
 * out. `--no-tailors` places none.
 */
const TAILOR_GRID = process.argv.includes('--no-tailors') ? 0 : LODGE_GRID;
const TAILOR_BESIDE_LODGE = 3;
const SUPPLY = TASK_KINDS.indexOf(SUPPLYING) + 1;
const CARRY = TASK_KINDS.indexOf(CARRYING) + 1;
const EAT = TASK_KINDS.indexOf(EATING) + 1;
const KINDS = [
  ['eating', EAT],
  ['stocking', TASK_KINDS.indexOf(STOCKING) + 1],
  ['building', TASK_KINDS.indexOf(BUILDING) + 1],
  ['supplying', SUPPLY],
  ['carrying', CARRY],
  ['gathering', TASK_KINDS.indexOf(GATHERING) + 1],
  ['foraging', TASK_KINDS.indexOf(FORAGING) + 1],
  ['fetching a kill', TASK_KINDS.indexOf(FETCHING_KILL) + 1],
  ['hunting', TASK_KINDS.indexOf(HUNTING) + 1],
  ['working a workshop', TASK_KINDS.indexOf(WORKSHOP) + 1],
] as const;
const TALLIED = ['felled', 'quarried', 'stocked', 'delivered', 'built', 'foraged'] as const satisfies readonly (keyof Tally)[];
const FED = ['meals', 'missed', 'carriedHome', 'fromGround', 'toCamp', 'died'] as const satisfies readonly (keyof Tally)[];
const HUNTED = ['shots', 'kills', 'hunted', 'huntedIn', 'fromGround', 'hides', 'spoiled'] as const satisfies readonly (keyof Tally)[];
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

/** The center tile of each cell of a grid of `grid` by `grid` cells. */
function cellCenters(size: number, grid: number): [number, number][] {
  const cell = size / grid;
  return Array.from({ length: grid * grid }, (_, i) => [
    Math.floor(((i % grid) + 0.5) * cell),
    Math.floor((Math.floor(i / grid) + 0.5) * cell),
  ]);
}

/** Finished buildings of a kind. */
function built(sim: Sim, kind: Building): number {
  const { sites } = sim.orders;
  let count = 0;
  for (let slot = 0; slot < sites.used; slot++) if (sites.state[slot] === SiteState.Built && sites.kind[slot] === kind) count++;
  return count;
}

function barnFood(sim: Sim): number {
  let food = 0;
  for (let i = 0; i < sim.stores.barnCount; i++) food += sim.stores.held[Good.Food - 1]![sim.stores.barns[i]!]!;
  return food;
}

function woodshedFirewood(sim: Sim): number {
  let firewood = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) firewood += sim.stores.held[Good.Firewood - 1]![slot]!;
  return firewood;
}

/** The clothing in the tailor's huts. Nothing takes clothing out of one yet, so its growth over the measured ticks is the clothing made in them. */
function tailorClothing(sim: Sim): number {
  let clothing = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) clothing += sim.stores.held[Good.Clothing - 1]![slot]!;
  return clothing;
}

/** The hides on stockpile tiles. */
function stockedHides(sim: Sim): number {
  const { map } = sim;
  let hides = 0;
  for (let tile = 0; tile < map.size * map.size; tile++) if (map.stackGood[tile] === Good.Hide && sim.orders.claims[tile] === Claim.Stockpile) hides += map.stackSize[tile]!;
  return hides;
}

/** Living villagers who hold a job. */
function holding(sim: Sim, job: Job): number {
  let count = 0;
  for (let id = 0; id < sim.villagers.state.length; id++) if (sim.villagers.state[id] !== VillagerState.Dead && jobOf(sim, id) === job) count++;
  return count;
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
// The tiles of each site on the site grid, of each hut on the hut grid, and of each barn on the barn grid keep no tree, so the site can be placed.
function setUp(size: number): { sim: Sim; sites: number; huts: number; barns: number; lodges: number; woodsheds: number; tailors: number } {
  const map = generateMap(SEED, size);
  const camp = campTile(map);
  for (let tile = 0; tile < size * size; tile++) {
    const x = tile % size;
    const y = Math.floor(tile / size);
    const far = Math.max(Math.abs(x - (camp % size)), Math.abs(y - Math.floor(camp / size))) > BARE_REACH;
    const lattice = x % STOCKPILE_SPACING === 0 && y % STOCKPILE_SPACING === 0;
    if (!lattice && (map.kinds[tile] === TileKind.Forest || (far && map.kinds[tile] === TileKind.Grass))) map.trees[tile] = 1;
  }
  const centers = cellCenters(size, SITE_GRID);
  for (const [x, y] of centers) {
    for (let ty = y - 1; ty <= y + 1; ty++) map.trees.fill(0, ty * size + x - 1, ty * size + x + 2);
  }
  const anchors = cellCenters(size, HUT_GRID);
  for (const [x, y] of anchors) {
    for (let ty = y; ty <= y + 1; ty++) map.trees.fill(0, ty * size + x, ty * size + x + 2);
  }
  const barnCenters = cellCenters(size, BARN_GRID);
  for (const [x, y] of barnCenters) {
    for (let ty = y - 1; ty <= y + 1; ty++) map.trees.fill(0, ty * size + x - 1, ty * size + x + 2);
  }
  const lodgeAnchors = cellCenters(size, LODGE_GRID).map(([x, y]): [number, number] => [x + Math.floor(size / LODGE_GRID / 4), y]);
  for (const [x, y] of lodgeAnchors) {
    for (let ty = y; ty <= y + 1; ty++) map.trees.fill(0, ty * size + x, ty * size + x + 2);
  }
  const shedAnchors = WOODSHED_GRID === 0 ? [] : cellCenters(size, WOODSHED_GRID).map(([x, y]): [number, number] => [x - Math.floor(size / WOODSHED_GRID / 4), y]);
  for (const [x, y] of shedAnchors) {
    for (let ty = y; ty <= y + 1; ty++) map.trees.fill(0, ty * size + x, ty * size + x + 2);
  }
  const tailorAnchors = TAILOR_GRID === 0 ? [] : lodgeAnchors.map(([x, y]): [number, number] => [x, y + TAILOR_BESIDE_LODGE]);
  for (const [x, y] of tailorAnchors) {
    for (let ty = y; ty <= y + 1; ty++) map.trees.fill(0, ty * size + x, ty * size + x + 2);
  }
  const sim = createSim(map, BENCHMARK_POPULATION);
  const sites = centers.filter(([x, y]) => applyCommand(sim, { kind: 'place', building: Building.House, x, y })!.ok).length;
  const huts = anchors.filter(([x, y]) => applyCommand(sim, { kind: 'place', building: Building.Hut, x, y })!.ok).length;
  const barns = barnCenters.filter(([x, y]) => applyCommand(sim, { kind: 'place', building: Building.Barn, x, y })!.ok).length;
  const lodges = lodgeAnchors.filter(([x, y]) => applyCommand(sim, { kind: 'place', building: Building.Lodge, x, y })!.ok).length;
  const woodsheds = shedAnchors.filter(([x, y]) => applyCommand(sim, { kind: 'place', building: Building.Woodshed, x, y })!.ok).length;
  const tailors = tailorAnchors.filter(([x, y]) => applyCommand(sim, { kind: 'place', building: Building.Tailor, x, y })!.ok).length;
  applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 0, y0: 0, x1: size - 1, y1: size - 1 } });
  return { sim, sites, huts, barns, lodges, woodsheds, tailors };
}

/** The straight-line length of each trip from a unit to where it goes, for the tasks of a kind taken in the measured ticks. */
interface Trips {
  count: number;
  length: number;
}

function measure(size: number): boolean {
  const setupStart = performance.now();
  const { sim, sites, huts, barns, lodges, woodsheds, tailors } = setUp(size);
  const setupMs = performance.now() - setupStart;

  for (let tick = 0; tick < WARMUP_TICKS; tick++) step(sim);
  const monsterDraws = sum(sim.monsters.draws);
  const spentBefore = spentRock(sim.map);
  const tallyBefore = { ...sim.tally };
  const housesBefore = built(sim, Building.House);
  const hutsBefore = built(sim, Building.Hut);
  const barnsBefore = built(sim, Building.Barn);
  const lodgesBefore = built(sim, Building.Lodge);
  const shedsBefore = built(sim, Building.Woodshed);
  const woodcuttersBefore = holding(sim, Job.Woodcutter);
  const stoppedFull = new Uint8Array(MAX_SITES);
  const stoppedForLogs = new Uint8Array(MAX_SITES);
  const stoppedForSites = new Uint8Array(MAX_SITES);
  const tailorHutsBefore = built(sim, Building.Tailor);
  const tailorsBefore = holding(sim, Job.Tailor);
  const clothingBefore = tailorClothing(sim);
  const tailorFull = new Uint8Array(MAX_SITES);
  const tailorForHides = new Uint8Array(MAX_SITES);
  const foragersBefore = holding(sim, Job.Forager);
  const huntersBefore = holding(sim, Job.Hunter);
  const deerBefore = sim.animals.living[AnimalKind.Deer]!;
  const samples = new Float64Array(MEASURED_TICKS);
  const { task, taskTile, destination } = sim.villagers;
  const heldTask = new Uint8Array(task.length);
  const lastTask = Uint8Array.from(task);
  const { state, workplace, x: villagerX, y: villagerY } = sim.villagers;
  const lastWorkplace = Int16Array.from(workplace);
  const lastState = Uint8Array.from(state);
  const campX = (sim.flow.goal % size) + 0.5;
  const campY = Math.floor(sim.flow.goal / size) + 0.5;
  const deaths = { away: 0, atStore: 0, foragers: 0, hunters: 0, farthest: 0 };
  const lastMissed = Uint8Array.from(sim.villagers.missedMeals);
  let mealsByDay = 0;
  const dawnMeals = { walks: 0, length: 0, byDawn: [] as number[] };
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
    const dawnTick = isDawn(sim.tick);
    const byDay = !isNight(sim.tick) && !dawnTick;
    const start = performance.now();
    step(sim);
    samples[tick] = performance.now() - start;
    for (let id = 0; id < state.length; id++) {
      if (state[id] === VillagerState.Dead && lastState[id] !== VillagerState.Dead) {
        if (dawnTick) deaths.away++;
        else deaths.atStore++;
        const job = lastWorkplace[id]! < 0 ? Job.None : BUILDINGS[sim.orders.sites.kind[lastWorkplace[id]!] as Building].job;
        if (job === Job.Forager) deaths.foragers++;
        if (job === Job.Hunter) deaths.hunters++;
        deaths.farthest = Math.max(deaths.farthest, Math.hypot(villagerX[id]! - campX, villagerY[id]! - campY));
      }
      if (byDay && lastMissed[id]! > 0 && sim.villagers.missedMeals[id] === 0 && state[id] !== VillagerState.Dead) mealsByDay++;
      lastMissed[id] = sim.villagers.missedMeals[id]!;
      lastState[id] = state[id]!;
      lastWorkplace[id] = workplace[id]!;
    }
    if (turn && turnLeft-- > 0) turns[turn][turnCount[turn] - 1] = Math.max(turns[turn][turnCount[turn] - 1]!, samples[tick]!);
    for (let slot = 0; slot < sim.orders.sites.used; slot++) {
      if (sim.orders.sites.state[slot] !== SiteState.Built) continue;
      const stopped = sim.workshops.stopped[slot];
      if (sim.orders.sites.kind[slot] === Building.Woodshed) {
        if (stopped === Stop.Full) stoppedFull[slot] = 1;
        else if (stopped === Stop.NoInput) stoppedForLogs[slot] = 1;
        else if (stopped === Stop.ForSites) stoppedForSites[slot] = 1;
      } else if (sim.orders.sites.kind[slot] === Building.Tailor) {
        if (stopped === Stop.Full) tailorFull[slot] = 1;
        else if (stopped === Stop.NoInput) tailorForHides[slot] = 1;
      }
    }
    if (tickOfDay(sim.tick) === 0) {
      insideAtMidnight[nights] = inside(sim);
      midnights[nights++] = atCamp(sim);
    }
    const day = !isNight(sim.tick - 1);
    for (let id = 0; id < task.length; id++) {
      const taken = task[id] !== lastTask[id] && taskTile[id]! >= 0;
      if (taken && task[id] === EAT && turn === 'dawn' && turnLeft >= 0) {
        dawnMeals.walks++;
        dawnMeals.byDawn[turnCount.dawn - 1] = (dawnMeals.byDawn[turnCount.dawn - 1] ?? 0) + 1;
        dawnMeals.length += Math.hypot(villagerX[id]! - ((taskTile[id]! % size) + 0.5), villagerY[id]! - (Math.floor(taskTile[id]! / size) + 0.5));
      }
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
  const hunt = Object.fromEntries(HUNTED.map((name) => [name, sim.tally[name] - tallyBefore[name]])) as Record<(typeof HUNTED)[number], number>;
  const count = (flags: Uint8Array) => flags.reduce((total, flag) => total + flag, 0);
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
      `${work.stocked} units carried onto stockpile tiles, ${work.delivered} units delivered to sites, ` +
      `${built(sim, Building.House) - housesBefore} houses, ${built(sim, Building.Hut) - hutsBefore} huts, ${built(sim, Building.Barn) - barnsBefore} barns, and ${built(sim, Building.Lodge) - lodgesBefore} lodges built, ${work.foraged} units of food foraged, ` +
      `${sum(sim.monsters.draws) - monsterDraws} monster arrivals at the goal`,
  );
  console.log(
    `  every kind of work done in the measured ticks: ${allWork ? 'PASS' : 'FAIL'}, needs trees felled, stone quarried, units stocked, units delivered, buildings built, and food foraged`,
  );
  console.log(
    `  food in the measured ticks: ${fed.meals} meals eaten, ${fed.missed} meals missed, ${fed.carriedHome} units carried home, ` +
      `${fed.fromGround} carried from the ground into a store, ${fed.toCamp} carried from a barn to the camp, ` +
      `${fed.died} villagers died; at the end ${hungry(sim)} living villagers hungry, ` +
      `${sim.stores.held[Good.Food - 1]![CAMP_STORE]} food left at the camp of ${BENCHMARK_POPULATION.campFood} at the start, ${barnFood(sim)} in the barns`,
  );
  console.log(
    `  meals eaten by day after a missed meal, outside dusk and dawn: ${mealsByDay}; walks to eat taken in the 10 ticks from each dawn: ${dawnMeals.walks} (${Array.from({ length: turnCount.dawn }, (_, i) => dawnMeals.byDawn[i] ?? 0).join(', ')}), ` +
      `a straight line of ${(dawnMeals.length / Math.max(dawnMeals.walks, 1)).toFixed(1)} tiles on average to the store`,
  );
  console.log(
    `  deaths in the measured ticks: ${deaths.away} at a dawn, by a third meal missed away from home, and ${deaths.atStore} at a dusk, by a third meal missed at an empty store; ` +
      `${deaths.foragers} of them foragers and ${deaths.hunters} hunters; the farthest ${deaths.farthest.toFixed(0)} tiles from the camp center`,
  );
  console.log(
    `  house sites: ${sites} placed on a grid of ${SITE_GRID} by ${SITE_GRID}, ${housesBefore} built in the warm-up ticks, ` +
      `${built(sim, Building.House) - housesBefore} in the measured ticks, ${sites - built(sim, Building.House)} unfinished at the end`,
  );
  const places = BUILDINGS[Building.Hut].places;
  console.log(
    `  hut sites: ${huts} placed on a grid of ${HUT_GRID} by ${HUT_GRID}, ${hutsBefore} built in the warm-up ticks, ` +
      `${built(sim, Building.Hut) - hutsBefore} in the measured ticks, ${huts - built(sim, Building.Hut)} unfinished at the end`,
  );
  console.log(
    `  barn sites: ${barns} placed on a grid of ${BARN_GRID} by ${BARN_GRID}, ${barnsBefore} built in the warm-up ticks, ` +
      `${built(sim, Building.Barn) - barnsBefore} in the measured ticks, ${barns - built(sim, Building.Barn)} unfinished at the end`,
  );
  console.log(
    `  forage in the measured ticks: ${work.foraged} units picked and ${sim.tally.foragedIn - tallyBefore.foragedIn} put into a store by the foragers, ` +
      `${foragersBefore} at the start and ${holding(sim, Job.Forager)} in the ${built(sim, Building.Hut) * places} places of the finished huts at the end`,
  );
  console.log(
    `  lodge sites: ${lodges} placed on a grid of ${LODGE_GRID} by ${LODGE_GRID}, ${lodgesBefore} built in the warm-up ticks, ` +
      `${built(sim, Building.Lodge) - lodgesBefore} in the measured ticks, ${lodges - built(sim, Building.Lodge)} unfinished at the end; ` +
      `hunters ${huntersBefore} at the start and ${holding(sim, Job.Hunter)} in the ${built(sim, Building.Lodge) * BUILDINGS[Building.Lodge].places} places of the finished lodges at the end`,
  );
  console.log(
    `  hunting in the measured ticks: deer ${deerBefore} at the start and ${sim.animals.living[AnimalKind.Deer]} at the end, ` +
      `${hunt.shots} shots and ${hunt.kills} kills, ${hunt.hunted} units of food the kills left, ${hunt.huntedIn} carried into a store by hunters, ` +
      `${hunt.fromGround} by settlers without a job from the ground, ${hunt.spoiled} units spoiled on the ground at a dawn`,
  );
  console.log(
    `  woodshed sites: ${woodsheds} placed on a grid of ${WOODSHED_GRID} by ${WOODSHED_GRID}, ${shedsBefore} built in the warm-up ticks, ` +
      `${built(sim, Building.Woodshed) - shedsBefore} in the measured ticks, ${woodsheds - built(sim, Building.Woodshed)} unfinished at the end; ` +
      `woodcutters ${woodcuttersBefore} at the start and ${holding(sim, Job.Woodcutter)} in the ${built(sim, Building.Woodshed) * BUILDINGS[Building.Woodshed].places} places of the finished woodsheds at the end`,
  );
  const pieces = tailorClothing(sim) - clothingBefore;
  console.log(
    `  firewood in the measured ticks: ${sim.tally.batches - tallyBefore.batches - pieces} logs split, ${sim.tally.made - tallyBefore.made - pieces} firewood made, ` +
      `${woodshedFirewood(sim)} in the woodsheds at the end; woodsheds that stopped at some measured tick: ${count(stoppedFull)} full, ` +
      `${count(stoppedForLogs)} with no log in reach, ${count(stoppedForSites)} leaving the logs to the building sites`,
  );
  console.log(
    `  tailor's hut sites: ${tailors} placed ${TAILOR_BESIDE_LODGE} tiles south of each lodge, ${tailorHutsBefore} built in the warm-up ticks, ` +
      `${built(sim, Building.Tailor) - tailorHutsBefore} in the measured ticks, ${tailors - built(sim, Building.Tailor)} unfinished at the end; ` +
      `tailors ${tailorsBefore} at the start and ${holding(sim, Job.Tailor)} in the ${built(sim, Building.Tailor) * BUILDINGS[Building.Tailor].places} places of the finished tailor's huts at the end`,
  );
  console.log(
    `  clothing in the measured ticks: ${hunt.hides} hides left by kills, ${stockedHides(sim)} hides on stockpile tiles at the end, ${pieces} pieces made, ` +
      `${tailorClothing(sim)} in the tailor's huts at the end; tailor's huts that stopped at some measured tick: ${count(tailorFull)} full, ${count(tailorForHides)} with no hide in reach`,
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
    `but none on a lattice every ${STOCKPILE_SPACING} tiles, every tree and rock tile marked, up to ${SITE_GRID * SITE_GRID} house sites, ${HUT_GRID * HUT_GRID} hut sites, ${BARN_GRID * BARN_GRID} barn sites, ${LODGE_GRID * LODGE_GRID} lodge sites, ${WOODSHED_GRID * WOODSHED_GRID} woodshed sites, and ${TAILOR_GRID * TAILOR_GRID} tailor's hut sites, stockpile on every other open tile, ` +
    `${WARMUP_TICKS} warm-up ticks, then ${MEASURED_TICKS} measured ticks`,
);
const results = SIZES.map(measure);
if (!results.every(Boolean)) process.exitCode = 1;
