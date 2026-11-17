// The first year on seed 7 with a hunter's lodge beside the camp, with and without the forager's hut: `bun scripts/hunt-year.ts [run ...]`.
import { AnimalKind, AnimalState, MAX_ANIMALS } from '../src/sim/animals';
import { BUILDINGS, Building, Job, withinReach } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_SECOND, dateAt, seasonAt, tickOfDay } from '../src/sim/calendar';
import { isNight } from '../src/sim/daylight';
import { FIRST_YEAR_BARNS, FIRST_YEAR_LODGE, FIRST_YEAR_SEED, barnYearCommands, huntYearCommands } from '../src/sim/firstYear';
import { FORAGE_WORK_TICKS } from '../src/sim/foraging';
import { Good } from '../src/sim/goods';
import { jobOf } from '../src/sim/jobs';
import { TileKind } from '../src/sim/map';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState, siteRefusal } from '../src/sim/orders';
import { SETTLERS, type Command, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE, StoreKind, storeKind } from '../src/sim/stores';
import { VillagerState } from '../src/sim/villagerState';

const RUNS: Readonly<Record<string, { readonly title: string; readonly commands: () => Command[] }>> = {
  all: { title: "the hut, the barn beside it, and the hunter's lodge", commands: () => huntYearCommands({ hut: true }) },
  lodge: { title: "the barn and the hunter's lodge, no hut", commands: () => huntYearCommands({ hut: false }) },
};
/** The lodge anchor is chosen among those whose middle lies this near the camp center. */
const ANCHOR_REACH = 14;
const SEASON_ENDS = [3, 6, 9, 12];
const WINTER_DUSKS = [10, 11, 12];

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);

function foodIn(sim: Sim, kind: StoreKind): number {
  let food = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) food += sim.stores.held[Good.Food - 1]![slot]!;
  return food;
}

/** The food on open ground: every tile that holds food is listed for spoiling. */
function groundFood(sim: Sim): number {
  const { goods, map } = sim;
  let food = 0;
  for (let i = 0; i < goods.spoilingCount; i++) {
    const tile = goods.spoilingTiles[i]!;
    if (map.stackGood[tile] === Good.Food) food += map.stackSize[tile]!;
  }
  return food;
}

/** Living deer within the reach of the lodge anchored on `FIRST_YEAR_LODGE`. */
function deerInReach(sim: Sim): number {
  const slot = sim.orders.siteOf[FIRST_YEAR_LODGE.y * sim.map.size + FIRST_YEAR_LODGE.x]!;
  let deer = 0;
  for (let row = 0; row < MAX_ANIMALS; row++) {
    if (sim.animals.state[row] !== AnimalState.Gone && withinReach(sim.orders.sites, slot, sim.animals.x[row]!, sim.animals.y[row]!)) deer++;
  }
  return deer;
}

/** Units of food that went into a store: by a forager, a hunter, a carrier from the ground, a household, or a carrier from a barn to the camp. */
const intoStores = (sim: Sim) => sim.tally.foragedIn + sim.tally.huntedIn + sim.tally.fromGround + sim.tally.carriedHome + sim.tally.toCamp;

/**
 * Ranks the lodge's anchors within `ANCHOR_REACH` of the camp center that the
 * rules accept beside the hut and the barn, by the grass and forest tiles
 * within the lodge's reach, then by the nearness of the lodge's middle to the
 * camp center, then by the lowest tile. Throws unless `FIRST_YEAR_LODGE` ranks first.
 */
function rankAnchors(): void {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of barnYearCommands(FIRST_YEAR_BARNS.beside)) applyCommand(sim, command);
  const { size } = sim.map;
  const { side, reach } = BUILDINGS[Building.Lodge];
  const campX = (sim.flow.goal % size) + 0.5;
  const campY = Math.floor(sim.flow.goal / size) + 0.5;
  const ranked: { x: number; y: number; land: number; fromCamp: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = x + side / 2;
      const my = y + side / 2;
      const fromCamp = Math.hypot(mx - campX, my - campY);
      if (fromCamp > ANCHOR_REACH || siteRefusal(sim.map, sim.orders, Building.Lodge, x, y) !== null) continue;
      let land = 0;
      for (let ty = Math.max(Math.floor(my - reach), 0); ty <= Math.min(Math.ceil(my + reach), size - 1); ty++) {
        for (let tx = Math.max(Math.floor(mx - reach), 0); tx <= Math.min(Math.ceil(mx + reach), size - 1); tx++) {
          const kind = sim.map.kinds[ty * size + tx];
          if ((kind === TileKind.Grass || kind === TileKind.Forest) && (tx + 0.5 - mx) ** 2 + (ty + 0.5 - my) ** 2 <= reach * reach) land++;
        }
      }
      ranked.push({ x, y, land, fromCamp });
    }
  }
  ranked.sort((a, b) => b.land - a.land || a.fromCamp - b.fromCamp || a.y * size + a.x - (b.y * size + b.x));
  const best = ranked[0]!;
  const sharing = ranked.filter(({ land }) => land === best.land).length;
  const describe = ({ x, y, land, fromCamp }: (typeof ranked)[number]) => `(${x}, ${y}) ${land} land tiles, middle ${fromCamp.toFixed(1)} from the camp center`;
  console.log(`## The lodge's anchor`);
  console.log(`${ranked.length} anchors within ${ANCHOR_REACH} tiles of the camp center fit beside the hut and the barn; ${sharing} of them hold the most grass and forest within ${reach} tiles.`);
  console.log(`ranked: ${ranked.slice(0, 6).map(describe).join('; ')}`);
  console.log(`fewest: ${describe(ranked.at(-1)!)}`);
  console.log('');
  if (best.x !== FIRST_YEAR_LODGE.x || best.y !== FIRST_YEAR_LODGE.y) throw new Error(`FIRST_YEAR_LODGE is (${FIRST_YEAR_LODGE.x}, ${FIRST_YEAR_LODGE.y}) but (${best.x}, ${best.y}) ranks first`);
}

function play(name: string): void {
  const run = RUNS[name];
  if (!run) throw new Error(`no run named ${name}; the runs are ${Object.keys(RUNS).join(', ')}`);
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of run.commands()) {
    const outcome = applyCommand(sim, command);
    if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  }
  const finished = new Map<number, string>();
  const hired: string[] = [];
  const missed: string[] = [];
  const deaths: string[] = [];
  const rows: string[] = [];
  const missedBefore = Uint8Array.from(sim.villagers.missedMeals);
  const workplace = Int16Array.from(sim.villagers.workplace);
  const carried = Uint8Array.from(sim.villagers.carried);
  let dropped = 0;
  const row = (when: string) =>
    rows.push(
      `| ${when} | ${seasonAt(sim.tick)} | ${foodIn(sim, StoreKind.Common)} | ${sim.stores.held[Good.Food - 1]![CAMP_STORE]} | ${foodIn(sim, StoreKind.Home)} | ` +
        `${groundFood(sim)} | ${sim.animals.living[AnimalKind.Deer]} | ${deerInReach(sim)} | ${sim.tally.foraged} | ${sim.tally.kills} | ${sim.living} |`,
    );
  while (!sim.over && dateAt(sim.tick).day <= DAYS_PER_YEAR) {
    const { day } = dateAt(sim.tick);
    if (isDusk(sim.tick) && WINTER_DUSKS.includes(day)) row(`dusk of day ${day}`);
    if (tickOfDay(sim.tick) === TICKS_PER_DAY - 1 && SEASON_ENDS.includes(day)) row(`end of day ${day}`);
    const stored = intoStores(sim);
    step(sim);
    let emptied = 0;
    for (let id = 0; id < carried.length; id++) {
      if (carried[id] === Good.Food && sim.villagers.carried[id] === Good.None) emptied++;
      carried[id] = sim.villagers.carried[id]!;
    }
    dropped += emptied - (intoStores(sim) - stored);
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] === SiteState.Built && !finished.has(slot)) finished.set(slot, `${BUILDINGS[sites.kind[slot] as Building].name} ${clock(sim.tick - 1)}`);
    }
    for (let id = 0; id < missedBefore.length; id++) {
      if (sim.villagers.workplace[id] !== workplace[id] && sim.villagers.state[id] !== VillagerState.Dead) {
        const job = jobOf(sim, id);
        hired.push(`${nameOfId(sim, id)} ${job === Job.None ? 'left a workplace' : `became a ${job === Job.Hunter ? 'hunter' : 'forager'}`} at ${clock(sim.tick - 1)}`);
      }
      workplace[id] = sim.villagers.workplace[id]!;
      const now = sim.villagers.missedMeals[id]!;
      if (now > missedBefore[id]!) missed.push(`${nameOfId(sim, id)} ${clock(sim.tick - 1)}`);
      if (sim.villagers.state[id] === VillagerState.Dead && missedBefore[id] !== 255) {
        deaths.push(`${nameOfId(sim, id)} ${clock(sim.tick - 1)}`);
        missedBefore[id] = 255;
        continue;
      }
      if (missedBefore[id] !== 255) missedBefore[id] = now;
    }
  }
  const { tally } = sim;
  console.log(`## ${run.title}`);
  console.log(
    `seed ${FIRST_YEAR_SEED}, ${FORAGE_WORK_TICKS / TICKS_PER_SECOND} s of work for one unit of forage, ` +
      `${sim.living} of ${SETTLERS.villagers} alive${sim.over ? `, died out at ${clock(sim.tick - 1)}` : ' at the end of the year'}`,
  );
  console.log(`finished: ${[...finished.values()].join(', ')}`);
  console.log(`places: ${hired.join(', ') || 'none'}`);
  console.log('');
  console.log(`Deer counts every deer on the map, In reach those within ${BUILDINGS[Building.Lodge].reach} tiles of the lodge. Picked and Kills count from the start of the year.`);
  console.log('| When | Season | Barn | Camp | Homes | Ground | Deer | In reach | Picked | Kills | Living |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const line of rows) console.log(line);
  console.log('');
  console.log(
    `picked ${tally.foraged}, foragers put into a store ${tally.foragedIn}; shots ${tally.shots}, hits ${tally.kills}, each a kill; ` +
      `the kills left ${tally.hunted} food, hunters carried ${tally.huntedIn} into a store, settlers without a job carried ${tally.fromGround} from the ground; ` +
      `${dropped} units put down from hands, ${tally.spoiled} spoiled on the ground at a dawn, ${groundFood(sim)} on the ground at the end; ` +
      `carried from a barn to the camp ${tally.toCamp}, carried home ${tally.carriedHome}, meals ${tally.meals}, missed ${tally.missed}`,
  );
  console.log(`missed meals: ${missed.join(', ') || 'none'}`);
  console.log(`deaths: ${deaths.join(', ') || 'none'}`);
  console.log('');
}

const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(RUNS);
rankAnchors();
for (const name of names) play(name);
