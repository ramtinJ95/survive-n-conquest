import { TICKS_PER_SECOND } from './calendar';
import { type FlowField, createFlowField } from './flowField';
import type { TileMap } from './map';
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

export interface Sim {
  readonly seed: number;
  readonly map: TileMap;
  readonly flow: FlowField;
  readonly villagers: Villagers;
  readonly monsters: Monsters;
  tick: number;
  speed: Speed;
  paused: boolean;
}

export function createSim(map: TileMap, population: Population): Sim {
  const flow = createFlowField(map);
  return {
    seed: map.seed,
    map,
    flow,
    villagers: createVillagers(map, population.villagers),
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
  moveVillagers(sim.map, sim.villagers);
  moveMonsters(sim.map, sim.flow, sim.monsters);
  sim.tick += 1;
}

export function ticksPerSecond(sim: Sim): number {
  return sim.paused ? 0 : TICKS_PER_SECOND * sim.speed;
}
