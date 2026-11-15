import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  type IUniform,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  type Vector3,
  type Vector4,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TileKind, heightAt, type TileMap } from '../sim/map';
import { hashUnit } from '../sim/noise';
import { PALETTES, type Surface } from './palette';
import { SEASON_COLORS, seasonalMaterial } from './seasonal';

const BOULDERS_PER_ROCK_TILE = 0.1;
/** A tree is this many times the size of its shape, at most and at least. */
const GROWTH = { min: 0.85, max: 1.6 };
const PINE_TOP = 5.3;
/** The top of the upper crown of a broadleaf tree, in meters at a growth of 1. */
const BROADLEAF_TOP = 4.55;
/** No tree stands taller than this, in meters. */
export const TALLEST_TREE = PINE_TOP * GROWTH.max;
/** Pines take over from broadleaf trees between these heights, in meters. */
const PINE_LINE = { from: 2, to: 13 };

/**
 * Strips a primitive down to unshared triangles so that it shades flat and
 * merges, and paints it as `surface` in each season.
 */
function painted(geometry: BufferGeometry, surface: Surface): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('normal');
  flat.deleteAttribute('uv');
  const count = flat.getAttribute('position').count;
  PALETTES.forEach((palette, season) => {
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) palette[surface].toArray(colors, i * 3);
    flat.setAttribute(SEASON_COLORS[season]!, new BufferAttribute(colors, 3));
  });
  return flat;
}

function pineGeometry(): BufferGeometry {
  return mergeGeometries([
    painted(new CylinderGeometry(0.16, 0.22, 1.2, 5).translate(0, 0.6, 0), 'trunk'),
    painted(new ConeGeometry(1.35, 2.3, 6).translate(0, 2.0, 0), 'pineLow'),
    painted(new ConeGeometry(1.0, 2.0, 6).rotateY(0.5).translate(0, 3.3, 0), 'pineMid'),
    painted(new ConeGeometry(0.62, 1.6, 6).translate(0, PINE_TOP - 0.8, 0), 'pineHigh'),
  ]);
}

function broadleafGeometry(): BufferGeometry {
  return mergeGeometries([
    painted(new CylinderGeometry(0.17, 0.24, 1.8, 5).translate(0, 0.9, 0), 'trunk'),
    painted(new IcosahedronGeometry(1.5, 0).scale(1, 0.85, 1).translate(0, 2.7, 0), 'leafLow'),
    painted(new IcosahedronGeometry(0.95, 0).rotateY(1).translate(0.7, 3.6, 0.3), 'leafHigh'),
  ]);
}

function boulderGeometry(): BufferGeometry {
  return painted(new DodecahedronGeometry(1, 0), 'boulder');
}

interface Placement {
  tile: number;
  x: number;
  y: number;
  z: number;
  turn: number;
  width: number;
  height: number;
  shade: number;
}

/** Where a tile's tree or boulder stands, so that it can leave when the tile changes. */
interface Standing {
  readonly mesh: InstancedMesh;
  readonly instance: number;
  readonly matrix: Matrix4;
  readonly tree: boolean;
}

function instanced(
  name: string,
  geometry: BufferGeometry,
  placements: Placement[],
  seasonMix: IUniform<Vector4>,
  standing: Map<number, Standing>,
  tree: boolean,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, seasonalMaterial(seasonMix), placements.length);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const pose = new Object3D();
  const tint = new Color();
  placements.forEach((placement, i) => {
    pose.position.set(placement.x, placement.y, placement.z);
    pose.rotation.set(0, placement.turn, 0);
    pose.scale.set(placement.width, placement.height, placement.width);
    pose.updateMatrix();
    mesh.setMatrixAt(i, pose.matrix);
    standing.set(placement.tile, { mesh, instance: i, matrix: pose.matrix.clone(), tree });
    mesh.setColorAt(i, tint.setScalar(placement.shade));
  });
  mesh.computeBoundingSphere();
  return mesh;
}

const roll = (map: TileMap, salt: number, x: number, y: number) => hashUnit(map.seed ^ salt, x, y);

/** Where the tree on a tile stands, at what size, and whether it is a pine, or null when the tile holds no tree. */
function treeOn(map: TileMap, tile: number): (Placement & { pine: boolean }) | null {
  if (map.trees[tile] === 0) return null;
  const { size } = map;
  const x = tile % size;
  const y = Math.floor(tile / size);
  const px = x + 0.1 + 0.8 * roll(map, 1, x, y);
  const py = y + 0.1 + 0.8 * roll(map, 2, x, y);
  const ground = heightAt(map, px, py);
  const grown = GROWTH.min + (GROWTH.max - GROWTH.min) * roll(map, 6, x, y);
  const pineShare = (ground - PINE_LINE.from) / (PINE_LINE.to - PINE_LINE.from);
  return {
    tile,
    x: px - size / 2,
    y: ground - 0.1,
    z: py - size / 2,
    turn: roll(map, 3, x, y) * Math.PI * 2,
    width: grown * (0.85 + 0.3 * roll(map, 8, x, y)),
    height: grown,
    shade: 0.82 + 0.3 * roll(map, 4, x, y),
    pine: roll(map, 7, x, y) < pineShare,
  };
}

/** Writes the world position of the top of the tree on a tile into `out`, or returns null when the tile holds no tree. */
export function treeTop(map: TileMap, tile: number, out: Vector3): Vector3 | null {
  const tree = treeOn(map, tile);
  return tree && out.set(tree.x, tree.y + tree.height * (tree.pine ? PINE_TOP : BROADLEAF_TOP), tree.z);
}

/**
 * Trees on forest tiles and boulders on rock tiles, one instanced mesh for each
 * shape. The seed decides where each one stands, so a map always looks the same.
 * `seasonMix` blends the colors that each shape has in each season. `refresh`
 * hides a tile's tree once the map holds no tree there, and its boulder once the
 * tile is no longer rock.
 */
export function createScenery(map: TileMap, seasonMix: IUniform<Vector4>) {
  const { size, kinds, trees } = map;
  const half = size / 2;
  const pines: Placement[] = [];
  const broadleaves: Placement[] = [];
  const boulders: Placement[] = [];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = y * size + x;
      const kind = kinds[tile];
      if (kind === TileKind.Forest) {
        const tree = treeOn(map, tile);
        if (tree) (tree.pine ? pines : broadleaves).push(tree);
      } else if (kind === TileKind.Rock && roll(map, 5, x, y) < BOULDERS_PER_ROCK_TILE) {
        const px = x + 0.1 + 0.8 * roll(map, 1, x, y);
        const py = y + 0.1 + 0.8 * roll(map, 2, x, y);
        const girth = 0.6 + 1.1 * roll(map, 6, x, y);
        boulders.push({
          tile,
          x: px - half,
          y: heightAt(map, px, py) + 0.1 * girth,
          z: py - half,
          turn: roll(map, 3, x, y) * Math.PI * 2,
          width: girth,
          height: girth * (0.55 + 0.4 * roll(map, 8, x, y)),
          shade: 0.82 + 0.3 * roll(map, 4, x, y),
        });
      }
    }
  }

  const standing = new Map<number, Standing>();
  const meshes = [
    instanced('pines', pineGeometry(), pines, seasonMix, standing, true),
    instanced('broadleaves', broadleafGeometry(), broadleaves, seasonMix, standing, true),
    instanced('boulders', boulderGeometry(), boulders, seasonMix, standing, false),
  ];
  const hidden = new Matrix4().makeScale(0, 0, 0);

  const refresh = (tile: number) => {
    const found = standing.get(tile);
    if (!found) return;
    const { mesh, instance, matrix, tree } = found;
    const stands = tree ? trees[tile] === 1 : kinds[tile] === TileKind.Rock;
    mesh.setMatrixAt(instance, stands ? matrix : hidden);
    mesh.instanceMatrix.needsUpdate = true;
  };

  return { meshes, refresh };
}
