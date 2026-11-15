import {
  type BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MeshLambertMaterial,
} from 'three';
import { Good } from '../sim/goods';
import { heightAt, type TileMap } from '../sim/map';
import type { Population } from '../sim/sim';
import { LOG_COLOR, STONE_COLOR, logGeometry, stoneGeometry } from './goods';

/** Villagers wear a saturated yellow and monsters a deep red, so neither reads as grass, sand, rock, or water from afar. */
export const VILLAGER_COLOR = 0xf2c12e;
export const MONSTER_COLOR = 0x9c1f2b;
/** A carried unit rests this far above the ground, a little over the villager's head. */
const CARRY_HEIGHT = 1.7;

function group(name: string, geometry: BufferGeometry, color: number, capacity: number): InstancedMesh {
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox!.min.y, 0);
  const mesh = new InstancedMesh(geometry, new MeshLambertMaterial({ color, flatShading: true }), capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  return mesh;
}

/**
 * Draws each group of units as one instanced mesh standing on the ground. Each
 * instance keeps the identity rotation and scale, so placing a unit writes only
 * the translation of its matrix. The units take the light of the scene, and
 * they cast and take its shadows.
 */
export function createSwarm(map: TileMap, population: Population) {
  const half = map.size / 2;
  const villagers = group('villagers', new CapsuleGeometry(0.3, 1, 2, 6), VILLAGER_COLOR, population.villagers);
  const monsters = group('monsters', new ConeGeometry(0.55, 1.5, 5), MONSTER_COLOR, population.monsters);
  const carriedLogs = group('carried logs', logGeometry().rotateZ(Math.PI / 2), LOG_COLOR, population.villagers);
  const carriedStone = group('carried stone', stoneGeometry(), STONE_COLOR, population.villagers);
  const carriedMeshes = [carriedLogs, carriedStone];
  const held: Readonly<Record<Good, InstancedMesh | null>> = { [Good.None]: null, [Good.Log]: carriedLogs, [Good.Stone]: carriedStone };

  const place = (mesh: InstancedMesh, positions: Float32Array) => {
    const matrices = mesh.instanceMatrix.array;
    const count = positions.length / 2;
    for (let id = 0; id < count; id++) {
      const x = positions[id * 2]!;
      const y = positions[id * 2 + 1]!;
      matrices[id * 16 + 12] = x - half;
      matrices[id * 16 + 13] = heightAt(map, x, y);
      matrices[id * 16 + 14] = y - half;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  };

  const carry = (positions: Float32Array, carried: Uint8Array) => {
    for (const mesh of carriedMeshes) mesh.count = 0;
    for (let id = 0; id < carried.length; id++) {
      const mesh = held[carried[id] as Good];
      if (!mesh) continue;
      const x = positions[id * 2]!;
      const y = positions[id * 2 + 1]!;
      const at = mesh.count++ * 16;
      const matrices = mesh.instanceMatrix.array;
      matrices[at + 12] = x - half;
      matrices[at + 13] = heightAt(map, x, y) + CARRY_HEIGHT;
      matrices[at + 14] = y - half;
    }
    for (const mesh of carriedMeshes) mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    meshes: [villagers, monsters, ...carriedMeshes],
    /** Moves every unit to the positions in a frame from the simulation, and puts what each villager carries above its head. */
    show(frame: { readonly villagers: Float32Array; readonly monsters: Float32Array; readonly carried: Uint8Array }) {
      place(villagers, frame.villagers);
      place(monsters, frame.monsters);
      carry(frame.villagers, frame.carried);
    },
  };
}
