import { TileKind, type TileMap, createTileMap } from './map';

const KINDS: Readonly<Record<string, TileKind>> = {
  '.': TileKind.Grass,
  '~': TileKind.Water,
  '#': TileKind.Rock,
  f: TileKind.Forest,
  T: TileKind.Forest,
  _: TileKind.Bare,
};

/**
 * A square map for tests, drawn one row per string: `.` grass, `~` water, `#`
 * rock, `f` forest, `T` forest with a tree, `_` bare ground. Every tile stands
 * 1 m high.
 */
export function mapFrom(rows: readonly string[], seed = 3): TileMap {
  const size = rows.length;
  const cells = rows.join('');
  if (cells.length !== size * size) throw new Error('a test map must be square');
  const kinds = Uint8Array.from(cells, (cell) => {
    const kind = KINDS[cell];
    if (kind === undefined) throw new Error(`no tile kind for '${cell}'`);
    return kind;
  });
  const map = createTileMap(seed, size, new Float32Array(size * size).fill(1), kinds);
  for (let tile = 0; tile < cells.length; tile++) if (cells[tile] === 'T') map.trees[tile] = 1;
  return map;
}

/** The tile at (x, y). */
export function at(map: TileMap, x: number, y: number): number {
  return y * map.size + x;
}
