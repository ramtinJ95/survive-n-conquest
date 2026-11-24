// What each workshop's panel reads in daylight, tick by tick, in a first year on seed 7: `bun scripts/workshop-reasons.ts [year ...]`.
// With no year named it plays #40's "wood and hides". Each idle reading is split by where the workshop's input is
// at that tick: on a stockpile tile, off every stockpile where a walk reaches it, in a carrier's hands, or nowhere.
// `hides-page` is that year as the verification skill gives it. `--first` also prints the first daylight minute of each day on which the tailor's panel reads its reading for loose hides.
import { BUILDINGS, Building } from '../src/sim/buildings';
import { Claim } from '../src/sim/claims';
import { CARRYING } from '../src/sim/carrying';
import { DAYS_PER_YEAR, dateAt } from '../src/sim/calendar';
import { isNight } from '../src/sim/daylight';
import { HIDES_LAYOUT, WOOD_LAYOUT, type WinterYear, playWinterYear, winterYearCommands } from '../src/sim/firstYear';
import type { Unit } from '../src/sim/goods';
import { SiteState } from '../src/sim/orders';
import { type Sim, applyCommand } from '../src/sim/sim';
import { TASK_KINDS } from '../src/sim/tasks';
import { tickAt } from './firewood-years';

const CARRY = TASK_KINDS.indexOf(CARRYING) + 1;

/** Each workshop panel's `Doing` for each value of `workshops.stopped`, as `src/ui/selection.ts` words it. A value the build does not have reads as its number. */
const STOP_WORDS: Readonly<Partial<Record<Building, readonly string[]>>> = {
  [Building.Woodshed]: [
    'Working or looking for a log',
    'Idle, the woodshed is full',
    'Idle, no log in a stockpile within 30 tiles of the woodshed',
    'Idle, the building sites need the logs',
    'Idle, no log carried to a stockpile yet',
  ],
  [Building.Tailor]: [
    'Working or looking for a hide',
    "Idle, the tailor's hut is full",
    "Idle, no hide in a stockpile within 30 tiles of the tailor's hut",
    'Idle, the building sites need the hides',
    'Idle, no hide carried to a stockpile yet',
  ],
};

const HIDES = winterYearCommands({ houses: 2, layout: HIDES_LAYOUT, tailor: 'after lodge' });

/** A year, and for a year as the verification skill gives it, the tick at which it gives the commands the script gives on the tick the lodge is finished. */
const YEARS: Readonly<Record<string, { readonly title: string; readonly year: WinterYear; readonly lateAt?: number }>> = {
  hides: { title: "#40's year wood and hides", year: HIDES },
  'hides-page': {
    title: "#40's year wood and hides as the verification skill gives it, with the tailor's hut at 08:30 on day 4",
    year: { atStart: HIDES.atStart, afterLodge: [] },
    lateAt: tickAt(4, '08:30'),
  },
  wood: { title: "#40's year wood", year: winterYearCommands({ houses: 4, layout: WOOD_LAYOUT, tailor: 'at start' }) },
  'clothing-at-start': { title: "4.4's year with the tailor's hut at the start", year: winterYearCommands({ houses: 0, layout: HIDES_LAYOUT, tailor: 'at start' }) },
  'clothing-after-lodge': { title: "4.4's year with the tailor's hut after the lodge", year: winterYearCommands({ houses: 0, layout: HIDES_LAYOUT, tailor: 'after lodge' }) },
};

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};

/** Where the input of a workshop is at this tick, read from the map's stacks and the carriers' hands, not from the sim's sets. */
function whereInput(sim: Sim, good: Unit): string {
  const { map, orders, villagers } = sim;
  let stockpiled = false;
  let loose = false;
  for (let tile = 0; tile < map.size * map.size; tile++) {
    if (map.stackGood[tile] !== good || map.stackSize[tile] === 0) continue;
    if (orders.claims[tile] === Claim.Stockpile) stockpiled = true;
    else if (sim.flow.next[tile] !== -1 && orders.siteOf[tile] === -1) loose = true;
  }
  if (stockpiled) return 'some on a stockpile';
  if (loose) return 'off every stockpile';
  for (let id = 0; id < villagers.state.length; id++) if (villagers.task[id] === CARRY && villagers.carried[id] === good) return "in a carrier's hands";
  return 'nowhere';
}

function play(name: string, first: boolean) {
  const entry = YEARS[name];
  if (!entry) throw new Error(`no year named ${name}; the years are ${Object.keys(YEARS).join(', ')}`);
  const { sim, step } = playWinterYear(entry.year);
  const readings = new Map<string, Map<string, number>>();
  const firstByDay: string[] = [];
  let lastDay = -1;
  while (!sim.over && dateAt(sim.tick).day <= DAYS_PER_YEAR) {
    if (sim.tick === entry.lateAt) for (const command of HIDES.afterLodge) if (!applyCommand(sim, command)?.ok) throw new Error(`refused at ${clock(sim.tick)}: ${JSON.stringify(command)}`);
    if (!isNight(sim.tick)) {
      for (let slot = 0; slot < sim.orders.sites.used; slot++) {
        const kind = sim.orders.sites.kind[slot] as Building;
        const words = STOP_WORDS[kind];
        if (!words || sim.orders.sites.state[slot] !== SiteState.Built) continue;
        const stop = sim.workshops.stopped[slot]!;
        const doing = sim.villagers.workplace.includes(slot) ? (words[stop] ?? `stop ${stop}`) : 'Nobody works here';
        const where = stop === 0 || stop === 1 ? '' : whereInput(sim, BUILDINGS[kind].recipe!.input);
        const key = `${BUILDINGS[kind].name} | ${doing}`;
        const byWhere = readings.get(key) ?? new Map<string, number>();
        byWhere.set(where, (byWhere.get(where) ?? 0) + 1);
        readings.set(key, byWhere);
        const { day } = dateAt(sim.tick);
        if (first && kind === Building.Tailor && stop === 4 && day !== lastDay) {
          firstByDay.push(clock(sim.tick));
          lastDay = day;
        }
      }
    }
    step();
  }
  console.log(`## ${entry.title}`);
  console.log('| Workshop | Doing | Daylight ticks | Where the input was |');
  console.log('| --- | --- | --- | --- |');
  for (const [key, byWhere] of readings) {
    const total = [...byWhere.values()].reduce((a, b) => a + b, 0);
    const split = [...byWhere].filter(([where]) => where !== '').map(([where, ticks]) => `${where} ${ticks}`);
    console.log(`| ${key} | ${total} | ${split.join('; ')} |`);
  }
  if (first) console.log(`\nfirst daylight tick of each day with the tailor's loose-hides reading: ${firstByDay.join(', ') || 'none'}`);
  console.log('');
}

const args = process.argv.slice(2);
const first = args.includes('--first');
const names = args.filter((arg) => !arg.startsWith('--'));
for (const name of names.length > 0 ? names : ['hides']) play(name, first);
