import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashUnit } from '../sim/noise';
import { PALETTES, type Surface } from './palette';
import { SEASON_COLORS } from './seasonal';

/** One surface for a whole shape, or the surface of each facet from how far it faces up, from -1 to 1. */
type Paint = Surface | ((up: number) => Surface);

/**
 * Strips a shape down to unshared triangles so that it shades flat and
 * merges, and paints each facet in the colors its surface has in each season.
 */
export function painted(geometry: BufferGeometry, paint: Paint): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('normal');
  flat.deleteAttribute('uv');
  const at = flat.getAttribute('position');
  const seasons = PALETTES.map(() => new Float32Array(at.count * 3));
  for (let corner = 0; corner < at.count; corner += 3) {
    let surface = paint as Surface;
    if (typeof paint === 'function') {
      const ux = at.getX(corner + 1) - at.getX(corner);
      const uy = at.getY(corner + 1) - at.getY(corner);
      const uz = at.getZ(corner + 1) - at.getZ(corner);
      const vx = at.getX(corner + 2) - at.getX(corner);
      const vy = at.getY(corner + 2) - at.getY(corner);
      const vz = at.getZ(corner + 2) - at.getZ(corner);
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      surface = paint(ny / (Math.hypot(nx, ny, nz) || 1));
    }
    PALETTES.forEach((palette, season) => {
      for (let i = 0; i < 3; i++) palette[surface].toArray(seasons[season]!, (corner + i) * 3);
    });
  }
  seasons.forEach((colors, season) => flat.setAttribute(SEASON_COLORS[season]!, new BufferAttribute(colors, 3)));
  return flat;
}

/**
 * Moves every corner of a shape around the origin out or in by up to `share`
 * of its distance. Corners at one place move together, so the shape stays closed.
 */
function roughened<G extends BufferGeometry>(geometry: G, share: number, salt: number): G {
  const at = geometry.getAttribute('position');
  for (let i = 0; i < at.count; i++) {
    const x = at.getX(i);
    const y = at.getY(i);
    const z = at.getZ(i);
    const roll = hashUnit(salt, Math.round(x * 1000) + Math.round(z * 1000) * 7919, Math.round(y * 1000));
    const grown = 1 + share * (2 * roll - 1);
    at.setXYZ(i, x * grown, y * grown, z * grown);
  }
  return geometry;
}

/** A crown is dark where it faces the ground, and lightest where it faces the sky. */
const crown = (low: Surface, mid: Surface, high: Surface) => (up: number) => (up > 0.4 ? high : up > -0.25 ? mid : low);

/** A rough ball of leaves `radius` wide, `squash` times as tall, around a point. */
function blob(radius: number, squash: number, x: number, y: number, z: number, salt: number): BufferGeometry {
  return roughened(new IcosahedronGeometry(radius, 0), 0.16, salt)
    .rotateY(salt * 1.7)
    .scale(1, squash, 1)
    .translate(x, y, z);
}

function trunk(top: number, bottom: number, height: number, surface: Surface): BufferGeometry {
  return painted(new CylinderGeometry(top, bottom, height, 5, 1, true).translate(0, height / 2, 0), surface);
}

const TIER_SIDES = 8;

/** One skirt of a pine: a cone whose rim rises and falls, so the branches end in points. */
function tier(radius: number, height: number, base: number, turn: number): BufferGeometry {
  const cone = new ConeGeometry(radius, height, TIER_SIDES, 1, true);
  const at = cone.getAttribute('position');
  for (let i = 0; i <= TIER_SIDES; i++) {
    const rim = TIER_SIDES + 1 + i;
    const tucked = i % 2 === 1;
    const reach = tucked ? 0.7 : 1.06;
    at.setXYZ(rim, at.getX(rim) * reach, at.getY(rim) + (tucked ? 0.16 : -0.05) * height, at.getZ(rim) * reach);
  }
  return cone.rotateY(turn).translate(0, base + height / 2, 0);
}

/** A kind of tree at a growth of 1: its shape, and the height of its top in meters. */
export interface TreeShape {
  readonly geometry: BufferGeometry;
  readonly top: number;
}

export const TREE_KINDS = ['pine', 'oak', 'blossom', 'birch'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];

export const TREE_TOPS: Readonly<Record<TreeKind, number>> = { pine: 5.3, oak: 5.0, blossom: 4.3, birch: 4.9 };

/** The shape of each kind of tree, standing on the origin. */
export function treeShapes(): Readonly<Record<TreeKind, BufferGeometry>> {
  return {
    pine: mergeGeometries([
      trunk(0.14, 0.21, 1.3, 'trunk'),
      painted(tier(1.45, 1.7, 0.9, 0), 'pineLow'),
      painted(tier(1.15, 1.6, 1.9, 0.4), 'pineMid'),
      painted(tier(0.85, 1.5, 2.9, 0.8), 'pineMid'),
      painted(tier(0.55, 1.4, TREE_TOPS.pine - 1.4, 1.2), 'pineHigh'),
    ]),
    oak: mergeGeometries([
      trunk(0.2, 0.3, 1.9, 'trunk'),
      painted(
        mergeGeometries([
          blob(1.7, 0.8, 0, 3.0, 0, 11),
          blob(1.15, 0.85, 0.95, 3.5, 0.4, 12),
          blob(1.1, 0.85, -0.8, 3.4, -0.6, 13),
          blob(0.9, 0.85, 0.1, 4.2, 0, 14),
        ]),
        crown('oakLow', 'oakMid', 'oakHigh'),
      ),
    ]),
    blossom: mergeGeometries([
      trunk(0.13, 0.2, 1.7, 'trunk'),
      painted(
        mergeGeometries([
          blob(1.25, 0.85, 0, 2.55, 0, 21),
          blob(0.85, 0.9, 0.7, 3.15, 0.25, 22),
          blob(0.75, 0.9, -0.55, 3.0, -0.45, 23),
          blob(0.6, 0.9, 0.05, 3.7, -0.1, 24),
        ]),
        crown('blossomLow', 'blossomMid', 'blossomHigh'),
      ),
    ]),
    birch: mergeGeometries([
      trunk(0.09, 0.13, 2.6, 'birchTrunk'),
      painted(
        mergeGeometries([blob(0.7, 1.35, 0, 3.2, 0, 31), blob(0.55, 1.2, 0.25, 4.15, 0.1, 32), blob(0.5, 1.1, -0.3, 2.6, 0.2, 33)]),
        crown('birchLow', 'birchLow', 'birchHigh'),
      ),
    ]),
  };
}

export function boulderShape(): BufferGeometry {
  return painted(roughened(new DodecahedronGeometry(1, 0), 0.2, 41), 'boulder');
}

/** A thin triangle that stands on the ground at (x, z), leans `lean` meters, and faces `turn`. */
function blade(width: number, height: number, lean: number, turn: number, x = 0, z = 0): BufferGeometry {
  const half = width / 2;
  return new BufferGeometry()
    .setAttribute('position', new BufferAttribute(new Float32Array([-half, 0, 0, half, 0, 0, lean, height, 0]), 3))
    .rotateY(turn)
    .translate(x, 0, z);
}

export const COVER_KINDS = ['tuft', 'flowers', 'bush', 'pebbles', 'reeds'] as const;
export type CoverKind = (typeof COVER_KINDS)[number];

/** The small things that grow and lie on open ground, each standing on the origin. */
export function coverShapes(): Readonly<Record<CoverKind, BufferGeometry>> {
  const flower = (x: number, z: number, height: number, turn: number) => [
    painted(blade(0.035, height, 0, turn, x, z), 'stem'),
    painted(new OctahedronGeometry(0.095, 0).scale(1, 0.55, 1).translate(x, height, z), 'petal'),
  ];
  return {
    tuft: painted(
      mergeGeometries([
        blade(0.14, 0.44, 0.14, 0),
        blade(0.12, 0.36, 0.12, 1.1, 0.06, 0.02),
        blade(0.14, 0.4, 0.16, 2.2, -0.04, 0.06),
        blade(0.12, 0.32, 0.1, 3.3, 0.03, -0.06),
        blade(0.13, 0.38, 0.15, 4.4, -0.07, -0.02),
        blade(0.11, 0.28, 0.1, 5.5, 0.08, -0.03),
      ]),
      'blade',
    ),
    flowers: mergeGeometries([
      ...flower(0, 0, 0.3, 0.2),
      ...flower(0.24, 0.12, 0.24, 1.4),
      ...flower(-0.16, 0.22, 0.27, 2.9),
      ...flower(-0.1, -0.22, 0.22, 4.4),
      ...flower(0.2, -0.18, 0.26, 5.3),
    ]),
    bush: painted(
      mergeGeometries([blob(0.5, 0.75, 0, 0.32, 0, 51), blob(0.38, 0.8, 0.4, 0.3, 0.15, 52), blob(0.33, 0.8, -0.3, 0.27, -0.25, 53)]),
      crown('oakLow', 'oakMid', 'oakHigh'),
    ),
    pebbles: painted(
      mergeGeometries([
        roughened(new IcosahedronGeometry(0.2, 0), 0.2, 61).scale(1, 0.6, 1).translate(0, 0.07, 0),
        roughened(new IcosahedronGeometry(0.12, 0), 0.2, 62).scale(1, 0.65, 1).translate(0.28, 0.04, 0.12),
      ]),
      'boulder',
    ),
    reeds: painted(
      mergeGeometries([
        blade(0.07, 1.0, 0.1, 0.3),
        blade(0.06, 0.8, 0.14, 1.5, 0.12, 0.05),
        blade(0.07, 0.92, 0.08, 2.4, -0.1, 0.1),
        blade(0.06, 0.7, 0.16, 3.6, 0.05, -0.12),
        blade(0.07, 1.05, 0.06, 4.9, -0.12, -0.08),
        blade(0.06, 0.85, 0.12, 5.6, 0.2, -0.04),
      ]),
      'reed',
    ),
  };
}
