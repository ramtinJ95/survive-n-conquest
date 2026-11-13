import { type DirectionalLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../sim/calendar';
import { heightAt } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { TALLEST_TREE } from './scenery';
import { createWorld } from './world';

const HOUR = TICKS_PER_DAY / 24;
const SIZE = 256;
const HALF = SIZE / 2;
const map = generateMap(19, SIZE);
const { scene, rig, show } = createWorld(map);
const light = scene.getObjectByName('sun') as DirectionalLight;
rig.camera.aspect = 16 / 9;
rig.camera.updateProjectionMatrix();

/** Ticks after the 08:00 start. */
const TIMES = { noon: 4 * HOUR, 'a low morning sun': 22 * HOUR, midnight: 16 * HOUR };
const highest = map.heights.indexOf(Math.max(...map.heights));
const PLACES = {
  'the map center': [0, 0],
  'the highest ground': [(highest % SIZE) + 0.5 - HALF, Math.floor(highest / SIZE) + 0.5 - HALF],
  'a map corner': [HALF, HALF],
  'a map edge': [HALF, 0],
} as const;
const YAWS = [0, 2.1, 4.2];
const TILTS = { 'from above': 10, 'from low': -10 };
const ZOOMS = { nearest: 1, 'four times the nearest': 4, farthest: 1e9 };

const groundAt = (x: number, z: number) => heightAt(map, x + HALF, z + HALF);

function look(x: number, z: number, yaw: number, tilt: number, zoom: number) {
  rig.update(100);
  const { position } = rig.camera;
  rig.rotate(yaw - Math.atan2(position.x - rig.target.x, position.z - rig.target.z), tilt);
  const dx = x - rig.target.x;
  const dz = z - rig.target.z;
  rig.pan(dx * Math.cos(yaw) - dz * Math.sin(yaw), -dx * Math.sin(yaw) - dz * Math.cos(yaw));
  rig.zoom(1e-9);
  rig.zoom(zoom);
  rig.update(100);
}

/** Points on the ground and at treetop height around the place the camera looks at, that the camera sees nearby. */
function* seenNearby(): Generator<Vector3> {
  const distance = rig.camera.position.distanceTo(rig.target);
  const step = distance / 6;
  const point = new Vector3();
  const onScreen = new Vector3();
  for (let x = rig.target.x - 3 * distance; x <= rig.target.x + 3 * distance; x += step) {
    for (let z = rig.target.z - 3 * distance; z <= rig.target.z + 3 * distance; z += step) {
      if (Math.abs(x) > HALF || Math.abs(z) > HALF) continue;
      for (const above of [0, TALLEST_TREE]) {
        point.set(x, groundAt(x, z) + above, z);
        if (point.distanceTo(rig.camera.position) > 2 * distance) continue;
        onScreen.copy(point).project(rig.camera);
        if (Math.max(Math.abs(onScreen.x), Math.abs(onScreen.y), Math.abs(onScreen.z)) <= 1) yield point;
      }
    }
  }
}

describe('the shadows', () => {
  it.each(Object.entries(PLACES))('reach all that the camera sees nearby at %s', (_place, [x, z]) => {
    const missed: string[] = [];
    const inShadowMap = new Vector3();
    for (const yaw of YAWS) {
      for (const [view, tilt] of Object.entries(TILTS)) {
        for (const [zoom, factor] of Object.entries(ZOOMS)) {
          look(x, z, yaw, tilt, factor);
          for (const [time, tick] of Object.entries(TIMES)) {
            show(tick);
            scene.updateMatrixWorld();
            light.shadow.updateMatrices(light);
            let seen = 0;
            let outside = 0;
            for (const point of seenNearby()) {
              seen++;
              inShadowMap.copy(point).project(light.shadow.camera);
              if (Math.max(Math.abs(inShadowMap.x), Math.abs(inShadowMap.y), Math.abs(inShadowMap.z)) > 1) outside++;
            }
            expect(seen, `points in view ${view}, ${zoom}, turned ${yaw}`).toBeGreaterThan(0);
            if (outside > 0) missed.push(`${outside} of ${seen} points ${view}, ${zoom}, turned ${yaw}, at ${time}`);
          }
        }
      }
    }
    expect(missed).toEqual([]);
  });
});
