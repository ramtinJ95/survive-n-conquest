import type { TileMap } from './sim/map';
import { type Command, type Population, type Sim, type Speed, applyCommand, createSim, step, ticksPerSecond } from './sim/sim';

export type ToSim = { readonly kind: 'start'; readonly map: TileMap; readonly population: Population } | Command;

export interface ClockSnapshot {
  readonly tick: number;
  readonly speed: Speed;
  readonly paused: boolean;
}

/** What the worker posts after the clock moves. Positions are pairs of map x and y in tiles, one pair per unit in id order. */
export interface SimFrame extends ClockSnapshot {
  readonly villagers: Float32Array;
  readonly monsters: Float32Array;
}

const PUMP_MS = 1000 / 60;
// After a stall (a throttled tab, a sleeping laptop) the clock slows down instead of leaping ahead.
const MAX_OWED_TICKS = 80;

function positions({ x, y }: { readonly x: Float32Array; readonly y: Float32Array }): Float32Array {
  const pairs = new Float32Array(x.length * 2);
  for (let id = 0; id < x.length; id++) {
    pairs[id * 2] = x[id]!;
    pairs[id * 2 + 1] = y[id]!;
  }
  return pairs;
}

function publish(sim: Sim) {
  const villagers = positions(sim.villagers);
  const monsters = positions(sim.monsters);
  self.postMessage(
    { tick: sim.tick, speed: sim.speed, paused: sim.paused, villagers, monsters } satisfies SimFrame,
    { transfer: [villagers.buffer, monsters.buffer] },
  );
}

function host(map: TileMap, population: Population): (command: Command) => void {
  const sim = createSim(map, population);
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
    receive = host(data.map, data.population);
  } else if (receive) {
    receive(data);
  } else {
    throw new Error(`the ${data.kind} command arrived before the simulation started`);
  }
});
