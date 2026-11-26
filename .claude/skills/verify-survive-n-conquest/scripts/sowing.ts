// The first spring on seed 7 as the `sowing` scenario gives it, played in src/sim, so the scenario can check the page
// against the rules. Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/sowing.ts '<stops>'
// The stops are [{ "day": 1, "time": "12:20" }, ...] in the order the scenario reaches them. It gives `firstSpringCommands`
// at tick 0, 08:00 on day 1, and prints JSON: the field's tiles, the tick and the minute at which the farm stands, its
// farmers by name in the order they came, and at the first tick of each stop's minute the field tiles sown and where
// each farmer stands, in tile coordinates.
import { Job } from '../../../../src/sim/buildings';
import { MINUTES_PER_DAY, dateAt } from '../../../../src/sim/calendar';
import { NOT_SOWN } from '../../../../src/sim/fields';
import { FIRST_SPRING_FARM, FIRST_SPRING_FIELD, FIRST_YEAR_SEED, firstSpringCommands } from '../../../../src/sim/firstYear';
import { jobOf } from '../../../../src/sim/jobs';
import { generateMap } from '../../../../src/sim/mapgen';
import { type Sex, nameOf } from '../../../../src/sim/names';
import { SiteState } from '../../../../src/sim/orders';
import { SETTLERS, applyCommand, createSim, step } from '../../../../src/sim/sim';

const stops: { day: number; time: string }[] = JSON.parse(process.argv[2] ?? '[]');
const minuteOf = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return (day - 1) * MINUTES_PER_DAY + minuteOfDay;
};
const clock = (minutes: number) => `day ${Math.floor(minutes / MINUTES_PER_DAY) + 1} ${String(Math.floor((minutes % MINUTES_PER_DAY) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
for (const command of firstSpringCommands()) {
  const outcome = applyCommand(sim, command);
  if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
}
const { size } = sim.map;
const farm = sim.orders.siteOf[FIRST_SPRING_FARM.y * size + FIRST_SPRING_FARM.x]!;
const field: [number, number][] = [];
for (let y = FIRST_SPRING_FIELD.y0; y <= FIRST_SPRING_FIELD.y1; y++) for (let x = FIRST_SPRING_FIELD.x0; x <= FIRST_SPRING_FIELD.x1; x++) field.push([x, y]);
const nameOfVillager = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const farmerIds = () =>
  [...sim.villagers.workplace.subarray(0, sim.villagers.count).keys()]
    .filter((id) => sim.villagers.workplace[id] === farm && jobOf(sim, id) === Job.Farmer)
    .sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!);

let stands: { tick: number; minute: number; at: string } | null = null;
const advance = (tick: number) => {
  while (sim.tick < tick) {
    step(sim);
    if (!stands && sim.orders.sites.state[farm] === SiteState.Built) stands = { tick: sim.tick - 1, minute: minuteOf(sim.tick - 1), at: clock(minuteOf(sim.tick - 1)) };
  }
};
const read = stops.map(({ day, time }) => {
  const [hours, minutes] = time.split(':').map(Number);
  const want = (day - 1) * MINUTES_PER_DAY + hours! * 60 + minutes!;
  let tick = sim.tick;
  while (minuteOf(tick) < want) tick++;
  advance(tick);
  return {
    at: clock(want),
    tick: sim.tick,
    sown: field.filter(([x, y]) => sim.fields.sownAt[y * size + x] !== NOT_SOWN),
    farmers: farmerIds().map((id) => ({ name: nameOfVillager(id), x: sim.villagers.x[id], y: sim.villagers.y[id] })),
  };
});
console.log(JSON.stringify({ field, stands, farmers: farmerIds().map(nameOfVillager), stops: read }));
