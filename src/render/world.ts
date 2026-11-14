import { CylinderGeometry, type IUniform, Mesh, MeshLambertMaterial, PlaneGeometry, Scene, Vector4 } from 'three';
import { campTile } from '../sim/camp';
import { type TileKind, WATER_LEVEL, heightAt, type TileMap } from '../sim/map';
import { CameraRig } from './cameraRig';
import { createDaylight } from './daylight';
import { PALETTES } from './palette';
import { TALLEST_TREE, createScenery } from './scenery';
import { SEASON_COLORS, seasonMixAt, seasonalMaterial } from './seasonal';
import { createTerrain } from './terrainMesh';

const NEAREST_VIEW = 22;
/** The camp is a disc of trodden earth, wide enough to hold the settlers' spots. */
const CAMP = { radius: 2, color: 0x6e4b2e };
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

function createCamp(map: TileMap): Mesh {
  const tile = campTile(map);
  const x = (tile % map.size) + 0.5;
  const y = Math.floor(tile / map.size) + 0.5;
  const camp = new Mesh(
    new CylinderGeometry(CAMP.radius, CAMP.radius, 0.3, 12),
    new MeshLambertMaterial({ color: CAMP.color, flatShading: true }),
  );
  camp.name = 'camp';
  camp.position.set(x - map.size / 2, heightAt(map, x, y), y - map.size / 2);
  camp.receiveShadow = true;
  return camp;
}

/**
 * Builds the scene for a map, centered on the world origin, and the camera
 * that flies over it. `show` lights the scene and colors the land for a tick
 * of the simulation clock. The simulation owns the map, and `changeTiles`
 * brings this copy of it, the ground, and the scenery up to date.
 */
export function createWorld(map: TileMap) {
  const scene = new Scene();
  const seasonMix = { value: new Vector4(1, 0, 0, 0) };
  const { terrain, repaint } = createTerrain(map, seasonMix);
  const scenery = createScenery(map, seasonMix);
  scene.add(terrain, createWater(map, seasonMix), createCamp(map), ...scenery.meshes);
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

  /** Applies tile changes from the simulation, as pairs of a tile index and its kind now, to the map and the scene. */
  const changeTiles = (pairs: Int32Array) => {
    for (let i = 0; i < pairs.length; i += 2) {
      const tile = pairs[i]!;
      map.kinds[tile] = pairs[i + 1]! as TileKind;
      repaint(tile);
      scenery.refresh(tile);
    }
  };

  return { scene, rig, show, changeTiles };
}
