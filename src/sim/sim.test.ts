import { describe, expect, it } from 'vitest';
import { Building } from './buildings';
import { TileKind } from './map';
import { generateMap } from './mapgen';
import { Claim, type OrderOutcome, createOrders, siteRefusal } from './orders';
import {
  BENCHMARK_POPULATION,
  type Command,
  type Population,
  SETTLERS,
  SPEEDS,
  type Sim,
  applyCommand,
  createSim,
  populationFor,
  step,
  ticksPerSecond,
} from './sim';

const NOBODY: Population = { villagers: 0, monsters: 0 };
const map = generateMap(1234, 32);

function clockOf({ seed, tick, speed, paused }: Sim) {
  return { seed, tick, speed, paused };
}

interface Scheduled {
  readonly tick: number;
  readonly command: Command;
}

function runScript(script: readonly Scheduled[], ticks: number): { sim: Sim; outcomes: (OrderOutcome | undefined)[] } {
  const sim = createSim(map, { villagers: 50, monsters: 50 });
  const outcomes: (OrderOutcome | undefined)[] = [];
  while (sim.tick < ticks) {
    for (const { tick, command } of script) if (tick === sim.tick) outcomes.push(applyCommand(sim, command));
    step(sim);
  }
  return { sim, outcomes };
}

function firstHouseSpot(): { x: number; y: number } {
  const orders = createOrders(map);
  for (let y = 1; y < map.size - 1; y++) {
    for (let x = 1; x < map.size - 1; x++) if (siteRefusal(map, orders, Building.House, x, y) === null) return { x, y };
  }
  throw new Error('no house fits on the test map');
}

const HOUSE = firstHouseSpot();
const WHOLE_MAP = { x0: 0, y0: 0, x1: map.size - 1, y1: map.size - 1 };

const SCRIPT: readonly Scheduled[] = [
  { tick: 0, command: { kind: 'setSpeed', speed: 4 } },
  { tick: 10, command: { kind: 'place', building: Building.House, ...HOUSE } },
  { tick: 10, command: { kind: 'place', building: Building.House, ...HOUSE } },
  { tick: 20, command: { kind: 'markArea', order: 'chop', area: WHOLE_MAP } },
  { tick: 30, command: { kind: 'markArea', order: 'quarry', area: WHOLE_MAP } },
  { tick: 40, command: { kind: 'markArea', order: 'stockpile', area: { x0: 0, y0: 0, x1: 9, y1: 9 } } },
  { tick: 500, command: { kind: 'markArea', order: 'cancel', area: { x0: 0, y0: 0, x1: 4, y1: 4 } } },
  { tick: 1200, command: { kind: 'togglePause' } },
  { tick: 1200, command: { kind: 'setSpeed', speed: 8 } },
  { tick: 2999, command: { kind: 'togglePause' } },
  { tick: 3000, command: { kind: 'togglePause' } },
  { tick: 7000, command: { kind: 'setSpeed', speed: 2 } },
  { tick: 7001, command: { kind: 'togglePause' } },
];

describe('the simulation', () => {
  it('reaches the same state from one seed and the same commands', () => {
    const first = runScript(SCRIPT, 9000);
    const second = runScript(SCRIPT, 9000);
    expect(second).toEqual(first);
    expect(clockOf(first.sim)).toEqual({ seed: 1234, tick: 9000, speed: 2, paused: true });
    expect(first.outcomes.filter((outcome) => outcome !== undefined).map(({ ok, order }) => [order, ok])).toEqual([
      ['house', true],
      ['house', false],
      ['chop', true],
      ['quarry', true],
      ['stockpile', true],
      ['cancel', true],
    ]);
  });

  it('opens the swarm with every tree and rock tile marked, as a player marks them', () => {
    const swarm = createSim(map, populationFor('on'));
    const byHand = createSim(map, { villagers: 1500, monsters: 3000, campFood: BENCHMARK_POPULATION.campFood, mostLiving: BENCHMARK_POPULATION.mostLiving });
    applyCommand(byHand, { kind: 'markArea', order: 'chop', area: WHOLE_MAP });
    applyCommand(byHand, { kind: 'markArea', order: 'quarry', area: WHOLE_MAP });
    const claimed = (sim: Sim, claim: Claim) => sim.orders.claims.filter((value) => value === claim).length;
    expect(claimed(swarm, Claim.Chop)).toBe(map.trees.filter((tree) => tree === 1).length);
    expect(claimed(swarm, Claim.Quarry)).toBe(map.kinds.filter((kind) => kind === TileKind.Rock).length);
    expect(swarm).toEqual(byHand);
    expect(createSim(map, SETTLERS).orders.claims.every((claim) => claim === Claim.None)).toBe(true);
  });

  it('answers an order with its outcome and a clock command with nothing', () => {
    const sim = createSim(map, NOBODY);
    expect(applyCommand(sim, { kind: 'togglePause' })).toBeUndefined();
    expect(applyCommand(sim, { kind: 'place', building: Building.House, ...HOUSE })).toEqual({ ok: true, order: 'house', tiles: 9 });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, ...HOUSE })).toEqual({ ok: false, order: 'house', refusal: 'site' });
  });

  it('starts at the first tick, running at 1x', () => {
    const sim = createSim(map, NOBODY);
    expect(clockOf(sim)).toEqual({ seed: 1234, tick: 0, speed: 1, paused: false });
    expect(ticksPerSecond(sim)).toBe(10);
  });

  it('advances one tick per step', () => {
    const sim = createSim(map, NOBODY);
    step(sim);
    step(sim);
    expect(sim.tick).toBe(2);
  });

  it.each(SPEEDS.map((speed) => [speed, speed * 10]))('runs %ix at %i ticks per second', (speed, rate) => {
    const sim = createSim(map, NOBODY);
    applyCommand(sim, { kind: 'setSpeed', speed });
    expect(ticksPerSecond(sim)).toBe(rate);
  });

  it('holds the clock while paused and resumes at the chosen speed', () => {
    const sim = createSim(map, NOBODY);
    applyCommand(sim, { kind: 'setSpeed', speed: 4 });
    applyCommand(sim, { kind: 'togglePause' });
    expect(ticksPerSecond(sim)).toBe(0);
    applyCommand(sim, { kind: 'togglePause' });
    expect(ticksPerSecond(sim)).toBe(40);
  });

  it('resumes when a speed is chosen during a pause', () => {
    const sim = createSim(map, NOBODY);
    applyCommand(sim, { kind: 'togglePause' });
    applyCommand(sim, { kind: 'setSpeed', speed: 2 });
    expect(ticksPerSecond(sim)).toBe(20);
  });

  it.each([
    ['on', BENCHMARK_POPULATION],
    ['off', { villagers: 0, monsters: 0 }],
    [null, SETTLERS],
    ['', SETTLERS],
    ['constructor', SETTLERS],
    ['toString', SETTLERS],
    ['__proto__', SETTLERS],
    ['ON', SETTLERS],
  ] as const)('opens swarm=%s with its population', (swarm, population) => {
    expect(populationFor(swarm)).toEqual(population);
    expect(structuredClone(populationFor(swarm))).toEqual(population);
  });
});
