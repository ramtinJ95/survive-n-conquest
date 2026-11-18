import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimFrame } from './frame';
import { mapFrom } from './sim/testMaps';
import type { ToSim } from './worker';

const map = mapFrom(Array.from({ length: 16 }, () => '.'.repeat(16)));
const population = { villagers: 1, monsters: 0 };

let frames: SimFrame[];
let send: (message: ToSim) => void;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  vi.resetModules();
  frames = [];
  vi.stubGlobal('self', {
    addEventListener: (_: string, listener: (event: { data: ToSim }) => void) => {
      send = (data) => listener({ data });
    },
    postMessage: (frame: SimFrame) => frames.push(frame),
  });
  await import('./worker');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const last = () => frames.at(-1)!;

describe('the simulation worker', () => {
  it('runs the clock from the start when the page asks for no paused start', () => {
    send({ kind: 'start', map, population, paused: false });
    vi.advanceTimersByTime(1000);
    expect(last().paused).toBe(false);
    expect(last().tick).toBeGreaterThanOrEqual(9);
  });

  it('starts paused before the first step when asked, and stays at tick 0', () => {
    send({ kind: 'start', map, population, paused: true });
    vi.advanceTimersByTime(5000);
    expect(frames.every((frame) => frame.tick === 0 && frame.paused)).toBe(true);
  });

  it('pauses at the tick it is given at any speed, and runs on when the clock is started again', () => {
    send({ kind: 'start', map, population, paused: true });
    send({ kind: 'pauseAt', tick: 125 });
    send({ kind: 'setSpeed', speed: 8 });
    vi.advanceTimersByTime(5000);
    expect([last().paused, last().tick]).toEqual([true, 125]);
    send({ kind: 'togglePause' });
    vi.advanceTimersByTime(1000);
    expect([last().paused, last().tick]).toEqual([false, 205]);
  });
});
