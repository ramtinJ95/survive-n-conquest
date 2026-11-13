import { describe, expect, it } from 'vitest';
import { type Command, SPEEDS, type Sim, applyCommand, createSim, step, ticksPerSecond } from './sim';

interface Scheduled {
  readonly tick: number;
  readonly command: Command;
}

function runScript(seed: number, script: readonly Scheduled[], ticks: number): Sim {
  const sim = createSim(seed);
  while (sim.tick < ticks) {
    for (const { tick, command } of script) if (tick === sim.tick) applyCommand(sim, command);
    step(sim);
  }
  return sim;
}

const SCRIPT: readonly Scheduled[] = [
  { tick: 0, command: { kind: 'setSpeed', speed: 4 } },
  { tick: 1200, command: { kind: 'togglePause' } },
  { tick: 1200, command: { kind: 'setSpeed', speed: 8 } },
  { tick: 2999, command: { kind: 'togglePause' } },
  { tick: 3000, command: { kind: 'togglePause' } },
  { tick: 7000, command: { kind: 'setSpeed', speed: 2 } },
  { tick: 7001, command: { kind: 'togglePause' } },
];

describe('the simulation', () => {
  it('reaches the same state from one seed and the same commands', () => {
    const first = runScript(1234, SCRIPT, 9000);
    const second = runScript(1234, SCRIPT, 9000);
    expect(second).toEqual(first);
    expect(first).toEqual({ seed: 1234, tick: 9000, speed: 2, paused: true });
  });

  it('starts at the first tick, running at 1x', () => {
    const sim = createSim(7);
    expect(sim).toEqual({ seed: 7, tick: 0, speed: 1, paused: false });
    expect(ticksPerSecond(sim)).toBe(10);
  });

  it('advances one tick per step', () => {
    const sim = createSim(7);
    step(sim);
    step(sim);
    expect(sim.tick).toBe(2);
  });

  it.each(SPEEDS.map((speed) => [speed, speed * 10]))('runs %ix at %i ticks per second', (speed, rate) => {
    const sim = createSim(7);
    applyCommand(sim, { kind: 'setSpeed', speed });
    expect(ticksPerSecond(sim)).toBe(rate);
  });

  it('holds the clock while paused and resumes at the chosen speed', () => {
    const sim = createSim(7);
    applyCommand(sim, { kind: 'setSpeed', speed: 4 });
    applyCommand(sim, { kind: 'togglePause' });
    expect(ticksPerSecond(sim)).toBe(0);
    applyCommand(sim, { kind: 'togglePause' });
    expect(ticksPerSecond(sim)).toBe(40);
  });

  it('resumes when a speed is chosen during a pause', () => {
    const sim = createSim(7);
    applyCommand(sim, { kind: 'togglePause' });
    applyCommand(sim, { kind: 'setSpeed', speed: 2 });
    expect(ticksPerSecond(sim)).toBe(20);
  });
});
