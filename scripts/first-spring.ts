// The first spring on seed 7 with a farm and a field of 24 tiles: `bun scripts/first-spring.ts`.
// It gives `firstSpringCommands` at 08:00 on day 1, runs to the midnight that ends spring, and prints the tick at which
// the farm stands, the tiles sown on each day, and how each farmer spent its daylight ticks.
import { BUILDINGS, Building, Job } from '../src/sim/buildings';
import { DAYS_PER_SEASON, dateAt, seasonAt } from '../src/sim/calendar';
import { isNight } from '../src/sim/daylight';
import { SOWING, SOW_WORK_TICKS } from '../src/sim/fields';
import { FIRST_SPRING_FARM, FIRST_SPRING_FIELD, FIRST_YEAR_SEED, firstSpringCommands } from '../src/sim/firstYear';
import { jobOf } from '../src/sim/jobs';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState } from '../src/sim/orders';
import { SETTLERS, applyCommand, createSim, step } from '../src/sim/sim';
import { TASK_KINDS } from '../src/sim/tasks';
import { NO_TASK, VillagerState } from '../src/sim/villagerState';

const SOW = TASK_KINDS.indexOf(SOWING) + 1;
const ESTIMATE_PER_FARMER_DAY = 4;

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};

const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
for (const command of firstSpringCommands()) {
  const outcome = applyCommand(sim, command);
  if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  if (command.kind === 'markArea' && command.order === 'field') console.log(`the field order marks ${outcome.tiles} tiles`);
}
const { size } = sim.map;
const farm = sim.orders.siteOf[FIRST_SPRING_FARM.y * size + FIRST_SPRING_FARM.x]!;
const { side } = BUILDINGS[Building.Farm];
const fieldTiles = (FIRST_SPRING_FIELD.x1 - FIRST_SPRING_FIELD.x0 + 1) * (FIRST_SPRING_FIELD.y1 - FIRST_SPRING_FIELD.y0 + 1);
const distance = Math.hypot(
  (FIRST_SPRING_FIELD.x0 + FIRST_SPRING_FIELD.x1 + 1) / 2 - (FIRST_SPRING_FARM.x + side / 2),
  (FIRST_SPRING_FIELD.y0 + FIRST_SPRING_FIELD.y1 + 1) / 2 - (FIRST_SPRING_FARM.y + side / 2),
);
console.log(
  `seed ${FIRST_YEAR_SEED}, ${size} map, ${SETTLERS.villagers} settlers; at 08:00 on day 1 a farm anchored on (${FIRST_SPRING_FARM.x}, ${FIRST_SPRING_FARM.y}), ` +
    `a field of ${fieldTiles} tiles from (${FIRST_SPRING_FIELD.x0}, ${FIRST_SPRING_FIELD.y0}) to (${FIRST_SPRING_FIELD.x1}, ${FIRST_SPRING_FIELD.y1}) whose middle is ${distance.toFixed(1)} tiles from the farm's, and 4 trees chopped for 8 logs`,
);

interface Spent {
  sowing: number;
  walking: number;
  idle: number;
  other: number;
}
const spent = new Map<number, Spent[]>();
const sownByDay = Array.from({ length: DAYS_PER_SEASON }, () => 0);
let stood = -1;
const heldTile = new Int32Array(sim.villagers.count).fill(-1);
while (seasonAt(sim.tick) === 'Spring') {
  const day = dateAt(sim.tick).day;
  const daylight = !isNight(sim.tick);
  const sown = sim.tally.sown;
  for (let id = 0; id < sim.villagers.count; id++) heldTile[id] = sim.villagers.task[id] === SOW ? sim.villagers.taskTile[id]! : -1;
  step(sim);
  sownByDay[day - 1]! += sim.tally.sown - sown;
  if (stood < 0 && sim.orders.sites.state[farm] === SiteState.Built) {
    stood = sim.tick - 1;
    const farmers = [...sim.villagers.workplace.subarray(0, sim.villagers.count).keys()].filter((id) => sim.villagers.workplace[id] === farm);
    console.log(`  the farm stands at tick ${stood}, ${clock(stood)}; its farmers: ${farmers.map((id) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!)).join(' and ')}`);
  }
  if (!daylight) continue;
  for (let id = 0; id < sim.villagers.count; id++) {
    if (jobOf(sim, id) !== Job.Farmer || sim.villagers.state[id] === VillagerState.Dead) continue;
    if (!spent.has(id)) spent.set(id, Array.from({ length: DAYS_PER_SEASON }, () => ({ sowing: 0, walking: 0, idle: 0, other: 0 })));
    const counts = spent.get(id)![day - 1]!;
    const task = sim.villagers.task[id];
    // The step that finishes a tile ends the task, so its last work tick shows as a tile sown on this tick.
    const finished = heldTile[id]! >= 0 && sim.fields.sownAt[heldTile[id]!] === sim.tick - 1;
    if (task === SOW) counts[sim.villagers.state[id] === VillagerState.Working ? 'sowing' : 'walking']++;
    else if (finished) counts.sowing++;
    else if (task === NO_TASK) counts.idle++;
    else counts.other++;
  }
}

const farmers = spent.size;
const sowingTicks = [...spent.values()].flat().reduce((sum, { sowing }) => sum + sowing, 0);
if (sowingTicks !== sim.tally.sown * SOW_WORK_TICKS) throw new Error(`${sowingTicks} sowing ticks counted for ${sim.tally.sown} tiles of ${SOW_WORK_TICKS} ticks`);
console.log(`  tiles sown: ${sownByDay.map((tiles, day) => `day ${day + 1} ${tiles}`).join(', ')}; ${sim.tally.sown} of ${fieldTiles} in the spring`);
console.log(
  `  the brief's estimate: ${ESTIMATE_PER_FARMER_DAY} tiles a farmer on each spring day, ${ESTIMATE_PER_FARMER_DAY * farmers} a day for ${farmers} farmers`,
);
console.log('  daylight ticks of each farmer, from the tick it took its place: day, sowing, walking to a tile, idle, other tasks');
for (const [id, days] of spent) {
  const name = nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
  days.forEach(({ sowing, walking, idle, other }, day) => console.log(`    ${name} day ${day + 1}: sowing ${sowing}, walking ${walking}, idle ${idle}, other ${other}`));
}
