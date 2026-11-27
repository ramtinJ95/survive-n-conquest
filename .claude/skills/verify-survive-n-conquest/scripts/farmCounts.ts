// The `frost` scenario's settlement on seed 7 played into its second year in src/sim, so the `farm-counts` scenario can
// check the farm's panel against the rules. Run from the checkout root:
// bun .claude/skills/verify-survive-n-conquest/scripts/farmCounts.ts '<stops>'
// The stops are [{ "day": 6, "time": "05:00" }, ...] in the order the scenario reaches them. A stop with
// "places": [1, 0] sets the farm's places to each of those numbers in turn after its reading, as presses of the farm
// panel's Fewer places and More places buttons at that stop do. It prints JSON: the orders it gives at tick 0, the
// field's tiles, the minute each building stands, each year's first ripe dawn, frost, and first dawn of spring after it,
// and at the first tick of each stop's minute the field tiles in the farm's reach by state, the food the cut tiles put
// down and the tiles the frost killed in the calendar year so far, the same counts of the year before from the second
// year on, the living settlers, and the farm's farmers. The farm is the only one on the map, so the settlement's
// tallies are the farm's: these counts come from `tally.reaped` and `fields.lostThisYear`, not from the farm's own.
import { BUILDINGS, Building, Job, withinReach } from '../../../../src/sim/buildings';
import { DAYS_PER_YEAR, MINUTES_PER_DAY, dateAt, dayIndexAt, firstTickOf, seasonAt, startsYear } from '../../../../src/sim/calendar';
import { dawnTick, isDawn } from '../../../../src/sim/daylight';
import { FieldState, fieldState } from '../../../../src/sim/fields';
import { FIRST_YEAR_SEED } from '../../../../src/sim/firstYear';
import { jobOf } from '../../../../src/sim/jobs';
import { generateMap } from '../../../../src/sim/mapgen';
import { type Sex, nameOf } from '../../../../src/sim/names';
import { Claim, SiteState } from '../../../../src/sim/orders';
import { SETTLERS, applyCommand, createSim, step } from '../../../../src/sim/sim';
import { BARN, CAMP_FOOD, FARM, FIELD, FROST_COMMANDS, HOUSES, WOODSHED } from './frostSettlement';

const STATES = Object.keys(FieldState).map((name) => name.toLowerCase());

const stops: { day: number; time: string; places?: number[] }[] = JSON.parse(process.argv[2] ?? '[]');
const minuteOf = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return (day - 1) * MINUTES_PER_DAY + minuteOfDay;
};
const clock = (minutes: number) => `day ${Math.floor(minutes / MINUTES_PER_DAY) + 1} ${String(Math.floor((minutes % MINUTES_PER_DAY) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const when = (tick: number) => ({ tick, at: clock(minuteOf(tick)) });
const dawnOf = (day: number) => firstTickOf(day) + dawnTick(seasonAt(firstTickOf(day)));

const sim = createSim(generateMap(FIRST_YEAR_SEED), { ...SETTLERS, campFood: CAMP_FOOD });
const marked = FROST_COMMANDS.map((command) => {
  const outcome = applyCommand(sim, command);
  if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  return outcome.tiles;
});
const { size } = sim.map;
const slotOf = ({ x, y }: { x: number; y: number }) => sim.orders.siteOf[y * size + x]!;
const buildings = { farm: slotOf(FARM), barn: slotOf(BARN), woodshed: slotOf(WOODSHED), house1: slotOf(HOUSES[0]!), house2: slotOf(HOUSES[1]!) };
const field: [number, number][] = [];
for (let y = FIELD.y0; y <= FIELD.y1; y++) for (let x = FIELD.x0; x <= FIELD.x1; x++) field.push([x, y]);
const inReach: number[] = [];
for (let tile = 0; tile < size * size; tile++) {
  if (withinReach(sim.orders.sites, buildings.farm, (tile % size) + 0.5, Math.floor(tile / size) + 0.5)) inReach.push(tile);
}
const nameOfVillager = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const farmerNames = () =>
  [...sim.villagers.workplace.subarray(0, sim.villagers.count).keys()]
    .filter((id) => sim.villagers.workplace[id] === buildings.farm && jobOf(sim, id) === Job.Farmer)
    .sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!)
    .map(nameOfVillager);

const stands: Record<string, { tick: number; at: string } | null> = Object.fromEntries(Object.keys(buildings).map((name) => [name, null]));
const years: { year: number; firstRipe: { tick: number; at: string } | null; frost: { tick: number; at: string }; springDawn: { tick: number; at: string }; foodCut: number; lost: number }[] = [];
const yearOf = (tick: number) => Math.floor(dayIndexAt(tick) / DAYS_PER_YEAR);
const yearRow = (year: number) => {
  while (years.length <= year) {
    const frostAt = years.length === 0 ? sim.fields.frostAt : NaN;
    years.push({ year: years.length + 1, firstRipe: null, frost: when(frostAt), springDawn: when(dawnOf((years.length + 1) * DAYS_PER_YEAR)), foodCut: 0, lost: 0 });
  }
  return years[year]!;
};
let reapedAtYearStart = 0;
const advance = (tick: number) => {
  while (sim.tick < tick) {
    const dawn = isDawn(sim.tick);
    const ripened = sim.tally.ripened;
    const year = yearOf(sim.tick);
    step(sim);
    const row = yearRow(year);
    if (dawn && sim.tally.ripened > ripened && !row.firstRipe) row.firstRipe = when(sim.tick - 1);
    if (dawn && dayIndexAt(sim.tick - 1) % DAYS_PER_YEAR === 0) yearRow(year).frost = when(sim.fields.frostAt);
    if (startsYear(sim.tick)) {
      row.foodCut = sim.tally.reaped - reapedAtYearStart;
      row.lost = sim.tally.lost - years.slice(0, year).reduce((sum, { lost }) => sum + lost, 0);
      reapedAtYearStart = sim.tally.reaped;
    }
    for (const [name, slot] of Object.entries(buildings)) if (!stands[name] && sim.orders.sites.state[slot] === SiteState.Built) stands[name] = when(sim.tick - 1);
  }
};
const read = stops.map(({ day, time, places = [] }) => {
  const [hours, minutes] = time.split(':').map(Number);
  const want = (day - 1) * MINUTES_PER_DAY + hours! * 60 + minutes!;
  let tick = sim.tick;
  while (minuteOf(tick) < want) tick++;
  advance(tick);
  const counts = Object.fromEntries(STATES.map((state) => [state, 0]));
  for (const tile of inReach) if (sim.orders.claims[tile] === Claim.Field) counts[STATES[fieldState(sim.fields, tile, sim.tick)]!]! += 1;
  const year = yearOf(sim.tick);
  const reading = {
    at: clock(want),
    tick: sim.tick,
    year: year + 1,
    fields: counts,
    thisYear: { foodCut: sim.tally.reaped - reapedAtYearStart, lost: sim.fields.lostThisYear },
    lastYear: year === 0 ? null : { foodCut: years[year - 1]!.foodCut, lost: years[year - 1]!.lost },
    living: sim.living,
    farmers: farmerNames(),
  };
  for (const wanted of places) applyCommand(sim, { kind: 'setPlaces', slot: buildings.farm, places: wanted });
  return reading;
});
console.log(JSON.stringify({ commands: FROST_COMMANDS, marked, field, farm: FARM, reach: BUILDINGS[Building.Farm].reach, stands, years, stops: read }));
