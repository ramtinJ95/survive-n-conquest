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
import { BUILDINGS, Building, type BuildingName, kindOf, siteMidX, siteMidY, siteX0, siteY0 } from '../sim/buildings';
import type { TileMap } from '../sim/map';
import { MAX_SITES, type Orders, SiteState, type Sites } from '../sim/orders';
import { BARN_LOOK, HUT_LOOK, LODGE_LOOK, type Shapes, TAILOR_LOOK, WOODSHED_LOOK, barnShape, colored, hutShape, lodgeShape, shapeMaterial, tailorShape, woodshedShape } from './shapes';

/** A building stands on a footing of grey stone that reaches this far below its floor, past the lowest tile of its footprint. */
const FOOTING = { color: 0x8d8a82, depth: 1.8, inset: 0.05 };

/**
 * A site under work stands in a scaffold of poles and rails around its walls, so a building that is half up reads as
 * building work and not as a low building. The poles are the light timber of the house model, this thick, and reach
 * this share of its height.
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
 * The walls go up first and the roof closes last: the walls take this share of the building work. A house cut through
 * its roof shows the flat underside of the thatch and reads as a low hut.
 */
const WALLS_WORK = 0.8;

/** The share of a building's height that stands at a share of its work, for walls that are `walls` of its height. */
function heightShareAt(workShare: number, walls: number): number {
  return workShare <= WALLS_WORK
    ? (workShare / WALLS_WORK) * walls
    : walls + ((workShare - WALLS_WORK) / (1 - WALLS_WORK)) * (1 - walls);
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

/** What a kind of building is drawn as: its shape, the box its walls stand in, and the share of its height its walls take. */
interface Look {
  readonly shape: BufferGeometry;
  readonly walls: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly share: number };
}

/** The house model's walls are this share of its height. */
const HOUSE_WALLS = 0.49;

function looks(shapes: Shapes): Readonly<Record<Building, Look>> {
  shapes.house.computeBoundingBox();
  const { min, max } = shapes.house.boundingBox!;
  const hut = hutShape();
  hut.computeBoundingBox();
  const half = HUT_LOOK.side / 2;
  const hutWalls = 2 * HUT_LOOK.log * HUT_LOOK.courses;
  const barn = barnShape();
  barn.computeBoundingBox();
  const barnX = BARN_LOOK.width / 2;
  const barnZ = BARN_LOOK.depth / 2;
  const lodge = lodgeShape();
  lodge.computeBoundingBox();
  const lodgeHalf = LODGE_LOOK.side / 2;
  const woodshed = woodshedShape();
  woodshed.computeBoundingBox();
  const shedHalf = WOODSHED_LOOK.side / 2;
  const tailor = tailorShape();
  tailor.computeBoundingBox();
  const tailorHalf = TAILOR_LOOK.radius;
  return {
    [Building.House]: { shape: shapes.house, walls: { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z, share: HOUSE_WALLS } },
    [Building.Hut]: { shape: hut, walls: { minX: -half, maxX: half, minZ: -half, maxZ: half, share: hutWalls / hut.boundingBox!.max.y } },
    [Building.Barn]: { shape: barn, walls: { minX: -barnX, maxX: barnX, minZ: -barnZ, maxZ: barnZ, share: BARN_LOOK.walls / barn.boundingBox!.max.y } },
    [Building.Lodge]: {
      shape: lodge,
      walls: { minX: -lodgeHalf, maxX: lodgeHalf, minZ: -lodgeHalf, maxZ: lodgeHalf, share: LODGE_LOOK.front / lodge.boundingBox!.max.y },
    },
    [Building.Woodshed]: {
      shape: woodshed,
      walls: { minX: -shedHalf, maxX: shedHalf, minZ: -shedHalf, maxZ: shedHalf, share: WOODSHED_LOOK.back / woodshed.boundingBox!.max.y },
    },
    [Building.Tailor]: {
      shape: tailor,
      walls: { minX: -tailorHalf, maxX: tailorHalf, minZ: -tailorHalf, maxZ: tailorHalf, share: TAILOR_LOOK.walls / tailor.boundingBox!.max.y },
    },
  };
}

/** One kind's building and scaffold meshes, and the height above which a finished one is never cut. */
function meshesOf(name: BuildingName, { shape, walls }: Look) {
  shape.computeBoundingBox();
  const top = shape.boundingBox!.max.y;
  const footing = new BoxGeometry(walls.maxX - walls.minX - 2 * FOOTING.inset, FOOTING.depth, walls.maxZ - walls.minZ - 2 * FOOTING.inset);
  const geometry = mergeGeometries([
    shape,
    colored(footing.translate((walls.minX + walls.maxX) / 2, -FOOTING.depth / 2, (walls.minZ + walls.maxZ) / 2), FOOTING.color),
  ]);
  const rise = new InstancedBufferAttribute(new Float32Array(MAX_SITES), 1);
  geometry.setAttribute('rise', rise);
  const material = cutAboveRise(shapeMaterial());
  material.side = DoubleSide;
  const building = instanced(`${name}s`, geometry, material);
  building.customDepthMaterial = cutAboveRise(new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide }));
  const scaffold = instanced(`${name}-scaffolds`, scaffoldGeometry(walls.minX, walls.maxX, walls.minZ, walls.maxZ, top), shapeMaterial());
  return { building, scaffold, rise, top, walls: walls.share, count: 0, underWork: 0 };
}

/** The height a building's floor lies at: the highest tile of its footprint. */
export function floorOf(map: TileMap, sites: Sites, slot: number): number {
  const { side } = kindOf(sites, slot);
  const x0 = siteX0(sites, slot);
  const y0 = siteY0(sites, slot);
  let highest = -Infinity;
  for (let y = y0; y < y0 + side; y++) {
    for (let x = x0; x < x0 + side; x++) highest = Math.max(highest, map.heights[y * map.size + x]!);
  }
  return highest;
}

/**
 * Draws every building of each kind, finished or not, as one instanced mesh,
 * and the scaffolds of its sites under work as another. A building on a site
 * rises from its footing inside its scaffold with the share of the building
 * work done, so the progress reads without the label. A finished building
 * stands whole and without a scaffold. The floor lies on the highest tile of
 * its footprint, and the footing fills the fall of the ground under it.
 */
export function createSites(map: TileMap, shapes: Shapes) {
  const half = map.size / 2;
  const look = looks(shapes);
  const kinds = Object.values(Building).map((building) => meshesOf(BUILDINGS[building].name, look[building]));
  const pose = new Object3D();

  /** Redraws every site and building from the orders. */
  const show = (orders: Orders) => {
    const { sites } = orders;
    for (const kind of kinds) {
      kind.count = 0;
      kind.underWork = 0;
    }
    for (let slot = 0; slot < MAX_SITES; slot++) {
      const state = sites.state[slot]!;
      const work = sites.work[slot]!;
      if (state === SiteState.Free || (state === SiteState.Site && work === 0)) continue;
      const kind = kinds[sites.kind[slot]!]!;
      const { workTicks } = kindOf(sites, slot);
      pose.position.set(siteMidX(sites, slot) - half, floorOf(map, sites, slot), siteMidY(sites, slot) - half);
      pose.updateMatrix();
      kind.building.setMatrixAt(kind.count, pose.matrix);
      kind.rise.setX(kind.count, state === SiteState.Built ? kind.top + 1 : heightShareAt(Math.min(work, workTicks) / workTicks, kind.walls) * kind.top);
      kind.count++;
      if (state === SiteState.Site) kind.scaffold.setMatrixAt(kind.underWork++, pose.matrix);
    }
    for (const { building, scaffold, rise, count, underWork } of kinds) {
      building.count = count;
      building.instanceMatrix.needsUpdate = true;
      rise.needsUpdate = true;
      scaffold.count = underWork;
      scaffold.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    /** Each kind's finished and rising buildings, by `Building`. */
    buildings: kinds.map(({ building }) => building),
    /** Each kind's scaffolds, by `Building`. */
    scaffolds: kinds.map(({ scaffold }) => scaffold),
    show,
  };
}
