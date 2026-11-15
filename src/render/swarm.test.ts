import { InstancedMesh, Matrix4, type MeshLambertMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Good } from '../sim/goods';
import { heightAt } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { createSwarm } from './swarm';

const SIZE = 64;
const map = generateMap(7, SIZE);

function placed(mesh: InstancedMesh, instance: number): Vector3 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(instance, matrix);
  return new Vector3().setFromMatrixPosition(matrix);
}

describe('createSwarm', () => {
  it('draws each group as one instanced mesh that shows nothing before the first frame', () => {
    const { meshes } = createSwarm(map, { villagers: 3, monsters: 2 });
    expect(meshes.map((mesh) => [mesh.name, mesh.constructor, mesh.count])).toEqual([
      ['villagers', InstancedMesh, 0],
      ['monsters', InstancedMesh, 0],
      ['carried logs', InstancedMesh, 0],
      ['carried stone', InstancedMesh, 0],
    ]);
  });

  it('lets the light of the world fall on the units, with no glow of their own', () => {
    for (const mesh of createSwarm(map, { villagers: 1, monsters: 1 }).meshes) {
      expect([mesh.castShadow, mesh.receiveShadow], mesh.name).toEqual([true, true]);
      expect((mesh.material as MeshLambertMaterial).emissive?.getHex(), mesh.name).toBe(0);
    }
  });

  it('stands every unit on the ground at its map position', () => {
    const { meshes, show } = createSwarm(map, { villagers: 2, monsters: 1 });
    show({ villagers: Float32Array.of(10.5, 20.25, 40, 3.75), monsters: Float32Array.of(32, 32), carried: new Uint8Array(2) });
    const [villagers, monsters] = meshes as [InstancedMesh, InstancedMesh];
    expect(villagers.count).toBe(2);
    expect(monsters.count).toBe(1);
    const half = SIZE / 2;
    for (const [mesh, instance, x, y] of [
      [villagers, 0, 10.5, 20.25],
      [villagers, 1, 40, 3.75],
      [monsters, 0, 32, 32],
    ] as const) {
      const position = placed(mesh, instance);
      expect(position.x).toBeCloseTo(x - half, 5);
      expect(position.z).toBeCloseTo(y - half, 5);
      expect(position.y).toBeCloseTo(heightAt(map, x, y), 5);
    }
  });

  it('builds each unit with its base on the ground', () => {
    for (const mesh of createSwarm(map, { villagers: 1, monsters: 1 }).meshes.slice(0, 2)) {
      mesh.geometry.computeBoundingBox();
      const { min, max } = mesh.geometry.boundingBox!;
      expect(min.y).toBeCloseTo(0, 5);
      expect(max.y).toBeGreaterThan(1.2);
    }
  });

  it('holds a carried log or stone above the head of the villager that carries it, and nothing over one that carries none', () => {
    const { meshes, show } = createSwarm(map, { villagers: 3, monsters: 0 });
    const [villagers, , logs, stone] = meshes as [InstancedMesh, InstancedMesh, InstancedMesh, InstancedMesh];
    show({ villagers: Float32Array.of(10.5, 20.5, 30.5, 30.5, 40.5, 12.5), monsters: new Float32Array(0), carried: Uint8Array.of(Good.Stone, Good.None, Good.Log) });
    expect([logs.count, stone.count]).toEqual([1, 1]);
    villagers.geometry.computeBoundingBox();
    const head = villagers.geometry.boundingBox!.max.y;
    const half = SIZE / 2;
    for (const [mesh, x, y] of [
      [stone, 10.5, 20.5],
      [logs, 40.5, 12.5],
    ] as const) {
      const position = placed(mesh, 0);
      expect(position.x).toBeCloseTo(x - half, 5);
      expect(position.z).toBeCloseTo(y - half, 5);
      expect(position.y).toBeGreaterThan(heightAt(map, x, y) + head);
    }

    show({ villagers: Float32Array.of(10.5, 20.5, 30.5, 30.5, 40.5, 12.5), monsters: new Float32Array(0), carried: new Uint8Array(3) });
    expect([logs.count, stone.count]).toEqual([0, 0]);
  });
});
