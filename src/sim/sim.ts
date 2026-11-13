import { TICKS_PER_SECOND } from './calendar';

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export type Command = { readonly kind: 'togglePause' } | { readonly kind: 'setSpeed'; readonly speed: Speed };

export interface Sim {
  readonly seed: number;
  tick: number;
  speed: Speed;
  paused: boolean;
}

export function createSim(seed: number): Sim {
  return { seed, tick: 0, speed: 1, paused: false };
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

export function step(sim: Sim): void {
  sim.tick += 1;
}

export function ticksPerSecond(sim: Sim): number {
  return sim.paused ? 0 : TICKS_PER_SECOND * sim.speed;
}
