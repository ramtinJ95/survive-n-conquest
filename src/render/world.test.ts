import {
  Box3,
  type BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Raycaster,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { TileKind, WATER_LEVEL, type TileMap } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { TALLEST_TREE } from './scenery';
import { createWorld } from './world';

const SIZE = 96;
const map = generateMap(7, SIZE);
const { scene, rig } = createWorld(map);

function kindUnder(mesh: InstancedMesh, instance: number, on: TileMap): number {
  const matrix = new Matrix4();
  mesh.getMatrixAt(instance, matrix);
  const { x, z } = new Vector3().setFromMatrixPosition(matrix);
  return on.kinds[Math.floor(z + on.size / 2) * on.size + Math.floor(x + on.size / 2)]!;
}

function kindsUnder(name: string): Set<number> {
  const mesh = scene.getObjectByName(name) as InstancedMesh;
  expect(mesh).toBeInstanceOf(InstancedMesh);
  expect(mesh.count).toBeGreaterThan(0);
  return new Set(Array.from({ length: mesh.count }, (_, i) => kindUnder(mesh, i, map)));
}

describe('createWorld', () => {
  it('draws terrain over the whole map, up to its highest tile', () => {
    const terrain = scene.getObjectByName('terrain') as Mesh;
    const { min, max } = new Box3().setFromObject(terrain);
    const half = SIZE / 2;
    expect([min.x, max.x, min.z, max.z]).toEqual([-half, half, -half, half]);
    expect(max.y).toBeCloseTo(Math.max(...map.heights), 5);
    expect(min.y).toBeLessThan(Math.min(...map.heights));
  });

  it('lays water at the water level across the map', () => {
    const water = scene.getObjectByName('water') as Mesh;
    const { min, max } = new Box3().setFromObject(water);
    expect(min.y).toBeCloseTo(WATER_LEVEL, 5);
    expect(max.y).toBeCloseTo(WATER_LEVEL, 5);
    expect(max.x - min.x).toBeCloseTo(SIZE, 5);
    expect(max.z - min.z).toBeCloseTo(SIZE, 5);
  });

  it('stands trees on forest tiles only', () => {
    expect(kindsUnder('broadleaves')).toEqual(new Set([TileKind.Forest]));
    expect(kindsUnder('pines')).toEqual(new Set([TileKind.Forest]));
  });

  it('grows no tree taller than the height the camera clears', () => {
    const matrix = new Matrix4();
    for (const name of ['pines', 'broadleaves']) {
      const trees = scene.getObjectByName(name) as InstancedMesh;
      const shapeTop = new Box3().setFromBufferAttribute(
        trees.geometry.getAttribute('position') as BufferAttribute,
      ).max.y;
      for (let i = 0; i < trees.count; i++) {
        trees.getMatrixAt(i, matrix);
        expect(shapeTop * new Vector3().setFromMatrixScale(matrix).y).toBeLessThanOrEqual(TALLEST_TREE);
      }
    }
  });

  it('roots every tree and boulder in the ground that the terrain draws', () => {
    const terrain = scene.getObjectByName('terrain') as Mesh;
    const down = new Raycaster();
    const matrix = new Matrix4();
    const root = new Vector3();
    for (const name of ['pines', 'broadleaves', 'boulders']) {
      const scenery = scene.getObjectByName(name) as InstancedMesh;
      for (let i = 0; i < scenery.count; i++) {
        scenery.getMatrixAt(i, matrix);
        root.setFromMatrixPosition(matrix);
        down.set(new Vector3(root.x, 1000, root.z), new Vector3(0, -1, 0));
        const [ground] = down.intersectObject(terrain);
        expect(ground, `${name} ${i} stands over the terrain`).toBeDefined();
        expect(Math.abs(ground!.point.y - root.y)).toBeLessThan(0.75);
      }
    }
  });

  it('scatters boulders on rock tiles only', () => {
    expect(kindsUnder('boulders')).toEqual(new Set([TileKind.Rock]));
  });

  it('starts the camera above the map center, looking down at it', () => {
    expect(rig.target.x).toBe(0);
    expect(rig.target.z).toBe(0);
    expect(rig.camera.position.y).toBeGreaterThan(rig.target.y);
    expect(rig.camera.getWorldDirection(new Vector3()).y).toBeLessThan(0);
  });

  it('draws the same world for the same seed and another world for another seed', () => {
    const vertices = (seed: number) => {
      const world = createWorld(generateMap(seed, SIZE)).scene;
      return (world.getObjectByName('terrain') as Mesh).geometry.getAttribute('position').array;
    };
    expect(vertices(7)).toEqual(vertices(7));
    expect(vertices(8)).not.toEqual(vertices(7));
  });
});
