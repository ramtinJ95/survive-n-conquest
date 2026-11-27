// #53's twenty years of `src/sim` on seed 7 played with the rule `farm` beside `settle`, and without it: `bun
// scripts/farm-years.ts [--years n] [--hour h] [--hours] [--farms-from y] [--json]`. The rule `farm` is stated in
// `scripts/settlement-years.ts`. It starts in year 2, as `settle` does, or in year `--farms-from`. The default prints,
// for the rule at 08:00 or at `--hour`, the living beside the run without farms, the fields of each year, the share of
// a farmer's daylight in which it works, the harvest's stops for lack of room, and what the early frost costs.
// `--hours` plays both rules at 08:00, 10:00, 12:00, and 14:00 and prints the living of each. `--json` prints the raw
// numbers.
import { BUILDINGS, Building } from '../src/sim/buildings';
import { DAYS_PER_YEAR, SEASONS, TICKS_PER_DAY, TICKS_PER_YEAR, dayIndexAt, firstTickOf, seasonAt, seasonIndexAt } from '../src/sim/calendar';
import { Claim } from '../src/sim/claims';
import { dawnTick, isNight } from '../src/sim/daylight';
import { SOWING } from '../src/sim/fields';
import { FROST_DAY, frostTick } from '../src/sim/frost';
import { Good } from '../src/sim/goods';
import { CUTTING, FETCHING_CROP } from '../src/sim/harvest';
import { SiteState } from '../src/sim/orders';
import type { Sim, Tally } from '../src/sim/sim';
import { CAMP_STORE, Wants, nearestCommonStore } from '../src/sim/stores';
import { TASK_KINDS } from '../src/sim/tasks';
import { NO_TASK, VillagerState } from '../src/sim/villagerState';
import { type Run, hhmm, play, table, when, yearsEnd } from './settlement-years';

const HOURS = [8, 10, 12, 14] as const;
/** The task kinds of a farmer's own work, by their number in `villagers.task`. */
const SOW = TASK_KINDS.indexOf(SOWING) + 1;
const CUT = TASK_KINDS.indexOf(CUTTING) + 1;
const FETCH = TASK_KINDS.indexOf(FETCHING_CROP) + 1;
/** What a farmer's daylight tick went to. */
const SHARES = ['sowing', 'cutting', 'fetching', 'idle', 'other'] as const;

/** The first night tick of day `day` (1 to 12) of calendar year `year` (0 for the first), where `frostTick` puts a frost on that day. */
function duskOf(year: number, day: number): number {
  const start = firstTickOf(year * DAYS_PER_YEAR + day - 1);
  return start + TICKS_PER_DAY - dawnTick(seasonAt(start));
}
const daylightTicks = (tick: number) => TICKS_PER_DAY - 2 * dawnTick(seasonAt(tick));

interface FarmYear {
  readonly year: number;
  /** Field tiles at the year's end, and those of them no walk from the camp reaches. */
  fieldTiles: number;
  unreachable: number;
  farms: number;
  farmSites: number;
  barns: number;
  sown: number;
  ripened: number;
  cut: number;
  lost: number;
  reaped: number;
  reapedIn: number;
  fromFields: number;
  spoiledOnFields: number;
  frostDay: number;
  barnFood: number;
  commonFood: number;
  standingAtDusk8: number;
  /** -1 in a year whose frost fell at the dusk of day 8. */
  standingAtDusk9: number;
  /** Daylight ticks in which a ripe crop stood and no common store had room for food, and those ticks in days of daylight. */
  ripeNoRoomTicks: number;
  ripeNoRoomDays: number;
  /** Daylight ticks of the frost's day in which no common store had room for food, and the daylight ticks of that day. */
  frostDayNoRoom: number;
  frostDayDaylight: number;
  /** Farmer ticks of daylight by season and by `SHARES`. */
  work: number[][];
}

interface Order {
  readonly kind: 'farm' | 'barn';
  readonly at: string;
  readonly x: number;
  readonly y: number;
  built: string | null;
}

interface Played {
  readonly run: Run;
  readonly years: FarmYear[];
  readonly orders: Order[];
}

const tallyDelta = (t: Tally, last: Tally) => ({
  sown: t.sown - last.sown,
  ripened: t.ripened - last.ripened,
  cut: t.cut - last.cut,
  lost: t.lost - last.lost,
  reaped: t.reaped - last.reaped,
  reapedIn: t.reapedIn - last.reapedIn,
  fromFields: t.fromFields - last.fromFields,
  spoiledOnFields: t.spoiledOnFields - last.spoiledOnFields,
});

/**
 * Plays the years and counts, after each step, what the step's tick held:
 * - a farmer's daylight: each daylight tick, each living villager who works and whose workplace is a farm, by the task
 *   it holds after the step: sowing, cutting, fetching cut food, no task (idle), or any other task (eating and the
 *   rest);
 * - each daylight tick in which a crop stands, some standing tile is ripe, and `nearestCommonStore` from the camp
 *   center finds no store with room for food;
 * - the standing crop at the dusk of day 8 and of day 9 of the year, read before the step of that tick, in which a
 *   frost falls first.
 * A tile the frost kills counts as lost for lack of room when no common store had room for food at one daylight tick
 * of the frost's day or more, and as lost for lack of hands or time otherwise.
 */
function playCounted(hour: number, ticks: number, farmsFrom: number | undefined): Played {
  const years: FarmYear[] = [];
  const orders: Order[] = [];
  const watched: { slot: number; order: Order }[] = [];
  let year: FarmYear | null = null;
  let last: Tally | null = null;
  let usedSites = 0;
  const dayNoRoom = new Int32Array(DAYS_PER_YEAR);
  const dayDaylight = new Int32Array(DAYS_PER_YEAR);
  const open = (sim: Sim, index: number): FarmYear => {
    dayNoRoom.fill(0);
    dayDaylight.fill(0);
    last = index === 0 ? (Object.fromEntries(Object.keys(sim.tally).map((k) => [k, 0])) as unknown as Tally) : { ...sim.tally };
    const frost = frostTick(sim.seed, index);
    return {
      year: index + 1, fieldTiles: 0, unreachable: 0, farms: 0, farmSites: 0, barns: 0,
      sown: 0, ripened: 0, cut: 0, lost: 0, reaped: 0, reapedIn: 0, fromFields: 0, spoiledOnFields: 0,
      frostDay: (dayIndexAt(frost) % DAYS_PER_YEAR) + 1, barnFood: 0, commonFood: 0, standingAtDusk8: 0, standingAtDusk9: -1,
      ripeNoRoomTicks: 0, ripeNoRoomDays: 0, frostDayNoRoom: 0, frostDayDaylight: 0, work: SEASONS.map(() => SHARES.map(() => 0)),
    };
  };
  const close = (sim: Sim, y: FarmYear) => {
    Object.assign(y, tallyDelta(sim.tally, last!));
    const { map, orders: o, flow } = sim;
    for (let t = 0; t < map.size * map.size; t++) {
      if (o.claims[t] !== Claim.Field) continue;
      y.fieldTiles += 1;
      if (flow.next[t] === -1) y.unreachable += 1;
    }
    const { sites } = o;
    for (let s = 0; s < sites.used; s++) {
      if (sites.kind[s] === Building.Farm && sites.state[s] === SiteState.Built) y.farms += 1;
      if (sites.kind[s] === Building.Farm && sites.state[s] === SiteState.Site) y.farmSites += 1;
      if (sites.kind[s] === Building.Barn && sites.state[s] === SiteState.Built) y.barns += 1;
    }
    const held = sim.stores.held[Good.Food - 1]!;
    y.barnFood = 0;
    for (let i = 0; i < sim.stores.barnCount; i++) y.barnFood += held[sim.stores.barns[i]!]!;
    y.commonFood = y.barnFood + held[CAMP_STORE]!;
    const frostDay = y.frostDay - 1;
    y.frostDayNoRoom = dayNoRoom[frostDay]!;
    y.frostDayDaylight = dayDaylight[frostDay]!;
    years.push(y);
  };
  const watch = (sim: Sim) => {
    year ??= open(sim, 0);
    const tick = sim.tick - 1;
    const { sites } = sim.orders;
    for (; usedSites < sites.used; usedSites++) {
      const kind = sites.kind[usedSites];
      if (kind !== Building.Farm && kind !== Building.Barn) continue;
      const order: Order = { kind: BUILDINGS[kind].name as 'farm' | 'barn', at: when(tick), x: sites.x[usedSites]!, y: sites.y[usedSites]!, built: null };
      orders.push(order);
      watched.push({ slot: usedSites, order });
    }
    for (const w of watched) if (w.order.built === null && sites.state[w.slot] === SiteState.Built) w.order.built = when(tick);
    const index = year.year - 1;
    if (sim.tick === duskOf(index, FROST_DAY)) year.standingAtDusk8 = sim.fields.standing;
    if (sim.tick === duskOf(index, FROST_DAY + 1)) year.standingAtDusk9 = sim.fields.standing;
    if (!isNight(tick)) {
      const season = seasonIndexAt(tick);
      const v = sim.villagers;
      for (let id = 0; id < v.count; id++) {
        if (v.state[id] === VillagerState.Dead || v.child[id] !== 0) continue;
        const w = v.workplace[id]!;
        if (w < 0 || sites.kind[w] !== Building.Farm) continue;
        const task = v.task[id]!;
        const share = task === SOW ? 0 : task === CUT ? 1 : task === FETCH ? 2 : task === NO_TASK ? 3 : 4;
        year.work[season]![share]! += 1;
      }
      const noRoom = nearestCommonStore(sim, (sim.flow.goal % sim.map.size) + 0.5, Math.floor(sim.flow.goal / sim.map.size) + 0.5, Wants.Room, Good.Food) < 0;
      const day = dayIndexAt(tick) % DAYS_PER_YEAR;
      dayDaylight[day]! += 1;
      if (noRoom) dayNoRoom[day]! += 1;
      const ripe = sim.fields.ripeThisYear - (sim.tally.cut - last!.cut);
      if (noRoom && sim.fields.standing > 0 && ripe > 0) {
        year.ripeNoRoomTicks += 1;
        year.ripeNoRoomDays += 1 / daylightTicks(tick);
      }
    }
    if (sim.tick % TICKS_PER_YEAR === yearsEnd(1) || sim.over) {
      close(sim, year);
      year = open(sim, year.year);
    }
  };
  const run = play({ hour, ticks, farmsFrom, watch });
  return { run, years, orders };
}

const pct = (n: number, of: number) => (of === 0 ? '-' : `${((100 * n) / of).toFixed(0)}%`);
const mean = (xs: number[]) => (xs.length === 0 ? '-' : (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));
const lostForRoom = (y: FarmYear) => (y.frostDayNoRoom > 0 ? y.lost : 0);

function summary(run: Run, label: string): string {
  const end = run.rows.at(-1)!;
  const died = run.rows.reduce((d, r) => ({ hunger: d.hunger + r.died.hunger, cold: d.cold + r.died.cold, old: d.old + r.died.old }), { hunger: 0, cold: 0, old: 0 });
  return `${label}, the rule at ${hhmm(run.hour)}: ${run.over ? `nobody lives from ${run.over}` : `${end.mouths} living at the end of year ${end.year}`}; most living ${run.peak}; died of hunger ${died.hunger}, of cold ${died.cold}, of old age ${died.old}.`;
}

function report(farmed: Played, bare: Played): string[] {
  const out = ['## Table 1. The living, with farms and without', '', summary(bare.run, 'Without farms (#53)'), summary(farmed.run, 'With farms'), ''];
  const years = Math.max(farmed.run.rows.length, bare.run.rows.length);
  const life = (run: Run, i: number) => {
    const r = run.rows[i];
    return r ? [r.mouths, r.born, `${r.died.hunger}/${r.died.cold}/${r.died.old}`] : ['-', '-', '-'];
  };
  out.push(
    ...table(
      ['year', 'living, no farms', 'born', 'starved/froze/old age', 'living, farms', 'born', 'starved/froze/old age', 'house/hut/barn/lodge/shed/tailor/farm, farms'],
      Array.from({ length: years }, (_, i) => {
        const b = farmed.run.rows[i]?.buildings;
        return [i + 1, ...life(bare.run, i), ...life(farmed.run, i), b ? `${b.house}/${b.hut}/${b.barn}/${b.lodge}/${b.woodshed}/${b.tailor}/${b.farm}` : '-'];
      }),
    ),
  );
  out.push('', '## Table 1b. The fields of the run with farms', '');
  out.push('The rule `farm` on the first morning of each year: the living, the field tiles wanted (3 each), those in the reach of the farms before the morning, the tiles it marked, and the farm it ordered.', '');
  out.push(...table(['year', 'living', 'wanted', 'held', 'marked', 'farm ordered on'], (farmed.run.fields ?? []).map((m) => [m.year, m.living, m.wanted, m.held, m.marked, m.farm ? `(${m.farm[0]}, ${m.farm[1]})` : '-'])));
  out.push('', 'Each year: field tiles at its end, farms standing (+ sites), barns standing, tiles sown, ripened, cut, and lost to the frost, food cut, carried in by farmers, carried in from the fields by settlers without a job, spoiled on the fields, the day of the frost, and the food at the year\'s end in the barns and in the barns and the camp.', '');
  out.push(
    ...table(
      ['year', 'field tiles', 'farms', 'barns', 'sown', 'ripened', 'cut', 'lost', 'food cut', 'by farmers', 'by settlers', 'spoiled on fields', 'frost', 'food barns', 'barns+camp'],
      farmed.years.map((y) => [y.year, y.fieldTiles, `${y.farms}${y.farmSites ? `+${y.farmSites}` : ''}`, y.barns, y.sown, y.ripened, y.cut, y.lost, y.reaped, y.reapedIn, y.fromFields, y.spoiledOnFields, y.frostDay === FROST_DAY ? 'day 8, early' : 'day 9', y.barnFood, y.commonFood]),
    ),
  );
  const unreachable = Math.max(...farmed.years.map((y) => y.unreachable));
  const sum = (key: 'sown' | 'cut' | 'lost' | 'reaped' | 'reapedIn' | 'fromFields' | 'spoiledOnFields') => farmed.years.reduce((s, y) => s + y[key], 0);
  out.push('', `Over the run: ${sum('sown')} tiles sown, ${sum('cut')} cut, ${sum('lost')} lost; ${sum('reaped')} food cut, ${sum('reapedIn')} carried in by farmers, ${sum('fromFields')} by settlers without a job, ${sum('spoiledOnFields')} spoiled on the fields. Most field tiles no walk from the camp reaches at a year's end: ${unreachable}.`);
  for (const [label, played] of [['without farms', bare], ['with farms', farmed]] as const) {
    out.push('', `Farms and barns ordered, ${label}: ${played.orders.map((o) => `${o.kind} on (${o.x}, ${o.y}) at ${o.at}, ${o.built ? `standing from ${o.built}` : 'never built'}`).join('; ') || 'none'}.`);
  }
  const secondBarn = (played: Played) => played.orders.filter((o) => o.kind === 'barn')[1];
  for (const [label, played] of [['without farms', bare], ['with farms', farmed]] as const) {
    const b = secondBarn(played);
    out.push('', `A second barn, ${label}: ${b ? `ordered by \`settle\`'s rule 6 at ${b.at}` : 'never ordered'}.`);
  }

  out.push('', "## Table 2. A farmer's daylight", '');
  out.push('Each daylight tick, each living villager who works at a farm, by the task it holds after the step: its own work (sowing, cutting, fetching cut food), no task, or another task such as eating. Shares of those farmer ticks.', '');
  const bySeason = SEASONS.map((_, s) => SHARES.map((_, k) => farmed.years.reduce((n, y) => n + y.work[s]![k]!, 0)));
  const row = (label: string | number, counts: number[]) => {
    const all = counts.reduce((a, b) => a + b, 0);
    return [label, all, pct(counts[0]! + counts[1]! + counts[2]!, all), ...counts.map((c) => pct(c, all))];
  };
  out.push(...table(['season', 'farmer ticks', 'works', ...SHARES], [...bySeason.map((c, s) => row(SEASONS[s]!, c)), row('year', SHARES.map((_, k) => bySeason.reduce((n, c) => n + c[k]!, 0)))]));
  out.push('', 'By year, the share in which a farmer works / is idle / holds another task, per season.', '');
  out.push(
    ...table(
      ['year', ...SEASONS],
      farmed.years.map((y) => [
        y.year,
        ...y.work.map((c) => {
          const all = c.reduce((a, b) => a + b, 0);
          return all === 0 ? '-' : `${pct(c[0]! + c[1]! + c[2]!, all)} / ${pct(c[3]!, all)} / ${pct(c[4]!, all)}`;
        }),
      ]),
    ),
  );

  out.push('', '## Table 3. The stores full while a crop stands', '');
  out.push(
    'Daylight ticks in which a crop stands, some standing tile is ripe, and no common store has room for food (`nearestCommonStore` from the camp center), and the same in days of that season\'s daylight. The tiles the frost killed count as lost for lack of room when no store had room at one daylight tick of the frost\'s day or more, and for lack of hands or time otherwise.',
    '',
  );
  out.push(
    ...table(
      ['year', 'ticks ripe, no room', 'days', "frost day's ticks with no room", 'lost', 'lost for lack of room', 'lost for lack of hands/time'],
      farmed.years.map((y) => [y.year, y.ripeNoRoomTicks, y.ripeNoRoomDays.toFixed(2), `${y.frostDayNoRoom}/${y.frostDayDaylight}`, y.lost, lostForRoom(y), y.lost - lostForRoom(y)]),
    ),
  );
  const ripeNoRoom = farmed.years.reduce((n, y) => n + y.ripeNoRoomTicks, 0);
  const ripeNoRoomDays = farmed.years.reduce((n, y) => n + y.ripeNoRoomDays, 0);
  const room = farmed.years.reduce((n, y) => n + lostForRoom(y), 0);
  out.push('', `Over the run: ${ripeNoRoom} daylight ticks (${ripeNoRoomDays.toFixed(1)} days) with a ripe crop and no room; ${room} of ${sum('lost')} lost tiles for lack of room.`);

  out.push('', '## Table 4. The early frost', '');
  out.push('The crop standing at the dusk of day 8 and of day 9, read before the step in which a frost falls. In a day-9 year an early frost would have killed the crop of the dusk of day 8; the difference is what one day earlier would have cost.', '');
  out.push(
    ...table(
      ['year', 'frost', 'standing at dusk of day 8', 'standing at dusk of day 9', 'lost', 'a day earlier would cost', 'food cut'],
      farmed.years.map((y) => {
        const early = y.frostDay === FROST_DAY;
        return [y.year, early ? 'day 8, early' : 'day 9', y.standingAtDusk8, early ? '-' : y.standingAtDusk9, y.lost, early ? '-' : y.standingAtDusk8 - y.standingAtDusk9, y.reaped];
      }),
    ),
  );
  const early = farmed.years.filter((y) => y.frostDay === FROST_DAY && y.sown > 0);
  const late = farmed.years.filter((y) => y.frostDay !== FROST_DAY && y.sown > 0);
  out.push(
    '',
    `Years with a crop sown: early frost (${early.map((y) => y.year).join(', ') || 'none'}): mean lost ${mean(early.map((y) => y.lost))} tiles, mean food cut ${mean(early.map((y) => y.reaped))}. ` +
      `Day-9 frost (${late.length} years): mean lost ${mean(late.map((y) => y.lost))} tiles, mean food cut ${mean(late.map((y) => y.reaped))}, mean that a day earlier would cost ${mean(late.map((y) => y.standingAtDusk8 - y.standingAtDusk9))} tiles.`,
  );
  return out;
}

function hoursReport(pairs: { farmed: Played; bare: Played }[]): string[] {
  const out = ['## Table 5. The rule at four hours, with farms and without', ''];
  const end = (run: Run) => (run.over ? `dies out ${run.over.split(' ')[0]}` : `${run.rows.at(-1)!.mouths} living`);
  out.push(...table(['hour', 'without farms', 'with farms', 'most living, without / with'], pairs.map(({ farmed, bare }) => [hhmm(farmed.run.hour), end(bare.run), end(farmed.run), `${bare.run.peak} / ${farmed.run.peak}`])));
  out.push('', ...pairs.flatMap(({ farmed, bare }) => [summary(bare.run, 'Without farms'), summary(farmed.run, 'With farms')]), '');
  const years = Math.max(...pairs.flatMap(({ farmed, bare }) => [farmed.run.rows.length, bare.run.rows.length]));
  const header = ['year', ...pairs.flatMap(({ farmed }) => [`${hhmm(farmed.run.hour)} no farms`, 'farms', 'farm tiles cut/lost'])];
  const rows = Array.from({ length: years }, (_, i) => [
    i + 1,
    ...pairs.flatMap(({ farmed, bare }) => {
      const y = farmed.years[i];
      return [bare.run.rows[i]?.mouths ?? '-', farmed.run.rows[i]?.mouths ?? '-', y ? `${y.cut}/${y.lost}` : '-'];
    }),
  ]);
  return [...out, ...table(header, rows)];
}

if (import.meta.main) {
  const flag = (name: string) => {
    const at = process.argv.indexOf(name);
    return at < 0 ? undefined : process.argv[at + 1];
  };
  const ticks = yearsEnd(Number(flag('--years') ?? 20));
  const hours = process.argv.includes('--hours') ? [...HOURS] : [Number(flag('--hour') ?? 8)];
  const started = performance.now();
  const farmsFrom = Number(flag('--farms-from') ?? 2);
  const pairs = hours.map((hour) => ({ farmed: playCounted(hour, ticks, farmsFrom), bare: playCounted(hour, ticks, undefined) }));
  const seconds = (performance.now() - started) / 1000;
  if (process.argv.includes('--json')) {
    const raw = (p: Played) => ({ ...p, run: { ...p.run, sim: undefined, log: undefined } });
    console.log(JSON.stringify({ seed: 7, seconds, runs: pairs.map(({ farmed, bare }) => ({ farmed: raw(farmed), bare: raw(bare) })) }));
  } else {
    console.log((process.argv.includes('--hours') ? hoursReport(pairs) : report(pairs[0]!.farmed, pairs[0]!.bare)).join('\n'));
    console.log(`\nWall seconds: ${seconds.toFixed(1)}.`);
  }
}
