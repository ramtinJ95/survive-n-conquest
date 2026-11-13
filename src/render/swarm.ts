import {
  type BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  MeshLambertMaterial,
} from 'three';
import { heightAt, type TileMap } from '../sim/map';
import type { Population } from '../sim/sim';

/** Villagers wear a saturated yellow and monsters a deep red, so neither reads as grass, sand, rock, or water from afar. */
export const VILLAGER_COLOR = 0xf2c12e;
export const MONSTER_COLOR = 0x9c1f2b;

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

  return {
    meshes: [villagers, monsters],
    /** Moves every unit to the positions in a frame from the simulation. */
    show(frame: { readonly villagers: Float32Array; readonly monsters: Float32Array }) {
      place(villagers, frame.villagers);
      place(monsters, frame.monsters);
    },
  };
}
