// The starting settlers' ages and life spans on a seed, and the dawn at which each dies of old age:
// `bun scripts/ages.ts [--seed 7] [--json]`. It reads the game's own draws on the map a new game opens, and finds
// each dawn by the clock alone, not by running the simulation.
import { TICKS_PER_YEAR_OF_AGE, dateAt } from '../src/sim/calendar';
import { ageAt } from '../src/sim/aging';
import { isDawn } from '../src/sim/daylight';
import { generateMap } from '../src/sim/mapgen';
import { Sex, nameOf } from '../src/sim/names';
import { SETTLERS, createSim } from '../src/sim/sim';

const args = process.argv.slice(2);
const seedAt = args.indexOf('--seed');
const seed = seedAt >= 0 ? Number(args[seedAt + 1]) : 7;
if (!Number.isInteger(seed)) throw new Error('--seed takes a whole number');

const { villagers } = createSim(generateMap(seed), SETTLERS);
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const rows = Array.from({ length: villagers.count }, (_, id) => {
  const reachesSpan = villagers.born[id]! + villagers.span[id]! * TICKS_PER_YEAR_OF_AGE;
  let dies = reachesSpan;
  while (!isDawn(dies)) dies++;
  const { day, year, minuteOfDay } = dateAt(dies);
  return {
    id,
    name: nameOf(villagers.sex[id] as Sex, villagers.name[id]!),
    sex: villagers.sex[id] === Sex.Man ? 'man' : 'woman',
    age: ageAt(villagers, id, 0),
    span: villagers.span[id]!,
    reachesSpan,
    diesAt: dies,
    day,
    year,
    time: clock(minuteOfDay),
  };
});

if (args.includes('--json')) {
  console.log(JSON.stringify(rows));
} else {
  console.log(`Starting settlers of seed ${seed}, and the dawn at which each dies of old age.\n`);
  console.log('| id | name | sex | age on day 1 | life span | reaches its span at tick | dies at the dawn of tick | day | year | time |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of rows) {
    console.log(`| ${row.id} | ${row.name} | ${row.sex} | ${row.age} | ${row.span} | ${row.reachesSpan} | ${row.diesAt} | ${row.day} | ${row.year} | ${row.time} |`);
  }
}
