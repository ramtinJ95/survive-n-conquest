import { type PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { WATER_LEVEL, heightAt, type TileMap } from '../sim/map';

const STEP = 0.5;
const REFINE = 12;

export interface PickedTile {
  readonly x: number;
  readonly y: number;
  /** False when the ray met the ground beyond the map edge, or no ground, and the tile is the nearest one on the map. */
  readonly onMap: boolean;
}

/**
 * Finds the tile under a point of the viewport, given in pixels from its top
 * left. The ray marches over the height field instead of testing the terrain's
 * triangles, so a pick costs a few thousand height samples.
 */
export function createPicker(map: TileMap, camera: PerspectiveCamera) {
  const ray = new Raycaster();
  const pointer = new Vector2();
  const at = new Vector3();
  const half = map.size / 2;
  const ground = (x: number, z: number) => Math.max(heightAt(map, x + half, z + half), WATER_LEVEL);
  const above = (t: number) => {
    ray.ray.at(t, at);
    return at.y - ground(at.x, at.z);
  };

  return (clientX: number, clientY: number, width: number, height: number): PickedTile => {
    pointer.set((clientX / width) * 2 - 1, 1 - (clientY / height) * 2);
    // The rig aims the camera every frame, and its world matrix catches up only when the scene renders.
    camera.updateMatrixWorld();
    ray.setFromCamera(pointer, camera);
    let near = 0;
    let far = -1;
    for (let t = STEP; t < camera.far; t += STEP) {
      if (above(t) <= 0) {
        near = t - STEP;
        far = t;
        break;
      }
    }
    if (far < 0) {
      // The ray passes over the map into the sky, so the pick takes the point where it is lowest over the map's plane.
      const down = Math.max(-ray.ray.direction.y, 1e-3);
      far = (ray.ray.origin.y - WATER_LEVEL) / down;
    } else {
      for (let i = 0; i < REFINE; i++) {
        const mid = (near + far) / 2;
        if (above(mid) <= 0) far = mid;
        else near = mid;
      }
    }
    ray.ray.at(far, at);
    const x = Math.floor(at.x + half);
    const y = Math.floor(at.z + half);
    const clamp = (value: number) => Math.min(Math.max(value, 0), map.size - 1);
    return { x: clamp(x), y: clamp(y), onMap: x === clamp(x) && y === clamp(y) };
  };
}
