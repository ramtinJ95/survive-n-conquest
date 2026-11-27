// The first harvest on seed 7 as the `harvest` scenario gives it, played in src/sim, so the scenario can check the page
// against the rules. Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/harvest.ts
// '<stops>' The stops are [{ "day": 6, "time": "03:36" }, ...] in the order the scenario reaches them. A stop with
// "places": [1, 0] sets the farm's places to each of those numbers in turn after its reading, as presses of the farm
// panel's Fewer places and More places buttons at that stop do. It prints JSON: the orders it gives at tick 0, 08:00 on
// day 1, on a camp that starts with `CAMP_FOOD` food, the field's tiles, the minute each building stands, the farmers
// by name in the order they came, the minute of each dawn at which tiles ripen and how many, and at the first tick of
// each stop's minute each field tile's state and the dawns its crop has grown, the food in the barn and at the camp,
// the tallies of the harvest, and where each farmer stands and what task it holds.
import { Building, Job } from '../../../../src/sim/buildings';
import { MINUTES_PER_DAY, dateAt } from '../../../../src/sim/calendar';
import { isDawn } from '../../../../src/sim/daylight';
import { SOWING, fieldState, grownDawns } from '../../../../src/sim/fields';
import { FIRST_YEAR_BARN_ROCK, FIRST_YEAR_BARN_TREES, FIRST_YEAR_LOG_TREES, FIRST_YEAR_SEED } from '../../../../src/sim/firstYear';
import { Good } from '../../../../src/sim/goods';
import { jobOf } from '../../../../src/sim/jobs';
import { generateMap } from '../../../../src/sim/mapgen';
import { type Sex, nameOf } from '../../../../src/sim/names';
import { SiteState, type TileArea } from '../../../../src/sim/orders';
import { type Command, SETTLERS, applyCommand, createSim, step } from '../../../../src/sim/sim';
import { CAMP_STORE } from '../../../../src/sim/stores';
import { TASK_KINDS } from '../../../../src/sim/tasks';
import { CUTTING, FETCHING_CROP } from '../../../../src/sim/harvest';
import { VillagerState } from '../../../../src/sim/villagerState';

/**
 * 6.1's farm, a field of 24 tiles one tile north and east of 6.1's, and a barn between them and the camp, whose
 * middle lies nearer every field tile than the camp's center does, so the harvest goes into the barn. The camp starts
 * with food for the dusks of days 1 to 7, so nobody goes hungry before the harvest.
 */
const FARM = { x: 136, y: 127 };
const FIELD: TileArea = { x0: 130, y0: 121, x1: 135, y1: 124 };
const BARN = { x: 132, y: 126 };
const CAMP_FOOD = 56;
const one = ([x, y]: readonly [number, number]): TileArea => ({ x0: x, y0: y, x1: x, y1: y });
const commands: Command[] = [
  { kind: 'place', building: Building.Farm, ...FARM },
  { kind: 'markArea', order: 'field', area: FIELD },
  { kind: 'place', building: Building.Barn, ...BARN },
  ...[...FIRST_YEAR_LOG_TREES, ...FIRST_YEAR_BARN_TREES].map((at): Command => ({ kind: 'markArea', order: 'chop', area: one(at) })),
  { kind: 'markArea', order: 'quarry', area: one(FIRST_YEAR_BARN_ROCK) },
];
const TASK_NAMES = new Map([
  [TASK_KINDS.indexOf(SOWING) + 1, 'sowing'],
  [TASK_KINDS.indexOf(FETCHING_CROP) + 1, 'fetching'],
  [TASK_KINDS.indexOf(CUTTING) + 1, 'cutting'],
]);

const stops: { day: number; time: string; places?: number[] }[] = JSON.parse(process.argv[2] ?? '[]');
const minuteOf = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return (day - 1) * MINUTES_PER_DAY + minuteOfDay;
};
const clock = (minutes: number) => `day ${Math.floor(minutes / MINUTES_PER_DAY) + 1} ${String(Math.floor((minutes % MINUTES_PER_DAY) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const sim = createSim(generateMap(FIRST_YEAR_SEED), { ...SETTLERS, campFood: CAMP_FOOD });
for (const command of commands) {
  const outcome = applyCommand(sim, command);
  if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
}
const { size } = sim.map;
const farm = sim.orders.siteOf[FARM.y * size + FARM.x]!;
const barn = sim.orders.siteOf[BARN.y * size + BARN.x]!;
const field: [number, number][] = [];
for (let y = FIELD.y0; y <= FIELD.y1; y++) for (let x = FIELD.x0; x <= FIELD.x1; x++) field.push([x, y]);
const nameOfVillager = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const farmerIds = () =>
  [...sim.villagers.workplace.subarray(0, sim.villagers.count).keys()]
    .filter((id) => sim.villagers.workplace[id] === farm && jobOf(sim, id) === Job.Farmer)
    .sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!);

const stands: Record<string, { tick: number; at: string } | null> = { farm: null, barn: null };
const ripening: { tick: number; at: string; tiles: number }[] = [];
const advance = (tick: number) => {
  while (sim.tick < tick) {
    const dawn = isDawn(sim.tick);
    const ripened = sim.tally.ripened;
    step(sim);
    if (dawn && sim.tally.ripened > ripened) ripening.push({ tick: sim.tick - 1, at: clock(minuteOf(sim.tick - 1)), tiles: sim.tally.ripened - ripened });
    for (const [name, slot] of [['farm', farm], ['barn', barn]] as const) {
      if (!stands[name] && sim.orders.sites.state[slot] === SiteState.Built) stands[name] = { tick: sim.tick - 1, at: clock(minuteOf(sim.tick - 1)) };
    }
  }
};
const read = stops.map(({ day, time, places = [] }) => {
  const [hours, minutes] = time.split(':').map(Number);
  const want = (day - 1) * MINUTES_PER_DAY + hours! * 60 + minutes!;
  let tick = sim.tick;
  while (minuteOf(tick) < want) tick++;
  advance(tick);
  const { tally } = sim;
  const reading = {
    at: clock(want),
    tick: sim.tick,
    tiles: field.map(([x, y]) => ({ state: fieldState(sim.fields, y * size + x, sim.tick), grown: grownDawns(sim.fields, y * size + x, sim.tick), food: sim.map.stackGood[y * size + x] === Good.Food ? sim.map.stackSize[y * size + x] : 0 })),
    barnFood: sim.stores.held[Good.Food - 1]![barn],
    campFood: sim.stores.held[Good.Food - 1]![CAMP_STORE],
    tally: { sown: tally.sown, ripened: tally.ripened, cut: tally.cut, reaped: tally.reaped, reapedIn: tally.reapedIn, fromFields: tally.fromFields, spoiledOnFields: tally.spoiledOnFields, missed: tally.missed },
    ripeThisYear: sim.fields.ripeThisYear,
    farmers: farmerIds().map((id) => ({
      name: nameOfVillager(id),
      x: sim.villagers.x[id],
      y: sim.villagers.y[id],
      task: TASK_NAMES.get(sim.villagers.task[id]!) ?? (sim.villagers.task[id] === 0 ? 'none' : 'other'),
      carried: sim.villagers.carried[id] === Good.Food,
      working: sim.villagers.state[id] === VillagerState.Working,
    })),
  };
  for (const wanted of places) applyCommand(sim, { kind: 'setPlaces', slot: farm, places: wanted });
  return reading;
});
console.log(JSON.stringify({ commands, field, farm: FARM, barn: BARN, campFood: CAMP_FOOD, stands, farmers: farmerIds().map(nameOfVillager), ripening, stops: read }));
