import { BufferAttribute, BufferGeometry, Color, type IUniform, Mesh, type Vector4 } from 'three';
import { TileKind, WATER_LEVEL, type TileMap } from '../sim/map';
import { fractalNoise, hashUnit } from '../sim/noise';
import { PALETTES, type Palette } from './palette';
import { SEASON_COLORS, seasonalMaterial } from './seasonal';

/** How far the cut edge of the map reaches below the water level, in meters. */
const SLAB_DEPTH = 7;
const FACET_SHIMMER = 0.1;
/** Meadow patches are about this many meters across. */
const MEADOW_SPAN = 26;

function ramp(from: number, to: number, value: number): number {
  return Math.min(Math.max((value - from) / (to - from), 0), 1);
}

/** The ground color of a tile from its height and from `meadow`, a slow noise in about [-1, 1]. */
const GROUND_COLOR: Record<TileKind, (palette: Palette, height: number, meadow: number, out: Color) => Color> = {
  [TileKind.Grass]: (palette, height, meadow, out) =>
    out
      .lerpColors(palette.grassLow, palette.grassHigh, ramp(2, 16, height))
      .lerp(palette.meadow, 0.6 * ramp(-0.2, 0.4, meadow))
      .lerp(palette.sand, 1 - ramp(0.15, 0.9, height)),
  [TileKind.Forest]: (palette, height, meadow, out) =>
    out
      .lerpColors(palette.forestFloor, palette.grassHigh, 0.35 * ramp(4, 18, height))
      .lerp(palette.meadow, 0.2 * ramp(-0.2, 0.4, meadow)),
  [TileKind.Rock]: (palette, height, _meadow, out) =>
    out.lerpColors(palette.rockLow, palette.rockHigh, ramp(3, 20, height)),
  [TileKind.Water]: (palette, height, _meadow, out) =>
    out.lerpColors(palette.sand, palette.lakeBed, ramp(0, 2.2, WATER_LEVEL - height)),
};

function meadows(map: TileMap): Float32Array {
  const noise = new Float32Array(map.size * map.size);
  for (let i = 0; i < noise.length; i++) {
    const x = (i % map.size) / MEADOW_SPAN;
    const y = Math.floor(i / map.size) / MEADOW_SPAN;
    noise[i] = fractalNoise(map.seed, x, y, 2);
  }
  return noise;
}

function tileColors(map: TileMap, palette: Palette, meadow: Float32Array): Float32Array {
  const colors = new Float32Array(map.size * map.size * 3);
  const color = new Color();
  for (let i = 0; i < map.size * map.size; i++) {
    GROUND_COLOR[map.kinds[i] as TileKind](palette, map.heights[i]!, meadow[i]!, color).toArray(colors, i * 3);
  }
  return colors;
}

/**
 * The ground as flat-shaded triangles, and the cut edge of the map as walls. A
 * vertex sits at each tile center. One more ring of vertices sits on the map
 * edge and repeats the border tiles, so the ground covers every tile in full
 * and matches `heightAt`. The map center sits at the world origin. Every
 * vertex carries its color in each season, and `seasonMix` blends them.
 */
export function createTerrain(map: TileMap, seasonMix: IUniform<Vector4>): Mesh {
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
  const meadow = meadows(map);
  const seasons = PALETTES.map((palette) => ({
    palette,
    tiles: tileColors(map, palette, meadow),
    colors: new Uint8ClampedArray(vertexCount * 3),
  }));
  let cursor = 0;

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

  const facet = (a: number, b: number, c: number) => {
    const shimmer = (1 + FACET_SHIMMER * (hashUnit(map.seed, a, b ^ c) - 0.5)) / 3;
    const ta = tileAt(a) * 3;
    const tb = tileAt(b) * 3;
    const tc = tileAt(c) * 3;
    for (const { tiles, colors } of seasons) {
      const r = (tiles[ta]! + tiles[tb]! + tiles[tc]!) * shimmer;
      const g = (tiles[ta + 1]! + tiles[tb + 1]! + tiles[tc + 1]!) * shimmer;
      const bl = (tiles[ta + 2]! + tiles[tb + 2]! + tiles[tc + 2]!) * shimmer;
      for (let corner = 0; corner < 9; corner += 3) paint(colors, cursor + corner, r, g, bl);
    }
    for (const corner of [a, b, c]) {
      vertex(along(corner % rows), heights[tileAt(corner)]!, along(Math.floor(corner / rows)));
    }
  };

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const nw = y * rows + x;
      const ne = nw + 1;
      const sw = nw + rows;
      const se = sw + 1;
      if ((x + y) % 2 === 0) {
        facet(nw, sw, se);
        facet(nw, se, ne);
      } else {
        facet(nw, sw, ne);
        facet(ne, sw, se);
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
  return terrain;
}
