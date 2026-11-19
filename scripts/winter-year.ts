// The first year on seed 7 with warmth, for each set of commands: `bun scripts/winter-year.ts [run ...]`.
// With no run named it prints 4.5's three years, wood, hides, and nothing. The runs two-houses (4.2's year) and
// clothing-at-start and clothing-after-lodge (4.4's two years) print the earlier years of the stage the same way.
import { BUILDINGS, Building } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, tickOfDay } from '../src/sim/calendar';
import { isColdNight, isDawn, isNight } from '../src/sim/daylight';
import {
  FIRST_YEAR_HOUSES,
  HIDES_LAYOUT,
  WOOD_LAYOUT,
  NOTHING_FOR_WARMTH,
  type WinterYear,
  playWinterYear,
  winterYearCommands,
} from '../src/sim/firstYear';
import { LOGS_PER_TREE } from '../src/sim/gathering';
import { Good } from '../src/sim/goods';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState } from '../src/sim/orders';
import { readinessOf } from '../src/sim/readiness';
import type { Command, Sim } from '../src/sim/sim';
import { STOCKING } from '../src/sim/stocking';
import { CAMP_STORE, StoreKind, storeKind } from '../src/sim/stores';
import { TASK_KINDS } from '../src/sim/tasks';
import { VillagerState } from '../src/sim/villagerState';

const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
const SEASON_ENDS = [3, 6, 9, 12];
const NOON_DAYS = [7, 8, 9, 10, 11, 12];
const WINTER_DAYS = [10, 11, 12];

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);
const at = (x: number, y: number) => `(${x}, ${y})`;
const buildingName = (sim: Sim, slot: number) => `${BUILDINGS[sim.orders.sites.kind[slot] as Building].name} ${slot}`;

const goodIn = (sim: Sim, good: Good, kind: StoreKind) => {
  let units = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) units += sim.stores.held[good - 1]![slot]!;
  return units;
};
const atCamp = (sim: Sim, good: Good) => sim.stores.held[good - 1]![CAMP_STORE]!;

function describe(commands: readonly Command[]): string[] {
  const lines: string[] = [];
  const chops: string[] = [];
  const quarries: string[] = [];
  for (const command of commands) {
    if (command.kind === 'place') lines.push(`place ${BUILDINGS[command.building].name} on ${at(command.x, command.y)}`);
    else if (command.kind === 'markArea' && command.order === 'chop') chops.push(at(command.area.x0, command.area.y0));
    else if (command.kind === 'markArea' && command.order === 'quarry') quarries.push(at(command.area.x0, command.area.y0));
    else if (command.kind === 'markArea') lines.push(`${command.order} on ${at(command.area.x0, command.area.y0)} to ${at(command.area.x1, command.area.y1)}`);
  }
  if (chops.length > 0) lines.push(`chop ${chops.length} trees, ${chops.length * LOGS_PER_TREE} logs: ${chops.join(', ')}`);
  if (quarries.length > 0) lines.push(`quarry ${quarries.length} rock tiles: ${quarries.join(', ')}`);
  return lines;
}

/** What one villager's winter night was, as the simulation judged it. */
interface Night {
  readonly cold: boolean;
  readonly why: string;
}

function runYear(year: WinterYear) {
  const { sim, lodge, step } = playWinterYear(year);
  const count = sim.villagers.state.length;
  const given: { tick: number; commands: readonly Command[] }[] = [{ tick: 0, commands: year.atStart }];
  const finished: string[] = [];
  const builtAt = new Map<number, number>();
  const hires: string[] = [];
  const readings: string[] = [];
  const food: string[] = [];
  const warmth: string[] = [];
  const nights = Array.from({ length: count }, () => new Map<number, Night>());
  const coldBy = new Map<number, { noon: number; beforeDusk: number }>();
  const died: string[] = [];
  const fires: string[] = [];
  const clothing: string[] = [];
  const seasons: string[] = [];
  const atWinter = Array.from({ length: count }, () => ({ home: '', job: '' }));
  const stockingTicks = new Float64Array(count);
  const firewoodHome = new Uint16Array(count);
  let made = 0;
  let mealsDue = 0;
  const readingRow = (when: string) => {
    const r = readinessOf(sim);
    if (r === null) return;
    const camp = r.camp === null ? 'no household there' : `${r.camp.firewood} firewood, burns ${r.camp.burns}, ${r.camp.lights ? 'lights' : 'does not light'}`;
    readings.push(`| ${when} | ${r.nights} | ${r.housed} of ${r.households} | ${r.stocked} of ${r.houses} | ${r.clothed} of ${r.settlers} | ${r.cold} | ${camp} |`);
  };
  const clothedNow = () => {
    let clothed = 0;
    for (let id = 0; id < count; id++) if (sim.villagers.state[id] !== VillagerState.Dead && sim.villagers.worn[id] === Good.Clothing) clothed += 1;
    return clothed;
  };
  const storesRow = (when: string) => {
    const { tally } = sim;
    food.push(
      `| ${when} | ${goodIn(sim, Good.Food, StoreKind.Common)} | ${atCamp(sim, Good.Food)} | ${goodIn(sim, Good.Food, StoreKind.Home)} | ` +
        `${tally.foraged} | ${tally.kills} | ${tally.meals} | ${tally.missed} | ${sim.living} |`,
    );
    warmth.push(
      `| ${when} | ${goodIn(sim, Good.Firewood, StoreKind.Workshop)} | ${atCamp(sim, Good.Firewood)} | ${goodIn(sim, Good.Firewood, StoreKind.Home)} | ` +
        `${splitsOf(sim).splits} | ${tally.burnt} | ${clothedNow()} |`,
    );
  };
  const piecesNow = () => sim.tally.dressed + goodIn(sim, Good.Clothing, StoreKind.Workshop);
  const seasonRow = (day: number) => {
    const names: string[] = [];
    for (let id = 0; id < count; id++) if (sim.villagers.state[id] !== VillagerState.Dead && sim.villagers.worn[id] === Good.Clothing) names.push(nameOfId(sim, id));
    seasons.push(
      `| end of day ${day} | ${sim.tally.hides} | ${made} | ${sim.tally.dressed} | ${goodIn(sim, Good.Clothing, StoreKind.Workshop)} | ${names.length} of ${sim.living} | ${names.join(', ') || 'nobody'} |`,
    );
  };
  const firesRow = (day: number) => {
    const lit: string[] = [];
    const left: string[] = [];
    for (let store = 0; store <= CAMP_STORE; store++) if (sim.stores.burning[store] === 1) lit.push(store === CAMP_STORE ? 'the camp' : `house ${store}`);
    for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === StoreKind.Home) left.push(`house ${slot} ${sim.stores.held[Good.Firewood - 1]![slot]}`);
    fires.push(`| night of day ${day} | ${lit.join(', ') || 'none'} | ${left.join(', ') || 'no house'} | ${atCamp(sim, Good.Firewood)} |`);
  };
  let barnAtYearEnd = 0;
  // The year runs to the dawn after its last night, so a villager that never got home that night is judged too.
  while (!sim.over && !(isDawn(sim.tick - 1) && dateAt(sim.tick - 1).day > DAYS_PER_YEAR)) {
    const { day } = dateAt(sim.tick);
    if (tickOfDay(sim.tick) === 0 && SEASON_ENDS.includes(day - 1)) {
      storesRow(`end of day ${day - 1}`);
      seasonRow(day - 1);
    }
    if (tickOfDay(sim.tick) === TICKS_PER_DAY - 1 && WINTER_DAYS.includes(day)) firesRow(day);
    if (tickOfDay(sim.tick) === 0 && day - 1 === DAYS_PER_YEAR) barnAtYearEnd = goodIn(sim, Good.Food, StoreKind.Common);
    if (tickOfDay(sim.tick) === TICKS_PER_DAY / 2 && NOON_DAYS.includes(day)) {
      readingRow(`day ${day} 12:00`);
      if (WINTER_DAYS.includes(day)) coldBy.set(day, { noon: readinessOf(sim)!.cold, beforeDusk: -1 });
    }
    if (isDusk(sim.tick + 1) && WINTER_DAYS.includes(day)) coldBy.get(day)!.beforeDusk = readinessOf(sim)!.cold;
    if (isDusk(sim.tick) && WINTER_DAYS.includes(day)) storesRow(`dusk of day ${day}`);
    if (isDusk(sim.tick) && day === WINTER_DAYS[0]) {
      for (let id = 0; id < count; id++) {
        const home = sim.households.home[sim.villagers.household[id]!]!;
        const place = sim.villagers.workplace[id]!;
        atWinter[id] = { home: home < 0 ? 'camp' : `house ${home}`, job: place < 0 ? 'none' : buildingName(sim, place) };
      }
    }
    if (isDusk(sim.tick)) mealsDue += sim.living;
    const before = Uint8Array.from(sim.villagers.state);
    const coldBefore = Uint8Array.from(sim.villagers.coldNights);
    const workplace = Int16Array.from(sim.villagers.workplace);
    const carried = Uint8Array.from(sim.villagers.carried);
    const toStore = Int16Array.from(sim.villagers.toStore);
    const homeFirewood = sim.tally.firewoodHome;
    const pieces = piecesNow();
    const worn = Uint8Array.from(sim.villagers.worn);
    for (let id = 0; id < count; id++) if (sim.villagers.task[id] === STOCK && sim.villagers.stockGood[id] === Good.Firewood) stockingTicks[id]! += 1;
    const ticked = sim.tick;
    const pending = sim.orders.sites.state[lodge] !== SiteState.Built;
    step();
    if (pending && sim.orders.sites.state[lodge] === SiteState.Built && year.afterLodge.length > 0) given.push({ tick: ticked, commands: year.afterLodge });
    if (piecesNow() > pieces) {
      made += piecesNow() - pieces;
      clothing.push(`${clock(ticked)} piece ${made} made`);
    }
    if (sim.tally.firewoodHome > homeFirewood) {
      for (let id = 0; id < count; id++) {
        if (carried[id] === Good.Firewood && sim.villagers.carried[id] === Good.None && toStore[id]! >= 0 && toStore[id] !== CAMP_STORE) firewoodHome[id]! += 1;
      }
    }
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] !== SiteState.Built || builtAt.has(slot)) continue;
      builtAt.set(slot, ticked);
      finished.push(`${buildingName(sim, slot)} ${clock(ticked)}`);
    }
    for (let id = 0; id < count; id++) {
      const place = sim.villagers.workplace[id]!;
      if (place >= 0 && place !== workplace[id]) hires.push(`${clock(ticked)} ${nameOfId(sim, id)} takes a place at ${buildingName(sim, place)}`);
      if (place < 0 && workplace[id]! >= 0) hires.push(`${clock(ticked)} ${nameOfId(sim, id)} leaves ${buildingName(sim, workplace[id]!)}`);
      if (worn[id] !== sim.villagers.worn[id]) clothing.push(`${clock(ticked)} ${nameOfId(sim, id)} puts on a piece`);
      const now = sim.villagers.state[id]!;
      if (before[id] !== VillagerState.Dead && now === VillagerState.Dead) {
        died.push(`${nameOfId(sim, id)} ${sim.villagers.coldNights[id]! >= 3 ? 'froze' : 'starved'} ${clock(ticked)}`);
      }
      if (!isColdNight(ticked) || before[id] === VillagerState.Dead) continue;
      const home = before[id] === VillagerState.GoingIn && (now === VillagerState.Inside || now === VillagerState.Dead);
      const camp = before[id] === VillagerState.GoingToCamp && (now === VillagerState.Settling || now === VillagerState.Dead);
      const away = isDawn(ticked) && before[id] !== VillagerState.Settling && before[id] !== VillagerState.Inside;
      if (!home && !camp && !away) continue;
      const night = dateAt(ticked).day - Number(tickOfDay(ticked) < TICKS_PER_DAY / 2);
      const cold = sim.villagers.coldNights[id]! > coldBefore[id]!;
      const store = home ? sim.households.home[sim.villagers.household[id]!]! : CAMP_STORE;
      const clothed = sim.villagers.worn[id] === Good.Clothing ? 'clothed' : 'no clothing';
      const where = away ? 'never got home' : `${home ? 'house' : 'camp'}, ${sim.stores.burning[store] === 1 ? 'fire' : 'no fire'}`;
      const starved = now === VillagerState.Dead && !cold;
      nights[id]!.set(night, { cold, why: starved ? 'starved before its night' : `${cold ? 'cold' : 'warm'} (${where}, ${clothed})${now === VillagerState.Dead ? ', froze' : ''}` });
    }
  }
  if (sim.over) {
    barnAtYearEnd = goodIn(sim, Good.Food, StoreKind.Common);
    storesRow(`died out ${clock(sim.tick - 1)}`);
    seasonRow(dateAt(sim.tick - 1).day);
  }
  return { sim, given, finished, hires, readings, food, warmth, nights, coldBy, died, fires, clothing, seasons, atWinter, stockingTicks, firewoodHome, mealsDue, barnAtYearEnd };
}

/** The logs split and the pieces of clothing made so far. Each batch is one or the other, so the units made and the batches give how many of each. */
function splitsOf({ tally }: Sim) {
  const split = BUILDINGS[Building.Woodshed].recipe!;
  const sew = BUILDINGS[Building.Tailor].recipe!;
  const splits = (tally.made - sew.outputs * tally.batches) / (split.outputs - sew.outputs);
  return { splits, firewood: splits * split.outputs, pieces: tally.batches - splits };
}

/** The logs and stone the year took, and where every unit is at its end. */
function materials(sim: Sim) {
  const { map, orders, villagers, workshops } = sim;
  const { splits, firewood, pieces } = splitsOf(sim);
  const into = { [Good.Log]: 0, [Good.Stone]: 0 } as Record<Good.Log | Good.Stone, number>;
  const onSites = { [Good.Log]: 0, [Good.Stone]: 0 } as Record<Good.Log | Good.Stone, number>;
  const loose = { [Good.Log]: 0, [Good.Stone]: 0 } as Record<Good.Log | Good.Stone, number>;
  for (let slot = 0; slot < orders.sites.used; slot++) {
    if (orders.sites.state[slot] !== SiteState.Built) continue;
    const needs = BUILDINGS[orders.sites.kind[slot] as Building].needs;
    into[Good.Log] += needs[Good.Log] ?? 0;
    into[Good.Stone] += needs[Good.Stone] ?? 0;
  }
  for (let t = 0; t < map.size * map.size; t++) {
    const good = map.stackGood[t];
    if (map.stackSize[t] === 0 || (good !== Good.Log && good !== Good.Stone)) continue;
    const slot = orders.siteOf[t]!;
    (slot >= 0 && orders.sites.state[slot] === SiteState.Site ? onSites : loose)[good] += map.stackSize[t]!;
  }
  let carriedLogs = 0;
  let carriedStone = 0;
  for (let id = 0; id < villagers.state.length; id++) {
    if (villagers.carried[id] === Good.Log) carriedLogs += 1;
    if (villagers.carried[id] === Good.Stone) carriedStone += 1;
  }
  let inSheds = 0;
  for (let slot = 0; slot < orders.sites.used; slot++) if (orders.sites.kind[slot] === Building.Woodshed) inSheds += workshops.input[slot]!;
  return { splits, firewood, pieces, into, onSites, loose, carriedLogs, carriedStone, inSheds };
}

function report(title: string, year: WinterYear, why: readonly string[]) {
  const run = runYear(year);
  const { sim } = run;
  const { tally } = sim;
  console.log(`## ${title}`);
  for (const line of why) console.log(`- ${line}`);
  console.log('');
  console.log('Commands, with the time each is given:');
  for (const { tick, commands } of run.given) for (const line of describe(commands)) console.log(`- ${clock(tick)}: ${line}`);
  console.log('');
  console.log(`finished: ${run.finished.join(', ')}`);
  console.log('');
  console.log('Places at workplaces, in the order they were taken:');
  for (const line of run.hires) console.log(`- ${line}`);
  console.log('');
  console.log("The reading of how ready the settlement is for winter, at noon: cold nights still to come, households with a house, houses holding firewood for each of those nights, settlers in clothing, settlers who would be cold tonight, and the camp's fire.");
  console.log('| When | Nights to come | Housed | Stocked | Clothed | Cold | Camp fire |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.readings) console.log(line);
  console.log('');
  console.log('Food in barns, at the camp, and in homes, and since the start the units picked, the kills, the meals eaten and missed; settlers living. A row at a dusk is read before its meals.');
  console.log('| When | Barn | Camp | Homes | Picked | Kills | Meals | Missed | Living |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.food) console.log(line);
  console.log('');
  console.log('Firewood in woodsheds, at the camp, and in homes, and since the start the logs split and the firewood burnt; living settlers in clothing. Read as the food is.');
  console.log('| When | Shed firewood | Camp firewood | Home firewood | Split | Burnt | Clothed |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.warmth) console.log(line);
  console.log('');
  console.log("Hides left by kills, pieces made, pieces put on, pieces in tailor's huts, and the living settlers in clothing, at each season's end.");
  console.log('| When | Hides | Made | Put on | In the huts | Clothed | Who |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const line of run.seasons) console.log(line);
  console.log('');
  if (run.clothing.length > 0) {
    console.log('Pieces made and put on, in order:');
    for (const line of run.clothing) console.log(`- ${line}`);
    console.log('');
  }
  console.log('Fires that burn on each winter night, read at its last tick before midnight, and the firewood left then in each house and at the camp.');
  console.log('| Night | Fires | Firewood in houses | Firewood at the camp |');
  console.log('| --- | --- | --- | --- |');
  for (const line of run.fires) console.log(line);
  console.log('');
  console.log('Each winter night, as the simulation judged it: warm or cold, where the settler slept, whether a fire burned there, and whether it wore clothing.');
  console.log(`| Settler | Household | Home at the first winter dusk | Job then | ${WINTER_DAYS.map((day) => `Night of day ${day}`).join(' | ')} |`);
  console.log(`| --- | --- | --- | --- | ${WINTER_DAYS.map(() => '---').join(' | ')} |`);
  for (let id = 0; id < sim.villagers.state.length; id++) {
    const { home, job } = run.atWinter[id]!;
    console.log(
      `| ${nameOfId(sim, id)} | ${sim.villagers.household[id]} | ${home} | ${job} | ${WINTER_DAYS.map((day) => run.nights[id]!.get(day)?.why ?? '').join(' | ')} |`,
    );
  }
  console.log('');
  console.log('Settlers the reading counts cold at noon and at the last tick before the night, beside the settlers that had a cold night that night.');
  console.log('| Day | Cold at noon | Cold at the last tick before the night | Cold nights that night |');
  console.log('| --- | --- | --- | --- |');
  for (const day of WINTER_DAYS) {
    const by = run.coldBy.get(day);
    const judged = run.nights.filter((nights) => nights.get(day)?.cold === true).length;
    console.log(`| ${day} | ${by?.noon ?? ''} | ${by?.beforeDusk ?? ''} | ${by === undefined ? '' : judged} |`);
  }
  console.log('');
  console.log(`died: ${run.died.join('; ') || 'nobody'}; cold nights ${tally.coldNights}, starved ${tally.starved}, froze ${tally.froze}, living ${sim.living} of ${sim.villagers.state.length}`);
  console.log(`meals: ${tally.meals} eaten of ${run.mealsDue} due (a meal for each living settler at each dusk), ${tally.missed} missed`);
  console.log(`food: picked ${tally.foraged}, kills ${tally.kills}, barn at the year's end ${run.barnAtYearEnd}`);
  const m = materials(sim);
  console.log(
    `firewood: ${m.splits} logs split into ${m.firewood} firewood, ${tally.fires} fires burnt ${tally.burnt}, ` +
      `carried home ${tally.firewoodHome}, carried to the camp ${tally.firewoodToCamp}`,
  );
  const walkers: string[] = [];
  let walked = 0;
  for (let id = 0; id < run.stockingTicks.length; id++) {
    walked += run.stockingTicks[id]!;
    if (run.stockingTicks[id]! > 0) walkers.push(`${nameOfId(sim, id)} ${((run.stockingTicks[id]! / TICKS_PER_DAY) * 24).toFixed(1)} h, ${run.firewoodHome[id]} units home`);
  }
  console.log(`walks for firewood, as ticks holding a task to stock firewood: ${walked} ticks, ${((walked / TICKS_PER_DAY) * 24).toFixed(1)} game hours in all${walkers.length > 0 ? `; ${walkers.join('; ')}` : ''}`);
  console.log(`clothing: hides ${tally.hides}, pieces made ${m.pieces} from ${m.pieces * 2} hides, pieces put on ${tally.dressed}`);
  console.log(
    `logs: felled ${tally.felled} trees, ${tally.felled * LOGS_PER_TREE} logs; ${m.into[Good.Log]} in finished buildings, ${m.onSites[Good.Log]} on unfinished sites, ` +
      `${m.splits} split, ${m.inSheds} in woodsheds to split, ${m.loose[Good.Log]} on the ground and stockpiles, ${m.carriedLogs} carried`,
  );
  console.log(
    `stone: quarried ${tally.quarried}; ${m.into[Good.Stone]} in finished buildings, ${m.onSites[Good.Stone]} on unfinished sites, ` +
      `${m.loose[Good.Stone]} on the ground and stockpiles, ${m.carriedStone} carried`,
  );
  console.log('');
}

const thirty = "#30's commands: the hut on (136, 127), the barn on (139, 127), the lodge on (124, 129), and their chop and quarry orders";
const houses = (n: number) =>
  n === 0 ? 'no house' : `houses on ${FIRST_YEAR_HOUSES.slice(0, n).map(([x, y]) => at(x, y)).join(', ')}, the first ${n} of the first year's four`;
const wood = "4.2's woodshed on (126, 123) and stockpile on (130, 126) to (132, 128), east of the camp";
const hides = "4.4's stockpile on (122, 126) to (124, 128), tailor's hut on (126, 123), and woodshed on (124, 124), west of the camp";

const RUNS: Readonly<Record<string, () => void>> = {
  wood: () => report('wood: a house for each household and a woodshed', winterYearCommands({ houses: 4, layout: WOOD_LAYOUT, tailor: 'at start' }), [thirty, houses(4), wood, 'every command at the first tick']),
  hides: () =>
    report("wood and hides: two houses, a woodshed, and a tailor's hut", winterYearCommands({ houses: 2, layout: HIDES_LAYOUT, tailor: 'after lodge' }), [
      thirty,
      houses(2),
      hides,
      "every command at the first tick but the tailor's hut, which is placed on the tick the lodge is finished, so the lodge hires its hunters first",
    ]),
  nothing: () => report("nothing for warmth: #30's hut, barn, and lodge", NOTHING_FOR_WARMTH, [thirty, 'every command at the first tick']),
  'two-houses': () => report("4.2's year: two houses and a woodshed", winterYearCommands({ houses: 2, layout: WOOD_LAYOUT, tailor: 'at start' }), [thirty, houses(2), wood, 'every command at the first tick']),
  'clothing-at-start': () =>
    report("4.4's year: a woodshed and a tailor's hut, no house, all at the first tick", winterYearCommands({ houses: 0, layout: HIDES_LAYOUT, tailor: 'at start' }), [thirty, houses(0), hides, 'every command at the first tick']),
  'clothing-after-lodge': () =>
    report("4.4's year: a woodshed and a tailor's hut, no house, with the tailor's hut placed when the lodge is finished", winterYearCommands({ houses: 0, layout: HIDES_LAYOUT, tailor: 'after lodge' }), [
      thirty,
      houses(0),
      hides,
      "every command at the first tick but the tailor's hut, which is placed on the tick the lodge is finished",
    ]),
};
const names = process.argv.length > 2 ? process.argv.slice(2) : ['wood', 'hides', 'nothing'];
for (const name of names) {
  const run = RUNS[name];
  if (!run) throw new Error(`no run named ${name}; the runs are ${Object.keys(RUNS).join(', ')}`);
  run();
}
