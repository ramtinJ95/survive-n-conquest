import { describe, expect, it } from 'vitest';
import { campTile } from './camp';
import { generateMap } from './mapgen';
import { TileKind, type TileMap, createTileMap } from './map';

const KINDS: Readonly<Record<string, TileKind>> = { '.': TileKind.Grass, '~': TileKind.Water, '#': TileKind.Rock };

function mapFrom(rows: readonly string[]): TileMap {
  const size = rows.length;
  const kinds = Uint8Array.from(rows.join(''), (cell) => KINDS[cell]!);
  return createTileMap(1, size, new Float32Array(size * size).fill(1), kinds);
}

describe('the camp', () => {
  it('is the walkable tile nearest the map center', () => {
    const open = mapFrom(Array.from({ length: 16 }, () => '.'.repeat(16)));
    const camp = campTile(open);
    expect([camp % 16, Math.floor(camp / 16)]).toEqual([7, 7]);
  });

  it('moves off land that no walk from the map edge reaches', () => {
    const walled = mapFrom([
      '..........',
      '..........',
      '..........',
      '...####...',
      '...#..#...',
      '...#..#...',
      '...####...',
      '..........',
      '..........',
      '..........',
    ]);
    const camp = campTile(walled);
    expect(walled.kinds[camp]).toBe(TileKind.Grass);
    const [x, y] = [camp % 10, Math.floor(camp / 10)];
    expect(x < 3 || x > 6 || y < 3 || y > 6).toBe(true);
    expect(Math.hypot(x + 0.5 - 5, y + 0.5 - 5)).toBeCloseTo(Math.hypot(2.5, 0.5), 5);
  });

  it('stands near the center of the game maps', () => {
    for (const seed of [7, 2026]) {
      const map = generateMap(seed);
      const camp = campTile(map);
      expect(Math.hypot((camp % map.size) + 0.5 - map.size / 2, Math.floor(camp / map.size) + 0.5 - map.size / 2)).toBeLessThan(2);
    }
  });
});
