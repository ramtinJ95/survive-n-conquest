import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TileKind, heightAt, type TileMap } from '../sim/map';
import { hashUnit } from '../sim/noise';
import { PALETTE } from './palette';

const TREES_PER_FOREST_TILE = 0.17;
const BOULDERS_PER_ROCK_TILE = 0.1;
/** A tree is this many times the size of its shape, at most and at least. */
const GROWTH = { min: 0.85, max: 1.6 };
const PINE_TOP = 5.3;
/** No tree stands taller than this, in meters. */
export const TALLEST_TREE = PINE_TOP * GROWTH.max;
/** Pines take over from broadleaf trees between these heights, in meters. */
const PINE_LINE = { from: 2, to: 13 };

/** Strips a primitive down to painted, unshared triangles so that it shades flat and merges. */
function painted(geometry: BufferGeometry, color: Color): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('normal');
  flat.deleteAttribute('uv');
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  return flat;
}

function pineGeometry(): BufferGeometry {
  return mergeGeometries([
    painted(new CylinderGeometry(0.16, 0.22, 1.2, 5).translate(0, 0.6, 0), PALETTE.trunk),
    painted(new ConeGeometry(1.35, 2.3, 6).translate(0, 2.0, 0), PALETTE.pineLow),
    painted(
      new ConeGeometry(1.0, 2.0, 6).rotateY(0.5).translate(0, 3.3, 0),
      PALETTE.pineLow.clone().lerp(PALETTE.pineHigh, 0.5),
    ),
    painted(new ConeGeometry(0.62, 1.6, 6).translate(0, PINE_TOP - 0.8, 0), PALETTE.pineHigh),
  ]);
}

function broadleafGeometry(): BufferGeometry {
  return mergeGeometries([
    painted(new CylinderGeometry(0.17, 0.24, 1.8, 5).translate(0, 0.9, 0), PALETTE.trunk),
    painted(new IcosahedronGeometry(1.5, 0).scale(1, 0.85, 1).translate(0, 2.7, 0), PALETTE.leafLow),
    painted(new IcosahedronGeometry(0.95, 0).rotateY(1).translate(0.7, 3.6, 0.3), PALETTE.leafHigh),
  ]);
}

function boulderGeometry(): BufferGeometry {
  return painted(new DodecahedronGeometry(1, 0), PALETTE.boulder);
}

interface Placement {
  x: number;
  y: number;
  z: number;
  turn: number;
  width: number;
  height: number;
  shade: number;
}

function instanced(name: string, geometry: BufferGeometry, placements: Placement[]): InstancedMesh {
  const mesh = new InstancedMesh(
    geometry,
    new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    placements.length,
  );
  mesh.name = name;
  const pose = new Object3D();
  const tint = new Color();
  placements.forEach((placement, i) => {
    pose.position.set(placement.x, placement.y, placement.z);
    pose.rotation.set(0, placement.turn, 0);
    pose.scale.set(placement.width, placement.height, placement.width);
    pose.updateMatrix();
    mesh.setMatrixAt(i, pose.matrix);
    mesh.setColorAt(i, tint.setScalar(placement.shade));
  });
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Trees on forest tiles and boulders on rock tiles, one instanced mesh for each
 * shape. The seed decides where each one stands, so a map always looks the same.
 */
export function createScenery(map: TileMap): InstancedMesh[] {
  const { size, kinds, seed } = map;
  const half = size / 2;
  const pines: Placement[] = [];
  const broadleaves: Placement[] = [];
  const boulders: Placement[] = [];
  const roll = (salt: number, x: number, y: number) => hashUnit(seed ^ salt, x, y);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const kind = kinds[y * size + x];
      if (kind !== TileKind.Forest && kind !== TileKind.Rock) continue;
      const px = x + 0.1 + 0.8 * roll(1, x, y);
      const py = y + 0.1 + 0.8 * roll(2, x, y);
      const ground = heightAt(map, px, py);
      const turn = roll(3, x, y) * Math.PI * 2;
      const shade = 0.82 + 0.3 * roll(4, x, y);
      if (kind === TileKind.Forest) {
        if (roll(5, x, y) >= TREES_PER_FOREST_TILE) continue;
        const grown = GROWTH.min + (GROWTH.max - GROWTH.min) * roll(6, x, y);
        const pineShare = (ground - PINE_LINE.from) / (PINE_LINE.to - PINE_LINE.from);
        (roll(7, x, y) < pineShare ? pines : broadleaves).push({
          x: px - half,
          y: ground - 0.1,
          z: py - half,
          turn,
          width: grown * (0.85 + 0.3 * roll(8, x, y)),
          height: grown,
          shade,
        });
      } else {
        if (roll(5, x, y) >= BOULDERS_PER_ROCK_TILE) continue;
        const girth = 0.6 + 1.1 * roll(6, x, y);
        boulders.push({
          x: px - half,
          y: ground + 0.1 * girth,
          z: py - half,
          turn,
          width: girth,
          height: girth * (0.55 + 0.4 * roll(8, x, y)),
          shade,
        });
      }
    }
  }

  return [
    instanced('pines', pineGeometry(), pines),
    instanced('broadleaves', broadleafGeometry(), broadleaves),
    instanced('boulders', boulderGeometry(), boulders),
  ];
}
