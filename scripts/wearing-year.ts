// The first year on seed 7 with clothing worn: #30's hut, barn, and lodge, a stockpile, a woodshed, and a tailor's hut, no house.
// `bun scripts/wearing-year.ts [first-tick | after-lodge ...]`
import { BUILDINGS, Building, Job, jobAt } from '../src/sim/buildings';
import { DAYS_PER_YEAR, dateAt, seasonAt, tickOfDay } from '../src/sim/calendar';
import { isDawn, isNight } from '../src/sim/daylight';
import { FIRST_YEAR_SEED, huntYearCommands } from '../src/sim/firstYear';
import { LOGS_PER_TREE } from '../src/sim/gathering';
import { Good } from '../src/sim/goods';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { Claim, SiteState, siteRefusal } from '../src/sim/orders';
import { SETTLERS, type Command, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_FIREWOOD_LIMIT, CAMP_STORE, StoreKind, storeKind } from '../src/sim/stores';
import { VillagerState } from '../src/sim/villagerState';

/** Where #36's tailor year put the tailor's hut and its stockpile, by the rules #34 placed the woodshed by. */
const TAILOR = { x: 126, y: 123 };
const STOCKPILE = { x0: 122, y0: 126, x1: 124, y1: 128 };
/** The woodshed's anchor is chosen among those whose middle lies this near the camp center, as in 4.2's year. */
const ANCHOR_REACH = 14;
const WINTER_NIGHTS = 3;
const CAMP_FIRE = 4;
/** Logs for the woodshed and the tailor's hut, and for the firewood that fills the camp once and burns in its fire on every night of the winter. */
const LOGS = BUILDINGS[Building.Woodshed].needs[Good.Log]! + BUILDINGS[Building.Tailor].needs[Good.Log]! + (CAMP_FIREWOOD_LIMIT + CAMP_FIRE * WINTER_NIGHTS) / 2;
const TREES = Math.ceil(LOGS / LOGS_PER_TREE);
const SEASON_ENDS = [3, 6, 9, 12];
const WINTER_DUSKS = [10, 11, 12];

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);
const tile = (x: number, y: number) => ({ x0: x, y0: y, x1: x, y1: y });
const placeTailor: Command = { kind: 'place', building: Building.Tailor, x: TAILOR.x, y: TAILOR.y };

/**
 * #30's commands, the stockpile and the tailor's hut of #36's tailor year, the woodshed on the anchor the rules then
 * accept nearest the camp center, and chop orders on the trees nearest the camp center that the orders before leave
 * unmarked. With `tailor` false the tailor's hut is left out, for a later command.
 */
function plan(tailor: boolean): { commands: Command[]; why: string[] } {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  const commands: Command[] = [];
  const give = (command: Command) => {
    const outcome = applyCommand(sim, command);
    if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
    commands.push(command);
  };
  for (const command of huntYearCommands({ hut: true })) give(command);
  give({ kind: 'markArea', order: 'stockpile', area: STOCKPILE });
  const probe = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of [...commands, placeTailor]) applyCommand(probe, command);
  if (tailor) give(placeTailor);
  const { size } = sim.map;
  const campX = (sim.flow.goal % size) + 0.5;
  const campY = Math.floor(sim.flow.goal / size) + 0.5;
  const fromCamp = (x: number, y: number) => Math.hypot(x - campX, y - campY);
  const { side } = BUILDINGS[Building.Woodshed];
  let shed = { x: 0, y: 0, distance: Infinity };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = fromCamp(x + side / 2, y + side / 2);
      if (distance <= ANCHOR_REACH && distance < shed.distance && siteRefusal(probe.map, probe.orders, Building.Woodshed, x, y) === null) shed = { x, y, distance };
    }
  }
  give({ kind: 'place', building: Building.Woodshed, x: shed.x, y: shed.y });
  const trees: { x: number; y: number; distance: number }[] = [];
  for (let at = 0; at < size * size; at++) {
    if (sim.map.trees[at] === 1 && sim.orders.claims[at] === Claim.None) {
      trees.push({ x: at % size, y: Math.floor(at / size), distance: fromCamp((at % size) + 0.5, Math.floor(at / size) + 0.5) });
    }
  }
  trees.sort((a, b) => a.distance - b.distance || a.y * size + a.x - (b.y * size + b.x));
  const chosen = trees.slice(0, TREES);
  for (const { x, y } of chosen) give({ kind: 'markArea', order: 'chop', area: tile(x, y) });
  return {
    commands,
    why: [
      "#30's commands: the hut on (136, 127), the barn on (139, 127), the lodge on (124, 129), and their chop and quarry orders",
      `stockpile on (${STOCKPILE.x0}, ${STOCKPILE.y0}) to (${STOCKPILE.x1}, ${STOCKPILE.y1}) and tailor's hut on (${TAILOR.x}, ${TAILOR.y}), as #36's tailor year placed them`,
      `woodshed anchored on (${shed.x}, ${shed.y}), the anchor the rules accept beside them whose middle lies nearest the camp center, ${shed.distance.toFixed(1)} tiles`,
      `${TREES} trees, ${TREES * LOGS_PER_TREE} logs, for the shed's 6, the tailor's hut's 8, and 12 for the camp's firewood: ${chosen.map(({ x, y }) => `(${x}, ${y})`).join(', ')}`,
      'no house',
      tailor ? 'every command at the first tick' : "every command at the first tick but the tailor's hut, which is placed on the tick the lodge is finished",
    ],
  };
}

const foodIn = (sim: Sim, kind: StoreKind) => {
  let food = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) food += sim.stores.held[Good.Food - 1]![slot]!;
  return food;
};
const slotsOf = (sim: Sim, kind: Building) => {
  const slots: number[] = [];
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (sim.orders.sites.state[slot] !== SiteState.Free && sim.orders.sites.kind[slot] === kind) slots.push(slot);
  return slots;
};
const workersAt = (sim: Sim, job: Job) => {
  const names: string[] = [];
  for (let id = 0; id < sim.villagers.state.length; id++) {
    if (sim.villagers.state[id] !== VillagerState.Dead && jobAt(sim.orders.sites, sim.villagers.workplace[id]!) === job) names.push(nameOfId(sim, id));
  }
  return names;
};
const clothedNames = (sim: Sim) => {
  const names: string[] = [];
  for (let id = 0; id < sim.villagers.state.length; id++) if (sim.villagers.state[id] !== VillagerState.Dead && sim.villagers.worn[id] === Good.Clothing) names.push(nameOfId(sim, id));
  return names;
};

function runYear(commands: readonly Command[], tailorAfterLodge: boolean) {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of commands) applyCommand(sim, command);
  const count = SETTLERS.villagers;
  const lodge = slotsOf(sim, Building.Lodge)[0]!;
  const finished = new Map<number, string>();
  const events: string[] = [];
  const food: string[] = [];
  const seasons: string[] = [];
  const dusks: string[] = [];
  const nights = Array.from({ length: count }, () => [] as string[]);
  const died: string[] = [];
  const hunters = new Set<string>();
  let tailorPlaced = !tailorAfterLodge;
  let made = 0;
  const seasonRow = (day: number) => {
    food.push(`| end of day ${day} | ${seasonAt(sim.tick - 1)} | ${foodIn(sim, StoreKind.Common)} | ${sim.stores.held[Good.Food - 1]![CAMP_STORE]} | ${sim.tally.foraged} | ${sim.tally.kills} | ${sim.tally.meals} | ${sim.tally.missed} | ${sim.living} |`);
    const hut = slotsOf(sim, Building.Tailor)[0];
    const inHut = hut === undefined ? 0 : sim.stores.held[Good.Clothing - 1]![hut]!;
    const clothed = clothedNames(sim);
    seasons.push(`| end of day ${day} | ${sim.tally.hides} | ${made} | ${sim.tally.dressed} | ${inHut} | ${clothed.length} of ${sim.living} | ${clothed.join(', ') || 'nobody'} |`);
  };
  while (!sim.over && !(isDawn(sim.tick) && dateAt(sim.tick).day > DAYS_PER_YEAR)) {
    const { day } = dateAt(sim.tick);
    if (tickOfDay(sim.tick) === 0 && SEASON_ENDS.includes(day - 1)) seasonRow(day - 1);
    if (isDusk(sim.tick) && WINTER_DUSKS.includes(day)) dusks.push(`| dusk of day ${day} | ${sim.stores.held[Good.Firewood - 1]![CAMP_STORE]} | ${clothedNames(sim).length} of ${sim.living} |`);
    const before = Uint8Array.from(sim.villagers.state);
    const worn = Uint8Array.from(sim.villagers.worn);
    const cold = Uint8Array.from(sim.villagers.coldNights);
    const madeBefore = sim.tally.dressed + slotsOf(sim, Building.Tailor).reduce((sum, slot) => sum + sim.stores.held[Good.Clothing - 1]![slot]!, 0);
    step(sim);
    const madeAfter = sim.tally.dressed + slotsOf(sim, Building.Tailor).reduce((sum, slot) => sum + sim.stores.held[Good.Clothing - 1]![slot]!, 0);
    if (madeAfter > madeBefore) {
      made += madeAfter - madeBefore;
      events.push(`${clock(sim.tick - 1)} piece ${made} made`);
    }
    for (let id = 0; id < count; id++) {
      if (worn[id] !== sim.villagers.worn[id]) events.push(`${clock(sim.tick - 1)} ${nameOfId(sim, id)} puts on a piece`);
      if (before[id] !== VillagerState.Dead && sim.villagers.state[id] === VillagerState.Dead) {
        died.push(`${nameOfId(sim, id)} ${sim.villagers.coldNights[id]! >= 3 ? 'froze' : 'starved'} ${clock(sim.tick - 1)}${sim.villagers.worn[id] === Good.Clothing ? ', clothed' : ''}`);
      }
      const winter = seasonAt(sim.tick - 1) === 'Winter';
      const arrived = (sim.villagers.state[id] === VillagerState.Settling || sim.villagers.state[id] === VillagerState.Dead) && before[id] === VillagerState.GoingToCamp;
      const away = isDawn(sim.tick - 1) && before[id] !== VillagerState.Settling && before[id] !== VillagerState.Dead;
      if (winter && isNight(sim.tick - 1) && (arrived || away)) {
        const verdict = sim.villagers.coldNights[id]! > cold[id]! || sim.villagers.state[id] === VillagerState.Dead ? 'cold' : 'warm';
        const where = arrived ? `camp, ${sim.stores.burning[CAMP_STORE] === 1 ? 'fire' : 'no fire'}` : 'never got home';
        nights[id]!.push(`${verdict} (${where}, ${sim.villagers.worn[id] === Good.Clothing ? 'clothed' : 'unclothed'})${sim.villagers.state[id] === VillagerState.Dead ? ', froze' : ''}`);
      }
    }
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] !== SiteState.Built || finished.has(slot)) continue;
      const workers: string[] = [];
      for (let id = 0; id < count; id++) if (sim.villagers.workplace[id] === slot) workers.push(nameOfId(sim, id));
      finished.set(slot, `${BUILDINGS[sites.kind[slot] as Building].name} ${clock(sim.tick - 1)}${workers.length > 0 ? ` (${workers.join(' and ')})` : ''}`);
      if (slot === lodge && !tailorPlaced) {
        const outcome = applyCommand(sim, placeTailor);
        if (!outcome?.ok) throw new Error(`tailor's hut refused at ${clock(sim.tick)}: ${JSON.stringify(outcome)}`);
        tailorPlaced = true;
        events.push(`${clock(sim.tick - 1)} tailor's hut placed, as the lodge is finished`);
      }
    }
    for (const name of workersAt(sim, Job.Hunter)) hunters.add(name);
    if (sim.over) break;
  }
  if (!SEASON_ENDS.every((day) => food.some((row) => row.startsWith(`| end of day ${day} `)))) seasonRow(dateAt(sim.tick - 1).day);
  return { sim, finished, events, food, seasons, dusks, nights, died, hunters, lodge };
}

function report(title: string, tailorAfterLodge: boolean) {
  const { commands, why } = plan(!tailorAfterLodge);
  const run = runYear(commands, tailorAfterLodge);
  const { sim } = run;
  console.log(`## ${title}`);
  for (const line of why) console.log(`- ${line}`);
  console.log('');
  console.log(`finished: ${[...run.finished.values()].join(', ')}`);
  console.log(`hunters at the lodge at the year's end: ${workersAt(sim, Job.Hunter).join(' and ') || 'none'}; every settler that held a place there: ${[...run.hunters].join(', ')}`);
  console.log('');
  console.log('Pieces made and put on, in order:');
  for (const line of run.events) console.log(`- ${line}`);
  console.log('');
  console.log("Hides left by kills, pieces made, pieces put on, pieces in the tailor's hut, and the living settlers that wear clothing, at each season's end.");
  console.log('| When | Hides | Made | Put on | In the hut | Clothed | Who |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.seasons) console.log(line);
  console.log('');
  console.log('Food in barns and at the camp, picked, kills, meals eaten and missed, and settlers living.');
  console.log('| When | Season | Barn | Camp | Picked | Kills | Meals | Missed | Living |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.food) console.log(line);
  console.log('');
  console.log("Firewood at the camp at each winter dusk, before the camp's fire takes its 4, and the living settlers that wear clothing then.");
  console.log('| Dusk | Camp firewood | Clothed |');
  console.log('| --- | --- | --- |');
  for (const line of run.dusks) console.log(line);
  console.log('');
  console.log('Each winter night, as it was judged: warm or cold, where the settler slept, and what it wore.');
  console.log('| Settler | Night of day 10 | Night of day 11 | Night of day 12 |');
  console.log('| --- | --- | --- | --- |');
  for (let id = 0; id < SETTLERS.villagers; id++) console.log(`| ${nameOfId(sim, id)} | ${[0, 1, 2].map((night) => run.nights[id]![night] ?? '').join(' | ')} |`);
  console.log('');
  console.log(`died: ${run.died.join('; ') || 'nobody'}`);
  const { tally } = sim;
  console.log(
    `tally: kills ${tally.kills}, hides ${tally.hides}, pieces put on ${tally.dressed}, meals ${tally.meals} eaten and ${tally.missed} missed, ` +
      `cold nights ${tally.coldNights}, froze ${tally.froze}, starved ${tally.starved}, fires ${tally.fires}, firewood to the camp ${tally.firewoodToCamp}`,
  );
  console.log('');
}

const RUNS: Readonly<Record<string, () => void>> = {
  'first-tick': () => report("clothing worn: #30's hut, barn, and lodge, a stockpile, a woodshed, and a tailor's hut, no house, all at the first tick", false),
  'after-lodge': () => report("clothing worn, with the tailor's hut placed when the lodge is finished", true),
};
const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(RUNS);
for (const name of names) {
  const run = RUNS[name];
  if (!run) throw new Error(`no run named ${name}; the runs are ${Object.keys(RUNS).join(', ')}`);
  run();
}
