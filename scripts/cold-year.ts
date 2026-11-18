// The first winter on seed 7, with nothing for warmth and with two houses and a woodshed: `bun scripts/cold-year.ts [run ...]`.
import { BUILDINGS, Building } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, seasonAt, tickOfDay } from '../src/sim/calendar';
import { underCamp } from '../src/sim/camp';
import { isDawn, isNight } from '../src/sim/daylight';
import { FIRST_YEAR_HOUSES, FIRST_YEAR_SEED, huntYearCommands } from '../src/sim/firstYear';
import { LOGS_PER_TREE, STONE_PER_ROCK } from '../src/sim/gathering';
import { Good } from '../src/sim/goods';
import { TileKind } from '../src/sim/map';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { Claim, SiteState, openGround, siteRefusal } from '../src/sim/orders';
import { SETTLERS, type Command, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { STOCKING } from '../src/sim/stocking';
import { CAMP_FIREWOOD_LIMIT, CAMP_STORE, HOUSE_FIREWOOD_LIMIT, StoreKind, fireOf, storeKind } from '../src/sim/stores';
import { TASK_KINDS } from '../src/sim/tasks';
import { VillagerState } from '../src/sim/villagerState';

const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
/** The woodshed's anchor is chosen among those whose middle lies this near the camp center. */
const ANCHOR_REACH = 14;
const STOCKPILE_SIDE = 3;
const HOUSES = FIRST_YEAR_HOUSES.slice(0, 2);
const WINTER_NIGHTS = 3;
const HOUSE_FIRE = 2;
const CAMP_FIRE = 4;
/**
 * Logs for the woodshed and the two houses, and for the firewood that fills both houses and the camp once and
 * then burns in each of their fires on every night of the winter.
 */
const LOGS =
  BUILDINGS[Building.Woodshed].needs[Good.Log]! +
  HOUSES.length * BUILDINGS[Building.House].needs[Good.Log]! +
  (HOUSES.length * (HOUSE_FIREWOOD_LIMIT + HOUSE_FIRE * WINTER_NIGHTS) + CAMP_FIREWOOD_LIMIT + CAMP_FIRE * WINTER_NIGHTS) / 2;
const TREES = Math.ceil(LOGS / LOGS_PER_TREE);
const ROCKS = Math.ceil((HOUSES.length * BUILDINGS[Building.House].needs[Good.Stone]!) / STONE_PER_ROCK);
const SEASON_ENDS = [3, 6, 9];
const WINTER_DUSKS = [10, 11, 12];

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);
const tile = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });

interface Plan {
  readonly commands: readonly Command[];
  readonly why: readonly string[];
}

/**
 * #30's commands, then two of the first year's four houses, the woodshed on the anchor the rules accept nearest the
 * camp center, the stockpile square nearest the camp center, and chop and quarry orders on the trees and rock tiles
 * nearest the camp center that the orders before leave unmarked.
 */
function plan(): Plan {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  const commands: Command[] = [...huntYearCommands({ hut: true })];
  const give = (command: Command) => {
    const outcome = applyCommand(sim, command);
    if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
    commands.push(command);
  };
  for (const command of commands.splice(0)) give(command);
  for (const [x, y] of HOUSES) give({ kind: 'place', building: Building.House, x, y });
  const { size } = sim.map;
  const campX = (sim.flow.goal % size) + 0.5;
  const campY = Math.floor(sim.flow.goal / size) + 0.5;
  const fromCamp = (x: number, y: number) => Math.hypot(x - campX, y - campY);
  const { side } = BUILDINGS[Building.Woodshed];
  let shed = { x: 0, y: 0, distance: Infinity };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = fromCamp(x + side / 2, y + side / 2);
      if (distance <= ANCHOR_REACH && distance < shed.distance && siteRefusal(sim.map, sim.orders, Building.Woodshed, x, y) === null) shed = { x, y, distance };
    }
  }
  give({ kind: 'place', building: Building.Woodshed, x: shed.x, y: shed.y });
  const open = (x: number, y: number) => {
    const at = y * size + x;
    return sim.orders.claims[at] === Claim.None && openGround(sim.map, at) && !underCamp(sim.map, sim.camp, at);
  };
  let pile = { x0: 0, y0: 0, x1: 0, y1: 0, distance: Infinity };
  for (let y = 0; y + STOCKPILE_SIDE <= size; y++) {
    for (let x = 0; x + STOCKPILE_SIDE <= size; x++) {
      const distance = fromCamp(x + STOCKPILE_SIDE / 2, y + STOCKPILE_SIDE / 2);
      if (distance >= pile.distance) continue;
      let whole = true;
      for (let ty = y; ty < y + STOCKPILE_SIDE && whole; ty++) for (let tx = x; tx < x + STOCKPILE_SIDE && whole; tx++) whole = open(tx, ty);
      if (whole) pile = { x0: x, y0: y, x1: x + STOCKPILE_SIDE - 1, y1: y + STOCKPILE_SIDE - 1, distance };
    }
  }
  give({ kind: 'markArea', order: 'stockpile', area: pile });
  const nearest = (fits: (at: number) => boolean, count: number) => {
    const found: { x: number; y: number; distance: number }[] = [];
    for (let at = 0; at < size * size; at++) {
      if (fits(at) && sim.orders.claims[at] === Claim.None) found.push({ x: at % size, y: Math.floor(at / size), distance: fromCamp((at % size) + 0.5, Math.floor(at / size) + 0.5) });
    }
    found.sort((a, b) => a.distance - b.distance || a.y * size + a.x - (b.y * size + b.x));
    return found.slice(0, count);
  };
  const trees = nearest((at) => sim.map.trees[at] === 1, TREES);
  const rocks = nearest((at) => sim.map.kinds[at] === TileKind.Rock, ROCKS);
  for (const { x, y } of trees) give({ kind: 'markArea', order: 'chop', area: tile(x, y) });
  for (const { x, y } of rocks) give({ kind: 'markArea', order: 'quarry', area: tile(x, y) });
  const list = (spots: { x: number; y: number }[]) => spots.map(({ x, y }) => `(${x}, ${y})`).join(', ');
  return {
    commands,
    why: [
      "#30's commands: the hut on (136, 127), the barn on (139, 127), the lodge on (124, 129), and their chop and quarry orders",
      `houses anchored on ${HOUSES.map(([x, y]) => `(${x}, ${y})`).join(' and ')}, the first two of the first year's four`,
      `woodshed anchored on (${shed.x}, ${shed.y}), the anchor the rules then accept whose middle lies nearest the camp center, ${shed.distance.toFixed(1)} tiles`,
      `stockpile on (${pile.x0}, ${pile.y0}) to (${pile.x1}, ${pile.y1}), the ${STOCKPILE_SIDE} by ${STOCKPILE_SIDE} square nearest the camp center, ${pile.distance.toFixed(1)} tiles`,
      `${TREES} trees, ${TREES * LOGS_PER_TREE} logs, for the shed's 6, the houses' 24, and ${LOGS - 30} for firewood: ${list(trees)}`,
      `${ROCKS} rock tiles, ${ROCKS * STONE_PER_ROCK} stone, for the houses' 12: ${list(rocks)}`,
      'every command at the first tick',
    ],
  };
}

const foodIn = (sim: Sim, kind: StoreKind) => {
  let food = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) food += sim.stores.held[Good.Food - 1]![slot]!;
  return food;
};
const firewoodIn = (sim: Sim, kind: StoreKind) => {
  let firewood = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) firewood += sim.stores.held[Good.Firewood - 1]![slot]!;
  return firewood;
};
const homeName = (sim: Sim, id: number) => {
  const home = sim.households.home[sim.villagers.household[id]!]!;
  return home < 0 ? 'camp' : `house ${home}`;
};

function runYear(commands: readonly Command[]) {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of commands) applyCommand(sim, command);
  const count = SETTLERS.villagers;
  const finished = new Map<number, string>();
  const stores: string[] = [];
  const nights: string[] = [];
  const settlerRows = Array.from({ length: count }, () => ({ name: '', household: 0, sleeps: '', job: '', cold: [] as number[], died: '' }));
  const stockingTicks = new Float64Array(count);
  const firewoodTrips = new Uint16Array(count);
  let barnAtAutumnsEnd = 0;
  const storesRow = (when: string) =>
    stores.push(
      `| ${when} | ${foodIn(sim, StoreKind.Common)} | ${sim.stores.held[Good.Food - 1]![CAMP_STORE]} | ${foodIn(sim, StoreKind.Home)} | ` +
        `${firewoodIn(sim, StoreKind.Workshop)} | ${sim.stores.held[Good.Firewood - 1]![CAMP_STORE]} | ${firewoodIn(sim, StoreKind.Home)} | ${sim.tally.batches} | ${sim.living} |`,
    );
  // The year runs to the dawn after its last night, so that night is judged and read.
  while (!sim.over && !(isDawn(sim.tick) && dateAt(sim.tick).day > DAYS_PER_YEAR)) {
    const { day } = dateAt(sim.tick);
    if (isDusk(sim.tick) && WINTER_DUSKS.includes(day)) storesRow(`dusk of day ${day}`);
    if (tickOfDay(sim.tick) === 0 && SEASON_ENDS.includes(day - 1)) storesRow(`end of day ${day - 1}`);
    if (tickOfDay(sim.tick) === 0 && day - 1 === DAYS_PER_YEAR) storesRow(`end of day ${day - 1}`);
    if (tickOfDay(sim.tick) === 0 && day - 1 === 9) barnAtAutumnsEnd = foodIn(sim, StoreKind.Common);
    if (isNight(sim.tick) && seasonAt(sim.tick) === 'Winter' && tickOfDay(sim.tick) === TICKS_PER_DAY - 1) {
      const lit: string[] = [];
      for (let store = 0; store <= CAMP_STORE; store++) if (sim.stores.burning[store] === 1) lit.push(store === CAMP_STORE ? 'the camp' : `house ${store}`);
      const houses = [];
      for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === StoreKind.Home && fireOf(sim.orders, slot) > 0) houses.push(slot);
      const left = houses.map((slot) => `house ${slot} ${sim.stores.held[Good.Firewood - 1]![slot]}`).join(', ');
      nights.push(`| night of day ${day} | ${lit.join(', ') || 'none'} | ${left || 'no house'} | ${sim.stores.held[Good.Firewood - 1]![CAMP_STORE]} |`);
    }
    for (let id = 0; id < count; id++) {
      if (sim.villagers.task[id] === STOCK && sim.villagers.stockGood[id] === Good.Firewood) stockingTicks[id]! += 1;
    }
    const before = Uint8Array.from(sim.villagers.state);
    const carriedHome = sim.tally.firewoodHome;
    const toHomeBy = Int16Array.from(sim.villagers.toStore);
    const carried = Uint8Array.from(sim.villagers.carried);
    step(sim);
    if (sim.tally.firewoodHome > carriedHome) {
      for (let id = 0; id < count; id++) if (carried[id] === Good.Firewood && sim.villagers.carried[id] === Good.None && toHomeBy[id]! >= 0 && toHomeBy[id] !== CAMP_STORE) firewoodTrips[id]! += 1;
    }
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] !== SiteState.Built || finished.has(slot)) continue;
      const workers: string[] = [];
      for (let id = 0; id < count; id++) if (sim.villagers.workplace[id] === slot) workers.push(nameOfId(sim, id));
      finished.set(slot, `${BUILDINGS[sites.kind[slot] as Building].name} ${slot} ${clock(sim.tick - 1)}${workers.length > 0 ? ` (${workers.join(' and ')})` : ''}`);
    }
    for (let id = 0; id < count; id++) {
      const row = settlerRows[id]!;
      if (row.name === '') Object.assign(row, { name: nameOfId(sim, id), household: sim.villagers.household[id]! });
      if (before[id] !== VillagerState.Dead) {
        row.sleeps = homeName(sim, id);
        const workplace = sim.villagers.workplace[id]!;
        if (workplace >= 0) row.job = BUILDINGS[sim.orders.sites.kind[workplace] as Building].name;
      }
      if (before[id] !== VillagerState.Dead && sim.villagers.state[id] === VillagerState.Dead) {
        row.died = `${sim.villagers.coldNights[id]! >= 3 ? 'froze' : 'starved'} ${clock(sim.tick - 1)}`;
      }
    }
    if (sim.over || (isNight(sim.tick) && seasonAt(sim.tick - 1) === 'Winter' && tickOfDay(sim.tick) === 0)) {
      for (let id = 0; id < count; id++) if (settlerRows[id]!.cold.length < WINTER_NIGHTS) settlerRows[id]!.cold.push(sim.villagers.coldNights[id]!);
    }
  }
  if (sim.over) storesRow(`died out ${clock(sim.tick - 1)}`);
  return { sim, finished, stores, nights, settlerRows, stockingTicks, firewoodTrips, barnAtAutumnsEnd };
}

function report(title: string, commands: readonly Command[], why: readonly string[]) {
  const run = runYear(commands);
  const { sim } = run;
  console.log(`## ${title}`);
  for (const line of why) console.log(`- ${line}`);
  console.log('');
  console.log(`finished: ${[...run.finished.values()].join(', ')}`);
  console.log('');
  console.log('Food in barns, at the camp, and in homes; firewood in the woodshed, at the camp, and in homes; logs split; settlers living.');
  console.log('| When | Barn | Camp food | Home food | Shed firewood | Camp firewood | Home firewood | Split | Living |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.stores) console.log(line);
  console.log('');
  if (run.nights.length > 0) {
    console.log('Fires that burn each winter night, read at midnight, and the firewood left in each house and at the camp then.');
    console.log('| Night | Fires | Firewood in houses | Firewood at the camp |');
    console.log('| --- | --- | --- | --- |');
    for (const line of run.nights) console.log(line);
    console.log('');
  }
  console.log('Cold nights in a row at each winter midnight, after the night was judged at dusk; a settler that froze reads 3.');
  console.log('| Settler | Household | Sleeps | Job | Night of day 10 | Night of day 11 | Night of day 12 | Died |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of run.settlerRows) console.log(`| ${row.name} | ${row.household} | ${row.sleeps} | ${row.job || 'none'} | ${[0, 1, 2].map((night) => row.cold[night] ?? '').join(' | ')} | ${row.died || 'lives'} |`);
  console.log('');
  const { tally } = sim;
  console.log(
    `food: picked ${tally.foraged}, kills ${tally.kills}, barn at autumn's end ${run.barnAtAutumnsEnd}, meals ${tally.meals} eaten and ${tally.missed} missed; ` +
      `cold nights ${tally.coldNights}, froze ${tally.froze}, starved ${tally.starved}; fires lit ${tally.fires}, firewood burnt ${tally.burnt}; ` +
      `firewood carried home ${tally.firewoodHome}, to the camp ${tally.firewoodToCamp}`,
  );
  const ticks = Array.from(run.stockingTicks).reduce((sum, value) => sum + value, 0);
  if (ticks > 0) {
    const walkers = run.settlerRows
      .map((row, id) => ({ row, id }))
      .filter(({ id }) => run.stockingTicks[id]! > 0)
      .map(({ row, id }) => `${row.name} (${row.sleeps}) ${(run.stockingTicks[id]! / TICKS_PER_DAY * 24).toFixed(1)} h, ${run.firewoodTrips[id]} units home`);
    console.log(`walks for firewood, as villager-ticks holding a stocking task for firewood: ${ticks} ticks, ${((ticks / TICKS_PER_DAY) * 24).toFixed(1)} game hours in all; ${walkers.join('; ')}`);
  }
  console.log('');
}

const RUNS: Readonly<Record<string, () => void>> = {
  nothing: () => report("nothing for warmth: #30's hut, barn, and lodge", huntYearCommands({ hut: true }), ["#30's commands, all at the first tick"]),
  houses: () => {
    const { commands, why } = plan();
    report("two houses and a woodshed beside #30's hut, barn, and lodge", commands, why);
  },
};
const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(RUNS);
for (const name of names) {
  const run = RUNS[name];
  if (!run) throw new Error(`no run named ${name}; the runs are ${Object.keys(RUNS).join(', ')}`);
  run();
}
