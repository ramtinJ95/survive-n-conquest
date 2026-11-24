// Years of `src/sim` that look for a first winter on seed 7 that all 8 settlers live through, with orders a player
// gives through the toolbar: `bun scripts/firewood-years.ts [year ...] [--seed n] [--json] [--distances] [--page]`.
// With no year named it prints every year. Each order fires at a game time or on an event a player sees, and the row
// gives the time it fired. `--distances` adds each house's distance to the camp and to its trees, and `--page` prints
// instead the readings the `firewood-year` scenario of the verification skill reads in the page.
import { arrived } from '../src/sim/building';
import { BUILDINGS, Building, footprintStart } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, tickOfDay } from '../src/sim/calendar';
import { isDawn, isNight } from '../src/sim/daylight';
import { FIRST_YEAR_HOUSES, WOOD_LAYOUT, huntYearCommands } from '../src/sim/firstYear';
import { Good } from '../src/sim/goods';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { Claim, SiteState, type TileArea, openGround, siteRefusal } from '../src/sim/orders';
import { type Command, SETTLERS, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE, StoreKind, storeKind } from '../src/sim/stores';
import { STOCKING } from '../src/sim/stocking';
import { TASK_KINDS } from '../src/sim/tasks';
import { VILLAGER_ROWS, VillagerState } from '../src/sim/villagerState';
import { jobCounts, storeTotals } from '../src/ui/stockpiles';
import { readinessOf } from '../src/sim/readiness';

/** When an order is given: at a game time, or on the first tick a condition a player can see holds. */
export interface When {
  readonly label: string;
  readonly ready: (sim: Sim) => boolean;
}

/** One order a player gives, as one or more commands resolved against the simulation at the tick it fires. */
export interface Order {
  readonly when: When;
  readonly label: string;
  readonly give: (sim: Sim) => Command[];
}

export interface Year {
  readonly title: string;
  readonly orders: readonly Order[];
}

const OPENING_TICK = TICKS_PER_DAY / 3;
/** The first tick of a game minute, `day` from 1 and `time` as "hh:mm", the tick at which the verification skill's `reach` stops. */
export function tickAt(day: number, time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return (day - 1) * TICKS_PER_DAY + Math.ceil(((h * 60 + m) * TICKS_PER_DAY) / 1440) - OPENING_TICK;
}
export const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `d${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};

const tileOf = (sim: Sim, x: number, y: number) => y * sim.map.size + x;
const slotAt = (sim: Sim, x: number, y: number) => sim.orders.siteOf[tileOf(sim, x, y)]!;
const isBuilt = (sim: Sim, x: number, y: number) => {
  const slot = slotAt(sim, x, y);
  return slot >= 0 && sim.orders.sites.state[slot] === SiteState.Built;
};

export const at = (day: number, time: string): When => {
  const tick = tickAt(day, time);
  return { label: clock(tick), ready: (sim) => sim.tick >= tick };
};
export const whenBuilt = (name: string, x: number, y: number): When => ({ label: `when the ${name} on (${x}, ${y}) stands`, ready: (sim) => isBuilt(sim, x, y) });
/** Firewood split since the start, from the batches workshops finished: each batch is a split or a piece of clothing. */
export function firewoodSplit({ tally }: Sim): number {
  const split = BUILDINGS[Building.Woodshed].recipe!;
  const sew = BUILDINGS[Building.Tailor].recipe!;
  return ((tally.made - sew.outputs * tally.batches) / (split.outputs - sew.outputs)) * split.outputs;
}
export const whenSplit = (firewood: number): When => ({ label: `when ${firewood} firewood is split`, ready: (sim) => firewoodSplit(sim) >= firewood });
/** Every site that needs logs holds all of them, which a player reads in each site's panel. */
export const whenNoSiteLacksLogs: When = {
  label: 'when no site lacks a log',
  ready: (sim) => {
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] !== SiteState.Site) continue;
      if (arrived(sim.map, sim.orders, slot, Good.Log) < (BUILDINGS[sites.kind[slot] as Building].needs[Good.Log] ?? 0)) return false;
    }
    return true;
  },
};
/** Every building that needs logs stands. */
export const whenSitesStand: When = {
  label: 'when every site that needs logs stands',
  ready: (sim) => {
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) if (sites.state[slot] === SiteState.Site && (BUILDINGS[sites.kind[slot] as Building].needs[Good.Log] ?? 0) > 0) return false;
    return true;
  },
};

const tile = (x: number, y: number): TileArea => ({ x0: x, y0: y, x1: x, y1: y });

/** The `n` standing trees nearest the camp center with no chop order on them, nearest first, then the lowest tile: the rule "the nearest trees". */
export function nearestTrees(sim: Sim, n: number): [number, number][] {
  const { map, orders, flow } = sim;
  const { size } = map;
  const cx = (flow.goal % size) + 0.5;
  const cy = Math.floor(flow.goal / size) + 0.5;
  const trees: { t: number; d: number }[] = [];
  for (let t = 0; t < size * size; t++) {
    if (map.trees[t] !== 1 || orders.claims[t] === Claim.Chop || flow.next[t] === -1) continue;
    const dx = (t % size) + 0.5 - cx;
    const dy = Math.floor(t / size) + 0.5 - cy;
    trees.push({ t, d: dx * dx + dy * dy });
  }
  trees.sort((a, b) => a.d - b.d || a.t - b.t);
  return trees.slice(0, n).map(({ t }) => [t % size, Math.floor(t / size)]);
}

const campCenter = (sim: Sim) => [(sim.flow.goal % sim.map.size) + 0.5, Math.floor(sim.flow.goal / sim.map.size) + 0.5] as const;

/** The anchor the rules accept whose footprint's middle lies nearest the camp center, then the lowest tile, at least `gap` tiles clear of every claimed tile: the rule "the nearest place". */
export function nearestAnchor(sim: Sim, building: Building, to: readonly [number, number] = campCenter(sim), gap = 1): [number, number] {
  const { map, orders } = sim;
  const { size } = map;
  const { side } = BUILDINGS[building];
  const [cx, cy] = to;
  let best: [number, number] | null = null;
  let bestDistance = Infinity;
  for (let y = Math.max(Math.floor(cy) - 40, 1); y < Math.min(Math.floor(cy) + 40, size - 1); y++) {
    for (let x = Math.max(Math.floor(cx) - 40, 1); x < Math.min(Math.floor(cx) + 40, size - 1); x++) {
      const x0 = footprintStart(x, side);
      const y0 = footprintStart(y, side);
      const distance = (x0 + side / 2 - cx) ** 2 + (y0 + side / 2 - cy) ** 2;
      if (distance >= bestDistance || !clear(sim, x0 - gap, y0 - gap, x0 + side - 1 + gap, y0 + side - 1 + gap) || siteRefusal(map, orders, building, x, y) !== null) continue;
      best = [x, y];
      bestDistance = distance;
    }
  }
  if (!best) throw new Error(`no place for a ${BUILDINGS[building].name}`);
  return best;
}
function clear(sim: Sim, x0: number, y0: number, x1: number, y1: number): boolean {
  const { size } = sim.map;
  for (let y = Math.max(y0, 0); y <= Math.min(y1, size - 1); y++) for (let x = Math.max(x0, 0); x <= Math.min(x1, size - 1); x++) if (sim.orders.claims[y * size + x] !== Claim.None || sim.flow.goal === y * size + x) return false;
  return true;
}
/** The 3 by 3 square of open, unclaimed ground nearest the camp center, as `nearestAnchor` measures. */
export function nearestStockpile(sim: Sim): TileArea {
  const { map } = sim;
  const { size } = map;
  const [cx, cy] = campCenter(sim);
  let best: TileArea | null = null;
  let bestDistance = Infinity;
  for (let y = Math.max(Math.floor(cy) - 40, 1); y < Math.min(Math.floor(cy) + 40, size - 3); y++) {
    for (let x = Math.max(Math.floor(cx) - 40, 1); x < Math.min(Math.floor(cx) + 40, size - 3); x++) {
      const distance = (x + 1.5 - cx) ** 2 + (y + 1.5 - cy) ** 2;
      if (distance >= bestDistance || !clear(sim, x - 1, y - 1, x + 3, y + 3)) continue;
      let open = true;
      for (let t = 0; t < 9 && open; t++) open = openGround(map, (y + Math.floor(t / 3)) * size + x + (t % 3));
      if (!open) continue;
      best = { x0: x, y0: y, x1: x + 2, y1: y + 2 };
      bestDistance = distance;
    }
  }
  if (!best) throw new Error('no place for a stockpile');
  return best;
}
export const placeNearest = (building: Building, to?: (sim: Sim) => readonly [number, number]) => (sim: Sim): Command[] => {
  const [x, y] = nearestAnchor(sim, building, to ? to(sim) : campCenter(sim));
  return [{ kind: 'place', building, x, y }];
};
export const stockpileNearest = (sim: Sim): Command[] => [{ kind: 'markArea', order: 'stockpile', area: nearestStockpile(sim) }];
/** The `n` rock tiles nearest the camp center with no quarry order on them. */
export function nearestRocks(sim: Sim, n: number): [number, number][] {
  const { map, orders } = sim;
  const { size } = map;
  const [cx, cy] = campCenter(sim);
  const rocks: { t: number; d: number }[] = [];
  for (let t = 0; t < size * size; t++) {
    if (map.kinds[t] !== 3 || orders.claims[t] === Claim.Quarry) continue;
    rocks.push({ t, d: ((t % size) + 0.5 - cx) ** 2 + (Math.floor(t / size) + 0.5 - cy) ** 2 });
  }
  rocks.sort((a, b) => a.d - b.d || a.t - b.t);
  return rocks.slice(0, n).map(({ t }) => [t % size, Math.floor(t / size)]);
}
export const quarryNearest = (n: number) => (sim: Sim): Command[] => nearestRocks(sim, n).map(([x, y]) => ({ kind: 'markArea', order: 'quarry', area: tile(x, y) }));
export const place = (building: Building, x: number, y: number): Command => ({ kind: 'place', building, x, y });
export const chopNearest = (n: number) => (sim: Sim): Command[] => nearestTrees(sim, n).map(([x, y]) => ({ kind: 'markArea', order: 'chop', area: tile(x, y) }));
export const quarry = (rocks: readonly (readonly [number, number])[]) => (): Command[] => rocks.map(([x, y]) => ({ kind: 'markArea', order: 'quarry', area: tile(x, y) }));
export const setPlaces = (x: number, y: number, places: number) => (sim: Sim): Command[] => [{ kind: 'setPlaces', slot: slotAt(sim, x, y), places }];

/** Everything one year's row reports. */
export interface Row {
  readonly year: string;
  readonly seed: number;
  readonly given: string[];
  /** Every command given, with its tick, so the page can give the same at the same minute. */
  readonly commands: { tick: number; label: string; commands: Command[] }[];
  readonly built: string[];
  readonly housesByDay10: number;
  /** Firewood split by the end of spring, summer, autumn, and winter. */
  readonly splitBySeason: number[];
  /** At each cold dusk, before any fire lights: the firewood in each house, in the order the houses stood, and at the camp. */
  readonly dusks: { readonly day: number; readonly houses: number[]; readonly camp: number }[];
  /** Firewood carried into each house from the first tick of winter, midnight before day 10, to the last cold dusk, in the order the houses stood. */
  readonly winterArrivals: number[];
  /** The winter nights on which each house's fire burned, in the order the houses stood. */
  readonly fires: number[];
  /** Game minutes a settler held a task to carry firewood home, for each unit carried home over the year. */
  readonly minutesPerUnitHome: number;
  readonly unitsHome: number;
  readonly clothedAtDay10: number;
  readonly coldNights: string[];
  readonly died: string[];
  readonly meals: number;
  readonly mealsDue: number;
  readonly missed: number;
  readonly barnAtEnd: number;
  readonly living: number;
  /** Children born in the year. */
  readonly born: number;
  readonly felledByAutumn: number;
  readonly felled: number;
  readonly woodcutterIdle: string;
  /** Daylight ticks of the finished woodsheds by what the panel's `Doing` row reads. */
  readonly shedDoing: Record<string, number>;
}

const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);
const goodIn = (sim: Sim, good: Good, kind: StoreKind) => {
  let units = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) units += sim.stores.held[good - 1]![slot]!;
  return units;
};
/** The woodshed panel's `Doing` for each reason in `workshops.stopped`, as `src/ui/selection.ts` words it. */
const STOP_WORDS = ['Working or looking for a log', 'Idle, the woodshed is full', 'Idle, no log in a stockpile within 30 tiles of the woodshed', 'Idle, the building sites need the logs', 'Idle, no log carried to a stockpile yet'];
const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
const MINUTES_PER_TICK = 1440 / TICKS_PER_DAY;

/** The commands of one order, as a player would name them. */
function describe(commands: readonly Command[]): string {
  const parts: string[] = [];
  let chops = 0;
  let quarries = 0;
  for (const c of commands) {
    if (c.kind === 'place') parts.push(`${BUILDINGS[c.building].name} on (${c.x}, ${c.y})`);
    else if (c.kind === 'markArea' && c.order === 'chop') chops += 1;
    else if (c.kind === 'markArea' && c.order === 'quarry') quarries += 1;
    else if (c.kind === 'markArea') parts.push(`${c.order} (${c.area.x0}, ${c.area.y0}) to (${c.area.x1}, ${c.area.y1})`);
    else if (c.kind === 'setPlaces') parts.push(`places ${c.places}`);
  }
  if (chops > 0) parts.push(`chop ${chops} trees`);
  if (quarries > 0) parts.push(`quarry ${quarries} rock tiles`);
  return parts.join(', ');
}

/** Plays the first year on `seed`, giving each order on the first tick its `When` holds, before that tick's step, to the dawn after the last winter night. */
export function playYear(year: Year, seed = 7): { sim: Sim; row: Row } {
  const sim = createSim(generateMap(seed), SETTLERS);
  const pending = [...year.orders];
  const given: string[] = [];
  const commandLog: { tick: number; label: string; commands: Command[] }[] = [];
  const built = new Map<number, string>();
  const houses: number[] = [];
  const splitBySeason: number[] = [];
  const dusks: Row['dusks'] = [];
  const cold = Array.from({ length: VILLAGER_ROWS }, () => [] as number[]);
  const died: string[] = [];
  const arrivals = new Map<number, number>();
  const fires = new Map<number, number>();
  let housesByDay10 = 0;
  let clothedAtDay10 = 0;
  let mealsDue = 0;
  let barnAtEnd = -1;
  let felledByAutumn = 0;
  let shedTicks = 0;
  let shedWorking = 0;
  const shedDoing: Record<string, number> = {};
  let walkTicks = 0;
  let inWinter = false;
  const giveDue = () => {
    for (let i = 0; i < pending.length; ) {
      const order = pending[i]!;
      if (!order.when.ready(sim)) {
        i++;
        continue;
      }
      pending.splice(i, 1);
      const commands = order.give(sim);
      for (const command of commands) {
        const outcome = applyCommand(sim, command);
        if (outcome && !outcome.ok) throw new Error(`${year.title}: refused at ${clock(sim.tick)}: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
      }
      commandLog.push({ tick: sim.tick, label: order.label, commands });
      given.push(`${clock(sim.tick)} ${order.label}${order.when === atStart ? '' : ` (${order.when.label})`}: ${describe(commands)}`);
    }
  };
  const firewood = sim.stores.held[Good.Firewood - 1]!;
  while (!sim.over && !(isDawn(sim.tick - 1) && dateAt(sim.tick - 1).day > DAYS_PER_YEAR)) {
    giveDue();
    const { day } = dateAt(sim.tick);
    if (tickOfDay(sim.tick) === 0 && [3, 6, 9].includes(day - 1)) splitBySeason.push(firewoodSplit(sim));
    if (tickOfDay(sim.tick) === 0 && day - 1 === 9) {
      felledByAutumn = sim.tally.felled;
      inWinter = true;
    }
    if (tickOfDay(sim.tick) === 0 && day - 1 === DAYS_PER_YEAR) barnAtEnd = goodIn(sim, Good.Food, StoreKind.Common);
    if (isDusk(sim.tick)) {
      mealsDue += sim.living;
      if (day >= 10) {
        dusks.push({ day, houses: houses.map((slot) => firewood[slot]!), camp: firewood[CAMP_STORE]! });
        if (day === 12) inWinter = false;
      }
      if (day === 10) {
        housesByDay10 = houses.length;
        for (let id = 0; id < sim.villagers.count; id++) if (sim.villagers.state[id] !== VillagerState.Dead && sim.villagers.worn[id] === Good.Clothing) clothedAtDay10 += 1;
      }
    }
    if (!isNight(sim.tick)) {
      for (let slot = 0; slot < sim.orders.sites.used; slot++) {
        if (sim.orders.sites.kind[slot] !== Building.Woodshed || sim.orders.sites.state[slot] !== SiteState.Built) continue;
        shedTicks += 1;
        const staffed = sim.villagers.workplace.includes(slot);
        if (sim.workshops.stopped[slot] === 0 && staffed) shedWorking += 1;
        const doing = staffed ? STOP_WORDS[sim.workshops.stopped[slot]!]! : 'Nobody works here';
        shedDoing[doing] = (shedDoing[doing] ?? 0) + 1;
      }
    }
    for (let id = 0; id < sim.villagers.count; id++) {
      if (sim.villagers.task[id] === STOCK && sim.villagers.stockGood[id] === Good.Firewood && sim.villagers.toStore[id] !== CAMP_STORE) walkTicks += 1;
    }
    const coldBefore = Uint8Array.from(sim.villagers.coldNights);
    const before = Uint8Array.from(sim.villagers.state);
    const heldBefore = houses.map((slot) => firewood[slot]!);
    const { froze } = sim.tally;
    const ticked = sim.tick;
    step(sim);
    if (isDawn(ticked) && dateAt(ticked).day >= 11) houses.forEach((slot) => sim.stores.burnedLastNight[slot] === 1 && fires.set(slot, (fires.get(slot) ?? 0) + 1));
    if (inWinter) houses.forEach((slot, i) => firewood[slot]! > heldBefore[i]! && arrivals.set(slot, (arrivals.get(slot) ?? 0) + firewood[slot]! - heldBefore[i]!));
    for (let slot = 0; slot < sim.orders.sites.used; slot++) {
      if (sim.orders.sites.state[slot] !== SiteState.Built || built.has(slot)) continue;
      built.set(slot, `${BUILDINGS[sim.orders.sites.kind[slot] as Building].name} ${clock(ticked)}`);
      if (sim.orders.sites.kind[slot] === Building.House) houses.push(slot);
    }
    let froze1 = sim.tally.froze - froze;
    for (let id = 0; id < sim.villagers.count; id++) {
      const dead = before[id] !== VillagerState.Dead && sim.villagers.state[id] === VillagerState.Dead;
      const frozeNow = dead && coldBefore[id] === 2 && froze1 > 0;
      if (frozeNow) froze1 -= 1;
      if (sim.villagers.coldNights[id]! > coldBefore[id]! || frozeNow) cold[id]!.push(dateAt(ticked).day - Number(tickOfDay(ticked) < TICKS_PER_DAY / 2));
      if (dead) died.push(`${nameOfId(sim, id)} ${frozeNow ? 'froze' : 'starved'} ${clock(ticked)}`);
    }
  }
  splitBySeason.push(firewoodSplit(sim));
  if (barnAtEnd < 0) barnAtEnd = goodIn(sim, Good.Food, StoreKind.Common);
  const coldNights = cold.slice(0, sim.villagers.count).map((nights, id) => `${nameOfId(sim, id)} ${nights.length > 0 ? nights.join(',') : 'none'}`);
  return {
    sim,
    row: {
      year: year.title,
      seed,
      given,
      commands: commandLog,
      built: [...built.values()],
      housesByDay10,
      splitBySeason,
      dusks,
      winterArrivals: houses.map((slot) => arrivals.get(slot) ?? 0),
      fires: houses.map((slot) => fires.get(slot) ?? 0),
      minutesPerUnitHome: sim.tally.firewoodHome === 0 ? 0 : Math.round((walkTicks * MINUTES_PER_TICK) / sim.tally.firewoodHome),
      unitsHome: sim.tally.firewoodHome,
      clothedAtDay10,
      coldNights,
      died,
      meals: sim.tally.meals,
      mealsDue,
      missed: sim.tally.missed,
      barnAtEnd,
      living: sim.living,
      born: sim.tally.births,
      felledByAutumn,
      felled: sim.tally.felled,
      shedDoing,
      woodcutterIdle: shedTicks === 0 ? 'no woodshed stood' : `${(100 - (100 * shedWorking) / shedTicks).toFixed(1)}% of its daylight without work`,
    },
  };
}

/** The firewood each house holds beyond the 2 its fire burns, at each cold dusk, and the least of them. */
export function slackOf(row: Row): { readonly byDusk: string[]; readonly least: number } {
  let least = Infinity;
  const byDusk = row.dusks.map(({ day, houses }) => {
    for (const held of houses) least = Math.min(least, held - 2);
    return `d${day} ${houses.map((held) => held - 2).join(' ')}`;
  });
  return { byDusk, least: least === Infinity ? NaN : least };
}

export function printRow(row: Row): void {
  console.log(`## ${row.year} (seed ${row.seed})`);
  for (const line of row.given) console.log(`- ${line}`);
  console.log(`built: ${row.built.join(', ')}`);
  console.log(`houses by the dusk of day 10: ${row.housesByDay10}; firewood split by the end of spring, summer, autumn, winter: ${row.splitBySeason.join(', ')}`);
  console.log(`firewood at each cold dusk before the fires, houses in the order they stood, then the camp: ${row.dusks.map((d) => `d${d.day} [${d.houses.join(' ')}] camp ${d.camp}`).join('; ')}`);
  console.log(`slack, firewood beyond the 2 a house burns: ${slackOf(row).byDusk.join('; ')}; firewood carried into each house from the start of winter to the last cold dusk: ${row.winterArrivals.join(' ')}; nights each house's fire burned: ${row.fires.join(' ')}`);
  console.log(`firewood carried home over the year ${row.unitsHome}, ${row.minutesPerUnitHome} game minutes of walking for each unit`);
  console.log(`clothed at the dusk of day 10: ${row.clothedAtDay10}; cold nights: ${row.coldNights.join('; ')}`);
  console.log(`died: ${row.died.join('; ') || 'nobody'}; living ${row.living} of the 8 and the ${row.born} born`);
  console.log(`meals: ${row.meals} eaten of ${row.mealsDue} due, ${row.missed} missed; barn at the year's end ${row.barnAtEnd}`);
  console.log(`trees felled by the end of autumn ${row.felledByAutumn}, by the year's end ${row.felled}; woodshed ${row.woodcutterIdle}`);
  console.log(`the woodshed panel's Doing, in daylight ticks after it stood: ${Object.entries(row.shedDoing).map(([k, v]) => `${k} ${v}`).join('; ') || 'no woodshed stood'}`);
  console.log('');
}

/** #30's orders for the hut, the barn, and the lodge on seed 7, with their 16 trees and 2 rock tiles. */
const thirty = () => huntYearCommands({ hut: true });
/** The rock tiles nearest the camp center that #30's orders leave, whose 24 stone hold four houses' 6. */
const HOUSE_ROCKS: readonly (readonly [number, number])[] = [
  [123, 113],
  [122, 113],
  [121, 113],
];

/** `when`, put off by `ticks` from the first tick it holds. */
export function later(when: When, ticks: number): When {
  if (ticks === 0) return when;
  let since = -1;
  return {
    label: `${(ticks / (TICKS_PER_DAY / 24)).toFixed(1)} h after ${when.label}`,
    ready: (sim) => {
      if (since < 0 && when.ready(sim)) since = sim.tick;
      return since >= 0 && sim.tick >= since + ticks;
    },
  };
}

/** The orders a year gives, named the way the owner reads them. Every order has a `When`, so item 4 can put each one off alone. */
export interface Plan {
  readonly title: string;
  /** #30's hut, barn, and lodge on their seed 7 places, or the same three on the nearest places with the nearest trees and rocks. */
  readonly base: 'thirty' | 'nearest';
  readonly houses: number;
  /** The nearest places the rules accept, or the first year's four places west of the camp that #40 used. */
  readonly housePlaces: 'nearest' | 'west';
  readonly housesAt: When;
  /** 4.2's stockpile east of the camp, or the 3 by 3 square nearest the camp, drawn after the houses. */
  readonly stockpile: 'east' | 'nearest';
  readonly stockpileAt: When;
  readonly shedAt: When;
  /** Trees marked with the woodshed, for its 6 logs and the firewood. */
  readonly shedTrees: number;
  /** The woodshed on 4.2's place, or on the nearest place left when it is ordered. */
  readonly shedPlace: 'east' | 'nearest';
  /** Set the woodshed's places to 0 the tick it stands, and back to 1 at this. */
  readonly shedPlacesOneAt?: When;
  readonly tailorAt?: When;
  readonly tailorTrees?: number;
}

const START = at(1, '08:00');
export const atStart = START;

/** The orders of a plan, in the order a player gives those that fall on the same tick. */
export function ordersOf(plan: Plan): Order[] {
  const orders: Order[] = [];
  if (plan.base === 'thirty') orders.push({ when: START, label: "#30's hut, barn, and lodge", give: thirty });
  else {
    let hut: readonly [number, number] = [0, 0];
    const nearestTree = (sim: Sim) => nearestTrees(sim, 1)[0]!.map((v) => v + 0.5) as [number, number];
    const besideHut = () => hut;
    const building = (b: Building, trees: number, rocks: number, to?: (sim: Sim) => readonly [number, number]): Order => ({
      when: START,
      label: `${BUILDINGS[b].name} on the nearest place${to === nearestTree ? ' to the nearest tree' : to === besideHut ? ' to the hut' : ''}`,
      give: (sim) => {
        const placed = placeNearest(b, to)(sim);
        const first = placed[0]!;
        if (b === Building.Hut && first.kind === 'place') hut = [first.x + 1, first.y + 1];
        return [...placed, ...chopNearest(trees)(sim), ...quarryNearest(rocks)(sim)];
      },
    });
    orders.push(building(Building.Hut, 4, 0, nearestTree), building(Building.Barn, 8, 1, besideHut), building(Building.Lodge, 4, 1));
  }
  const stockpile: Order = {
    when: plan.stockpileAt,
    label: 'stockpile',
    give: (sim) => {
      const east = WOOD_LAYOUT.stockpile;
      const open = clear(sim, east.x0, east.y0, east.x1, east.y1);
      return plan.stockpile === 'east' && open ? [{ kind: 'markArea', order: 'stockpile', area: east }] : stockpileNearest(sim);
    },
  };
  if (plan.stockpile === 'east') orders.push(stockpile);
  for (let i = 0; i < plan.houses; i++) {
    orders.push({
      when: plan.housesAt,
      label: `house ${i + 1}`,
      give: (sim) => [
        ...(plan.housePlaces === 'nearest' ? placeNearest(Building.House)(sim) : [place(Building.House, FIRST_YEAR_HOUSES[i]![0], FIRST_YEAR_HOUSES[i]![1])]),
        ...chopNearest(6)(sim),
        ...(i % 4 === 3 ? [] : plan.base === 'thirty' ? quarry([HOUSE_ROCKS[i % 4]!])() : quarryNearest(1)(sim)),
      ],
    });
  }
  if (plan.stockpile === 'nearest') orders.push(stockpile);
  let shed: [number, number] = [WOOD_LAYOUT.woodshed.x, WOOD_LAYOUT.woodshed.y];
  orders.push({
    when: plan.shedAt,
    label: 'woodshed',
    give: (sim) => {
      if (plan.shedPlace === 'nearest') shed = nearestAnchor(sim, Building.Woodshed);
      return [place(Building.Woodshed, shed[0], shed[1]), ...chopNearest(plan.shedTrees)(sim)];
    },
  });
  if (plan.shedPlacesOneAt) {
    orders.push({ when: { label: 'when the woodshed stands', ready: (sim) => isBuilt(sim, shed[0], shed[1]) }, label: 'woodshed places 0', give: (sim) => setPlaces(shed[0], shed[1], 0)(sim) });
    orders.push({ when: plan.shedPlacesOneAt, label: 'woodshed places 1', give: (sim) => setPlaces(shed[0], shed[1], 1)(sim) });
  }
  if (plan.tailorAt) orders.push({ when: plan.tailorAt, label: "tailor's hut", give: (sim) => [...placeNearest(Building.Tailor)(sim), ...chopNearest(plan.tailorTrees ?? 4)(sim)] });
  return orders;
}

const lodgeStands = whenBuilt('lodge', 124, 129);
const barnStands: When = {
  label: 'when the barn stands',
  ready: (sim) => {
    for (let slot = 0; slot < sim.orders.sites.used; slot++) if (sim.orders.sites.kind[slot] === Building.Barn && sim.orders.sites.state[slot] === SiteState.Built) return true;
    return false;
  },
};

/** The year that lives: four houses on the nearest places at the start, the woodshed when no site lacks a log. */
export const NEAR_HOUSES_LATE_SHED: Plan = {
  title: 'near houses, late woodshed: 4 houses on the nearest places at the start, the woodshed when no site lacks a log',
  base: 'thirty',
  houses: 4,
  housePlaces: 'nearest',
  housesAt: START,
  stockpile: 'east',
  stockpileAt: START,
  shedAt: whenNoSiteLacksLogs,
  shedTrees: 9,
  shedPlace: 'nearest',
};

/** The near-houses year with every place chosen by the nearest rule, so that it runs on any seed. */
export const BY_RULE: Plan = {
  ...NEAR_HOUSES_LATE_SHED,
  title: 'by rule: the near-houses year with the hut by the tree nearest the camp, the barn by the hut, and every other building, the stockpile, each tree and each rock nearest the camp',
  base: 'nearest',
  stockpile: 'nearest',
};

export const PLANS: Record<string, Plan> = {
  'near-houses-late-shed': NEAR_HOUSES_LATE_SHED,
  'near-houses-shed-when-built': {
    ...NEAR_HOUSES_LATE_SHED,
    title: "the first report's year: near houses, the woodshed and 15 trees when every site that needs logs stands",
    shedAt: whenSitesStand,
    shedTrees: 15,
  },
  'near-houses-at-minutes': {
    ...NEAR_HOUSES_LATE_SHED,
    title: "near houses, late woodshed, with the woodshed at 06:17 on day 5, the first minute after no site lacks a log: the orders the page gives",
    shedAt: at(5, '06:17'),
  },
  'near-houses-shed-places': {
    ...NEAR_HOUSES_LATE_SHED,
    title: "near houses, woodshed's places: the woodshed at the start, its places set to 0 when it stands and to 1 when no site lacks a log",
    shedAt: START,
    shedPlacesOneAt: whenNoSiteLacksLogs,
  },
  'near-houses-shed-at-start': { ...NEAR_HOUSES_LATE_SHED, title: 'near houses, woodshed at the start', shedAt: START },
  'west-houses-late-shed': { ...NEAR_HOUSES_LATE_SHED, title: "#40's house places, late woodshed", housePlaces: 'west', shedPlace: 'east' },
  'west-houses-shed-at-start': { ...NEAR_HOUSES_LATE_SHED, title: "#40's year wood: #40's house places, woodshed at the start", housePlaces: 'west', shedPlace: 'east', shedAt: START },
  'no-house-clothing': {
    ...NEAR_HOUSES_LATE_SHED,
    title: "no house: the woodshed at the start, a tailor's hut when the lodge stands, the camp's fire and clothing",
    houses: 0,
    shedAt: START,
    shedTrees: 6,
    tailorAt: lodgeStands,
  },
  'firewood-first-1-house': {
    ...NEAR_HOUSES_LATE_SHED,
    title: "firewood first: the woodshed at the start, a tailor's hut when the lodge stands, 1 house on the nearest place when 12 firewood is split",
    houses: 1,
    housesAt: whenSplit(12),
    shedAt: START,
    shedTrees: 6,
    tailorAt: lodgeStands,
  },
  'firewood-first-4-houses': {
    ...NEAR_HOUSES_LATE_SHED,
    title: 'firewood first: the woodshed at the start, 4 houses on the nearest places when 24 firewood is split',
    housesAt: whenSplit(24),
    shedAt: START,
  },
  'near-3-houses-tailor': {
    ...NEAR_HOUSES_LATE_SHED,
    title: "3 houses on the nearest places at the start, a tailor's hut when the lodge stands, the woodshed when no site lacks a log",
    houses: 3,
    shedTrees: 12,
    tailorAt: lodgeStands,
  },
  'by-rule': BY_RULE,
  'by-rule-shed-places': { ...BY_RULE, title: "by rule, with the woodshed at the start, its places set to 0 when it stands and to 1 when no site lacks a log", shedAt: START, shedPlacesOneAt: whenNoSiteLacksLogs },
  'by-rule-houses-after-barn': { ...BY_RULE, title: 'by rule, with the four houses ordered when the barn stands', housesAt: barnStands },
  'by-rule-nothing': { ...BY_RULE, title: 'by rule, nothing for warmth: the hut, barn, and lodge of the rule year alone', houses: 0, shedAt: at(13, '08:00') },
};

/** For each house a year placed: the straight line from its middle to the camp center, and the mean one to the 6 trees its order marked. */
function houseDistances(sim: Sim, row: Row): string[] {
  const [cx, cy] = campCenter(sim);
  return row.commands.flatMap(({ label, commands }) => {
    const house = commands.find((c) => c.kind === 'place' && c.building === Building.House);
    if (!house || house.kind !== 'place') return [];
    const [hx, hy] = [house.x + 0.5, house.y + 0.5];
    const trees = commands.flatMap((c) => (c.kind === 'markArea' && c.order === 'chop' ? [Math.hypot(c.area.x0 + 0.5 - hx, c.area.y0 + 0.5 - hy)] : []));
    const toTrees = trees.reduce((a, b) => a + b, 0) / trees.length;
    return [`${label} on (${house.x}, ${house.y}): ${Math.hypot(hx - cx, hy - cy).toFixed(1)} tiles to the camp, ${toTrees.toFixed(1)} on average to its 6 trees`];
  });
}

/** The winter readiness reading and the Stockpiles panel's totals at the minutes the `firewood-year` scenario reads them. */
function pageReadings(year: Year, seed: number): string[] {
  const sim = createSim(generateMap(seed), SETTLERS);
  const pending = [...year.orders];
  const stops = new Map([
    [tickAt(10, '12:00'), 'd10 12:00'],
    [tickAt(10, '17:00'), 'd10 17:00'],
    [tickAt(13, '05:00'), 'd13 05:00'],
  ]);
  const lines: string[] = [];
  while (sim.tick <= Math.max(...stops.keys()) && !sim.over) {
    for (let i = 0; i < pending.length; ) {
      if (!pending[i]!.when.ready(sim)) i++;
      else for (const command of pending.splice(i, 1)[0]!.give(sim)) applyCommand(sim, command);
    }
    const when = stops.get(sim.tick);
    if (when) {
      const r = readinessOf(sim);
      const food = storeTotals(sim.orders, sim.stores.held[Good.Food - 1]!);
      const wood = storeTotals(sim.orders, sim.stores.held[Good.Firewood - 1]!);
      const jobs = jobCounts(sim.orders, sim.villagers.state.subarray(0, sim.villagers.count), sim.villagers.workplace, sim.villagers.child);
      const reading = r === null ? 'reading hidden' : `Households in a house ${r.housed} of ${r.households}; Houses with firewood ${r.stocked} of ${r.houses}; Settlers in clothing ${r.clothed} of ${r.settlers}; Cold tonight ${r.cold}${r.camp ? `; Camp fire ${r.camp.lights ? `Lights, ${r.camp.firewood} firewood` : `Out, ${r.camp.firewood} of ${r.camp.burns} firewood`}` : ''}`;
      lines.push(
        `${when}: ${reading}; Barn and camp food ${food[StoreKind.Common]}; Food in homes ${food[StoreKind.Home]}; ` +
          `Firewood in stores ${wood[StoreKind.Workshop] + wood[StoreKind.Common]}; Firewood in homes ${wood[StoreKind.Home]}; Settlers with a job ${jobs.withJob}; Settlers with no job ${jobs.withoutJob}; Children ${jobs.children}`,
      );
    }
    step(sim);
  }
  return lines;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const seedAt = args.indexOf('--seed');
  const seed = seedAt >= 0 ? Number(args[seedAt + 1]) : 7;
  const json = args.includes('--json');
  const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--seed');
  for (const name of names.length > 0 ? names : Object.keys(PLANS)) {
    const plan = PLANS[name];
    if (!plan) throw new Error(`no year named ${name}; the years are ${Object.keys(PLANS).join(', ')}`);
    const year = { title: `${name}: ${plan.title}`, orders: ordersOf(plan) };
    if (args.includes('--page')) {
      console.log(`## ${year.title} (seed ${seed}), as the page reads it`);
      for (const line of pageReadings(year, seed)) console.log(`- ${line}`);
      console.log('');
      continue;
    }
    const { sim, row } = playYear(year, seed);
    if (json) console.log(JSON.stringify(row));
    else printRow(row);
    if (args.includes('--distances')) for (const line of houseDistances(sim, row)) console.log(`- ${line}`);
  }
}
