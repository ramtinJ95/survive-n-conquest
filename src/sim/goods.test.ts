import { describe, expect, it } from 'vitest';
import { Good, putDown } from './goods';
import type { TileMap } from './map';
import { Claim } from './orders';
import { NOBODY, type Sim, createSim } from './sim';
import { at, mapFrom } from './testMaps';
import { NOT_CUT, NOT_SOWN } from './fields';
import { TILE_CHANGE_STRIDE, takeTileChanges } from './tileChanges';

const OPEN = mapFrom(Array.from({ length: 9 }, () => '.........'));

function stack(sim: Sim, tile: number): [Good, number] {
  return [sim.map.stackGood[tile]! as Good, sim.map.stackSize[tile]!];
}

function fill(map: TileMap, tile: number, good: Good, size: number): void {
  map.stackGood[tile] = good;
  map.stackSize[tile] = size;
}

/** Tiles with goods, as [tile, good, size], in tile order. */
function stacks(sim: Sim): [number, Good, number][] {
  const found: [number, Good, number][] = [];
  sim.map.stackSize.forEach((size, tile) => {
    if (size > 0) found.push([tile, sim.map.stackGood[tile]! as Good, size]);
  });
  return found;
}

const steps = (map: TileMap, a: number, b: number) =>
  Math.max(Math.abs((a % map.size) - (b % map.size)), Math.abs(Math.floor(a / map.size) - Math.floor(b / map.size)));

describe('putting goods down', () => {
  it('fills the first tile up to 8 units and puts the rest one step away', () => {
    const sim = createSim(OPEN, NOBODY);
    const from = at(sim.map, 4, 4);
    expect(putDown(sim, from, Good.Log, 10)).toBe(true);
    const found = stacks(sim);
    expect(stack(sim, from)).toEqual([Good.Log, 8]);
    expect(found).toHaveLength(2);
    const [other] = found.filter(([tile]) => tile !== from);
    expect(other![1]).toBe(Good.Log);
    expect(other![2]).toBe(2);
    expect(steps(sim.map, other![0], from)).toBe(1);

    const changes = takeTileChanges(sim);
    const listed = [];
    for (let i = 0; i < changes.length; i += TILE_CHANGE_STRIDE) listed.push(Array.from(changes.subarray(i, i + TILE_CHANGE_STRIDE)));
    expect(listed.sort((a, b) => a[0]! - b[0]!)).toEqual(
      found.map(([tile, good, size]) => [tile, sim.map.kinds[tile], 0, good, size, NOT_SOWN, NOT_CUT]),
    );
  });

  it('adds to a stack of the same good and passes over a full stack or a stack of another good', () => {
    const sim = createSim(OPEN, NOBODY);
    const [half, full, stone] = [at(sim.map, 1, 1), at(sim.map, 4, 4), at(sim.map, 7, 7)];
    fill(sim.map, half, Good.Log, 5);
    fill(sim.map, full, Good.Log, 8);
    fill(sim.map, stone, Good.Stone, 1);

    expect(putDown(sim, half, Good.Log, 3)).toBe(true);
    expect(stack(sim, half)).toEqual([Good.Log, 8]);
    expect(stacks(sim)).toHaveLength(3);

    for (const from of [full, stone]) {
      const before = stacks(sim).map(([tile]) => tile);
      expect(putDown(sim, from, Good.Log, 1)).toBe(true);
      const landed = stacks(sim).filter(([tile]) => !before.includes(tile));
      expect(landed).toHaveLength(1);
      expect([steps(sim.map, landed[0]![0], from), landed[0]![1], landed[0]![2]]).toEqual([1, Good.Log, 1]);
    }
    expect(stack(sim, full)).toEqual([Good.Log, 8]);
    expect(stack(sim, stone)).toEqual([Good.Stone, 1]);
  });

  it('counts the way in steps of a walk, so a free tile across a wall loses to one along the walk', () => {
    const walled = mapFrom([
      '.......',
      '#####..',
      '.......',
      '~~~~~~~',
      '~~~~~~~',
      '~~~~~~~',
      '~~~~~~~',
    ]);
    const sim = createSim(walled, NOBODY);
    for (let x = 0; x < 3; x++) fill(sim.map, at(sim.map, x, 2), Good.Stone, 8);
    expect(putDown(sim, at(sim.map, 0, 2), Good.Log, 1)).toBe(true);
    expect(stack(sim, at(sim.map, 3, 2))).toEqual([Good.Log, 1]);
    expect(stack(sim, at(sim.map, 0, 0))).toEqual([Good.None, 0]);
  });

  it('never puts a unit on a site, a house, water, or rock', () => {
    const sim = createSim(mapFrom(['~~~~~', '~..#~', '~..~~', '~~~~~', '~~~~~']), NOBODY);
    const [from, right, below, corner] = [at(sim.map, 1, 1), at(sim.map, 2, 1), at(sim.map, 1, 2), at(sim.map, 2, 2)];
    fill(sim.map, from, Good.Stone, 8);
    sim.orders.claims[right] = Claim.Site;
    sim.orders.claims[below] = Claim.Site;
    expect(putDown(sim, from, Good.Log, 9)).toBe(false);
    expect(putDown(sim, from, Good.Log, 8)).toBe(true);
    expect(stacks(sim)).toEqual([
      [from, Good.Stone, 8],
      [corner, Good.Log, 8],
    ]);
  });

  it('puts nothing down when the land that walks reach lacks room for every unit', () => {
    const island = mapFrom(['~~~~~~', '~..~..', '~..~..', '~~~~..', '~~~~~~', '~~~~~~']);
    const sim = createSim(island, NOBODY);
    const land = [at(sim.map, 1, 1), at(sim.map, 2, 1), at(sim.map, 1, 2), at(sim.map, 2, 2)];
    for (const tile of land) fill(sim.map, tile, Good.Log, 7);
    const before = stacks(sim);
    takeTileChanges(sim);

    expect(putDown(sim, land[0]!, Good.Log, 5)).toBe(false);
    expect(stacks(sim)).toEqual(before);
    expect(takeTileChanges(sim)).toHaveLength(0);

    expect(putDown(sim, land[0]!, Good.Log, 4)).toBe(true);
    expect(land.map((tile) => stack(sim, tile))).toEqual(land.map(() => [Good.Log, 8]));
  });
});
