// The first year's frost on seed 7 as the `frost` scenario gives it, played in src/sim, so the scenario can check the
// page against the rules. Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/frost.ts
// '<stops>' The stops are [{ "day": 9, "time": "04:50" }, ...] in the order the scenario reaches them. A stop with
// "places": [1, 0] sets the farm's places to each of those numbers in turn after its reading, as presses of the farm
// panel's Fewer places and More places buttons at that stop do. It prints JSON: the orders it gives at tick 0, 08:00 on
// day 1, on a camp that starts with `CAMP_FOOD` food, the field's tiles, the minute each building stands, the tick and
// the minute of the year's frost and of the dawn of its day, the first dawn of spring after it, and at the first tick of
// each stop's minute each field tile's state and the dawns its crop has grown, the crops that stand, the tiles the frost
// killed, the food in the barn and at the camp, the tallies, the living settlers, and where each farmer stands and what
// task it holds.
import { Job } from '../../../../src/sim/buildings';
import { DAYS_PER_YEAR, MINUTES_PER_DAY, dateAt, dayIndexAt, firstTickOf, seasonAt } from '../../../../src/sim/calendar';
import { dawnTick, isDawn } from '../../../../src/sim/daylight';
import { SOWING, fieldState, grownDawns } from '../../../../src/sim/fields';
import { FIRST_YEAR_SEED } from '../../../../src/sim/firstYear';
import { Good } from '../../../../src/sim/goods';
import { CUTTING, FETCHING_CROP } from '../../../../src/sim/harvest';
import { jobOf } from '../../../../src/sim/jobs';
import { generateMap } from '../../../../src/sim/mapgen';
import { type Sex, nameOf } from '../../../../src/sim/names';
import { SiteState } from '../../../../src/sim/orders';
import { SETTLERS, applyCommand, createSim, step } from '../../../../src/sim/sim';
import { CAMP_STORE } from '../../../../src/sim/stores';
import { TASK_KINDS } from '../../../../src/sim/tasks';
import { VillagerState } from '../../../../src/sim/villagerState';
import { BARN, CAMP_FOOD, FARM, FIELD, FROST_COMMANDS, HOUSES, WOODSHED } from './frostSettlement';

const commands = FROST_COMMANDS;
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
const when = (tick: number) => ({ tick, at: clock(minuteOf(tick)) });

const sim = createSim(generateMap(FIRST_YEAR_SEED), { ...SETTLERS, campFood: CAMP_FOOD });
const marked = commands.map((command) => {
  const outcome = applyCommand(sim, command);
  if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  return outcome.tiles;
});
const { size } = sim.map;
const slotOf = ({ x, y }: { x: number; y: number }) => sim.orders.siteOf[y * size + x]!;
const buildings = { farm: slotOf(FARM), barn: slotOf(BARN), woodshed: slotOf(WOODSHED), house1: slotOf(HOUSES[0]!), house2: slotOf(HOUSES[1]!) };
const field: [number, number][] = [];
for (let y = FIELD.y0; y <= FIELD.y1; y++) for (let x = FIELD.x0; x <= FIELD.x1; x++) field.push([x, y]);
const nameOfVillager = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const farmerIds = () =>
  [...sim.villagers.workplace.subarray(0, sim.villagers.count).keys()]
    .filter((id) => sim.villagers.workplace[id] === buildings.farm && jobOf(sim, id) === Job.Farmer)
    .sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!);

const frost = when(sim.fields.frostAt);
const frostDay = dayIndexAt(sim.fields.frostAt);
const frostDawn = when(firstTickOf(frostDay) + dawnTick(seasonAt(firstTickOf(frostDay))));
const springDay = (Math.floor(frostDay / DAYS_PER_YEAR) + 1) * DAYS_PER_YEAR;
const springDawn = when(firstTickOf(springDay) + dawnTick(seasonAt(firstTickOf(springDay))));
const stands: Record<string, { tick: number; at: string } | null> = Object.fromEntries(Object.keys(buildings).map((name) => [name, null]));
const ripening: { tick: number; at: string; tiles: number }[] = [];
const advance = (tick: number) => {
  while (sim.tick < tick) {
    const dawn = isDawn(sim.tick);
    const ripened = sim.tally.ripened;
    step(sim);
    if (dawn && sim.tally.ripened > ripened) ripening.push({ ...when(sim.tick - 1), tiles: sim.tally.ripened - ripened });
    for (const [name, slot] of Object.entries(buildings)) if (!stands[name] && sim.orders.sites.state[slot] === SiteState.Built) stands[name] = when(sim.tick - 1);
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
    standing: sim.fields.standing,
    lostThisYear: sim.fields.lostThisYear,
    barnFood: sim.stores.held[Good.Food - 1]![buildings.barn],
    campFood: sim.stores.held[Good.Food - 1]![CAMP_STORE],
    tally: { sown: tally.sown, ripened: tally.ripened, cut: tally.cut, lost: tally.lost, reaped: tally.reaped, spoiledOnFields: tally.spoiledOnFields, missed: tally.missed, froze: tally.froze, starved: tally.starved },
    living: sim.living,
    farmers: farmerIds().map((id) => ({
      name: nameOfVillager(id),
      x: sim.villagers.x[id],
      y: sim.villagers.y[id],
      task: TASK_NAMES.get(sim.villagers.task[id]!) ?? (sim.villagers.task[id] === 0 ? 'none' : 'other'),
      carried: sim.villagers.carried[id] === Good.Food,
      working: sim.villagers.state[id] === VillagerState.Working,
      inside: sim.villagers.state[id] === VillagerState.Inside,
    })),
  };
  for (const wanted of places) applyCommand(sim, { kind: 'setPlaces', slot: buildings.farm, places: wanted });
  return reading;
});
console.log(JSON.stringify({ commands, marked, field, farm: FARM, barn: BARN, campFood: CAMP_FOOD, stands, frost, frostDawn, springDawn, ripening, stops: read }));
