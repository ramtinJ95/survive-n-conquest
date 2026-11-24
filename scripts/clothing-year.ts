// A tailor's hut on seed 7 beside the first year's hut, barn, and lodge: `bun scripts/clothing-year.ts`.
import { BUILDINGS, Building, jobAt, siteMidX, siteMidY } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, seasonAt, tickOfDay } from '../src/sim/calendar';
import { underCamp } from '../src/sim/camp';
import { Claim } from '../src/sim/claims';
import { FIRST_YEAR_SEED, huntYearCommands } from '../src/sim/firstYear';
import { LOGS_PER_TREE } from '../src/sim/gathering';
import { Good } from '../src/sim/goods';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState, openGround, siteRefusal } from '../src/sim/orders';
import { SETTLERS, type Command, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE, StoreKind, TAILOR_CLOTHING_LIMIT, storeKind } from '../src/sim/stores';
import { VillagerState } from '../src/sim/villagerState';
import { JOB_WORDS } from '../src/ui/buildings';

/** The tailor's hut's anchor is chosen among those whose middle lies this near the camp center. */
const ANCHOR_REACH = 14;
/** The stockpile is a square of this many tiles a side. */
const STOCKPILE_SIDE = 3;
/** Trees enough for the tailor's hut's logs. */
const TREES = BUILDINGS[Building.Tailor].needs[Good.Log]! / LOGS_PER_TREE;
const SEASON_ENDS = [3, 6, 9, 12];

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const tile = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });

/** Where the tailor's hut, its stockpile, and its trees lie, and why. */
interface Plan {
  readonly hut: { readonly x: number; readonly y: number };
  readonly stockpile: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly trees: readonly (readonly [number, number])[];
  readonly why: readonly string[];
}

/**
 * Places the tailor's hut, its stockpile, and its trees beside the first
 * year's hut, barn, and lodge, by the rules the woodshed of #34 was placed by.
 * The hut takes the anchor the rules accept whose middle lies nearest the camp
 * center, then the lowest tile. The stockpile takes the square that a
 * stockpile order takes whole nearest the camp center, then the lowest tile.
 * The trees are the ones nearest the camp center that the first year's orders leave standing.
 */
function plan(): Plan {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of huntYearCommands({ hut: true })) applyCommand(sim, command);
  const { size } = sim.map;
  const campX = (sim.flow.goal % size) + 0.5;
  const campY = Math.floor(sim.flow.goal / size) + 0.5;
  const fromCamp = (x: number, y: number) => Math.hypot(x - campX, y - campY);
  const anchors: { x: number; y: number; distance: number }[] = [];
  const { side } = BUILDINGS[Building.Tailor];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = fromCamp(x + side / 2, y + side / 2);
      if (distance <= ANCHOR_REACH && siteRefusal(sim.map, sim.orders, Building.Tailor, x, y) === null) anchors.push({ x, y, distance });
    }
  }
  anchors.sort((a, b) => a.distance - b.distance || a.y * size + a.x - (b.y * size + b.x));
  const hut = anchors[0]!;
  applyCommand(sim, { kind: 'place', building: Building.Tailor, x: hut.x, y: hut.y });

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
  const slot = sim.orders.siteOf[hut.y * size + hut.x]!;
  const hutToPile = Math.hypot(stockpile.x0 + STOCKPILE_SIDE / 2 - siteMidX(sim.orders.sites, slot), stockpile.y0 + STOCKPILE_SIDE / 2 - siteMidY(sim.orders.sites, slot));
  return {
    hut: { x: hut.x, y: hut.y },
    stockpile,
    trees,
    why: [
      `tailor's hut anchored on (${hut.x}, ${hut.y}): of the ${anchors.length} anchors within ${ANCHOR_REACH} tiles of the camp center that the rules accept beside the first year's hut, barn, and lodge, its middle lies nearest the camp center, ${hut.distance.toFixed(1)} tiles`,
      `stockpile on (${stockpile.x0}, ${stockpile.y0}) to (${stockpile.x1}, ${stockpile.y1}): the ${STOCKPILE_SIDE} by ${STOCKPILE_SIDE} square that a stockpile order takes whole nearest the camp center once the hut stands, its middle ${stockpile.distance.toFixed(1)} tiles from the camp center and ${hutToPile.toFixed(1)} from the tailor's hut's`,
      `${TREES} trees, ${TREES * LOGS_PER_TREE} logs, for the hut's ${BUILDINGS[Building.Tailor].needs[Good.Log]}: the ${TREES} nearest the camp center that the first year's orders leave standing: ${trees.map(([x, y]) => `(${x}, ${y})`).join(', ')}`,
    ],
  };
}

const stockpileCommand = ({ stockpile }: Plan): Command => ({ kind: 'markArea', order: 'stockpile', area: stockpile });
const tailorCommands = ({ hut, trees }: Plan): Command[] => [
  { kind: 'place', building: Building.Tailor, x: hut.x, y: hut.y },
  ...trees.map(([x, y]): Command => ({ kind: 'markArea', order: 'chop', area: tile(x, y) })),
];

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

/** The hides on stockpile tiles and on the ground off them, and in the hands of villagers. */
function hides(sim: Sim): { stocked: number; ground: number; held: number } {
  const { map } = sim;
  let stocked = 0;
  let ground = 0;
  for (let at = 0; at < map.size * map.size; at++) {
    if (map.stackGood[at] !== Good.Hide) continue;
    if (sim.orders.claims[at] === Claim.Stockpile) stocked += map.stackSize[at]!;
    else ground += map.stackSize[at]!;
  }
  let held = 0;
  for (let id = 0; id < sim.villagers.count; id++) if (sim.villagers.carried[id] === Good.Hide) held++;
  return { stocked, ground, held };
}

interface Run {
  readonly sim: Sim;
  readonly rows: readonly string[];
  readonly finished: readonly string[];
  readonly deaths: readonly string[];
  /** The job each villager held at the end of autumn, by id. */
  readonly autumnJobs: readonly string[];
}

/** Runs the commands from the first tick to the end of the year, with a row at each season's end. */
function runYear(commands: readonly Command[], row: (sim: Sim, when: string) => string, each: (sim: Sim) => void = () => {}): Run {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of commands) {
    const outcome = applyCommand(sim, command);
    if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  }
  const rows: string[] = [];
  const deaths: string[] = [];
  const dead = new Uint8Array(SETTLERS.villagers);
  const finished = new Map<number, string>();
  let autumnJobs: string[] = [];
  while (!sim.over && dateAt(sim.tick).day <= DAYS_PER_YEAR) {
    each(sim);
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] !== SiteState.Built || finished.has(slot)) continue;
      const workers: string[] = [];
      for (let id = 0; id < SETTLERS.villagers; id++) if (sim.villagers.workplace[id] === slot) workers.push(nameOfId(sim, id));
      finished.set(slot, `${BUILDINGS[sites.kind[slot] as Building].name} ${clock(sim.tick - 1)}${workers.length > 0 ? ` (${workers.join(' and ')})` : ''}`);
    }
    const { day } = dateAt(sim.tick);
    if (tickOfDay(sim.tick) === TICKS_PER_DAY - 1 && SEASON_ENDS.includes(day)) {
      rows.push(row(sim, `end of day ${day}`));
      if (day === 9) autumnJobs = Array.from(sim.villagers.workplace, (place) => JOB_WORDS[jobAt(sim.orders.sites, place)].title);
    }
    for (let id = 0; id < dead.length; id++) {
      if (dead[id] === 0 && sim.villagers.state[id] === VillagerState.Dead) {
        dead[id] = 1;
        deaths.push(`${nameOfId(sim, id)} ${clock(sim.tick - 1)}`);
      }
    }
    step(sim);
  }
  return { sim, rows, finished: [...finished.values()], deaths, autumnJobs };
}

const foodRow = (sim: Sim, when: string) =>
  `| ${when} | ${seasonAt(sim.tick)} | ${foodIn(sim, StoreKind.Common)} | ${sim.stores.held[Good.Food - 1]![CAMP_STORE]} | ${foodIn(sim, StoreKind.Home)} | ` +
  `${groundFood(sim)} | ${sim.tally.foraged} | ${sim.tally.kills} | ${sim.living} |`;

function printFood(title: string, run: Run): void {
  console.log(`## ${title}`);
  console.log(`finished: ${run.finished.join(', ')}`);
  console.log(`jobs at the end of autumn: ${run.autumnJobs.map((job, id) => `${nameOfId(run.sim, id)} ${job}`).join(', ')}`);
  console.log('');
  console.log('| When | Season | Barn | Camp | Homes | Ground | Picked | Kills | Living |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.rows) console.log(line);
  console.log('');
  console.log(`meals ${run.sim.tally.meals}, missed ${run.sim.tally.missed}; deaths: ${run.deaths.join(', ') || 'none'}`);
  console.log('');
}

const where = plan();
console.log("## Where the tailor's hut, its stockpile, and its trees lie");
for (const line of where.why) console.log(line);
console.log('');

printFood("#30's first year: the hut, the barn beside it, and the hunter's lodge", runYear(huntYearCommands({ hut: true }), foodRow));
printFood("#30's first year and the stockpile, no tailor's hut", runYear([...huntYearCommands({ hut: true }), stockpileCommand(where)], foodRow));

const seen = { finished: 'never', tailor: 'nobody', firstPiece: 'never', full: 'never' };
let slot = -1;
const clothing = (sim: Sim) => (slot < 0 ? 0 : sim.stores.held[Good.Clothing - 1]![slot]!);
const look = (sim: Sim) => {
  if (slot < 0) slot = sim.orders.siteOf[where.hut.y * sim.map.size + where.hut.x]!;
  const at = clock(Math.max(sim.tick - 1, 0));
  if (seen.finished === 'never' && sim.orders.sites.state[slot] === SiteState.Built) {
    seen.finished = at;
    const id = sim.villagers.workplace.indexOf(slot);
    seen.tailor = id < 0 ? 'nobody' : nameOfId(sim, id);
  }
  if (seen.firstPiece === 'never' && clothing(sim) > 0) seen.firstPiece = at;
  if (seen.full === 'never' && clothing(sim) === TAILOR_CLOTHING_LIMIT) seen.full = at;
};
const tailorRow = (sim: Sim, when: string) => {
  const { stocked, ground, held } = hides(sim);
  const inHut = slot < 0 ? 0 : sim.workshops.input[slot]!;
  return `${foodRow(sim, when)} ${sim.tally.hides} | ${ground} | ${stocked} | ${held} | ${inHut} | ${clothing(sim)} |`;
};
const year = runYear([...huntYearCommands({ hut: true }), stockpileCommand(where), ...tailorCommands(where)], tailorRow, look);
console.log("## #30's first year, the stockpile, and the tailor's hut");
console.log(`seed ${FIRST_YEAR_SEED}: #30's first-year commands, the stockpile, and the tailor's hut, all at the first tick; ${year.sim.living} of ${SETTLERS.villagers} alive at the end of the year`);
console.log(`finished: ${year.finished.join(', ')}`);
console.log(`jobs at the end of autumn: ${year.autumnJobs.map((job, id) => `${nameOfId(year.sim, id)} ${job}`).join(', ')}`);
console.log(
  `tailor's hut finished ${seen.finished}, ${seen.tailor} became its tailor; first piece of clothing ${seen.firstPiece}; full with ${TAILOR_CLOTHING_LIMIT} pieces ${seen.full}`,
);
console.log('');
console.log('Picked, Kills, and Hides left count from the start of the year. Ground is the hides on the ground off a stockpile, Held those in hands, and In hut those in the hut toward its next piece.');
console.log('| When | Season | Barn | Camp | Homes | Ground food | Picked | Kills | Living | Hides left | Ground | Stockpiles | Held | In hut | Clothing |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const line of year.rows) console.log(line);
console.log('');
const left = hides(year.sim);
console.log(
  `meals ${year.sim.tally.meals}, missed ${year.sim.tally.missed}; deaths: ${year.deaths.join(', ') || 'none'}; ` +
    `hides left over at the year's end: ${left.ground} on the ground, ${left.stocked} in stockpiles, ${left.held} in hands, ${slot < 0 ? 0 : year.sim.workshops.input[slot]} in the hut`,
);
