// Two years of `src/sim` on seed 7 with four houses, and the children born in them:
// `bun scripts/birth-years.ts [--seed n] [--hungry h] [--json]`.
// The orders are those of the year that lives in `firewood-years.ts`, `NEAR_HOUSES_LATE_SHED`: #30's hut, barn, and
// lodge, four houses on the nearest places and 4.2's stockpile at 08:00 on day 1, and the woodshed with 9 trees when no
// site lacks a log. Nothing is ordered after them. The script prints the day of each birth, the household, and the
// people at each year's end. Then it plays the same two years with household `h`, 1 unless stated, kept hungry: at each
// dusk the script sets every unit of food in that household's house aside, so its members come home to an empty store,
// miss their meal, and are still hungry after the dawn's meals, when the household draws for a birth. On the tick after
// each dawn the script puts the food back, so they eat it by day and none of them misses a second meal in a row.
import { ageAt } from '../src/sim/aging';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from '../src/sim/calendar';
import { isDawn, isNight } from '../src/sim/daylight';
import { Good } from '../src/sim/goods';
import { NO_HOME } from '../src/sim/households';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SETTLERS, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { Cause, VillagerState } from '../src/sim/villagerState';
import { NEAR_HOUSES_LATE_SHED, clock, ordersOf } from './firewood-years';

const YEARS = 2;
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const SEED = Number(flag('--seed') ?? 7);
const HUNGRY = Number(flag('--hungry') ?? 1);
const FOOD = Good.Food - 1;
/** The year ends at 08:00 on its last day plus one, as the clock opens each day at 08:00. */
const yearEnd = (year: number) => year * DAYS_PER_YEAR * TICKS_PER_DAY;

const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const coupleOf = (sim: Sim, h: number) => [sim.households.man[h]!, sim.households.woman[h]!].map((id) => nameOfId(sim, id)).join(' and ');
const CAUSES: Readonly<Record<number, string>> = { [Cause.Hunger]: 'starved', [Cause.Cold]: 'froze', [Cause.OldAge]: 'died of old age' };

interface Birth {
  readonly at: string;
  readonly household: number;
  readonly couple: string;
  readonly child: string;
  readonly sex: string;
}

interface People {
  readonly year: number;
  readonly households: readonly { readonly household: number; readonly couple: string; readonly home: string; readonly members: readonly string[] }[];
  readonly living: number;
  readonly children: number;
}

/** Each household at the end of a year: its couple, its home, and each member with its age, or how it died. */
function peopleOf(sim: Sim, year: number): People {
  const { villagers, households } = sim;
  let children = 0;
  for (let id = 0; id < villagers.count; id++) if (villagers.state[id] !== VillagerState.Dead && villagers.child[id] === 1) children++;
  return {
    year,
    living: sim.living,
    children,
    households: Array.from({ length: households.count }, (_, h) => {
      const members: string[] = [];
      for (let id = 0; id < villagers.count; id++) {
        if (villagers.household[id] !== h) continue;
        const dead = villagers.state[id] === VillagerState.Dead;
        const role = villagers.child[id] === 1 ? 'child' : 'adult';
        members.push(`${nameOfId(sim, id)} (${role}, ${dead ? `${CAUSES[villagers.cause[id]!]} ${clock(villagers.diedAt[id]!)}` : `${ageAt(villagers, id, sim.tick)}`})`);
      }
      const home = households.living[h] === 0 ? 'nobody left' : households.home[h] === NO_HOME ? 'the camp' : `house ${households.home[h]}`;
      return { household: h + 1, couple: coupleOf(sim, h), home, members };
    }),
  };
}

/** Plays the two years, with household `hungry` kept hungry when it is not -1. */
function play(hungry: number): { births: Birth[]; years: People[]; dusks: number; missed: number } {
  const sim = createSim(generateMap(SEED), SETTLERS);
  const pending = ordersOf(NEAR_HOUSES_LATE_SHED);
  const births: Birth[] = [];
  const years: People[] = [];
  let dusks = 0;
  let aside = 0;
  while (sim.tick < yearEnd(YEARS) && !sim.over) {
    for (let i = 0; i < pending.length; ) {
      if (!pending[i]!.when.ready(sim)) i++;
      else for (const command of pending.splice(i, 1)[0]!.give(sim)) applyCommand(sim, command);
    }
    const dusk = isNight(sim.tick) && !isNight(sim.tick - 1);
    const house = hungry < 0 ? NO_HOME : sim.households.home[hungry]!;
    if (dusk && house !== NO_HOME) {
      dusks += 1;
      aside = sim.stores.held[FOOD]![house]!;
      sim.stores.held[FOOD]![house] = 0;
    }
    if (isDawn(sim.tick - 1) && aside > 0) {
      if (house !== NO_HOME) sim.stores.held[FOOD]![house]! += aside;
      aside = 0;
    }
    const before = sim.villagers.count;
    const ticked = sim.tick;
    step(sim);
    for (let id = before; id < sim.villagers.count; id++) {
      const h = sim.villagers.household[id]!;
      births.push({ at: clock(ticked), household: h + 1, couple: coupleOf(sim, h), child: nameOfId(sim, id), sex: sim.villagers.sex[id] === 0 ? 'girl' : 'boy' });
    }
    if (sim.tick === yearEnd(years.length + 1)) years.push(peopleOf(sim, years.length + 1));
  }
  if (sim.over) years.push(peopleOf(sim, years.length + 1));
  return { births, years, dusks, missed: sim.tally.missed };
}

function print(title: string, run: ReturnType<typeof play>): void {
  console.log(`\n## ${title}\n`);
  console.log('| Birth | Household | Couple | Child |');
  console.log('| --- | --- | --- | --- |');
  for (const birth of run.births) console.log(`| ${birth.at} | ${birth.household} | ${birth.couple} | ${birth.child}, a ${birth.sex} |`);
  if (run.births.length === 0) console.log('| none | | | |');
  for (const year of run.years) {
    console.log(`\nAt the end of year ${year.year}: ${year.living} living, ${year.children} of them children.\n`);
    console.log('| Household | Home | Members |');
    console.log('| --- | --- | --- |');
    for (const { household, couple, home, members } of year.households) console.log(`| ${household}, ${couple} | ${home} | ${members.join('; ')} |`);
  }
  console.log(`\nmeals missed in the two years: ${run.missed}${run.dusks > 0 ? `; dusks at which the script emptied the kept-hungry house: ${run.dusks}` : ''}`);
}

const fed = play(-1);
const kept = play(HUNGRY - 1);
if (process.argv.includes('--json')) console.log(JSON.stringify({ seed: SEED, hungry: HUNGRY, fed, kept }));
else {
  console.log(`# Births in two years on seed ${SEED}: ${NEAR_HOUSES_LATE_SHED.title}`);
  print('Every household fed', fed);
  print(`Household ${HUNGRY} kept hungry`, kept);
}
