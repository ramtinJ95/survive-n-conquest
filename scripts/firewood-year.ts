// A woodshed on seed 7, alone and in the first year with the hut, the barn, and the lodge: `bun scripts/firewood-year.ts [run ...]`.
import { BUILDINGS, Building, siteMidX, siteMidY } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, seasonAt, tickOfDay } from '../src/sim/calendar';
import { underCamp } from '../src/sim/camp';
import { isNight } from '../src/sim/daylight';
import { FIRST_YEAR_SEED, huntYearCommands } from '../src/sim/firstYear';
import { LOGS_PER_TREE } from '../src/sim/gathering';
import { Good } from '../src/sim/goods';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { Claim, SiteState, openGround, siteRefusal } from '../src/sim/orders';
import { SETTLERS, type Command, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE, StoreKind, WOODSHED_FIREWOOD_LIMIT, storeKind } from '../src/sim/stores';
import { VillagerState } from '../src/sim/villagerState';

/** The woodshed's anchor is chosen among those whose middle lies this near the camp center. */
const ANCHOR_REACH = 14;
/** The stockpile is a square of this many tiles a side. */
const STOCKPILE_SIDE = 3;
/** Trees enough for the woodshed's logs and for the logs that fill it with firewood. */
const TREES = (BUILDINGS[Building.Woodshed].needs[Good.Log]! + WOODSHED_FIREWOOD_LIMIT / 2) / LOGS_PER_TREE;
const SEASON_ENDS = [3, 6, 9, 12];
const WINTER_DUSKS = [10, 11, 12];
const SHED_DUSKS = [1, 2, 3, 4, 5, 6];

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);
const tile = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });

/** Where the woodshed, its stockpile, and its trees lie, and why, the same in both runs. */
interface Plan {
  readonly shed: { readonly x: number; readonly y: number };
  readonly stockpile: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly trees: readonly (readonly [number, number])[];
  readonly why: readonly string[];
}

/**
 * Places the woodshed, its stockpile, and its trees beside the first year's
 * hut, barn, and lodge. The woodshed takes the anchor the rules accept there
 * whose middle lies nearest the camp center, then the lowest tile. The
 * stockpile takes the square that a stockpile order takes whole nearest the
 * camp center, then the lowest tile. The trees are the ones
 * nearest the camp center that the first year's orders leave standing.
 */
function plan(): Plan {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of huntYearCommands({ hut: true })) applyCommand(sim, command);
  const { size } = sim.map;
  const campX = (sim.flow.goal % size) + 0.5;
  const campY = Math.floor(sim.flow.goal / size) + 0.5;
  const fromCamp = (x: number, y: number) => Math.hypot(x - campX, y - campY);
  const anchors: { x: number; y: number; distance: number }[] = [];
  const { side } = BUILDINGS[Building.Woodshed];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = fromCamp(x + side / 2, y + side / 2);
      if (distance <= ANCHOR_REACH && siteRefusal(sim.map, sim.orders, Building.Woodshed, x, y) === null) anchors.push({ x, y, distance });
    }
  }
  anchors.sort((a, b) => a.distance - b.distance || a.y * size + a.x - (b.y * size + b.x));
  const shed = anchors[0]!;
  applyCommand(sim, { kind: 'place', building: Building.Woodshed, x: shed.x, y: shed.y });

  const open = (x: number, y: number) => {
    const at = y * size + x;
    return sim.orders.claims[at] === Claim.None && openGround(sim.map, at) && !underCamp(sim.map, sim.camp, at);
  };
  let stockpile = { x0: 0, y0: 0, x1: 0, y1: 0, distance: Infinity };
  for (let y = 0; y + STOCKPILE_SIDE <= size; y++) {
    for (let x = 0; x + STOCKPILE_SIDE <= size; x++) {
      const distance = fromCamp(x + STOCKPILE_SIDE / 2, y + STOCKPILE_SIDE / 2);
      if (distance >= stockpile.distance) continue;
      let whole = true;
      for (let ty = y; ty < y + STOCKPILE_SIDE && whole; ty++) for (let tx = x; tx < x + STOCKPILE_SIDE && whole; tx++) whole = open(tx, ty);
      if (whole) stockpile = { x0: x, y0: y, x1: x + STOCKPILE_SIDE - 1, y1: y + STOCKPILE_SIDE - 1, distance };
    }
  }

  const standing: { x: number; y: number; distance: number }[] = [];
  for (let at = 0; at < size * size; at++) {
    if (sim.map.trees[at] === 1 && sim.orders.claims[at] === Claim.None) standing.push({ x: at % size, y: Math.floor(at / size), distance: fromCamp((at % size) + 0.5, Math.floor(at / size) + 0.5) });
  }
  standing.sort((a, b) => a.distance - b.distance || a.y * size + a.x - (b.y * size + b.x));
  const trees = standing.slice(0, TREES).map(({ x, y }) => [x, y] as const);
  const slot = sim.orders.siteOf[shed.y * size + shed.x]!;
  const shedToPile = Math.hypot(stockpile.x0 + STOCKPILE_SIDE / 2 - siteMidX(sim.orders.sites, slot), stockpile.y0 + STOCKPILE_SIDE / 2 - siteMidY(sim.orders.sites, slot));
  return {
    shed: { x: shed.x, y: shed.y },
    stockpile,
    trees,
    why: [
      `woodshed anchored on (${shed.x}, ${shed.y}): of the ${anchors.length} anchors within ${ANCHOR_REACH} tiles of the camp center that the rules accept beside the first year's hut, barn, and lodge, its middle lies nearest the camp center, ${shed.distance.toFixed(1)} tiles`,
      `stockpile on (${stockpile.x0}, ${stockpile.y0}) to (${stockpile.x1}, ${stockpile.y1}): the ${STOCKPILE_SIDE} by ${STOCKPILE_SIDE} square that a stockpile order takes whole nearest the camp center once the woodshed stands, its middle ${stockpile.distance.toFixed(1)} tiles from the camp center and ${shedToPile.toFixed(1)} from the woodshed's`,
      `${TREES} trees, ${TREES * LOGS_PER_TREE} logs, for the woodshed's ${BUILDINGS[Building.Woodshed].needs[Good.Log]} and the ${WOODSHED_FIREWOOD_LIMIT / 2} that fill it with ${WOODSHED_FIREWOOD_LIMIT} firewood: the ${TREES} nearest the camp center that the first year's orders leave standing, ` +
        `the nearest ${standing[0]!.distance.toFixed(1)} and the farthest ${standing[TREES - 1]!.distance.toFixed(1)} tiles from it: ${trees.map(([x, y]) => `(${x}, ${y})`).join(', ')}`,
    ],
  };
}

function woodshedCommands({ shed, stockpile, trees }: Plan): Command[] {
  return [
    { kind: 'markArea', order: 'stockpile', area: stockpile },
    { kind: 'place', building: Building.Woodshed, x: shed.x, y: shed.y },
    ...trees.map(([x, y]): Command => ({ kind: 'markArea', order: 'chop', area: tile(x, y) })),
  ];
}

function foodIn(sim: Sim, kind: StoreKind): number {
  let food = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) food += sim.stores.held[Good.Food - 1]![slot]!;
  return food;
}

/** The food on open ground: every tile that holds food is listed for spoiling. */
function groundFood(sim: Sim): number {
  const { goods, map } = sim;
  let food = 0;
  for (let i = 0; i < goods.spoilingCount; i++) {
    const at = goods.spoilingTiles[i]!;
    if (map.stackGood[at] === Good.Food) food += map.stackSize[at]!;
  }
  return food;
}

/** Runs the commands from the first tick to the end of the year, or until the settlement dies out, calling `each` before every tick. */
function runYear(commands: readonly Command[], each: (sim: Sim) => void): Sim {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of commands) {
    const outcome = applyCommand(sim, command);
    if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  }
  while (!sim.over && dateAt(sim.tick).day <= DAYS_PER_YEAR) {
    each(sim);
    step(sim);
  }
  return sim;
}

/** Watches the woodshed of a run: when it was finished, who became its woodcutter, and when it was first full. */
function watchShed(shed: Plan['shed']) {
  const seen = { finished: 'never', woodcutter: 'nobody', full: 'never' };
  let slot = -1;
  const firewood = (sim: Sim) => (slot < 0 ? 0 : sim.stores.held[Good.Firewood - 1]![slot]!);
  const look = (sim: Sim) => {
    if (slot < 0) slot = sim.orders.siteOf[shed.y * sim.map.size + shed.x]!;
    const at = clock(Math.max(sim.tick - 1, 0));
    if (seen.finished === 'never' && sim.orders.sites.state[slot] === SiteState.Built) {
      seen.finished = at;
      const id = sim.villagers.workplace.indexOf(slot);
      seen.woodcutter = id < 0 ? 'nobody' : nameOfId(sim, id);
    }
    if (seen.full === 'never' && firewood(sim) === WOODSHED_FIREWOOD_LIMIT) seen.full = at;
  };
  return { seen, look, firewood };
}

function alone(where: Plan): void {
  const shed = watchShed(where.shed);
  const rows: string[] = [];
  runYear(woodshedCommands(where), (sim) => {
    shed.look(sim);
    const { day } = dateAt(sim.tick);
    if (isDusk(sim.tick) && SHED_DUSKS.includes(day)) rows.push(`| dusk of day ${day} | ${sim.tally.batches} | ${shed.firewood(sim)} |`);
  });
  console.log('## the woodshed alone');
  console.log(`seed ${FIRST_YEAR_SEED}: the stockpile, the woodshed, and the chop orders at the first tick, and nothing else`);
  console.log(`woodshed finished ${shed.seen.finished}, ${shed.seen.woodcutter} became its woodcutter, full with ${WOODSHED_FIREWOOD_LIMIT} firewood ${shed.seen.full}`);
  console.log('');
  console.log('| When | Logs split | Firewood in the shed |');
  console.log('| --- | --- | --- |');
  for (const line of rows) console.log(line);
  console.log('');
}

function withTheFirstYear(where: Plan): void {
  const shed = watchShed(where.shed);
  const rows: string[] = [];
  const deaths: string[] = [];
  const row = (sim: Sim, when: string) =>
    rows.push(
      `| ${when} | ${seasonAt(sim.tick)} | ${foodIn(sim, StoreKind.Common)} | ${sim.stores.held[Good.Food - 1]![CAMP_STORE]} | ${foodIn(sim, StoreKind.Home)} | ` +
        `${groundFood(sim)} | ${sim.tally.foraged} | ${sim.tally.kills} | ${sim.living} | ${sim.tally.batches} | ${shed.firewood(sim)} |`,
    );
  const dead = new Uint8Array(SETTLERS.villagers);
  const finished = new Map<number, string>();
  const sim = runYear([...huntYearCommands({ hut: true }), ...woodshedCommands(where)], (sim) => {
    shed.look(sim);
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] !== SiteState.Built || finished.has(slot)) continue;
      const workers: string[] = [];
      for (let id = 0; id < SETTLERS.villagers; id++) if (sim.villagers.workplace[id] === slot) workers.push(nameOfId(sim, id));
      finished.set(slot, `${BUILDINGS[sites.kind[slot] as Building].name} ${clock(sim.tick - 1)}${workers.length > 0 ? ` (${workers.join(' and ')})` : ''}`);
    }
    const { day } = dateAt(sim.tick);
    if (isDusk(sim.tick) && WINTER_DUSKS.includes(day)) row(sim, `dusk of day ${day}`);
    if (tickOfDay(sim.tick) === TICKS_PER_DAY - 1 && SEASON_ENDS.includes(day)) row(sim, `end of day ${day}`);
    for (let id = 0; id < dead.length; id++) {
      if (dead[id] === 0 && sim.villagers.state[id] === VillagerState.Dead) {
        dead[id] = 1;
        deaths.push(`${nameOfId(sim, id)} ${clock(sim.tick - 1)}`);
      }
    }
  });
  console.log("## the first year with the hut, the barn beside it, the hunter's lodge, and the woodshed");
  console.log(`seed ${FIRST_YEAR_SEED}: #30's first-year commands and the woodshed's, all at the first tick; ${sim.living} of ${SETTLERS.villagers} alive at the end of the year`);
  console.log(`finished: ${[...finished.values()].join(', ')}`);
  console.log(`woodshed finished ${shed.seen.finished}, ${shed.seen.woodcutter} became its woodcutter, full with ${WOODSHED_FIREWOOD_LIMIT} firewood ${shed.seen.full}`);
  console.log('');
  console.log('Picked and Kills count from the start of the year, as in #30. Split is the logs split, and Firewood the firewood in the shed.');
  console.log('| When | Season | Barn | Camp | Homes | Ground | Picked | Kills | Living | Split | Firewood |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const line of rows) console.log(line);
  console.log('');
  console.log(`meals ${sim.tally.meals}, missed ${sim.tally.missed}; deaths: ${deaths.join(', ') || 'none'}`);
  console.log('');
}

const RUNS: Readonly<Record<string, (where: Plan) => void>> = { alone, year: withTheFirstYear };
const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(RUNS);
const where = plan();
console.log('## Where the woodshed, its stockpile, and its trees lie');
for (const line of where.why) console.log(line);
console.log('');
for (const name of names) {
  const run = RUNS[name];
  if (!run) throw new Error(`no run named ${name}; the runs are ${Object.keys(RUNS).join(', ')}`);
  run(where);
}
