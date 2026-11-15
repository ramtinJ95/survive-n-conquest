import { CylinderGeometry, type IUniform, type Material, Mesh, MeshLambertMaterial, PlaneGeometry, Scene, Vector4 } from 'three';
import { CAMP_RADIUS, campTile } from '../sim/camp';
import { type TileKind, WATER_LEVEL, heightAt, type TileMap } from '../sim/map';
import { type OrderChanges, applyOrderChanges, createOrders } from '../sim/orders';
import { TILE_CHANGE_STRIDE } from '../sim/tileChanges';
import { CameraRig } from './cameraRig';
import { createDaylight } from './daylight';
import { createGoods } from './goods';
import { PALETTES } from './palette';
import { createOrderMarks } from './orderMarks';
import { TALLEST_TREE, createScenery, treeTop } from './scenery';
import { createSites } from './sites';
import { SEASON_COLORS, seasonMixAt, seasonalMaterial } from './seasonal';
import { createTerrain } from './terrainMesh';

const NEAREST_VIEW = 22;
/** The camp is a disc of trodden earth, wide enough to hold the settlers' spots. */
const CAMP = { color: 0x6e4b2e };
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

function createCamp(map: TileMap, tile: number): Mesh {
  const x = (tile % map.size) + 0.5;
  const y = Math.floor(tile / map.size) + 0.5;
  const camp = new Mesh(
    new CylinderGeometry(CAMP_RADIUS, CAMP_RADIUS, 0.3, 12),
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
  const camp = campTile(map);
  scene.add(terrain, createWater(map, seasonMix), createCamp(map, camp), ...scenery.meshes);
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

  const goods = createGoods(map);
  scene.add(goods.group);

  const sites = createSites(map);
  scene.add(sites.group);

  const marks = createOrderMarks(map, terrain.material as Material, (tile, out) => treeTop(map, tile, out), rig.target);
  scene.add(...marks.meshes);

  const show = (tick: number) => light(tick, seasonMixAt(tick, seasonMix.value), rig.camera, rig.target);
  show(0);

  /** Applies tile changes from the simulation, as `takeTileChanges` groups them, to the map and the scene. */
  const changeTiles = (groups: Int32Array) => {
    for (let i = 0; i < groups.length; i += TILE_CHANGE_STRIDE) {
      const tile = groups[i]!;
      const kind = groups[i + 1]! as TileKind;
      const tree = groups[i + 2]!;
      const reshaped = map.kinds[tile] !== kind;
      const felled = map.trees[tile] !== tree;
      const stacked = map.stackGood[tile] !== groups[i + 3] || map.stackSize[tile] !== groups[i + 4];
      map.kinds[tile] = kind;
      map.trees[tile] = tree;
      map.stackGood[tile] = groups[i + 3]!;
      map.stackSize[tile] = groups[i + 4]!;
      if (reshaped) repaint(tile);
      if (reshaped || felled) scenery.refresh(tile);
      if (stacked) goods.refresh(tile);
    }
  };

  /** The simulation's orders as the main thread knows them, for the interface's previews. */
  const orders = createOrders(map, camp);
  /** Applies order changes from the simulation to this copy of the orders and to the marks. */
  const changeOrders = (changes: OrderChanges) => {
    if (changes.claims.length === 0 && changes.sites.length === 0) return;
    applyOrderChanges(orders, changes);
    marks.showOrders(orders);
    if (changes.sites.length > 0) sites.show(orders);
  };

  return { scene, rig, show, changeTiles, orders, marks, changeOrders };
}
