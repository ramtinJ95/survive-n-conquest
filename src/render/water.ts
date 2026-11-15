import { BufferAttribute, BufferGeometry, type Color, type IUniform, Mesh, type Vector4 } from 'three';
import { WATER_LEVEL, type TileMap } from '../sim/map';
import { PALETTES } from './palette';
import { type Motion, SEASON_COLORS, daily, seasonalMaterial } from './seasonal';

/** The water inside the map is a grid of cells this many meters wide, so that each can tilt with the waves. */
const CELL = 2;
/** The sea lies flat past the map's edge, this many meters out. It pales to the shallows over the first `shelf` meters. */
const SEA = { reach: 1400, shelf: 16, depth: 7 };
/** Water this deep, in meters, has its full color. Less of it shows the pale shallows. */
const DEEP = 1.7;
const OPACITY = 0.8;

/**
 * Two trains of waves cross the water, each a sine of the place and of the
 * time of day in ticks. A paused clock holds the water still.
 */
function waves(clock: IUniform<number>): Motion {
  return {
    uniforms: { waveClock: clock },
    declares: 'uniform float waveClock;\nattribute float swell;',
    moves: `transformed.y += swell * (0.085 * sin(position.x * 0.55 + position.z * 0.31 + waveClock * ${daily(0.16).toFixed(8)}) + 0.06 * sin(position.z * 0.83 - position.x * 0.37 + waveClock * ${daily(0.23).toFixed(8)}));`,
  };
}

/**
 * The lakes and rivers of the map and the sea around it, as one mesh, and the
 * bed of the sea as another. Water pales where it is shallow. The waves move
 * with `clock`. The bed lies around the map and not under it, where the ground
 * hides it, so nothing lies under the ground: a camera that got under the
 * ground would see the sky through it, and the `camera` scenario reads that.
 */
export function createWater(map: TileMap, seasonMix: IUniform<Vector4>, clock: IUniform<number>) {
  const { size, heights } = map;
  const half = size / 2;
  const lines = size / CELL + 1;
  const positions: number[] = [];
  const swells: number[] = [];
  const colors: number[][] = PALETTES.map(() => []);
  const indices: number[] = [];
  const scratch = PALETTES.map((palette) => palette.water.clone());

  /** The depth of the water at a corner of the tile grid: the deepest of the tiles that meet there. */
  const depthAt = (x: number, y: number) => {
    let deepest = -Infinity;
    for (let ty = Math.max(y - 1, 0); ty <= Math.min(y, size - 1); ty++) {
      for (let tx = Math.max(x - 1, 0); tx <= Math.min(x, size - 1); tx++) deepest = Math.max(deepest, WATER_LEVEL - heights[ty * size + tx]!);
    }
    return deepest;
  };

  const vertex = (x: number, z: number, depth: number, swell: number): number => {
    positions.push(x, WATER_LEVEL, z);
    swells.push(swell);
    const shallow = 1 - Math.min(Math.max(depth / DEEP, 0), 1);
    PALETTES.forEach((palette, season) => {
      const color: Color = scratch[season]!.lerpColors(palette.water, palette.shallows, shallow);
      colors[season]!.push(color.r, color.g, color.b);
    });
    return positions.length / 3 - 1;
  };
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);

  const depths = new Float32Array(lines * lines);
  for (let j = 0; j < lines; j++) {
    for (let i = 0; i < lines; i++) depths[j * lines + i] = depthAt(i * CELL, j * CELL);
  }
  const corners = new Int32Array(lines * lines).fill(-1);
  const corner = (i: number, j: number) => {
    const at = j * lines + i;
    if (corners[at]! < 0) corners[at] = vertex(i * CELL - half, j * CELL - half, depths[at]!, 1);
    return corners[at]!;
  };
  for (let j = 0; j < lines - 1; j++) {
    for (let i = 0; i < lines - 1; i++) {
      const wet = Math.max(depths[j * lines + i]!, depths[j * lines + i + 1]!, depths[(j + 1) * lines + i]!, depths[(j + 1) * lines + i + 1]!) > 0;
      if (wet) quad(corner(i, j), corner(i, j + 1), corner(i + 1, j + 1), corner(i + 1, j));
    }
  }

  /** The grid lines around the map's edge, in a loop, and how far along x and z the sea runs out from each. */
  const edge: { i: number; j: number; outX: number; outZ: number }[] = [];
  const last = lines - 1;
  for (let i = 0; i < last; i++) edge.push({ i, j: 0, outX: i === 0 ? -1 : 0, outZ: -1 });
  for (let j = 0; j < last; j++) edge.push({ i: last, j, outX: 1, outZ: j === 0 ? -1 : 0 });
  for (let i = last; i > 0; i--) edge.push({ i, j: last, outX: i === last ? 1 : 0, outZ: 1 });
  for (let j = last; j > 0; j--) edge.push({ i: 0, j, outX: -1, outZ: j === last ? 1 : 0 });
  const shelf = edge.map(({ i, j, outX, outZ }) => ({
    inner: vertex(i * CELL - half, j * CELL - half, Math.max(depths[j * lines + i]!, 0), 1),
    outer: vertex(i * CELL - half + outX * SEA.shelf, j * CELL - half + outZ * SEA.shelf, DEEP, 0),
    far: outX !== 0 && outZ !== 0 ? vertex(outX * (half + SEA.reach), outZ * (half + SEA.reach), DEEP, 0) : -1,
  }));
  let farCorner = shelf[0]!.far;
  shelf.forEach((here, at) => {
    const next = shelf[(at + 1) % shelf.length]!;
    quad(here.inner, next.inner, next.outer, here.outer);
    if (next.far >= 0) {
      indices.push(here.outer, next.outer, next.far, here.outer, next.far, farCorner);
      farCorner = next.far;
    } else {
      indices.push(here.outer, next.outer, farCorner);
    }
  });

  const surface = new BufferGeometry();
  surface.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  surface.setAttribute('swell', new BufferAttribute(Float32Array.from(swells), 1));
  colors.forEach((season, index) => surface.setAttribute(SEASON_COLORS[index]!, new BufferAttribute(Float32Array.from(season), 3)));
  surface.setIndex(indices);
  surface.computeBoundingSphere();
  surface.computeBoundingBox();
  const water = new Mesh(surface, seasonalMaterial(seasonMix, { transparent: true, opacity: OPACITY, depthWrite: false }, waves(clock)));
  water.name = 'water';
  water.receiveShadow = true;

  const floor = new BufferGeometry();
  const deep = WATER_LEVEL - SEA.depth;
  const square = (reach: number) => [-reach, deep, -reach, -reach, deep, reach, reach, deep, reach, reach, deep, -reach];
  floor.setAttribute('position', new BufferAttribute(Float32Array.from([...square(half + SEA.reach), ...square(half)]), 3));
  PALETTES.forEach(({ lakeBed }, season) =>
    floor.setAttribute(SEASON_COLORS[season]!, new BufferAttribute(Float32Array.from(Array.from({ length: 8 }, () => lakeBed.toArray()).flat()), 3)),
  );
  floor.setIndex([0, 1, 2, 3].flatMap((at) => [at, (at + 1) % 4, 4 + ((at + 1) % 4), at, 4 + ((at + 1) % 4), 4 + at]));
  const bed = new Mesh(floor, seasonalMaterial(seasonMix));
  bed.name = 'sea bed';

  return { water, bed };
}
