import { BufferAttribute, BufferGeometry, Color, Mesh, MeshLambertMaterial } from 'three';
import { TileKind, WATER_LEVEL, type TileMap } from '../sim/map';
import { fractalNoise, hashUnit } from '../sim/noise';
import { PALETTE } from './palette';

/** How far the cut edge of the map reaches below the water level, in meters. */
const SLAB_DEPTH = 7;
const FACET_SHIMMER = 0.1;
/** Meadow patches are about this many meters across. */
const MEADOW_SPAN = 26;

function ramp(from: number, to: number, value: number): number {
  return Math.min(Math.max((value - from) / (to - from), 0), 1);
}

/** The ground color of a tile from its height and from `meadow`, a slow noise in about [-1, 1]. */
const GROUND_COLOR: Record<TileKind, (height: number, meadow: number, out: Color) => Color> = {
  [TileKind.Grass]: (height, meadow, out) =>
    out
      .lerpColors(PALETTE.grassLow, PALETTE.grassHigh, ramp(2, 16, height))
      .lerp(PALETTE.meadow, 0.6 * ramp(-0.2, 0.4, meadow))
      .lerp(PALETTE.sand, 1 - ramp(0.15, 0.9, height)),
  [TileKind.Forest]: (height, meadow, out) =>
    out
      .lerpColors(PALETTE.forestFloor, PALETTE.grassHigh, 0.35 * ramp(4, 18, height))
      .lerp(PALETTE.meadow, 0.2 * ramp(-0.2, 0.4, meadow)),
  [TileKind.Rock]: (height, _meadow, out) =>
    out.lerpColors(PALETTE.rockLow, PALETTE.rockHigh, ramp(3, 20, height)),
  [TileKind.Water]: (height, _meadow, out) =>
    out.lerpColors(PALETTE.sand, PALETTE.lakeBed, ramp(0, 2.2, WATER_LEVEL - height)),
};

function tileColors(map: TileMap): Float32Array {
  const colors = new Float32Array(map.size * map.size * 3);
  const color = new Color();
  for (let i = 0; i < map.size * map.size; i++) {
    const x = (i % map.size) / MEADOW_SPAN;
    const y = Math.floor(i / map.size) / MEADOW_SPAN;
    const meadow = fractalNoise(map.seed, x, y, 2);
    GROUND_COLOR[map.kinds[i] as TileKind](map.heights[i]!, meadow, color).toArray(colors, i * 3);
  }
  return colors;
}

/**
 * The ground as flat-shaded triangles, and the cut edge of the map as walls. A
 * vertex sits at each tile center. One more ring of vertices sits on the map
 * edge and repeats the border tiles, so the ground covers every tile in full
 * and matches `heightAt`. The map center sits at the world origin.
 */
export function createTerrain(map: TileMap): Mesh {
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
  const colors = new Float32Array(vertexCount * 3);
  const tiles = tileColors(map);
  let cursor = 0;

  const vertex = (x: number, y: number, z: number, r: number, g: number, b: number) => {
    positions[cursor] = x;
    positions[cursor + 1] = y;
    positions[cursor + 2] = z;
    colors[cursor] = r;
    colors[cursor + 1] = g;
    colors[cursor + 2] = b;
    cursor += 3;
  };

  const facet = (a: number, b: number, c: number) => {
    const shimmer = 1 + FACET_SHIMMER * (hashUnit(map.seed, a, b ^ c) - 0.5);
    const ta = tileAt(a) * 3;
    const tb = tileAt(b) * 3;
    const tc = tileAt(c) * 3;
    const r = ((tiles[ta]! + tiles[tb]! + tiles[tc]!) / 3) * shimmer;
    const g = ((tiles[ta + 1]! + tiles[tb + 1]! + tiles[tc + 1]!) / 3) * shimmer;
    const bl = ((tiles[ta + 2]! + tiles[tb + 2]! + tiles[tc + 2]!) / 3) * shimmer;
    for (const corner of [a, b, c]) {
      vertex(along(corner % rows), heights[tileAt(corner)]!, along(Math.floor(corner / rows)), r, g, bl);
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
  const rim = (height: number, out: Color) =>
    out.copy(height < WATER_LEVEL ? PALETTE.water : PALETTE.soil);
  const fromColor = new Color();
  const toColor = new Color();
  const deep = PALETTE.bedrock;

  /** A wall under the edge from vertex `from` to vertex `to`. It faces left of that direction. */
  const wall = (from: number, to: number) => {
    const fx = along(from % rows);
    const fz = along(Math.floor(from / rows));
    const tx = along(to % rows);
    const tz = along(Math.floor(to / rows));
    const fy = Math.max(heights[tileAt(from)]!, WATER_LEVEL);
    const ty = Math.max(heights[tileAt(to)]!, WATER_LEVEL);
    rim(heights[tileAt(from)]!, fromColor);
    rim(heights[tileAt(to)]!, toColor);
    vertex(fx, fy, fz, fromColor.r, fromColor.g, fromColor.b);
    vertex(tx, ty, tz, toColor.r, toColor.g, toColor.b);
    vertex(fx, base, fz, deep.r, deep.g, deep.b);
    vertex(tx, ty, tz, toColor.r, toColor.g, toColor.b);
    vertex(tx, base, tz, deep.r, deep.g, deep.b);
    vertex(fx, base, fz, deep.r, deep.g, deep.b);
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
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const terrain = new Mesh(
    geometry,
    new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  terrain.name = 'terrain';
  return terrain;
}
