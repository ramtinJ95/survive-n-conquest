import { type SiteTasks, createSiteTasks, resetSite } from './building';
import { TICKS_PER_SECOND } from './calendar';
import { campTile } from './camp';
import { isDawn, isNight } from './daylight';
import { type FlowField, createFlowField } from './flowField';
import { type Gathering, createGathering } from './gathering';
import { type GoodsState, type PutDownSearch, createGoodsState, createPutDownSearch, refreshStack } from './goods';
import { type TileMap, copyMap } from './map';
import { type Monsters, createMonsters, moveMonsters } from './monsters';
import { type OrderCommand, type OrderOutcome, type Orders, applyOrder, createOrders } from './orders';
import { type PathSearch, createPathSearch } from './paths';
import { reachTasks, refreshTasks, reopenTasks } from './tasks';
import { type TileChanges, createTileChanges } from './tileChanges';
import { type Villagers, createVillagers, moveVillagers, stopFallenTasks } from './villagers';

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export type Command =
  | { readonly kind: 'togglePause' }
  | { readonly kind: 'setSpeed'; readonly speed: Speed }
  | OrderCommand;

export interface Population {
  readonly villagers: number;
  readonly monsters: number;
  /** Marks every tree and every rock tile on the map at the start, through the same orders a player gives. */
  readonly markAll?: boolean;
}

/** The load the performance budget is set for: a full city at work under a late assault. */
export const BENCHMARK_POPULATION: Population = { villagers: 1500, monsters: 3000, markAll: true };
/** A new game: a few settlers at the camp and nothing else. */
export const SETTLERS: Population = { villagers: 8, monsters: 0 };
export const NOBODY: Population = { villagers: 0, monsters: 0 };

/** The population for the `swarm` URL setting: `on` for the benchmark load, `off` for none, and the settlers for anything else. */
export function populationFor(swarm: string | null): Population {
  if (swarm === 'on') return BENCHMARK_POPULATION;
  if (swarm === 'off') return NOBODY;
  return SETTLERS;
}

/** Work completed since the simulation started. Nothing in the simulation reads it. The benchmark and the tests do. */
export interface Tally {
  felled: number;
  /** Stone taken from rock tiles. */
  quarried: number;
  /** Units a villager carried onto a stockpile tile. Stone quarried onto one is not counted. */
  stocked: number;
  /** Units delivered to sites. */
  delivered: number;
  /** Houses finished. */
  built: number;
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
  readonly monsters: Monsters;
  readonly orders: Orders;
  readonly siteTasks: SiteTasks;
  readonly gathering: Gathering;
  readonly goods: GoodsState;
  readonly putDownSearch: PutDownSearch;
  readonly pathSearch: PathSearch;
  readonly tally: Tally;
  tick: number;
  speed: Speed;
  paused: boolean;
}

/** Starts a simulation on its own copy of the map, so the caller's map never changes. */
export function createSim(source: TileMap, population: Population): Sim {
  const map = copyMap(source);
  const camp = campTile(map);
  const flow = createFlowField(map, camp);
  const sim: Sim = {
    seed: map.seed,
    map,
    camp,
    flow,
    tileChanges: createTileChanges(map.size * map.size),
    villagers: createVillagers(map, flow, population.villagers),
    monsters: createMonsters(map, flow, population.monsters),
    orders: createOrders(map, camp),
    siteTasks: createSiteTasks(map.size),
    gathering: createGathering(map),
    goods: createGoodsState(map.size),
    putDownSearch: createPutDownSearch(map.size * map.size),
    pathSearch: createPathSearch(map.size * map.size),
    tally: { felled: 0, quarried: 0, stocked: 0, delivered: 0, built: 0 },
    tick: 0,
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

/** Returns what became of an order, and nothing for a clock command. */
export function applyCommand(sim: Sim, command: Command): OrderOutcome | undefined {
  switch (command.kind) {
    case 'togglePause':
      sim.paused = !sim.paused;
      return;
    case 'setSpeed':
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
    case 'placeHouse': {
      const outcome = applyOrder(sim.map, sim.orders, command);
      if (outcome.ok) resetSite(sim, sim.orders.siteOf[command.y * sim.map.size + command.x]!);
      return outcome;
    }
  }
}

/**
 * Runs the systems in their fixed order. Nothing in a tick allocates. Tasks set
 * aside as out of reach open again at dawn, and after a tick in which land
 * gained walks to the camp.
 */
export function step(sim: Sim): void {
  const night = isNight(sim.tick);
  if (isDawn(sim.tick)) reopenTasks(sim);
  moveVillagers(sim, night);
  if (sim.flow.gainedCount > 0) reachTasks(sim);
  moveMonsters(sim.map, sim.flow, sim.monsters);
  sim.tick += 1;
}

export function ticksPerSecond(sim: Sim): number {
  return sim.paused ? 0 : TICKS_PER_SECOND * sim.speed;
}
