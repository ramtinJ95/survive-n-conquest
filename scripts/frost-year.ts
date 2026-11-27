// The frost on seed 7, played in src/sim: `bun scripts/frost-year.ts`. It prints the day of the frost in each of the
// first 20 years, then the first year of the field of 6.3's "Play it": the orders of the verification skill's harvest
// scenario with its field grown to the 54 tiles two farmers sow in the first spring, and a second barn. It plays that
// year with the frost forced to the dusk of day 9 and to the dusk of day 8, and prints by day the tiles sown, ripened,
// cut, and lost, and the food in the barns and at the camp, and the tick, game time, and wall time at 8× of the moments
// the owner watches. Last it plays the answers a player has to the frost: a second farm ordered at the warning dawn,
// a day before it, at the first dawn at which tiles ripen, or at the start, and the field with the harvest scenario's one
// barn. The second barn is there so that the farmers' time, not the room in the stores, sets what is cut.
import { Building } from '../src/sim/buildings';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, TICKS_PER_DAY, TICKS_PER_SECOND, dateAt, dayIndexAt, firstTickOf } from '../src/sim/calendar';
import { dawnTick, isNight } from '../src/sim/daylight';
import { FIRST_YEAR_BARN_ROCK, FIRST_YEAR_BARN_TREES, FIRST_YEAR_LODGE_ROCK, FIRST_YEAR_LODGE_TREES, FIRST_YEAR_LOG_TREES, FIRST_YEAR_SEED, WINTER_TREES } from '../src/sim/firstYear';
import { EARLY_FROST_CHANCE, FROST_DAY, frostTick } from '../src/sim/frost';
import { Good } from '../src/sim/goods';
import { generateMap } from '../src/sim/mapgen';
import { SiteState, type TileArea } from '../src/sim/orders';
import { type Command, SETTLERS, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE, Wants, nearestCommonStore } from '../src/sim/stores';

const YEARS = 20;
const SPEED = 8;
/** The harvest scenario's farm, barn, and camp food, and its field grown west and north over the grass to 9 by 6 tiles, as many as its two farmers sow in the first spring. */
const FARM = { x: 136, y: 127 } as const;
const FIELD: TileArea = { x0: 127, y0: 119, x1: 135, y1: 124 };
const middle = { x: (FIELD.x0 + FIELD.x1 + 1) / 2, y: (FIELD.y0 + FIELD.y1 + 1) / 2 };
const BARN = { x: 132, y: 126 } as const;
const CAMP_FOOD = 56;
/**
 * A second barn on the grass west of the field, built from the lodge's four trees and rock and the first four of
 * `WINTER_TREES`, which the harvest scenario leaves standing. With one barn and the camp, the stores run out of room on
 * day 9, so they and not the farmers' time would set what is cut.
 */
const SECOND_BARN = { x: 123, y: 121 } as const;
/** A second farm north west of the field, which lies in its reach, and the trees whose 8 logs build it. */
const SECOND_FARM = { x: 125, y: 116 } as const;
const SECOND_FARM_TREES = WINTER_TREES.slice(4, 8);

const one = ([x, y]: readonly [number, number]): TileArea => ({ x0: x, y0: y, x1: x, y1: y });
const chop = (trees: readonly (readonly [number, number])[]) => trees.map((at): Command => ({ kind: 'markArea', order: 'chop', area: one(at) }));
const harvestOrders: Command[] = [
  { kind: 'place', building: Building.Farm, ...FARM },
  { kind: 'markArea', order: 'field', area: FIELD },
  { kind: 'place', building: Building.Barn, ...BARN },
  ...chop([...FIRST_YEAR_LOG_TREES, ...FIRST_YEAR_BARN_TREES]),
  { kind: 'markArea', order: 'quarry', area: one(FIRST_YEAR_BARN_ROCK) },
];
const secondBarnOrders: Command[] = [
  { kind: 'place', building: Building.Barn, ...SECOND_BARN },
  ...chop([...FIRST_YEAR_LODGE_TREES, ...WINTER_TREES.slice(0, 4)]),
  { kind: 'markArea', order: 'quarry', area: one(FIRST_YEAR_LODGE_ROCK) },
];
const secondFarmOrders: Command[] = [{ kind: 'place', building: Building.Farm, ...SECOND_FARM }, ...chop(SECOND_FARM_TREES)];

/** When the second farm is ordered. */
type FarmOrdered = 'never' | 'at the start' | 'at the first dawn at which tiles ripen' | 'at the dawn before the warning' | 'at the warning dawn';
interface Run {
  readonly frostDay: number;
  readonly secondBarn: boolean;
  readonly secondFarm: FarmOrdered;
}
interface Day {
  sown: number;
  ripened: number;
  cut: number;
  lost: number;
  noRoom: number;
  barn: number;
  secondBarn: number;
  camp: number;
}
interface Played {
  readonly days: Day[];
  readonly moments: [string, number][];
  readonly sown: number;
  readonly cut: number;
  readonly lost: number;
  /** Daylight ticks from the first ripe dawn on in which no store had room for food. */
  readonly noRoomAtHarvest: number;
  readonly standingAtWarning: number;
  readonly secondFarmStands: number;
}

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const wall = (tick: number) => {
  const seconds = tick / (TICKS_PER_SECOND * SPEED);
  return `${Math.floor(seconds / 60)} min ${(seconds % 60).toFixed(1)} s`;
};
/** The first night tick of day `day` of the first year, counted from 1, where `frostTick` puts a frost. */
const duskOf = (day: number) => firstTickOf(day) - dawnTick('Autumn');

function give(sim: Sim, command: Command): void {
  const outcome = applyCommand(sim, command);
  if (!outcome?.ok) throw new Error(`refused at ${clock(sim.tick)}: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
}

function play({ frostDay, secondBarn, secondFarm }: Run): Played {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), { ...SETTLERS, campFood: CAMP_FOOD });
  [...harvestOrders, ...(secondBarn ? secondBarnOrders : []), ...(secondFarm === 'at the start' ? secondFarmOrders : [])].forEach((command) => give(sim, command));
  sim.fields.frostAt = duskOf(frostDay);
  const { size } = sim.map;
  const slotAt = ({ x, y }: { readonly x: number; readonly y: number }) => sim.orders.siteOf[y * size + x]!;
  const farm = slotAt(FARM);
  const barn = slotAt(BARN);
  const secondBarnSlot = secondBarn ? slotAt(SECOND_BARN) : -1;
  let secondFarmSlot = secondFarm === 'at the start' ? slotAt(SECOND_FARM) : -1;
  const food = (slot: number) => (slot < 0 ? 0 : sim.stores.held[Good.Food - 1]![slot]!);
  const warningDawn = firstTickOf(dayIndexAt(sim.fields.frostAt)) + dawnTick('Autumn');
  let farmStands = -1;
  let secondFarmStands = -1;
  let lastSown = -1;
  let firstRipe = -1;
  let springSown = -1;
  let standingAtWarning = -1;
  let noRoom = 0;
  const days: Day[] = [];
  let before = { ...sim.tally };
  while (!sim.over && dateAt(sim.tick).year === 1) {
    const { day } = dateAt(sim.tick);
    if (sim.tick === warningDawn) standingAtWarning = sim.fields.standing;
    const sown = sim.tally.sown;
    const ripened = sim.tally.ripened;
    step(sim);
    const tick = sim.tick - 1;
    if (sim.tally.sown > sown) lastSown = tick;
    if (firstRipe < 0 && sim.tally.ripened > ripened) firstRipe = tick;
    if (farmStands < 0 && sim.orders.sites.state[farm] === SiteState.Built) farmStands = tick;
    if (secondFarmSlot >= 0 && secondFarmStands < 0 && sim.orders.sites.state[secondFarmSlot] === SiteState.Built) secondFarmStands = tick;
    const ordered =
      (secondFarm === 'at the warning dawn' && tick === warningDawn) ||
      (secondFarm === 'at the dawn before the warning' && tick === warningDawn - TICKS_PER_DAY) ||
      (secondFarm === 'at the first dawn at which tiles ripen' && tick === firstRipe);
    if (ordered && secondFarmSlot < 0) {
      secondFarmOrders.forEach((command) => give(sim, command));
      secondFarmSlot = slotAt(SECOND_FARM);
    }
    if (!isNight(tick) && nearestCommonStore(sim, middle.x, middle.y, Wants.Room) < 0) noRoom++;
    if (dateAt(sim.tick).day === day && !sim.over) continue;
    const after = sim.tally;
    days.push({
      sown: after.sown - before.sown,
      ripened: after.ripened - before.ripened,
      cut: after.cut - before.cut,
      lost: after.lost - before.lost,
      noRoom,
      barn: food(barn),
      secondBarn: food(secondBarnSlot),
      camp: food(CAMP_STORE),
    });
    before = { ...after };
    noRoom = 0;
  }
  while (!sim.over && springSown < 0) {
    const sown = sim.tally.sown;
    step(sim);
    if (sim.tally.sown > sown) springSown = sim.tick - 1;
  }
  const overAt = sim.over ? sim.tick : -1;
  const springDawn = firstTickOf(DAYS_PER_YEAR) + dawnTick('Spring');
  const moments: [string, number][] = [
    ['the farm stands', farmStands],
    ['the last tile is sown', lastSown],
    ['the first dawn at which tiles ripen', firstRipe],
    ['the dawn of the warning, `A frost comes tonight`', warningDawn],
    ['the frost', duskOf(frostDay)],
    ...(overAt >= 0 ? [['the last settler freezes, and the clock stops for good', overAt - 1] as [string, number]] : []),
    [overAt >= 0 ? 'the first dawn of spring, which the clock never reaches' : 'the first dawn of spring', springDawn],
    ...(springSown >= 0 ? [['the first tile sown again', springSown] as [string, number]] : []),
  ];
  const total = (key: 'sown' | 'cut' | 'lost') => days.reduce((sum, d) => sum + d[key], 0);
  const noRoomAtHarvest = days.slice(dayIndexAt(firstRipe)).reduce((sum, d) => sum + d.noRoom, 0);
  return { days, moments, sown: total('sown'), cut: total('cut'), lost: total('lost'), noRoomAtHarvest, standingAtWarning, secondFarmStands };
}

console.log(`seed ${FIRST_YEAR_SEED}: the frost of each of the first ${YEARS} years, at the dusk of day ${FROST_DAY + 1} of the year, or of day ${FROST_DAY} in the years the draw puts below ${EARLY_FROST_CHANCE}`);
console.log('  | Year | Day of the year | Day | Tick | Early |');
console.log('  | --- | --- | --- | --- | --- |');
let early = 0;
for (let year = 0; year < YEARS; year++) {
  const tick = frostTick(FIRST_YEAR_SEED, year);
  const dayOfYear = (dayIndexAt(tick) % DAYS_PER_YEAR) + 1;
  if (dayOfYear === FROST_DAY) early++;
  console.log(`  | ${year + 1} | ${dayOfYear} | ${dateAt(tick).day} | ${tick.toLocaleString('en-US')} | ${dayOfYear === FROST_DAY ? 'yes' : ''} |`);
}
console.log(`  ${early} of ${YEARS} frosts come a day early`);

console.log(
  `\nthe field of "Play it": at 08:00 on day 1 the harvest scenario's farm on (${FARM.x}, ${FARM.y}), barn on (${BARN.x}, ${BARN.y}), trees, rock, and ${CAMP_FOOD} food at the camp, ` +
    `its field grown to (${FIELD.x0}, ${FIELD.y0}) to (${FIELD.x1}, ${FIELD.y1}), ${(FIELD.x1 - FIELD.x0 + 1) * (FIELD.y1 - FIELD.y0 + 1)} tiles, ` +
    `and a second barn on (${SECOND_BARN.x}, ${SECOND_BARN.y}) with Chop on ${FIRST_YEAR_LODGE_TREES.length + 4} trees and Quarry on 1 rock tile for it; ${SETTLERS.villagers} settlers, 2 of them farmers`,
);
const asOrdered = [9, 8].map((frostDay) => ({ frostDay, played: play({ frostDay, secondBarn: true, secondFarm: 'never' }) }));
for (const { frostDay, played } of asOrdered) {
  console.log(`\nwith the frost at the dusk of day ${frostDay}${duskOf(frostDay) === frostTick(FIRST_YEAR_SEED, 0) ? ", seed 7's own" : ', forced'}:`);
  console.log("  | Day | Season | Sown | Ripened | Cut | Lost | Daylight ticks no store had room | Barn at the day's end | Second barn | Camp |");
  console.log('  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  played.days.forEach((d, index) =>
    console.log(`  | ${index + 1} | ${SEASONS[Math.floor(index / DAYS_PER_SEASON)]} | ${d.sown} | ${d.ripened} | ${d.cut} | ${d.lost} | ${d.noRoom} | ${d.barn} | ${d.secondBarn} | ${d.camp} |`),
  );
  const total = (key: 'sown' | 'ripened' | 'cut' | 'lost' | 'noRoom') => played.days.reduce((sum, d) => sum + d[key], 0);
  const last = played.days.at(-1)!;
  console.log(`  | year | | ${total('sown')} | ${total('ripened')} | ${total('cut')} | ${total('lost')} | ${total('noRoom')} | ${last.barn} | ${last.secondBarn} | ${last.camp} |`);
  console.log(`  standing at the dawn of the warning: ${played.standingAtWarning} tiles`);
  console.log(`  | Moment | Tick | Game time | Wall time from tick 0 at ${SPEED}× |`);
  console.log('  | --- | --- | --- | --- |');
  for (const [moment, tick] of played.moments) console.log(`  | ${moment} | ${tick.toLocaleString('en-US')} | ${clock(tick)} | ${wall(tick)} |`);
}

console.log('\nwhat a player can do about the frost: the same field, each answer played with each frost day');
console.log(
  '  | Answer | Frost on day 9: sown, cut, lost | Frost on day 8: sown, cut, lost | Daylight ticks of the harvest no store had room, day 9 / day 8 | The second farm stands, day 9 / day 8 |',
);
console.log('  | --- | --- | --- | --- | --- |');
const answers: [string, Omit<Run, 'frostDay'>][] = [
  ['none, the field as ordered', { secondBarn: true, secondFarm: 'never' }],
  ["the harvest scenario's one barn, no second barn", { secondBarn: false, secondFarm: 'never' }],
  [`a second farm on (${SECOND_FARM.x}, ${SECOND_FARM.y}) and Chop on ${SECOND_FARM_TREES.length} trees ordered at the warning dawn`, { secondBarn: true, secondFarm: 'at the warning dawn' }],
  ['the same ordered at the dawn before the warning', { secondBarn: true, secondFarm: 'at the dawn before the warning' }],
  ['the same ordered at the first dawn at which tiles ripen', { secondBarn: true, secondFarm: 'at the first dawn at which tiles ripen' }],
  ['the same ordered at the start', { secondBarn: true, secondFarm: 'at the start' }],
];
for (const [answer, run] of answers) {
  const [late, soon] = [9, 8].map((frostDay) => play({ frostDay, ...run }));
  const stands = (played: Played) => (played.secondFarmStands < 0 ? '-' : clock(played.secondFarmStands));
  console.log(`  | ${answer} | ${late!.sown}, ${late!.cut}, ${late!.lost} | ${soon!.sown}, ${soon!.cut}, ${soon!.lost} | ${late!.noRoomAtHarvest} / ${soon!.noRoomAtHarvest} | ${stands(late!)} / ${stands(soon!)} |`);
}
