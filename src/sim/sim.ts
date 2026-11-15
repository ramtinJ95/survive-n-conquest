import { TICKS_PER_SECOND } from './calendar';
import { campTile } from './camp';
import { isNight } from './daylight';
import { type FlowField, createFlowField } from './flowField';
import { type TileMap, copyMap } from './map';
import { type Monsters, createMonsters, moveMonsters } from './monsters';
import { type OrderCommand, type OrderOutcome, type Orders, applyOrder, createOrders } from './orders';
import { type TileChanges, createTileChanges } from './tileChanges';
import { type Villagers, createVillagers, moveVillagers } from './villagers';

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export type Command =
  | { readonly kind: 'togglePause' }
  | { readonly kind: 'setSpeed'; readonly speed: Speed }
  | OrderCommand;

export interface Population {
  readonly villagers: number;
  readonly monsters: number;
}

/** The load the performance budget is set for: a full city under a late assault. */
export const BENCHMARK_POPULATION: Population = { villagers: 1500, monsters: 3000 };
/** A new game: a few settlers at the camp and nothing else. */
export const SETTLERS: Population = { villagers: 8, monsters: 0 };
export const NOBODY: Population = { villagers: 0, monsters: 0 };

/** The population for the `swarm` URL setting: `on` for the benchmark load, `off` for none, and the settlers for anything else. */
export function populationFor(swarm: string | null): Population {
  if (swarm === 'on') return BENCHMARK_POPULATION;
  if (swarm === 'off') return NOBODY;
  return SETTLERS;
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
  tick: number;
  speed: Speed;
  paused: boolean;
}

/** Starts a simulation on its own copy of the map, so the caller's map never changes. */
export function createSim(source: TileMap, population: Population): Sim {
  const map = copyMap(source);
  const camp = campTile(map);
  const flow = createFlowField(map, camp);
  return {
    seed: map.seed,
    map,
    camp,
    flow,
    tileChanges: createTileChanges(map.size * map.size),
    villagers: createVillagers(map, flow, population.villagers),
    monsters: createMonsters(map, flow, population.monsters),
    orders: createOrders(map, camp),
    tick: 0,
    speed: 1,
    paused: false,
  };
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
    case 'markArea':
    case 'placeHouse':
      return applyOrder(sim.map, sim.orders, command);
  }
}

/** Runs the systems in their fixed order. Nothing in a tick allocates. */
export function step(sim: Sim): void {
  moveVillagers(sim.map, sim.flow, sim.villagers, isNight(sim.tick));
  moveMonsters(sim.map, sim.flow, sim.monsters);
  sim.tick += 1;
}

export function ticksPerSecond(sim: Sim): number {
  return sim.paused ? 0 : TICKS_PER_SECOND * sim.speed;
}
