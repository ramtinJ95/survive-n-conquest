// Where tiles land on a 960 by 540 page at a view a scenario takes from the opening view, so its clicks can aim at them.
// Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts <seed> '<view>' '<tiles>'
// The view is { wheel, turn: { x, y }, pan: { x, y } } in the pixels of a wheel, a right drag, and a main-button drag,
// or { wheel, turn, target: [x, y] } to find the pan that brings the look-at point over a map point. The tiles are
// [[x, y], ...], or [x, y, rise] for a point that many meters above a tile's center, such as a roof. Each line names a
// tile, the pixel of its center, and the tile the game's picker takes at that pixel. The rig's limits and the input
// rates mirror src/render/world.ts and src/render/cameraInput.ts.
import { Vector3 } from 'three';
import { CameraRig } from '../../../../src/render/cameraRig';
import { createPicker } from '../../../../src/render/pick';
import { TALLEST_TREE } from '../../../../src/render/scenery';
import { WATER_LEVEL, heightAt } from '../../../../src/sim/map';
import { generateMap } from '../../../../src/sim/mapgen';

const WIDTH = 960;
const HEIGHT = 540;
const RADIANS_PER_PIXEL = 0.005;
const ZOOM_PER_WHEEL_PIXEL = 0.0015;

const [seed = '7', viewText = '{"wheel":0,"turn":{"x":0,"y":0},"pan":{"x":0,"y":0}}', tilesText = '[]'] = process.argv.slice(2);
const view = JSON.parse(viewText);
const map = generateMap(Number(seed));
const half = map.size / 2;
const rig = new CameraRig((x, z) => Math.max(heightAt(map, x + half, z + half), WATER_LEVEL), {
  reach: half - 1,
  minDistance: 14,
  maxDistance: map.size * 0.95,
  clearance: TALLEST_TREE + 1,
});
rig.camera.aspect = WIDTH / HEIGHT;
rig.camera.updateProjectionMatrix();
const settle = () => {
  for (let step = 0; step < 4; step++) rig.update(100);
  rig.camera.updateMatrixWorld();
};

settle();
rig.zoom(Math.exp(view.wheel * ZOOM_PER_WHEEL_PIXEL));
settle();
rig.rotate(-view.turn.x * RADIANS_PER_PIXEL, view.turn.y * RADIANS_PER_PIXEL);
settle();
const { across, into } = rig.groundPerPixel(HEIGHT);
const pan = view.pan ?? (() => {
  const yaw = Math.atan2(rig.camera.position.x - rig.target.x, rig.camera.position.z - rig.target.z);
  const east = view.target[0] - half - rig.target.x;
  const south = view.target[1] - half - rig.target.z;
  const right = east * Math.cos(yaw) - south * Math.sin(yaw);
  const forward = -east * Math.sin(yaw) - south * Math.cos(yaw);
  return { x: Math.round(-right / across), y: Math.round(forward / into) };
})();
rig.pan(-pan.x * across, pan.y * into);
settle();
console.log(`pan ${JSON.stringify(pan)}, looking at (${(rig.target.x + half).toFixed(2)}, ${(rig.target.z + half).toFixed(2)}) from ${rig.camera.position.distanceTo(rig.target).toFixed(1)} m`);

const pick = createPicker(map, rig.camera);
for (const [x, y, rise = 0] of JSON.parse(tilesText) as [number, number, number?][]) {
  const point = new Vector3(x + 0.5 - half, heightAt(map, x + 0.5, y + 0.5) + rise, y + 0.5 - half).project(rig.camera);
  const at = { x: Math.round(((point.x + 1) / 2) * WIDTH), y: Math.round(((1 - point.y) / 2) * HEIGHT) };
  if (rise > 0) {
    console.log(`${rise} m over (${x}, ${y}) at ${JSON.stringify(at)}`);
    continue;
  }
  const picked = pick(at.x, at.y, WIDTH, HEIGHT);
  console.log(`tile (${x}, ${y}) at ${JSON.stringify(at)} picks (${picked.x}, ${picked.y})${picked.x === x && picked.y === y ? '' : ' MISSES'}`);
}
