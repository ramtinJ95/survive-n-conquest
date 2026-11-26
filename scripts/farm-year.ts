// The first year on seed 7 with stage 3's hut, barn, and lodge and 6.1's field with a farm, played in src/sim: `bun scripts/farm-year.ts`.
// It runs the year twice: as ordered, and with no settler free to carry, where 7 more trees are felled from the start
// and a woodshed and a tailor's hut are ordered once the farm, the barn, and the lodge stand, so the two settlers left
// without a job build them from those logs, take their places, and do no common work after them. For each day it prints the field tiles sown, ripened, and cut, the food cut, the food the
// farmers and the settlers without a job carried in from the fields, the food spoiled on the fields, and the food in
// the barn and at the camp at the day's end.
import { Building } from '../src/sim/buildings';
import { DAYS_PER_SEASON, SEASONS, dateAt } from '../src/sim/calendar';
import { FIRST_SPRING_FIELD, FIRST_YEAR_BARNS, FIRST_YEAR_LODGE, FIRST_YEAR_SEED, HIDES_LAYOUT, NOTHING_FOR_WARMTH, WINTER_TREES, WOOD_LAYOUT } from '../src/sim/firstYear';
import { Good } from '../src/sim/goods';
import { generateMap } from '../src/sim/mapgen';
import { SiteState, type TileArea } from '../src/sim/orders';
import { type Command, SETTLERS, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE } from '../src/sim/stores';

/**
 * Stage 3's hut stands on 6.1's farm anchor, so the farm takes the anchor the rules accept beside the year's orders
 * and the field whose middle lies nearest the field's middle, 3.0 tiles, then the lowest tile: north of the field.
 */
const FARM = { x: 131, y: 120 } as const;
/** The four trees nearest the camp center that the year's orders leave standing, whose 8 logs build the farm. */
const FARM_TREES = WINTER_TREES.slice(0, 4);
/** The next seven, whose 14 logs build the woodshed and the tailor's hut of the run with no settler free to carry. */
const SHED_TREES = WINTER_TREES.slice(4, 11);
/** 4.2's woodshed, and the tailor's hut on 4.4's woodshed anchor beside it, both clear of the field and the farm. */
const WOODSHED = WOOD_LAYOUT.woodshed;
const TAILOR = HIDES_LAYOUT.woodshed;
/** Stage 3's food in the barn at autumn's end with a hut, a barn, and a lodge, and stage 4's at the year's end in the year "wood". */
const STAGE_3_AUTUMN = 97;
const STAGE_4_WOOD = 32;

const one = ([x, y]: readonly [number, number]): TileArea => ({ x0: x, y0: y, x1: x, y1: y });
const atStart: Command[] = [
  ...NOTHING_FOR_WARMTH.atStart,
  { kind: 'place', building: Building.Farm, ...FARM },
  { kind: 'markArea', order: 'field', area: FIRST_SPRING_FIELD },
  ...FARM_TREES.map((at): Command => ({ kind: 'markArea', order: 'chop', area: one(at) })),
];
/** The run with no settler free to carry fells the trees from the start, so their logs lie ready when the two buildings are ordered. */
const shedLogs: Command[] = SHED_TREES.map((at): Command => ({ kind: 'markArea', order: 'chop', area: one(at) }));
const noneFree: Command[] = [
  { kind: 'place', building: Building.Woodshed, ...WOODSHED },
  { kind: 'place', building: Building.Tailor, ...TAILOR },
];

interface Day {
  sown: number;
  ripened: number;
  cut: number;
  reaped: number;
  reapedIn: number;
  fromFields: number;
  spoiledOnFields: number;
  barn: number;
  camp: number;
}

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};

function give(sim: Sim, command: Command): void {
  const outcome = applyCommand(sim, command);
  if (!outcome?.ok) throw new Error(`refused at ${clock(sim.tick)}: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
}

function playYear(free: boolean): void {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  [...atStart, ...(free ? [] : shedLogs)].forEach((command) => give(sim, command));
  const { size } = sim.map;
  const slotOf = ({ x, y }: { readonly x: number; readonly y: number }) => sim.orders.siteOf[y * size + x]!;
  const farm = slotOf(FARM);
  const barn = slotOf(FIRST_YEAR_BARNS.beside);
  const lodge = slotOf(FIRST_YEAR_LODGE);
  const stood = new Map<string, number>();
  let extraSlots: [string, number][] = [];
  const watched = (): [string, number][] => [['farm', farm], ['barn', barn], ['lodge', lodge], ...extraSlots];
  const days: Day[] = [];
  let autumnBarn = -1;
  const tally = () => ({ ...sim.tally });
  let before = tally();
  while (dateAt(sim.tick).year === 1 && !sim.over) {
    const { day } = dateAt(sim.tick);
    step(sim);
    for (const [name, slot] of watched()) if (!stood.has(name) && sim.orders.sites.state[slot] === SiteState.Built) stood.set(name, sim.tick - 1);
    if (!free && extraSlots.length === 0 && ['farm', 'barn', 'lodge'].every((name) => stood.has(name))) {
      noneFree.forEach((command) => give(sim, command));
      extraSlots = [['woodshed', slotOf(WOODSHED)], ['tailor', slotOf(TAILOR)]];
      console.log(`  the woodshed and the tailor's hut are ordered at ${clock(sim.tick)}, when the farm, the barn, and the lodge stand`);
    }
    if (dateAt(sim.tick).day === day && dateAt(sim.tick).year === 1 && !sim.over) continue;
    const after = tally();
    days.push({
      sown: after.sown - before.sown,
      ripened: after.ripened - before.ripened,
      cut: after.cut - before.cut,
      reaped: after.reaped - before.reaped,
      reapedIn: after.reapedIn - before.reapedIn,
      fromFields: after.fromFields - before.fromFields,
      spoiledOnFields: after.spoiledOnFields - before.spoiledOnFields,
      barn: sim.stores.held[Good.Food - 1]![barn]!,
      camp: sim.stores.held[Good.Food - 1]![CAMP_STORE]!,
    });
    if (day === 9) autumnBarn = days.at(-1)!.barn;
    before = after;
  }
  for (const [name, tick] of stood) console.log(`  the ${name} stands at ${clock(tick)}`);
  console.log('  | Day | Season | Sown | Ripened | Cut | Food cut | Carried in by farmers | by settlers without a job | Spoiled on the fields | Barn at the day\'s end | Camp |');
  console.log('  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  days.forEach((d, index) =>
    console.log(
      `  | ${index + 1} | ${SEASONS[Math.floor(index / DAYS_PER_SEASON)]} | ${d.sown} | ${d.ripened} | ${d.cut} | ${d.reaped} | ${d.reapedIn} | ${d.fromFields} | ${d.spoiledOnFields} | ${d.barn} | ${d.camp} |`,
    ),
  );
  const total = (key: keyof Day) => days.reduce((sum, d) => sum + (key === 'barn' || key === 'camp' ? 0 : d[key]), 0);
  console.log(
    `  | year | | ${total('sown')} | ${total('ripened')} | ${total('cut')} | ${total('reaped')} | ${total('reapedIn')} | ${total('fromFields')} | ${total('spoiledOnFields')} | ${days.at(-1)!.barn} | ${days.at(-1)!.camp} |`,
  );
  const { tally: all } = sim;
  console.log(
    `  food in the barn at autumn's end ${autumnBarn} and at the year's end ${days.at(-1)!.barn}, against stage 3's ${STAGE_3_AUTUMN} at autumn's end and stage 4's ${STAGE_4_WOOD} in the year "wood"; ` +
      `the year's food: ${all.foraged} foraged, ${all.hunted} from kills, ${all.reaped} cut; ${all.meals} meals eaten, ${all.missed} missed, ${all.spoiled} spoiled on the ground in all; ` +
      `${all.starved} starved, ${all.froze} froze, ${sim.living} living at the end`,
  );
}

console.log(
  `seed ${FIRST_YEAR_SEED}, ${SETTLERS.villagers} settlers; at 08:00 on day 1 stage 3's hut, barn beside it, and lodge with their orders, ` +
    `a farm anchored on (${FARM.x}, ${FARM.y}), 6.1's field from (${FIRST_SPRING_FIELD.x0}, ${FIRST_SPRING_FIELD.y0}) to (${FIRST_SPRING_FIELD.x1}, ${FIRST_SPRING_FIELD.y1}), and Chop on ${FARM_TREES.length} trees for the farm's logs`,
);
console.log('\nas ordered:');
playYear(true);
console.log(`\nwith no settler free to carry: Chop on ${SHED_TREES.length} more trees at the start, then a woodshed on (${WOODSHED.x}, ${WOODSHED.y}) and a tailor's hut on (${TAILOR.x}, ${TAILOR.y}) once the farm, the barn, and the lodge stand:`);
playYear(false);
