import type { TileMap } from './sim/map';
import { type OrderChanges, type OrderOutcome, takeOrderChanges } from './sim/orders';
import { type Command, type Population, type Sim, type Speed, applyCommand, createSim, step, ticksPerSecond } from './sim/sim';
import { takeTileChanges } from './sim/tileChanges';

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
  /** One `Good` per villager in id order: what each one carries. */
  readonly carried: Uint8Array;
  /** One `VillagerState` per villager in id order. A villager in its house at night is `VillagerState.Inside`, on the tile it went in on. */
  readonly states: Uint8Array;
  /** One task column value per villager in id order: `NO_TASK`, or one more than its kind's index in `TASK_KINDS`. */
  readonly tasks: Uint8Array;
  /** The tile of each villager's task in id order, or -1. */
  readonly taskTiles: Int32Array;
  /** Per villager in id order: an index into `NAMES[sex]`, a `Sex`, and a household. */
  readonly names: Uint16Array;
  readonly sexes: Uint8Array;
  readonly households: Int16Array;
  /** Per household: the site slot of its house, or `NO_HOME`. */
  readonly homes: Int16Array;
  /** The tiles changed since the last frame, as `takeTileChanges` groups them. */
  readonly tiles: Int32Array;
  /** The claims and sites changed since the last frame. */
  readonly orders: OrderChanges;
  /** What became of the order command applied just before this frame. */
  readonly outcome?: OrderOutcome;
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

function publish(sim: Sim, outcome?: OrderOutcome) {
  const villagers = positions(sim.villagers);
  const monsters = positions(sim.monsters);
  const carried = sim.villagers.carried.slice();
  const states = sim.villagers.state.slice();
  const tasks = sim.villagers.task.slice();
  const taskTiles = sim.villagers.taskTile.slice();
  const names = sim.villagers.name.slice();
  const sexes = sim.villagers.sex.slice();
  const households = sim.villagers.household.slice();
  const homes = sim.households.home.slice();
  const tiles = takeTileChanges(sim);
  const orders = takeOrderChanges(sim.orders);
  self.postMessage(
    {
      tick: sim.tick,
      speed: sim.speed,
      paused: sim.paused,
      villagers,
      monsters,
      carried,
      states,
      tasks,
      taskTiles,
      names,
      sexes,
      households,
      homes,
      tiles,
      orders,
      outcome,
    } satisfies SimFrame,
    {
      transfer: [
        villagers.buffer,
        monsters.buffer,
        carried.buffer,
        states.buffer,
        tasks.buffer,
        taskTiles.buffer,
        names.buffer,
        sexes.buffer,
        households.buffer,
        homes.buffer,
        tiles.buffer,
        orders.claims.buffer,
        orders.sites.buffer,
      ],
    },
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
    publish(sim, applyCommand(sim, command));
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
