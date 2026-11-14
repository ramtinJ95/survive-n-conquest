import { TICKS_PER_SECOND } from './calendar';
import { campTile } from './camp';
import { isNight } from './daylight';
import { type FlowField, createFlowField } from './flowField';
import type { TileKind, TileMap } from './map';
import { type Monsters, createMonsters, moveMonsters } from './monsters';
import { type Villagers, createVillagers, moveVillagers } from './villagers';

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export type Command = { readonly kind: 'togglePause' } | { readonly kind: 'setSpeed'; readonly speed: Speed };

export interface Population {
  readonly villagers: number;
  readonly monsters: number;
}

/** The load the performance budget is set for: a full city under a late assault. */
export const BENCHMARK_POPULATION: Population = { villagers: 1500, monsters: 3000 };
/** A new game: a few settlers at the camp and nothing else. */
export const SETTLERS: Population = { villagers: 8, monsters: 0 };

/** The tiles whose kind changed since the last `takeTileChanges`, each listed once, in the order of their first change. */
interface TileChanges {
  readonly listed: Uint8Array;
  readonly tiles: Int32Array;
  count: number;
}

export interface Sim {
  readonly seed: number;
  /** The simulation's own copy of the map. Only the simulation changes it, and `takeTileChanges` reports each change. */
  readonly map: TileMap;
  readonly camp: number;
  /** Routes to the camp, for the villagers who walk home at dusk and for the monsters. */
  flow: FlowField;
  readonly tileChanges: TileChanges;
  readonly villagers: Villagers;
  readonly monsters: Monsters;
  tick: number;
  speed: Speed;
  paused: boolean;
}

export function createSim(map: TileMap, population: Population): Sim {
  const camp = campTile(map);
  const flow = createFlowField(map, camp);
  const tiles = map.size * map.size;
  return {
    seed: map.seed,
    map,
    camp,
    flow,
    tileChanges: { listed: new Uint8Array(tiles), tiles: new Int32Array(tiles), count: 0 },
    villagers: createVillagers(map, flow, population.villagers),
    monsters: createMonsters(map, flow, population.monsters),
    tick: 0,
    speed: 1,
    paused: false,
  };
}

export function applyCommand(sim: Sim, command: Command): void {
  switch (command.kind) {
    case 'togglePause':
      sim.paused = !sim.paused;
      return;
    case 'setSpeed':
      sim.speed = command.speed;
      sim.paused = false;
      return;
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

/** Changes the kind of a tile, records the change for the renderer, and routes around the tile from then on. */
export function changeTile(sim: Sim, tile: number, kind: TileKind): void {
  if (sim.map.kinds[tile] === kind) return;
  sim.map.kinds[tile] = kind;
  const changes = sim.tileChanges;
  if (!changes.listed[tile]) {
    changes.listed[tile] = 1;
    changes.tiles[changes.count++] = tile;
  }
  sim.flow = createFlowField(sim.map, sim.camp);
}

/** The tiles changed since the last call, as pairs of a tile index and its kind now, and forgets them. */
export function takeTileChanges(sim: Sim): Int32Array {
  const changes = sim.tileChanges;
  const pairs = new Int32Array(changes.count * 2);
  for (let i = 0; i < changes.count; i++) {
    const tile = changes.tiles[i]!;
    pairs[i * 2] = tile;
    pairs[i * 2 + 1] = sim.map.kinds[tile]!;
    changes.listed[tile] = 0;
  }
  changes.count = 0;
  return pairs;
}
