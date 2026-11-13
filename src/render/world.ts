import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Scene,
} from 'three';
import { WATER_LEVEL, heightAt, type TileMap } from '../sim/map';
import { CameraRig } from './cameraRig';
import { PALETTE, SKY_COLOR } from './palette';
import { TALLEST_TREE, createScenery } from './scenery';
import { createTerrain } from './terrainMesh';

const NEAREST_VIEW = 22;
/** The camera flies this far above the tallest tree, in meters. */
const TREETOP_MARGIN = 1;

function createWater(map: TileMap): Mesh {
  const water = new Mesh(
    new PlaneGeometry(map.size, map.size),
    new MeshLambertMaterial({
      color: PALETTE.water,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  water.name = 'water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_LEVEL;
  return water;
}

/** Builds the scene for a map, centered on the world origin, and the camera that flies over it. */
export function createWorld(map: TileMap) {
  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);
  scene.fog = new Fog(SKY_COLOR, map.size * 0.8, map.size * 3.2);

  const sky = new HemisphereLight(0xdcecff, 0x8f7f5e, 1.35);
  sky.name = 'sky';
  const sun = new DirectionalLight(0xfff0d2, 2.5);
  sun.name = 'sun';
  sun.position.set(-70, 80, 45);
  scene.add(sky, sun, createTerrain(map), createWater(map), ...createScenery(map));

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

  return { scene, rig };
}
