import { BufferAttribute, BufferGeometry, Color, type IUniform, Mesh, type Vector4 } from 'three';
import { CAMP_RADIUS } from '../sim/camp';
import { TileKind, WATER_LEVEL, type TileMap } from '../sim/map';
import { fractalNoise, hashUnit } from '../sim/noise';
import { PALETTES, type Palette } from './palette';
import { SEASON_COLORS, seasonalMaterial } from './seasonal';

/** How far the cut edge of the map reaches below the water level, in meters. */
const SLAB_DEPTH = 7;
const FACET_SHIMMER = 0.12;
/** Meadow patches are about this many meters across, and patches of lush grass about this many. */
const MEADOW_SPAN = 26;
const LUSH_SPAN = 11;
/** The feet of the settlers wear the grass down to soil around the middle of the camp: all of it up to `full` meters, none past `none`. */
const WEAR = { full: CAMP_RADIUS + 0.3, none: CAMP_RADIUS + 2.6, ragged: 0.9 };

function ramp(from: number, to: number, value: number): number {
  return Math.min(Math.max((value - from) / (to - from), 0), 1);
}

/** What colors the ground of a tile besides its kind: its height, two slow noises in about [-1, 1], and the share of it worn to soil. */
interface Ground {
  height: number;
  meadow: number;
  lush: number;
  worn: number;
}

const GROUND_COLOR: Record<TileKind, (palette: Palette, ground: Ground, out: Color) => Color> = {
  [TileKind.Grass]: (palette, { height, meadow, lush, worn }, out) =>
    out
      .lerpColors(palette.grassLow, palette.grassHigh, ramp(2, 16, height))
      .lerp(palette.grassLush, 0.75 * ramp(-0.1, 0.5, lush))
      .lerp(palette.meadow, 0.6 * ramp(-0.2, 0.4, meadow))
      .lerp(palette.sand, 1 - ramp(0.15, 0.9, height))
      .lerp(palette.worn, worn),
  [TileKind.Forest]: (palette, { height, meadow, lush }, out) =>
    out
      .lerpColors(palette.forestFloor, palette.grassHigh, 0.35 * ramp(4, 18, height))
      .lerp(palette.grassLush, 0.3 * ramp(-0.1, 0.5, lush))
      .lerp(palette.meadow, 0.2 * ramp(-0.2, 0.4, meadow)),
  [TileKind.Rock]: (palette, { height }, out) => out.lerpColors(palette.rockLow, palette.rockHigh, ramp(3, 20, height)),
  [TileKind.Water]: (palette, { height }, out) =>
    out.lerpColors(palette.sand, palette.lakeBed, ramp(0, 2.2, WATER_LEVEL - height)),
  [TileKind.Bare]: (palette, { meadow, worn }, out) =>
    out.lerpColors(palette.bare, palette.soil, 0.25 * ramp(-0.2, 0.4, meadow)).lerp(palette.worn, worn),
  [TileKind.House]: (palette, { meadow, worn }, out) =>
    out.lerpColors(palette.bare, palette.soil, 0.25 * ramp(-0.2, 0.4, meadow)).lerp(palette.worn, worn),
};

/** Reads what colors the ground of each tile, apart from its kind. */
function groundOf(map: TileMap, camp: number): (tile: number) => Ground {
  const { size, seed, heights } = map;
  const campX = camp % size;
  const campY = Math.floor(camp / size);
  const ground: Ground = { height: 0, meadow: 0, lush: 0, worn: 0 };
  return (tile) => {
    const x = tile % size;
    const y = Math.floor(tile / size);
    const fromCamp = Math.hypot(x - campX, y - campY) + WEAR.ragged * (hashUnit(seed ^ 0x3a7, x, y) - 0.5);
    ground.height = heights[tile]!;
    ground.meadow = fractalNoise(seed, x / MEADOW_SPAN, y / MEADOW_SPAN, 2);
    ground.lush = fractalNoise(seed ^ 0x1c5, x / LUSH_SPAN, y / LUSH_SPAN, 2);
    ground.worn = 1 - ramp(WEAR.full, WEAR.none, fromCamp);
    return ground;
  };
}

function tileColors(map: TileMap, palette: Palette, groundAt: (tile: number) => Ground): Float32Array {
  const colors = new Float32Array(map.size * map.size * 3);
  const color = new Color();
  for (let i = 0; i < map.size * map.size; i++) {
    GROUND_COLOR[map.kinds[i] as TileKind](palette, groundAt(i), color).toArray(colors, i * 3);
  }
  return colors;
}

/**
 * The ground as flat-shaded triangles, and the cut edge of the map as walls. A
 * vertex sits at each tile center. One more ring of vertices sits on the map
 * edge and repeats the border tiles, so the ground covers every tile in full
 * and matches `heightAt`. The map center sits at the world origin. Every
 * vertex carries its color in each season, and `seasonMix` blends them. The
 * ground around the tile `camp` is worn to soil.
 */
export function createTerrain(map: TileMap, seasonMix: IUniform<Vector4>, camp: number) {
  const { size, heights } = map;
  const rows = size + 2;
  const cells = size + 1;
  const half = size / 2;
  const along = (line: number) => Math.min(Math.max(line - 0.5, 0), size) - half;
  const tileAlong = (line: number) => Math.min(Math.max(line - 1, 0), size - 1);
  /** The tile that gives vertex `corner` its height and color. Vertices are numbered row by row. */
  const tileAt = (corner: number) =>
    tileAlong(Math.floor(corner / rows)) * size + tileAlong(corner % rows);
  const vertexCount = (cells * cells * 2 + cells * 4 * 2) * 3;
  const positions = new Float32Array(vertexCount * 3);
  const groundAt = groundOf(map, camp);
  const seasons = PALETTES.map((palette) => ({
    palette,
    tiles: tileColors(map, palette, groundAt),
    colors: new Uint8ClampedArray(vertexCount * 3),
  }));
  let cursor = 0;
  const scratch = new Color();

  const vertex = (x: number, y: number, z: number) => {
    positions[cursor] = x;
    positions[cursor + 1] = y;
    positions[cursor + 2] = z;
    cursor += 3;
  };

  const paint = (colors: Uint8ClampedArray, at: number, r: number, g: number, b: number) => {
    colors[at] = r * 255;
    colors[at + 1] = g * 255;
    colors[at + 2] = b * 255;
  };

  /** Colors the facet whose first vertex is at `at`, in each season, from the tiles of its corners. */
  const colorFacet = (at: number, a: number, b: number, c: number) => {
    const shimmer = (1 + FACET_SHIMMER * (hashUnit(map.seed, a, b ^ c) - 0.5)) / 3;
    const ta = tileAt(a) * 3;
    const tb = tileAt(b) * 3;
    const tc = tileAt(c) * 3;
    for (const { tiles, colors } of seasons) {
      const r = (tiles[ta]! + tiles[tb]! + tiles[tc]!) * shimmer;
      const g = (tiles[ta + 1]! + tiles[tb + 1]! + tiles[tc + 1]!) * shimmer;
      const bl = (tiles[ta + 2]! + tiles[tb + 2]! + tiles[tc + 2]!) * shimmer;
      for (let corner = 0; corner < 9; corner += 3) paint(colors, at + corner, r, g, bl);
    }
  };

  /** The corners of the two facets of the cell whose top left vertex is at (x, y). */
  const cellFacets = (x: number, y: number): [number, number, number][] => {
    const nw = y * rows + x;
    const ne = nw + 1;
    const sw = nw + rows;
    const se = sw + 1;
    return (x + y) % 2 === 0
      ? [
          [nw, sw, se],
          [nw, se, ne],
        ]
      : [
          [nw, sw, ne],
          [ne, sw, se],
        ];
  };

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      for (const [a, b, c] of cellFacets(x, y)) {
        colorFacet(cursor, a, b, c);
        for (const corner of [a, b, c]) {
          vertex(along(corner % rows), heights[tileAt(corner)]!, along(Math.floor(corner / rows)));
        }
      }
    }
  }

  const base = WATER_LEVEL - SLAB_DEPTH;
  const rim = (palette: Palette, height: number) => (height < WATER_LEVEL ? palette.water : palette.soil);

  /** A wall under the edge from vertex `from` to vertex `to`. It faces left of that direction. */
  const wall = (from: number, to: number) => {
    const fx = along(from % rows);
    const fz = along(Math.floor(from / rows));
    const tx = along(to % rows);
    const tz = along(Math.floor(to / rows));
    const fromHeight = heights[tileAt(from)]!;
    const toHeight = heights[tileAt(to)]!;
    const fy = Math.max(fromHeight, WATER_LEVEL);
    const ty = Math.max(toHeight, WATER_LEVEL);
    for (const { palette, colors } of seasons) {
      const top = [rim(palette, fromHeight), rim(palette, toHeight)] as const;
      const deep = palette.bedrock;
      [top[0], top[1], deep, top[1], deep, deep].forEach((color, corner) =>
        paint(colors, cursor + corner * 3, color.r, color.g, color.b),
      );
    }
    vertex(fx, fy, fz);
    vertex(tx, ty, tz);
    vertex(fx, base, fz);
    vertex(tx, ty, tz);
    vertex(tx, base, tz);
    vertex(fx, base, fz);
  };

  const lastRow = cells * rows;
  for (let i = 0; i < cells; i++) {
    wall(i, i + 1);
    wall(lastRow + i + 1, lastRow + i);
    wall((i + 1) * rows, i * rows);
    wall(i * rows + cells, (i + 1) * rows + cells);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  seasons.forEach(({ colors }, season) =>
    geometry.setAttribute(SEASON_COLORS[season]!, new BufferAttribute(colors, 3, true)),
  );
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const terrain = new Mesh(geometry, seasonalMaterial(seasonMix));
  terrain.name = 'terrain';
  terrain.castShadow = true;
  terrain.receiveShadow = true;

  /** The vertex lines, along one axis, that take their height and color from tile line `line`. */
  const linesOf = (line: number) => [line + 1, ...(line === 0 ? [0] : []), ...(line === size - 1 ? [size + 1] : [])];
  const cellsBeside = (line: number) => {
    const lines = linesOf(line);
    return { from: Math.max(Math.min(...lines) - 1, 0), to: Math.min(Math.max(...lines), cells - 1) };
  };

  /** Colors a tile again after its kind changed. Its height never changes, so the shape stays. */
  const repaint = (tile: number) => {
    const ground = groundAt(tile);
    for (const { palette, tiles } of seasons) {
      GROUND_COLOR[map.kinds[tile] as TileKind](palette, ground, scratch).toArray(tiles, tile * 3);
    }
    const across = cellsBeside(tile % size);
    const down = cellsBeside(Math.floor(tile / size));
    for (let y = down.from; y <= down.to; y++) {
      for (let x = across.from; x <= across.to; x++) {
        cellFacets(x, y).forEach(([a, b, c], facet) => colorFacet(((y * cells + x) * 2 + facet) * 9, a, b, c));
      }
    }
    for (const name of SEASON_COLORS) geometry.getAttribute(name).needsUpdate = true;
  };

  return { terrain, repaint };
}
