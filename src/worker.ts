import { type Command, type Sim, type Speed, applyCommand, createSim, step, ticksPerSecond } from './sim/sim';

export type ToSim = { readonly kind: 'start'; readonly seed: number } | Command;

export interface ClockSnapshot {
  readonly tick: number;
  readonly speed: Speed;
  readonly paused: boolean;
}

const PUMP_MS = 1000 / 60;
// After a stall (a throttled tab, a sleeping laptop) the clock slows down instead of leaping ahead.
const MAX_OWED_TICKS = 80;

function publish(sim: Sim) {
  self.postMessage({ tick: sim.tick, speed: sim.speed, paused: sim.paused } satisfies ClockSnapshot);
}

function host(seed: number): (command: Command) => void {
  const sim = createSim(seed);
  let owed = 0;
  let last = performance.now();
  const catchUp = () => {
    const now = performance.now();
    owed = Math.min(owed + ((now - last) / 1000) * ticksPerSecond(sim), MAX_OWED_TICKS);
    last = now;
    for (; owed >= 1; owed -= 1) step(sim);
  };
  setInterval(() => {
    const before = sim.tick;
    catchUp();
    if (sim.tick !== before) publish(sim);
  }, PUMP_MS);
  publish(sim);
  return (command) => {
    catchUp();
    applyCommand(sim, command);
    publish(sim);
  };
}

let receive: ((command: Command) => void) | undefined;

self.addEventListener('message', ({ data }: MessageEvent<ToSim>) => {
  if (data.kind === 'start') {
    if (receive) throw new Error('the simulation has already started');
    receive = host(data.seed);
  } else if (receive) {
    receive(data);
  } else {
    throw new Error(`the ${data.kind} command arrived before the simulation started`);
  }
});
