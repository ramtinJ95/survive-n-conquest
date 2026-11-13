import { type IUniform, Mesh, PlaneGeometry, Scene, Vector4 } from 'three';
import { WATER_LEVEL, heightAt, type TileMap } from '../sim/map';
import { CameraRig } from './cameraRig';
import { createDaylight } from './daylight';
import { PALETTES } from './palette';
import { TALLEST_TREE, createScenery } from './scenery';
import { SEASON_COLORS, seasonMixAt, seasonalMaterial } from './seasonal';
import { createTerrain } from './terrainMesh';

const NEAREST_VIEW = 22;
/** The camera flies this far above the tallest tree, in meters. */
const TREETOP_MARGIN = 1;

function createWater(map: TileMap, seasonMix: IUniform<Vector4>): Mesh {
  const surface = new PlaneGeometry(map.size, map.size);
  const corners = surface.getAttribute('position').count;
  PALETTES.forEach((palette, season) => {
    const { r, g, b } = palette.water;
    const colors = surface.getAttribute('position').clone();
    for (let corner = 0; corner < corners; corner++) colors.setXYZ(corner, r, g, b);
    surface.setAttribute(SEASON_COLORS[season]!, colors);
  });
  const water = new Mesh(surface, seasonalMaterial(seasonMix, { transparent: true, opacity: 0.72, depthWrite: false }));
  water.name = 'water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  water.receiveShadow = true;
  return water;
}

/**
 * Builds the scene for a map, centered on the world origin, and the camera
 * that flies over it. `show` lights the scene and colors the land for a tick
 * of the simulation clock.
 */
export function createWorld(map: TileMap) {
  const scene = new Scene();
  const seasonMix = { value: new Vector4(1, 0, 0, 0) };
  scene.add(createTerrain(map, seasonMix), createWater(map, seasonMix), ...createScenery(map, seasonMix));
  let lowest = WATER_LEVEL;
  let highest = WATER_LEVEL;
  for (const height of map.heights) {
    lowest = Math.min(lowest, height);
    highest = Math.max(highest, height);
  }
  const light = createDaylight(scene, map.size, lowest, highest + TALLEST_TREE);

  const half = map.size / 2;
  const rig = new CameraRig(
    (x, z) => Math.max(heightAt(map, x + half, z + half), WATER_LEVEL),
    {
      reach: half - 1,
      minDistance: NEAREST_VIEW,
      maxDistance: map.size * 0.95,
      clearance: TALLEST_TREE + TREETOP_MARGIN,
    },
  );

  const show = (tick: number) => light(tick, seasonMixAt(tick, seasonMix.value), rig.camera, rig.target);
  show(0);

  return { scene, rig, show };
}
