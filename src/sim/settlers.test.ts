import { describe, expect, it } from 'vitest';
import { campTile } from './camp';
import { isNight } from './daylight';
import { TileKind, type TileMap, tileAt, walkable } from './map';
import { generateMap } from './mapgen';
import { type Command, SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { mapFrom } from './testMaps';
import { changeTile, takeTileChanges } from './tileChanges';
import { WANDER_REACH } from './villagers';

const map = generateMap(7);

/** One villager standing at (x, y) on the map, at the first tick of the night. */
function nightFor(on: TileMap, x: number, y: number): Sim {
  const sim = createSim(on, { villagers: 1, monsters: 0 });
  while (!isNight(sim.tick)) sim.tick++;
  sim.villagers.x[0] = x;
  sim.villagers.y[0] = y;
  return sim;
}

function runUntil(sim: Sim, done: (sim: Sim) => boolean, afterEach: () => void = () => {}): void {
  while (!done(sim)) {
    step(sim);
    afterEach();
  }
}

const atCamp = (sim: Sim, id: number) => sim.villagers.x[id] === sim.villagers.spotX[id] && sim.villagers.y[id] === sim.villagers.spotY[id];
const everyone = (sim: Sim, test: (id: number) => boolean) => Array.from(sim.villagers.x.subarray(0, sim.villagers.count), (_, id) => test(id)).every(Boolean);

describe('the settlers', () => {
  it('open the game as 8 villagers at the camp', () => {
    const sim = createSim(map, SETTLERS);
    expect(sim.villagers.count).toBe(8);
    expect(sim.monsters.x.length).toBe(0);
    expect(sim.camp).toBe(campTile(map));
    expect(everyone(sim, (id) => atCamp(sim, id))).toBe(true);
    const spots = new Set(Array.from(sim.villagers.x.subarray(0, sim.villagers.count), (x, id) => `${x},${sim.villagers.y[id]}`));
    expect(spots.size).toBe(8);
  });

  it('wander near the camp by day, walk to it at dusk, stay until dawn, and leave again', () => {
    const sim = createSim(map, SETTLERS);
    const campX = (sim.camp % map.size) + 0.5;
    const campY = Math.floor(sim.camp / map.size) + 0.5;
    let farthest = 0;
    let offLand = 0;
    const watch = () => {
      for (let id = 0; id < 8; id++) {
        const { x, y } = sim.villagers;
        farthest = Math.max(farthest, Math.abs(x[id]! - campX), Math.abs(y[id]! - campY));
        if (!walkable(map, tileAt(map, x[id]!, y[id]!))) offLand++;
      }
    };

    runUntil(sim, (s) => isNight(s.tick), watch);
    const dusk = sim.tick;
    expect(farthest).toBeGreaterThan(WANDER_REACH / 2);
    expect(farthest).toBeLessThanOrEqual(WANDER_REACH);
    expect(everyone(sim, (id) => atCamp(sim, id))).toBe(false);

    runUntil(sim, (s) => s.tick === dusk + 600, watch);
    expect(everyone(sim, (id) => atCamp(sim, id))).toBe(true);
    const restingX = Float32Array.from(sim.villagers.x.subarray(0, sim.villagers.count));
    const restingY = Float32Array.from(sim.villagers.y.subarray(0, sim.villagers.count));

    runUntil(sim, (s) => !isNight(s.tick), watch);
    expect(sim.villagers.x.subarray(0, sim.villagers.count)).toEqual(restingX);
    expect(sim.villagers.y.subarray(0, sim.villagers.count)).toEqual(restingY);

    runUntil(sim, (s) => s.tick === dusk + 1800 + 100, watch);
    expect(everyone(sim, (id) => atCamp(sim, id))).toBe(false);
    expect(offLand).toBe(0);
  });

  it.each([7, 18, 24, 2026])('all reach their spots at the camp by night on seed %i', (seed) => {
    const sim = createSim(generateMap(seed), SETTLERS);
    runUntil(sim, (s) => isNight(s.tick));
    const dusk = sim.tick;
    runUntil(sim, (s) => s.tick === dusk + 600);
    expect(Array.from(sim.villagers.x.subarray(0, sim.villagers.count), (_, id) => atCamp(sim, id))).toEqual(Array(8).fill(true));
  });

  it('walk around water and rock to reach the camp', () => {
    const walled = mapFrom([
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '###########.',
      '~~~~~~~~~~~.',
      '............',
      '............',
      '............',
    ]);
    const sim = nightFor(walled, 3.5, 10.5);
    const { villagers } = sim;
    expect(sim.camp).toBe(campTile(walled));
    const tiles = new Set<number>();
    for (let tick = 0; tick < 300; tick++) {
      step(sim);
      expect(isNight(sim.tick)).toBe(true);
      const tile = tileAt(walled, villagers.x[0]!, villagers.y[0]!);
      expect(walkable(walled, tile)).toBe(true);
      tiles.add(tile);
    }
    expect([villagers.x[0], villagers.y[0]]).toEqual([villagers.spotX[0], villagers.spotY[0]]);
    expect(tiles.has(tileAt(walled, 11.5, 8.5))).toBe(true);
  });

  it('stay where they stand at night when no walk reaches the camp', () => {
    const island = mapFrom([
      '........',
      '........',
      '........',
      '........',
      '........',
      '~~~~~~~~',
      '~~~~~~~~',
      '.~~~~~~~',
    ]);
    const sim = nightFor(island, 0.5, 7.5);
    for (let tick = 0; tick < 100; tick++) step(sim);
    expect(isNight(sim.tick)).toBe(true);
    expect([sim.villagers.x[0], sim.villagers.y[0]]).toEqual([0.5, 7.5]);
  });

  it('reach the same state through a dusk and a dawn from one seed and the same commands', () => {
    const script: readonly { tick: number; command: Command }[] = [
      { tick: 300, command: { kind: 'setSpeed', speed: 8 } },
      { tick: 1500, command: { kind: 'togglePause' } },
      { tick: 1500, command: { kind: 'togglePause' } },
      { tick: 3200, command: { kind: 'setSpeed', speed: 2 } },
    ];
    const play = () => {
      const sim = createSim(map, SETTLERS);
      let nights = 0;
      let wasNight = false;
      while (sim.tick < 4000) {
        for (const { tick, command } of script) if (tick === sim.tick) applyCommand(sim, command);
        step(sim);
        if (isNight(sim.tick) !== wasNight) nights++;
        wasNight = isNight(sim.tick);
      }
      return { sim, turns: nights };
    };
    const first = play();
    const second = play();
    expect(first.turns).toBe(2);
    expect(second.sim).toEqual(first.sim);
    expect(first.sim.villagers.x).not.toEqual(createSim(map, SETTLERS).villagers.x);
  });
});

describe('tile changes', () => {
  it('are reported once each, with the kind the tile has now, and routes go around them', () => {
    const sim = createSim(map, SETTLERS);
    const [first, second] = [sim.camp + 3, sim.camp + 3 * map.size];
    expect(sim.flow.next[first]).not.toBe(-1);
    changeTile(sim, first, TileKind.Water);
    changeTile(sim, second, TileKind.Rock);
    changeTile(sim, first, TileKind.Rock);
    expect(Array.from(takeTileChanges(sim))).toEqual([first, TileKind.Rock, 0, 0, 0, second, TileKind.Rock, 0, 0, 0]);
    expect(takeTileChanges(sim).length).toBe(0);
    expect(sim.flow.next[first]).toBe(-1);
    expect(sim.flow.next[second]).toBe(-1);
    for (let tile = 0; tile < map.size * map.size; tile++) {
      const next = sim.flow.next[tile]!;
      if (next !== -1) expect(next === first || next === second, `tile ${tile}`).toBe(false);
    }
  });
});
