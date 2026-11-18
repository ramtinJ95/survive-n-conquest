import { frameOf } from './frame';
import type { TileMap } from './sim/map';
import type { OrderOutcome } from './sim/orders';
import { type Command, type Population, type Sim, applyCommand, createSim, step, ticksPerSecond } from './sim/sim';

/**
 * `paused` starts the clock paused, before the first step. `everyTick` posts a frame after every step, not once a pump,
 * so the page sees each unit's move of every tick and turns it the same way however its frames are timed. `pauseAt`
 * pauses the clock when it reaches a tick. The verification harness asks for all three, and a player's page for none.
 */
export type ToSim =
  | {
      readonly kind: 'start';
      readonly map: TileMap;
      readonly population: Population;
      readonly paused: boolean;
      readonly everyTick: boolean;
    }
  | { readonly kind: 'pauseAt'; readonly tick: number }
  | Command;
type Control = Exclude<ToSim, { kind: 'start' }>;

const PUMP_MS = 1000 / 60;
// After a stall (a throttled tab, a sleeping laptop) the clock slows down instead of leaping ahead.
const MAX_OWED_TICKS = 80;

function publish(sim: Sim, outcome?: OrderOutcome) {
  const { frame, transfer } = frameOf(sim, outcome);
  self.postMessage(frame, { transfer });
}

function host(map: TileMap, population: Population, paused: boolean, everyTick: boolean): (control: Control) => void {
  const sim = createSim(map, population);
  sim.paused = paused;
  let owed = 0;
  let last = performance.now();
  let pauseAt = -1;
  const catchUp = () => {
    const now = performance.now();
    owed = Math.min(owed + ((now - last) / 1000) * ticksPerSecond(sim), MAX_OWED_TICKS);
    last = now;
    for (; owed >= 1; owed -= 1) {
      step(sim);
      const stop = sim.tick === pauseAt;
      if (stop) {
        sim.paused = true;
        pauseAt = -1;
      }
      if (everyTick) publish(sim);
      if (stop) {
        owed = 0;
        break;
      }
    }
  };
  setInterval(() => {
    const before = sim.tick;
    catchUp();
    if (sim.tick !== before && !everyTick) publish(sim);
  }, PUMP_MS);
  publish(sim);
  return (control) => {
    catchUp();
    if (control.kind === 'pauseAt') {
      pauseAt = control.tick;
      publish(sim);
    } else {
      publish(sim, applyCommand(sim, control));
    }
  };
}

let receive: ((control: Control) => void) | undefined;

self.addEventListener('message', ({ data }: MessageEvent<ToSim>) => {
  if (data.kind === 'start') {
    if (receive) throw new Error('the simulation has already started');
    receive = host(data.map, data.population, data.paused, data.everyTick);
  } else if (receive) {
    receive(data);
  } else {
    throw new Error(`the ${data.kind} command arrived before the simulation started`);
  }
});
