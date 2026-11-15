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
import { TALLEST_TREE, TREE_MESHES } from './scenery';
import { primitiveShapes } from './shapes';
import { createWorld as createWorldFrom } from './world';

const createWorld = (map: TileMap) => createWorldFrom(map, primitiveShapes());

const SIZE = 96;
const map = generateMap(7, SIZE);
const { scene, rig, camp } = createWorld(map);
/** The meshes of the kinds of tree that grow on this map. */
const TREES = Object.values(TREE_MESHES).filter((name) => (scene.getObjectByName(name) as InstancedMesh).count > 0);

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

  it('lays water at the water level under the map, and a sea around it that reaches out of sight', () => {
    const water = scene.getObjectByName('water') as Mesh;
    const { min, max } = new Box3().setFromObject(water);
    expect(min.y).toBeCloseTo(WATER_LEVEL, 5);
    expect(max.y).toBeCloseTo(WATER_LEVEL, 5);
    for (const reach of [-min.x, max.x, -min.z, max.z]) expect(reach).toBeGreaterThan(SIZE / 2 + 1000);
    const bed = new Box3().setFromObject(scene.getObjectByName('sea bed') as Mesh);
    expect(bed.max.y).toBeLessThan(Math.min(...map.heights));
    expect([bed.min.x, bed.max.x, bed.min.z, bed.max.z]).toEqual([min.x, max.x, min.z, max.z]);
  });

  it('draws water over every tile that lies under the water level', () => {
    const water = scene.getObjectByName('water') as Mesh;
    const down = new Raycaster();
    for (let tile = 0; tile < SIZE * SIZE; tile++) {
      if (map.heights[tile]! >= WATER_LEVEL) continue;
      down.set(new Vector3((tile % SIZE) + 0.5 - SIZE / 2, 10, Math.floor(tile / SIZE) + 0.5 - SIZE / 2), new Vector3(0, -1, 0));
      expect(down.intersectObject(water).length, `tile ${tile}`).toBeGreaterThan(0);
    }
  });

  it('stands trees of more than one kind, on forest tiles only', () => {
    expect(TREES.length).toBeGreaterThan(1);
    for (const name of TREES) expect(kindsUnder(name), name).toEqual(new Set([TileKind.Forest]));
  });

  it('grows grass, flowers, bushes, pebbles, and reeds on open ground only, and none of them at the camp', () => {
    const matrix = new Matrix4();
    const at = new Vector3();
    const campX = (camp % SIZE) + 0.5 - SIZE / 2;
    const campZ = Math.floor(camp / SIZE) + 0.5 - SIZE / 2;
    for (const name of ['grass tufts', 'flowers', 'bushes', 'pebbles', 'reeds']) {
      const cover = scene.getObjectByName(name) as InstancedMesh;
      expect(cover, name).toBeInstanceOf(InstancedMesh);
      for (let i = 0; i < cover.count; i++) {
        expect(kindUnder(cover, i, map), `${name} ${i}`).toBe(TileKind.Grass);
        cover.getMatrixAt(i, matrix);
        at.setFromMatrixPosition(matrix);
        expect(Math.hypot(at.x - campX, at.z - campZ), `${name} ${i}`).toBeGreaterThan(3);
      }
    }
    expect((scene.getObjectByName('grass tufts') as InstancedMesh).count).toBeGreaterThan(100);
  });

  it('stands one tree on each tile where the map has a tree, and none elsewhere', () => {
    const matrix = new Matrix4();
    const position = new Vector3();
    const stood: number[] = [];
    for (const name of TREES) {
      const trees = scene.getObjectByName(name) as InstancedMesh;
      for (let i = 0; i < trees.count; i++) {
        trees.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix);
        stood.push(Math.floor(position.z + SIZE / 2) * SIZE + Math.floor(position.x + SIZE / 2));
      }
    }
    const treeTiles = Array.from({ length: SIZE * SIZE }, (_, tile) => tile).filter((tile) => map.trees[tile] === 1);
    expect(treeTiles.length).toBeGreaterThan(0);
    expect(stood.sort((a, b) => a - b)).toEqual(treeTiles);
  });

  it('grows no tree taller than the height the camera clears', () => {
    const matrix = new Matrix4();
    for (const name of TREES) {
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
    for (const name of [...TREES, 'boulders']) {
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
