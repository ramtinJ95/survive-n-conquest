import { describe, expect, it } from 'vitest';
import { campTile } from './camp';
import { createFlowField } from './flowField';
import { DIRECTIONS, type TileMap, stepLength, stepTo, walkable } from './map';
import { generateMap } from './mapgen';
import { hash } from './noise';
import { MAX_PATH, createPathSearch, findPath, planPath } from './paths';
import { createSim } from './sim';
import { at, mapFrom } from './testMaps';

/** The length of the step from one tile to the next, or NaN when units cannot take it. */
function stepBetween(map: TileMap, from: number, to: number): number {
  for (let direction = 0; direction < DIRECTIONS; direction++) {
    if (stepTo(map, from % map.size, Math.floor(from / map.size), direction) === to) return stepLength(direction);
  }
  return NaN;
}

describe('a path search', () => {
  it('finds a walk as short as the flow field finds, one legal step at a time', () => {
    const map = generateMap(7, 96);
    const camp = campTile(map);
    const flow = createFlowField(map, camp);
    const search = createPathSearch(map.size * map.size);
    const starts = Array.from({ length: map.size * map.size }, (_, tile) => tile)
      .filter((tile) => flow.next[tile] !== -1)
      .sort((a, b) => hash(5, a, 0) - hash(5, b, 0))
      .slice(0, 150);
    for (const start of starts) {
      expect(findPath(map, flow, search, camp, start)).toBe(true);
      let length = 0;
      let tile = start;
      for (let parent = search.parent[tile]!; parent !== -1; parent = search.parent[tile]!) {
        length += stepBetween(map, tile, parent);
        tile = parent;
      }
      expect(tile).toBe(camp);
      expect(Math.abs(length - flow.walk[start]!)).toBeLessThan(1e-9);
    }
  });

  it('finds no walk to land that water cuts off, and still finds walks after', () => {
    const map = mapFrom(['.....', '.....', '~~~~~', '.....', '.....']);
    const flow = createFlowField(map, at(map, 2, 1));
    const search = createPathSearch(map.size * map.size);
    expect(walkable(map, at(map, 0, 4))).toBe(true);
    expect(findPath(map, flow, search, at(map, 0, 0), at(map, 0, 4))).toBe(false);
    expect(findPath(map, flow, search, at(map, 0, 0), at(map, 4, 1))).toBe(true);
  });
});

describe('a villager route', () => {
  // A serpent of corridors whose far end lies more than MAX_PATH steps from its start.
  const rows = Array.from({ length: 33 }, (_, y) => {
    if (y % 2 === 0) return '.'.repeat(33);
    const gapAtEnd = y % 4 === 1;
    return gapAtEnd ? '#'.repeat(32) + '.' : '.' + '#'.repeat(32);
  });
  const serpent = mapFrom(rows);

  it('starts on the villager tile, keeps MAX_PATH tiles of a longer route, and goes on from the last kept tile', () => {
    const sim = createSim(serpent, { villagers: 1, monsters: 0 });
    const { villagers } = sim;
    villagers.x[0] = 0.5;
    villagers.y[0] = 0.5;
    const far = at(sim.map, 0, 32);
    expect(planPath(sim, 0, far)).toBe(true);
    const route = Array.from(villagers.path.subarray(0, villagers.pathLength[0]));
    expect(route).toHaveLength(MAX_PATH);
    expect(route[0]).toBe(at(sim.map, 0, 0));
    expect(villagers.pathCursor[0]).toBe(0);
    for (let i = 1; i < route.length; i++) expect(stepBetween(sim.map, route[i - 1]!, route[i]!)).toBeGreaterThan(0);

    let plans = 1;
    let kept = route;
    while (kept[kept.length - 1] !== far) {
      const last = kept[kept.length - 1]!;
      villagers.x[0] = (last % sim.map.size) + 0.5;
      villagers.y[0] = Math.floor(last / sim.map.size) + 0.5;
      expect(planPath(sim, 0, far)).toBe(true);
      kept = Array.from(villagers.path.subarray(0, villagers.pathLength[0]));
      expect(kept[0]).toBe(last);
      plans++;
      expect(plans).toBeLessThan(10);
    }
    expect(plans).toBeGreaterThan(2);
  });
});
