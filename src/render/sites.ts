import {
  BoxGeometry,
  type BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  MeshDepthMaterial,
  Object3D,
  RGBADepthPacking,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS, Building } from '../sim/buildings';
import type { TileMap } from '../sim/map';
import { MAX_SITES, type Orders, SiteState } from '../sim/orders';
import { type Shapes, colored, shapeMaterial } from './shapes';

/** A house stands on a footing of grey stone that reaches this far below its floor, past the lowest of its nine tiles. */
const FOOTING = { color: 0x8d8a82, depth: 1.8, inset: 0.05 };

/**
 * A site under work stands in a scaffold of poles and rails, so a house that is half up reads as building work and
 * not as a low house. The poles are the light timber of the house model, this thick, and reach this share of its height.
 */
const SCAFFOLD = { color: 0x855637, thickness: 0.09, height: 0.85, rails: [0.45, 0.95], out: 0.1 };

function scaffoldGeometry(minX: number, maxX: number, minZ: number, maxZ: number, top: number): BufferGeometry {
  const { color, thickness, rails, out } = SCAFFOLD;
  const height = top * SCAFFOLD.height;
  const [left, right] = [minX - out, maxX + out];
  const middle = (minZ + maxZ) / 2;
  const poles = [left, right].flatMap((x) => [minZ, middle, maxZ].map((z) => new BoxGeometry(thickness, height, thickness).translate(x, height / 2, z)));
  const rings = rails.flatMap((share) => [
    ...[left, right].map((x) => new BoxGeometry(thickness, thickness, maxZ - minZ).translate(x, height * share, middle)),
    ...[minZ, maxZ].map((z) => new BoxGeometry(right - left, thickness, thickness).translate((left + right) / 2, height * share, z)),
  ]);
  return mergeGeometries([...poles, ...rings].map((part) => colored(part, color)));
}

/**
 * The walls go up first and the roof closes last: the walls are this share of the house's height and take this share
 * of the building work. A house cut through its roof shows the flat underside of the thatch and reads as a low hut.
 */
const WALLS = { height: 0.49, work: 0.8 };

function heightShareAt(workShare: number): number {
  return workShare <= WALLS.work
    ? (workShare / WALLS.work) * WALLS.height
    : WALLS.height + ((workShare - WALLS.work) / (1 - WALLS.work)) * (1 - WALLS.height);
}

const DECLARED = 'attribute float rise;\nvarying float vOverRise;';
const MEASURED = 'vOverRise = position.y - rise;';
const CUT = 'if (vOverRise > 0.0) discard;';

function cutAboveRise<M extends Material>(material: M): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECLARED}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${MEASURED}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vOverRise;')
      .replace('#include <clipping_planes_fragment>', `${CUT}\n#include <clipping_planes_fragment>`);
    if (!shader.vertexShader.includes(MEASURED) || !shader.fragmentShader.includes(CUT)) {
      throw new Error('three.js changed the shader that the rising house cuts');
    }
  };
  return material;
}

function instanced(name: string, geometry: BufferGeometry, material: Material): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, MAX_SITES);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Draws every house, finished or not, as one instanced mesh, and the scaffolds
 * of the sites under work as another. A house on a site rises from its footing
 * inside its scaffold with the share of the building work done, so the
 * progress reads without the label. A finished house stands whole and without
 * a scaffold. The floor lies on the highest of the nine tiles, and the footing
 * fills the fall of the ground under it.
 */
export function createSites(map: TileMap, shapes: Shapes) {
  const half = map.size / 2;
  shapes.house.computeBoundingBox();
  const { min, max } = shapes.house.boundingBox!;
  const footing = new BoxGeometry(max.x - min.x - 2 * FOOTING.inset, FOOTING.depth, max.z - min.z - 2 * FOOTING.inset);
  const geometry = mergeGeometries([
    shapes.house,
    colored(footing.translate((min.x + max.x) / 2, -FOOTING.depth / 2, (min.z + max.z) / 2), FOOTING.color),
  ]);
  const aboveTheRoof = max.y + 1;
  const rise = new InstancedBufferAttribute(new Float32Array(MAX_SITES), 1);
  geometry.setAttribute('rise', rise);
  const material = cutAboveRise(shapeMaterial());
  material.side = DoubleSide;
  const houses = instanced('houses', geometry, material);
  houses.customDepthMaterial = cutAboveRise(new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide }));
  const scaffolds = instanced('scaffolds', scaffoldGeometry(min.x, max.x, min.z, max.z, max.y), shapeMaterial());
  const pose = new Object3D();

  /** Redraws every site and house from the orders. */
  const show = (orders: Orders) => {
    const { sites } = orders;
    let count = 0;
    let underWork = 0;
    for (let slot = 0; slot < MAX_SITES; slot++) {
      const state = sites.state[slot]!;
      const work = sites.work[slot]!;
      if (state === SiteState.Free || (state === SiteState.Site && work === 0)) continue;
      const cx = sites.x[slot]!;
      const cy = sites.y[slot]!;
      let highest = -Infinity;
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) highest = Math.max(highest, map.heights[y * map.size + x]!);
      }
      pose.position.set(cx + 0.5 - half, highest, cy + 0.5 - half);
      pose.updateMatrix();
      houses.setMatrixAt(count, pose.matrix);
      rise.setX(count, state === SiteState.Built ? aboveTheRoof : heightShareAt(Math.min(work, BUILDINGS[Building.House].workTicks) / BUILDINGS[Building.House].workTicks) * max.y);
      count++;
      if (state === SiteState.Site) scaffolds.setMatrixAt(underWork++, pose.matrix);
    }
    houses.count = count;
    houses.instanceMatrix.needsUpdate = true;
    rise.needsUpdate = true;
    scaffolds.count = underWork;
    scaffolds.instanceMatrix.needsUpdate = true;
  };

  return { houses, scaffolds, show };
}
