import { bornAt, lifeSpan, startingAge } from './aging';
import { type Animals, createAnimals, moveAnimals } from './animals';
import { type SiteTasks, createSiteTasks, resetSite } from './building';
import { TICKS_PER_SECOND } from './calendar';
import { campTile } from './camp';
import { isDawn, isNight } from './daylight';
import { DAWN } from './dawn';
import { type FlowField, createFlowField } from './flowField';
import { type Foraging, createForaging } from './foraging';
import { type Gathering, createGathering } from './gathering';
import { type GoodsState, type PutDownSearch, createGoodsState, createPutDownSearch, refreshStack, spoilGoods } from './goods';
import { type Households, createHouseholds } from './households';
import { type Hunting, createHunting } from './hunting';
import { setPlaces } from './jobs';
import { type TileMap, copyMap } from './map';
import { type Monsters, createMonsters, moveMonsters } from './monsters';
import { MAX_SITES, type OrderCommand, type OrderOutcome, type Orders, applyOrder, createOrders } from './orders';
import { type PathSearch, createPathSearch } from './paths';
import { CAMP_FOOD, type Stores, createStores } from './stores';
import { reachTasks, refreshTasks, reopenTasks } from './tasks';
import { Sex } from './names';
import { type TileChanges, createTileChanges } from './tileChanges';
import { type NewVillager, type Villagers, createVillagers, moveVillagers, startingNames, stopFallenTasks } from './villagers';
import { type Workshops, createWorkshops } from './workshops';

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export type Command =
  | { readonly kind: 'togglePause' }
  | { readonly kind: 'setSpeed'; readonly speed: Speed }
  // The places of the finished workplace in `slot` that the player wants filled.
  | { readonly kind: 'setPlaces'; readonly slot: number; readonly places: number }
  | OrderCommand;

export interface Population {
  readonly villagers: number;
  readonly monsters: number;
  /** Marks every tree and every rock tile on the map at the start, through the same orders a player gives. */
  readonly markAll?: boolean;
  /** The food the camp starts with, `CAMP_FOOD` when left out. A start above `CAMP_FOOD_LIMIT` raises what the camp holds to it. */
  readonly campFood?: number;
  /** False leaves the map without animals, from the start and at every dawn. A test page uses it to keep a scene still. */
  readonly animals?: boolean;
}

/**
 * The load the performance budget is set for: a full city at work under a late
 * assault. The camp's food lasts the benchmark's dusks of days 1 to 3 and the
 * stocking of its homes, and runs out at the dusk of day 4, the last one the
 * benchmark measures, so some villagers go hungry there. On seed 7 a camp with
 * plenty had given out 4,785 units on the 256 map and 4,099 on the 512 map
 * before that dusk, and 5,997 and 5,092 by the end of the measured ticks.
 */
export const BENCHMARK_POPULATION: Population = { villagers: 1500, monsters: 3000, markAll: true, campFood: 4900 };
/** A new game: a few settlers at the camp and nothing else. */
export const SETTLERS: Population = { villagers: 8, monsters: 0 };
export const NOBODY: Population = { villagers: 0, monsters: 0 };

/**
 * The population for the `swarm` URL setting: `on` for the benchmark load,
 * `off` for none, and the settlers for anything else. The `food` setting, a
 * whole number, sets the camp's starting food. Anything else leaves it at the
 * population's own.
 */
export function populationFor(swarm: string | null, food: string | null = null, deer: string | null = null): Population {
  const population = swarm === 'on' ? BENCHMARK_POPULATION : swarm === 'off' ? NOBODY : SETTLERS;
  const campFood = food !== null && /^\d{1,5}$/.test(food) ? Number(food) : NaN;
  const fed = campFood <= 0xffff ? { ...population, campFood } : population;
  return deer === 'off' ? { ...fed, animals: false } : fed;
}

/** Work completed since the simulation started. Nothing in the simulation reads it. The benchmark and the tests do. */
export interface Tally {
  felled: number;
  quarried: number;
  /** Units a villager carried onto a stockpile tile. Stone quarried onto one is not counted. */
  stocked: number;
  delivered: number;
  built: number;
  meals: number;
  /** Meals missed: at dusk with an empty store, or by a villager that did not come home. */
  missed: number;
  /** Units of food carried from a common store into a home. */
  carriedHome: number;
  died: number;
  /** Units of food a forager picked. */
  foraged: number;
  /** Units of food a forager put into a store. */
  foragedIn: number;
  /** Units of food a settler without a job carried from the ground into a store. */
  fromGround: number;
  /** Units of food carried from a barn into the camp for the households that live there. */
  toCamp: number;
  /** Shots hunters took, and those that hit, each a kill. */
  shots: number;
  kills: number;
  /** Units of food the kills left on the ground. */
  hunted: number;
  /** Units of food a hunter carried into a store. A settler without a job who carries a kill's food counts in `fromGround`. */
  huntedIn: number;
  /** Hides the kills left on the ground. */
  hides: number;
  /** Units of food gone from open ground at a dawn. */
  spoiled: number;
  /** Batches workers finished at workshops, such as the logs a woodcutter split. */
  batches: number;
  /** Units of output those batches made, such as firewood. */
  made: number;
  /** Villagers killed by a third missed meal in a row, by a third cold night in a row, and by old age. */
  starved: number;
  froze: number;
  oldAge: number;
  /** Cold nights villagers had. */
  coldNights: number;
  /** Fires lit on cold nights, and the firewood they burnt. */
  fires: number;
  burnt: number;
  /** Units of firewood carried from a woodshed into a home, and into the camp. */
  firewoodHome: number;
  firewoodToCamp: number;
  /** Pieces of clothing villagers took from a tailor's hut and put on. */
  dressed: number;
}

export interface Sim {
  readonly seed: number;
  /** The simulation's own copy of the map. Only the simulation changes it, and `takeTileChanges` reports each change. */
  readonly map: TileMap;
  readonly camp: number;
  /** Routes to the camp, for the villagers who walk home at dusk and for the monsters. */
  readonly flow: FlowField;
  readonly tileChanges: TileChanges;
  readonly villagers: Villagers;
  readonly households: Households;
  readonly monsters: Monsters;
  readonly animals: Animals;
  readonly orders: Orders;
  readonly siteTasks: SiteTasks;
  readonly gathering: Gathering;
  readonly foraging: Foraging;
  readonly hunting: Hunting;
  readonly workshops: Workshops;
  readonly goods: GoodsState;
  readonly stores: Stores;
  readonly putDownSearch: PutDownSearch;
  readonly pathSearch: PathSearch;
  /** Scratch for `fillPlaces`: the workers it counts at each site slot. Not part of the simulation's state. */
  readonly workers: Uint8Array;
  readonly tally: Tally;
  tick: number;
  /** Dawns passed since the start. */
  dawns: number;
  /** Places at workplaces taken since the start, so each hire has its own number. */
  hires: number;
  /** Villagers alive. */
  living: number;
  /** True once the last villager died. The clock stops for good. A simulation that started with nobody is never over. */
  over: boolean;
  speed: Speed;
  paused: boolean;
}

/**
 * The settlers a map starts with, in id order. Villagers `2h`, a man, and
 * `2h + 1`, a woman, form household `h`. With an odd count the last household
 * is one man. Each has the age and the life span the seed draws for its id.
 */
function startingSettlers(seed: number, population: Population): NewVillager[] {
  const names = startingNames(seed);
  return Array.from({ length: population.villagers }, (_, id) => {
    const household = id >> 1;
    const sex = id % 2 === 0 ? Sex.Man : Sex.Woman;
    return { sex, household, name: names[sex][household % names[sex].length]!, born: bornAt(startingAge(seed, id)), span: lifeSpan(seed, id) };
  });
}

/** Starts a simulation on its own copy of the map, so the caller's map never changes. */
export function createSim(source: TileMap, population: Population): Sim {
  const map = copyMap(source);
  const camp = campTile(map);
  const flow = createFlowField(map, camp);
  const settlers = startingSettlers(map.seed, population);
  const sim: Sim = {
    seed: map.seed,
    map,
    camp,
    flow,
    tileChanges: createTileChanges(map.size * map.size),
    villagers: createVillagers(map, flow, settlers),
    households: createHouseholds(settlers.length),
    monsters: createMonsters(map, flow, population.monsters),
    animals: createAnimals(map, population.animals ?? true),
    orders: createOrders(map, camp),
    siteTasks: createSiteTasks(map.size),
    gathering: createGathering(map),
    foraging: createForaging(map.size * map.size),
    hunting: createHunting(),
    workshops: createWorkshops(),
    goods: createGoodsState(map.size),
    stores: createStores(population.campFood ?? CAMP_FOOD),
    putDownSearch: createPutDownSearch(map.size * map.size),
    pathSearch: createPathSearch(map.size * map.size),
    workers: new Uint8Array(MAX_SITES),
    tally: {
      felled: 0, quarried: 0, stocked: 0, delivered: 0, built: 0, meals: 0, missed: 0, carriedHome: 0, died: 0,
      foraged: 0, foragedIn: 0, fromGround: 0, toCamp: 0, shots: 0, kills: 0, hunted: 0, huntedIn: 0, hides: 0, spoiled: 0,
      batches: 0, made: 0, starved: 0, froze: 0, oldAge: 0, coldNights: 0, fires: 0, burnt: 0, firewoodHome: 0, firewoodToCamp: 0, dressed: 0,
    },
    tick: 0,
    dawns: 0,
    hires: 0,
    living: settlers.length,
    over: false,
    speed: 1,
    paused: false,
  };
  for (let tile = 0; tile < map.size * map.size; tile++) refreshStack(sim, tile);
  if (population.markAll) {
    const whole = { x0: 0, y0: 0, x1: map.size - 1, y1: map.size - 1 };
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: whole });
    applyCommand(sim, { kind: 'markArea', order: 'quarry', area: whole });
  }
  return sim;
}

/** Returns what became of an order, and nothing for a clock command or a change of places. */
export function applyCommand(sim: Sim, command: Command): OrderOutcome | undefined {
  switch (command.kind) {
    case 'togglePause':
      if (!sim.over) sim.paused = !sim.paused;
      return;
    case 'setSpeed':
      if (sim.over) return;
      sim.speed = command.speed;
      sim.paused = false;
      return;
    case 'markArea': {
      const outcome = applyOrder(sim.map, sim.orders, command);
      if (!outcome.ok) return outcome;
      // A site that a cancel touches lies up to two tiles past the area, and its goods turn loose.
      refreshTasks(sim, command.area, command.order === 'cancel' ? 2 : 0);
      stopFallenTasks(sim);
      return outcome;
    }
    case 'place': {
      const outcome = applyOrder(sim.map, sim.orders, command);
      if (outcome.ok) resetSite(sim, sim.orders.siteOf[command.y * sim.map.size + command.x]!);
      return outcome;
    }
    case 'setPlaces':
      setPlaces(sim, command.slot, command.places);
      stopFallenTasks(sim);
      return;
  }
}

/**
 * Runs the systems in their fixed order. Nothing in a tick allocates. At dawn
 * every fire goes out, kept as last night's, every workshop's day of work starts anew, the food on open ground whose day has come is gone, and
 * tasks set aside as out of reach open again, as they do after a tick in
 * which land gained walks to the camp, and then the steps of `DAWN` run in
 * their order. Once the settlement has died out, nothing runs.
 */
export function step(sim: Sim): void {
  if (sim.over) return;
  const night = isNight(sim.tick);
  const dawn = isDawn(sim.tick);
  if (dawn) {
    sim.dawns += 1;
    sim.stores.burnedLastNight.set(sim.stores.burning);
    sim.stores.burning.fill(0);
    sim.workshops.worked.fill(0);
    spoilGoods(sim);
    reopenTasks(sim);
    for (let at = 0; at < DAWN.length; at++) DAWN[at]!(sim);
  }
  moveVillagers(sim, night);
  if (sim.flow.gainedCount > 0) reachTasks(sim);
  moveAnimals(sim, dawn);
  moveMonsters(sim.map, sim.flow, sim.monsters);
  sim.tick += 1;
}

export function ticksPerSecond(sim: Sim): number {
  return sim.paused || sim.over ? 0 : TICKS_PER_SECOND * sim.speed;
}
