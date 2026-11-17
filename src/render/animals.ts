import { type BufferGeometry, DynamicDrawUsage, InstancedMesh, Object3D } from 'three';
import { ANIMALS, AnimalKind, AnimalState, MAX_ANIMALS } from '../sim/animals';
import { type TileMap, heightAt } from '../sim/map';
import { deerShape, shapeMaterial } from './shapes';

/** The shape each kind of animal is drawn as. A kind added to `ANIMALS` needs its shape here. */
const ANIMAL_SHAPES: Readonly<Record<AnimalKind, () => BufferGeometry>> = {
  [AnimalKind.Deer]: deerShape,
};

/** What `show` reads of a frame from the simulation. */
export interface AnimalFrame {
  readonly tick: number;
  readonly animals: Float32Array;
  readonly animalKinds: Uint8Array;
  readonly animalStates: Uint8Array;
}

/**
 * Draws every living animal standing on the ground, one instanced mesh for
 * each kind, turned the way it last moved. Nothing selects an animal.
 */
export function createHerds(map: TileMap) {
  const half = map.size / 2;
  const meshes = (Object.values(AnimalKind) as AnimalKind[]).map((kind) => {
    const mesh = new InstancedMesh(ANIMAL_SHAPES[kind](), shapeMaterial(), MAX_ANIMALS);
    mesh.name = ANIMALS[kind].name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    return mesh;
  });
  const facing = new Float32Array(MAX_ANIMALS);
  const last = new Float32Array(MAX_ANIMALS * 2);
  let shown = -1;
  const pose = new Object3D();

  return {
    /** One mesh for each `AnimalKind`, in its order. */
    meshes,
    /** Moves every living animal to its place in a frame from the simulation. */
    show({ tick, animals, animalKinds, animalStates }: AnimalFrame) {
      for (const mesh of meshes) mesh.count = 0;
      for (let row = 0; row < animalStates.length; row++) {
        const x = animals[row * 2]!;
        const y = animals[row * 2 + 1]!;
        const dx = x - last[row * 2]!;
        const dy = y - last[row * 2 + 1]!;
        if (tick !== shown && shown >= 0 && (dx !== 0 || dy !== 0)) facing[row] = Math.atan2(dx, dy);
        last[row * 2] = x;
        last[row * 2 + 1] = y;
        if (animalStates[row] === AnimalState.Gone) continue;
        const mesh = meshes[animalKinds[row]!]!;
        pose.position.set(x - half, heightAt(map, x, y), y - half);
        pose.rotation.set(0, facing[row]!, 0);
        pose.updateMatrix();
        mesh.setMatrixAt(mesh.count++, pose.matrix);
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
      shown = tick;
    },
  };
}
