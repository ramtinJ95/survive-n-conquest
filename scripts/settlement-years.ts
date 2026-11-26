// Twenty years of `src/sim` on seed 7 under one ordering rule, played twice: with births, and with births off from
// year 3. `bun scripts/settlement-years.ts [--years n] [--hour h] [--hours] [--json] [--log]`.
// Year 1 gives the orders of #45's `NEAR_HOUSES_LATE_SHED`. From year 2 the rule `settle` reads what a player reads on
// the screen once a day, at 08:00 or at `--hour`, and gives its orders then. Births off sets the cap on the living to
// 0, a switch only this script has. `--hours` plays the run with births at 08:00, 10:00, 12:00, and 14:00 and prints
// the living and the deaths of each. `--log` lists each morning's reading, every order, and every death.
import { ageAt } from '../src/sim/aging';
import { arrived } from '../src/sim/building';
import { BEARING_AGES, BIRTH_CHANCE, BIRTH_GAP, FULL_HOUSE, bearChildren, birthDraw } from '../src/sim/births';
import { BUILDINGS, Building, type BuildingName, footprintStart, withinReach } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_YEAR, dateAt } from '../src/sim/calendar';
import { Claim } from '../src/sim/claims';
import { DAWN } from '../src/sim/dawn';
import { LOGS_PER_TREE } from '../src/sim/gathering';
import { Good } from '../src/sim/goods';
import { NO_HOME } from '../src/sim/households';
import { TileKind } from '../src/sim/map';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState } from '../src/sim/orders';
import { isSingle } from '../src/sim/pairing';
import { type Command, SETTLERS, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { BARN_FOOD_LIMIT, CAMP_FIREWOOD_LIMIT, CAMP_FOOD_LIMIT, HOUSE_FIREWOOD_LIMIT, StoreKind } from '../src/sim/stores';
import { Cause, VILLAGER_ROWS, VillagerState } from '../src/sim/villagerState';
import { jobCounts, stockpileTotals, storeTotals } from '../src/ui/stockpiles';
import { NEAR_HOUSES_LATE_SHED, nearestAnchor, nearestTrees, ordersOf, quarryNearest } from './firewood-years';

const SEED = 7;
const BIRTHS_OFF_FROM = 3;
const HOURS = [8, 10, 12, 14] as const;
const TICKS_PER_HOUR = TICKS_PER_DAY / 24;
/** Tick 0 is 08:00 on day 1, and the calendar year turns at the midnight inside the last winter night. */
const MIDNIGHT = 16 * TICKS_PER_HOUR;
export const yearsEnd = (years: number) => (years - 1) * TICKS_PER_YEAR + (DAYS_PER_YEAR - 1) * TICKS_PER_DAY + MIDNIGHT;
const endsYear = (tick: number) => tick % TICKS_PER_YEAR === yearsEnd(1);

const when = (tick: number) => {
  const { year, day, minuteOfDay } = dateAt(tick);
  return `y${year} d${day - (year - 1) * DAYS_PER_YEAR} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};

/** What a player reads on the screen: the camp and stockpile panels, the map's marks, and the buildings and their sites' panels. */
interface Reading {
  readonly living: number;
  readonly withoutJob: number;
  readonly households: number;
  /** Households without a house of their own. Their couples sleep at the camp, or in their parents' houses while no house stands empty. */
  readonly homeless: number;
  /** Food in barns and at the camp, and in homes. */
  readonly commonFood: number;
  readonly homeFood: number;
  /** Firewood in woodsheds and at the camp, and in homes. */
  readonly storeFirewood: number;
  readonly homeFirewood: number;
  /** Logs and stone on the stockpiles. */
  readonly logs: number;
  readonly stone: number;
  readonly markedTrees: number;
  readonly markedRocks: number;
  /** Logs and stone the building sites still lack, from each site's panel. */
  readonly siteLogs: number;
  readonly siteStone: number;
  readonly built: Record<BuildingName, number>;
  readonly sites: Record<BuildingName, number>;
}

function count(sim: Sim, state: SiteState): Record<BuildingName, number> {
  const out = { house: 0, hut: 0, barn: 0, lodge: 0, woodshed: 0, tailor: 0, farm: 0 };
  const { sites } = sim.orders;
  for (let s = 0; s < sites.used; s++) if (sites.state[s] === state) out[BUILDINGS[sites.kind[s] as Building].name] += 1;
  return out;
}

function readingOf(sim: Sim): Reading {
  const { villagers, households, orders, map } = sim;
  const food = storeTotals(orders, sim.stores.held[Good.Food - 1]!);
  const firewood = storeTotals(orders, sim.stores.held[Good.Firewood - 1]!);
  const piles = stockpileTotals(map, orders.claims);
  let living = 0;
  let homeless = 0;
  for (let h = 0; h < households.count; h++) {
    if (households.living[h] === 0) continue;
    living += 1;
    if (households.home[h] === NO_HOME) homeless += 1;
  }
  let markedTrees = 0;
  let markedRocks = 0;
  for (let t = 0; t < map.size * map.size; t++) {
    if (orders.claims[t] === Claim.Chop && map.trees[t] === 1) markedTrees += 1;
    if (orders.claims[t] === Claim.Quarry && map.kinds[t] === TileKind.Rock) markedRocks += 1;
  }
  let siteLogs = 0;
  let siteStone = 0;
  for (let slot = 0; slot < orders.sites.used; slot++) {
    if (orders.sites.state[slot] !== SiteState.Site) continue;
    const needs = BUILDINGS[orders.sites.kind[slot] as Building].needs;
    siteLogs += (needs[Good.Log] ?? 0) - arrived(map, orders, slot, Good.Log);
    siteStone += (needs[Good.Stone] ?? 0) - arrived(map, orders, slot, Good.Stone);
  }
  return {
    living: sim.living,
    withoutJob: jobCounts(orders, villagers.state.subarray(0, villagers.count), villagers.workplace, villagers.child).withoutJob,
    households: living,
    homeless,
    commonFood: food[StoreKind.Common],
    homeFood: food[StoreKind.Home],
    storeFirewood: firewood[StoreKind.Common] + firewood[StoreKind.Workshop],
    homeFirewood: firewood[StoreKind.Home],
    logs: piles[Good.Log],
    stone: piles[Good.Stone],
    markedTrees,
    markedRocks,
    siteLogs,
    siteStone,
    built: count(sim, SiteState.Built),
    sites: count(sim, SiteState.Site),
  };
}

/** The site slots of the finished workplaces of a kind, in the order they were ordered. */
function workplaces(sim: Sim, kind: Building): number[] {
  const out: number[] = [];
  for (let s = 0; s < sim.orders.sites.used; s++) if (sim.orders.sites.kind[s] === kind && sim.orders.sites.state[s] === SiteState.Built) out.push(s);
  return out;
}

const SPLIT = BUILDINGS[Building.Woodshed].recipe!;
const FIREWOOD_PER_LOG = SPLIT.outputs / SPLIT.inputs;
const HUT_PLACES = BUILDINGS[Building.Hut].places;
const HUT_REACH = BUILDINGS[Building.Hut].reach;
const treesFor = (logs: number) => Math.ceil(logs / LOGS_PER_TREE);

/**
 * Chop orders on the `n` standing unmarked trees nearest the camp center that a settler can walk to, as the map shows
 * land joined to the camp, and that lie outside the reach of every hut that stands or is ordered, `hut` too: the
 * middle of a hut ordered with these trees.
 */
function chop(sim: Sim, n: number, hut?: readonly [number, number]): Command[] {
  const { map, orders, flow } = sim;
  const { size } = map;
  const { sites } = orders;
  const cx = (flow.goal % size) + 0.5;
  const cy = Math.floor(flow.goal / size) + 0.5;
  const found: { t: number; d: number }[] = [];
  for (let t = 0; t < size * size; t++) {
    if (map.trees[t] !== 1 || orders.claims[t] === Claim.Chop || flow.next[t] === -1) continue;
    const x = (t % size) + 0.5;
    const y = Math.floor(t / size) + 0.5;
    let inHutReach = false;
    for (let s = 0; s < sites.used && !inHutReach; s++) inHutReach = sites.kind[s] === Building.Hut && sites.state[s] !== SiteState.Free && withinReach(sites, s, x, y);
    if (hut) inHutReach ||= (x - hut[0]) ** 2 + (y - hut[1]) ** 2 <= HUT_REACH * HUT_REACH;
    if (!inHutReach) found.push({ t, d: (x - cx) ** 2 + (y - cy) ** 2 });
  }
  found.sort((a, b) => a.d - b.d || a.t - b.t);
  return found.slice(0, n).map(({ t }) => ({ kind: 'markArea', order: 'chop', area: { x0: t % size, y0: Math.floor(t / size), x1: t % size, y1: Math.floor(t / size) } }));
}

/** A building on the nearest place the rules accept to `to`, the camp by default, with the trees and the rock for what it needs. */
function build(sim: Sim, building: Building, to?: readonly [number, number]): Command[] {
  const [x, y] = nearestAnchor(sim, building, to);
  const { needs, side } = BUILDINGS[building];
  const middle = [footprintStart(x, side) + side / 2, footprintStart(y, side) + side / 2] as const;
  return [{ kind: 'place', building, x, y }, ...chop(sim, treesFor(needs[Good.Log] ?? 0), building === Building.Hut ? middle : undefined), ...quarryNearest((needs[Good.Stone] ?? 0) > 0 ? 1 : 0)(sim)];
}

/**
 * The rule `settle`. Each morning from year 2, at the hour it reads the screen, it gives these orders in this order:
 * 1. House: when more households sleep at the camp than house sites stand, one house on the place nearest the camp.
 * 2. Trees: when the logs on the stockpiles and 2 for each marked tree fall short of the logs the building sites still
 *    lack, plus 1 log for every 2 firewood that the houses lack (6 a house, and 12 for the camp while a household
 *    sleeps there, less the firewood in woodsheds, at the camp, and in homes), mark the trees for the difference.
 * 3. Rock: when the sites lack more stone than the stockpiles hold and no rock is marked, mark one rock tile.
 * 4. Lodge: its places to 0.
 * 5. Huts: when nobody is without a job, a place less at the first hut that has one, so one settler is free to haul
 *    and build. Otherwise, below 4 days of meals for the living in the barns and at the camp, a place more at the
 *    first hut with a free place when 2 or more are without a job; when every hut is full, no hut site stands, and 2
 *    or more are without a job, one hut on the place nearest the standing tree nearest the camp. Above 8 days, a
 *    place less at the first hut that has one.
 * 6. Barn: when the barns and the camp hold within 20 food of all they can and no barn site stands, one barn on the
 *    place nearest the camp.
 * Each building comes with chop orders for the logs it needs and, when it needs stone, the nearest rock tile. Marked
 * trees are the unmarked trees nearest the camp outside the reach of every hut, and the rock the unmarked rock tile
 * nearest the camp. The rule orders no lodge, woodshed, or tailor's hut, and it reads the screen once, before its
 * first order of the morning.
 */
function settle(sim: Sim, r: Reading, give: (commands: Command[]) => void): void {
  if (r.homeless > r.sites.house) give(build(sim, Building.House));
  const firewood = HOUSE_FIREWOOD_LIMIT * r.built.house + (r.homeless > 0 ? CAMP_FIREWOOD_LIMIT : 0) - r.storeFirewood - r.homeFirewood;
  const logs = r.siteLogs + Math.max(0, Math.ceil(firewood / FIREWOOD_PER_LOG));
  const have = r.logs + LOGS_PER_TREE * r.markedTrees;
  if (have < logs) give(chop(sim, treesFor(logs - have)));
  if (r.siteStone > r.stone && r.markedRocks === 0) give(quarryNearest(1)(sim));
  const { places } = sim.orders.sites;
  for (const s of workplaces(sim, Building.Lodge)) if (places[s] !== 0) give([{ kind: 'setPlaces', slot: s, places: 0 }]);
  const huts = workplaces(sim, Building.Hut);
  const placeLess = () => {
    const s = huts.find((slot) => places[slot]! > 0);
    if (s !== undefined) give([{ kind: 'setPlaces', slot: s, places: places[s]! - 1 }]);
  };
  const days = r.commonFood / Math.max(r.living, 1);
  if (r.withoutJob === 0) placeLess();
  else if (days < 4) {
    const open = huts.find((slot) => places[slot]! < HUT_PLACES);
    if (open !== undefined && r.withoutJob >= 2) give([{ kind: 'setPlaces', slot: open, places: places[open]! + 1 }]);
    else if (open === undefined && r.sites.hut === 0 && r.withoutJob >= 2) give(build(sim, Building.Hut, (nearestTrees(sim, 1)[0] ?? [0, 0]).map((v) => v + 0.5) as [number, number]));
  } else if (days > 8) placeLess();
  if (r.sites.barn === 0 && r.commonFood >= CAMP_FOOD_LIMIT + BARN_FOOD_LIMIT * r.built.barn - 20) give(build(sim, Building.Barn));
}

/** Why a household did not have a child at a dawn: the first reason `qualifies` fails on, then a draw at or above `BIRTH_CHANCE`, then the cap on the living. */
const BRAKES = ['no house', 'full', 'couple', 'age', 'wanting', 'gap', 'drawn', 'cap', 'born'] as const;
type Brake = (typeof BRAKES)[number];

interface YearRow {
  readonly year: number;
  /** The living aged under 10, 10 to 15, 16 to 49, and 50 or more. */
  bands: [number, number, number, number];
  born: number;
  died: { hunger: number; cold: number; old: number };
  housed: number;
  homeless: number;
  formed: number;
  /** Living settlers of 16 or more who are not one of a couple. */
  singles: number;
  meals: number;
  due: number;
  food: number;
  homeFood: number;
  firewood: number;
  homeFirewood: number;
  buildings: Record<BuildingName, number>;
  rows: number;
  workers: number;
  mouths: number;
  /** Household dawns of the year by the reason no child was born. */
  brakes: Record<Brake, number>;
}

/** A settler who paired into a household with no house. */
interface CampPairing {
  readonly id: number;
  /** The villager's cold nights in a row at the last tick, to see a new one. */
  lastCold: number;
  coldBeforeHouse: boolean;
  frozeBeforeHouse: boolean;
}

export interface Run {
  readonly hour: number;
  readonly birthsOffFrom: number | null;
  readonly rows: YearRow[];
  readonly peak: number;
  /** When nobody lived any more, or null. */
  readonly over: string | null;
  readonly camp: { readonly paired: number; readonly coldBeforeHouse: number; readonly froze: number; readonly frozeBeforeHouse: number };
  readonly log: string[];
  readonly sim: Sim;
}

export interface Options {
  /** The hour the rule reads the screen, 8 for 08:00. */
  readonly hour: number;
  readonly ticks: number;
  /** The year from which no child is born. */
  readonly birthsOffFrom?: number;
  readonly log?: boolean;
}

/** Counts each household at this dawn by the reason it will not have a child. It reads the state right before `bearChildren`. */
function countBrakes(sim: Sim, brakes: Record<Brake, number>): void {
  const { households, villagers } = sim;
  const wanting = new Uint8Array(households.count);
  for (let id = 0; id < villagers.count; id++) {
    if (villagers.state[id] !== VillagerState.Dead && (villagers.missedMeals[id]! > 0 || villagers.coldNights[id]! > 0)) wanting[villagers.household[id]!] = 1;
  }
  let born = 0;
  for (let h = 0; h < households.count; h++) {
    if (households.living[h] === 0) continue;
    const man = households.man[h]!;
    const woman = households.woman[h]!;
    let brake: Brake;
    if (households.home[h] === NO_HOME) brake = 'no house';
    else if (households.living[h]! >= FULL_HOUSE) brake = 'full';
    else if (man < 0 || woman < 0 || villagers.state[man] === VillagerState.Dead || villagers.state[woman] === VillagerState.Dead) brake = 'couple';
    else if (ageAt(villagers, woman, sim.tick) < BEARING_AGES[0] || ageAt(villagers, woman, sim.tick) >= BEARING_AGES[1]) brake = 'age';
    else if (wanting[h] === 1) brake = 'wanting';
    else if (sim.dawns - households.lastBirth[h]! <= BIRTH_GAP) brake = 'gap';
    else if (birthDraw(sim.seed, h, sim.dawns) >= BIRTH_CHANCE) brake = 'drawn';
    else if (sim.living + born >= sim.mostLiving || villagers.count + born >= VILLAGER_ROWS) brake = 'cap';
    else {
      brake = 'born';
      born += 1;
    }
    brakes[brake] += 1;
  }
}

function emptyRow(year: number): YearRow {
  return {
    year, bands: [0, 0, 0, 0], born: 0, died: { hunger: 0, cold: 0, old: 0 }, housed: 0, homeless: 0, formed: 0, singles: 0, meals: 0, due: 0,
    food: 0, homeFood: 0, firewood: 0, homeFirewood: 0, buildings: { house: 0, hut: 0, barn: 0, lodge: 0, woodshed: 0, tailor: 0, farm: 0 }, rows: 0, workers: 0, mouths: 0,
    brakes: { 'no house': 0, full: 0, couple: 0, age: 0, wanting: 0, gap: 0, drawn: 0, cap: 0, born: 0 },
  };
}

/** Fills the year's row from the state at its end. */
function close(sim: Sim, row: YearRow, last: Sim['tally']): YearRow {
  const v = sim.villagers;
  const t = sim.tally;
  for (let id = 0; id < v.count; id++) {
    if (v.state[id] === VillagerState.Dead) continue;
    const age = ageAt(v, id, sim.tick);
    row.bands[age < 10 ? 0 : age < 16 ? 1 : age < 50 ? 2 : 3] += 1;
    if (isSingle(sim, id)) row.singles += 1;
    if (v.child[id] === 0) row.workers += 1;
  }
  const r = readingOf(sim);
  row.born = t.births - last.births;
  row.died = { hunger: t.starved - last.starved, cold: t.froze - last.froze, old: t.oldAge - last.oldAge };
  row.housed = r.households - r.homeless;
  row.homeless = r.homeless;
  row.formed = t.paired - last.paired;
  row.meals = t.meals - last.meals;
  row.due = row.meals + t.missed - last.missed;
  row.food = r.commonFood;
  row.homeFood = r.homeFood;
  row.firewood = r.storeFirewood;
  row.homeFirewood = r.homeFirewood;
  row.buildings = r.built;
  row.rows = v.count;
  row.mouths = sim.living;
  return row;
}

/** The commands of one order as a player would name them. */
function describe(sim: Sim, commands: readonly Command[]): string {
  const parts: string[] = [];
  let chops = 0;
  let quarries = 0;
  for (const c of commands) {
    if (c.kind === 'place') parts.push(`${BUILDINGS[c.building].name} on (${c.x}, ${c.y})`);
    else if (c.kind === 'markArea' && c.order === 'chop') chops += 1;
    else if (c.kind === 'markArea' && c.order === 'quarry') quarries += 1;
    else if (c.kind === 'markArea') parts.push(`${c.order} (${c.area.x0}, ${c.area.y0}) to (${c.area.x1}, ${c.area.y1})`);
    else if (c.kind === 'setPlaces') parts.push(`${BUILDINGS[sim.orders.sites.kind[c.slot] as Building].name} ${c.slot} places ${c.places}`);
  }
  if (chops > 0) parts.push(`chop ${chops} trees`);
  if (quarries > 0) parts.push(`quarry ${quarries} rock`);
  return parts.join(', ');
}

function morning(sim: Sim, r: Reading): string {
  const huts = workplaces(sim, Building.Hut).map((s) => sim.orders.sites.places[s]).join(' ');
  const days = (r.commonFood / Math.max(r.living, 1)).toFixed(1);
  return `living ${r.living}, without a job ${r.withoutJob}, food ${r.commonFood} (${days} days) and ${r.homeFood} at home, at the camp ${r.homeless}, hut places ${huts || '-'}`;
}

const CAUSE_WORDS: Record<number, string> = { [Cause.Hunger]: 'starved', [Cause.Cold]: 'froze', [Cause.OldAge]: 'died of old age' };

/** Plays year 1's orders, then the rule from year 2 at `hour`, for `ticks` ticks or until nobody lives. */
export function play({ hour, ticks, birthsOffFrom, log: logging = false }: Options): Run {
  const sim = createSim(generateMap(SEED), SETTLERS);
  const ruleTick = (hour - 8) * TICKS_PER_HOUR;
  const pending = ordersOf(NEAR_HOUSES_LATE_SHED);
  const rows: YearRow[] = [];
  const log: string[] = [];
  let row = emptyRow(1);
  let last = { ...sim.tally };
  let peak = sim.living;
  const camp: CampPairing[] = [];
  const watched = new Map<number, CampPairing>();
  const recorded = new Uint8Array(sim.villagers.state.length);
  const give = (commands: Command[], label = '') => {
    for (const command of commands) applyCommand(sim, command);
    if (logging) log.push(`${when(sim.tick)} ${label}${describe(sim, commands)}`);
  };
  const probe = (s: Sim) => {
    if (s === sim) countBrakes(sim, row.brakes);
  };
  const dawn = DAWN as ((sim: Sim) => void)[];
  dawn.splice(dawn.indexOf(bearChildren), 0, probe);
  try {
    while (sim.tick < ticks && !sim.over) {
      for (let i = 0; i < pending.length; ) {
        const order = pending[i]!;
        if (!order.when.ready(sim)) i++;
        else give(pending.splice(i, 1)[0]!.give(sim), `${order.label}: `);
      }
      const { year } = dateAt(sim.tick);
      if (birthsOffFrom !== undefined && year >= birthsOffFrom) (sim as { mostLiving: number }).mostLiving = 0;
      if (year >= 2 && (sim.tick - ruleTick) % TICKS_PER_DAY === 0) {
        const reading = readingOf(sim);
        if (logging) log.push(`${when(sim.tick)} ${morning(sim, reading)}`);
        settle(sim, reading, give);
      }
      const households = sim.households.count;
      const { died } = sim.tally;
      step(sim);
      peak = Math.max(peak, sim.living);
      for (let h = households; h < sim.households.count; h++) {
        if (sim.households.home[h] !== NO_HOME) continue;
        for (const id of [sim.households.man[h]!, sim.households.woman[h]!]) {
          const p = { id, lastCold: sim.villagers.coldNights[id]!, coldBeforeHouse: false, frozeBeforeHouse: false };
          camp.push(p);
          watched.set(id, p);
        }
      }
      for (const [id, p] of watched) {
        const v = sim.villagers;
        if (v.coldNights[id]! > p.lastCold) p.coldBeforeHouse = true;
        p.lastCold = v.coldNights[id]!;
        if (v.state[id] === VillagerState.Dead) {
          p.frozeBeforeHouse = v.cause[id] === Cause.Cold;
          watched.delete(id);
        } else if (sim.households.home[v.household[id]!] !== NO_HOME) watched.delete(id);
      }
      if (logging && sim.tally.died > died) {
        const v = sim.villagers;
        for (let id = 0; id < v.count; id++) {
          if (v.state[id] !== VillagerState.Dead || recorded[id] === 1) continue;
          recorded[id] = 1;
          log.push(`${when(sim.tick)} ${nameOf(v.sex[id] as Sex, v.name[id]!)}, ${ageAt(v, id, sim.tick)}, ${CAUSE_WORDS[v.cause[id]!]}`);
        }
      }
      if (endsYear(sim.tick) || sim.over) {
        rows.push(close(sim, row, last));
        last = { ...sim.tally };
        row = emptyRow(dateAt(sim.tick).year);
      }
    }
  } finally {
    dawn.splice(dawn.indexOf(probe), 1);
  }
  const froze = (p: CampPairing) => sim.villagers.state[p.id] === VillagerState.Dead && sim.villagers.cause[p.id] === Cause.Cold;
  return {
    hour,
    birthsOffFrom: birthsOffFrom ?? null,
    rows,
    peak,
    over: sim.over ? when(sim.tick) : null,
    camp: { paired: camp.length, coldBeforeHouse: camp.filter((p) => p.coldBeforeHouse).length, froze: camp.filter(froze).length, frozeBeforeHouse: camp.filter((p) => p.frozeBeforeHouse).length },
    log,
    sim,
  };
}

const total = (run: Run) => run.rows.reduce((d, r) => ({ hunger: d.hunger + r.died.hunger, cold: d.cold + r.died.cold, old: d.old + r.died.old }), { hunger: 0, cold: 0, old: 0 });
const hhmm = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

function summary(run: Run): string {
  const died = total(run);
  const end = run.rows.at(-1)!;
  const off = run.birthsOffFrom === null ? 'births on' : `births off from year ${run.birthsOffFrom}`;
  return `Seed ${SEED}, the rule at ${hhmm(run.hour)}, ${off}: ${run.over ? `nobody lives from ${run.over}` : `${end.mouths} living at the end of year ${end.year}`}; most living ${run.peak}; died of hunger ${died.hunger}, of cold ${died.cold}, of old age ${died.old}.`;
}

const firstYear = (run: Run, holds: (r: YearRow) => boolean) => run.rows.find(holds)?.year ?? 'none';

function table(header: string[], rows: (string | number)[][]): string[] {
  return [`| ${header.join(' | ')} |`, `|${' --- |'.repeat(header.length)}`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
}

function report(born: Run, off: Run): string[] {
  const out = [`## Table 1. ${summary(born)}`, ''];
  out.push(
    ...table(
      ['year', '<10', '10-15', '16-49', '50+', 'born', 'starved', 'froze', 'old age', 'housed', 'at camp', 'formed', 'singles 16+', 'meals/due', 'food barns+camp/homes', 'firewood stores/homes', 'house/hut/barn/lodge/shed/tailor', 'rows'],
      born.rows.map((r) => {
        const b = r.buildings;
        return [r.year, ...r.bands, r.born, r.died.hunger, r.died.cold, r.died.old, r.housed, r.homeless, r.formed, r.singles, `${r.meals}/${r.due}`, `${r.food}/${r.homeFood}`, `${r.firewood}/${r.homeFirewood}`, `${b.house}/${b.hut}/${b.barn}/${b.lodge}/${b.woodshed}/${b.tailor}`, r.rows];
      }),
    ),
  );
  const c = born.camp;
  out.push('', `Paired into a household with no house: ${c.paired} settlers. A cold night before their household had a house: ${c.coldBeforeHouse}. Froze: ${c.froze}, of whom ${c.frozeBeforeHouse} before a house.`);
  out.push('', '## The brakes on births', '', 'Household dawns by the first reason no child was born.', '');
  out.push(...table(['year', ...BRAKES], born.rows.map((r) => [r.year, ...BRAKES.map((k) => r.brakes[k])])));
  out.push('', `## Table 2. ${summary(off)}`, '');
  out.push(...table(['year', 'workers', 'mouths', 'meals/due', 'starved', 'froze', 'old age'], off.rows.map((r) => [r.year, r.workers, r.mouths, `${r.meals}/${r.due}`, r.died.hunger, r.died.cold, r.died.old])));
  const from = off.birthsOffFrom!;
  out.push(
    '',
    `First year a settler missed a meal: ${firstYear(off, (r) => r.meals < r.due)}; from year ${from} on: ${firstYear(off, (r) => r.year >= from && r.meals < r.due)}. First year one starved: ${firstYear(off, (r) => r.died.hunger > 0)}.`,
  );
  return out;
}

function hoursReport(runs: Run[]): string[] {
  const out = ['## The rule at four hours, births on', '', ...runs.map(summary), ''];
  const years = Math.max(...runs.map((r) => r.rows.length));
  const header = ['year', ...runs.flatMap((r) => [`${hhmm(r.hour)} living`, 'starved/froze/old age'])];
  const rows = Array.from({ length: years }, (_, i) => [i + 1, ...runs.flatMap((run) => {
    const r = run.rows[i];
    return r ? [r.mouths, `${r.died.hunger}/${r.died.cold}/${r.died.old}`] : ['-', '-'];
  })]);
  return [...out, ...table(header, rows)];
}

if (import.meta.main) {
  const flag = (name: string) => {
    const at = process.argv.indexOf(name);
    return at < 0 ? undefined : process.argv[at + 1];
  };
  const ticks = yearsEnd(Number(flag('--years') ?? 20));
  const log = process.argv.includes('--log');
  const json = process.argv.includes('--json');
  const started = performance.now();
  const runs = process.argv.includes('--hours')
    ? HOURS.map((hour) => play({ hour, ticks, log }))
    : [play({ hour: Number(flag('--hour') ?? 8), ticks, log }), play({ hour: Number(flag('--hour') ?? 8), ticks, birthsOffFrom: BIRTHS_OFF_FROM, log })];
  const seconds = (performance.now() - started) / 1000;
  if (json) console.log(JSON.stringify({ seed: SEED, seconds, runs: runs.map(({ sim: _, ...run }) => run) }));
  else {
    const [born, off] = runs as [Run, Run];
    console.log((process.argv.includes('--hours') ? hoursReport(runs) : report(born, off)).join('\n'));
    for (const run of log ? runs : []) console.log(['', `## Log, the rule at ${hhmm(run.hour)}${run.birthsOffFrom === null ? '' : `, births off from year ${run.birthsOffFrom}`}`, '', ...run.log.map((l) => `- ${l}`)].join('\n'));
    console.log(`\nWall seconds: ${seconds.toFixed(1)}.`);
  }
}
