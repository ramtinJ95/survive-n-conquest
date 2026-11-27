import { type Material, MathUtils, Scene, Vector4 } from 'three';
import { TICKS_PER_DAY } from '../sim/calendar';
import { campTile } from '../sim/camp';
import { type TileKind, WATER_LEVEL, heightAt, type TileMap } from '../sim/map';
import { type OrderChanges, applyOrderChanges, createOrders } from '../sim/orders';
import { createFieldTiles } from '../sim/fields';
import { frostTick } from '../sim/frost';
import { TILE_CHANGE_STRIDE } from '../sim/tileChanges';
import { createCamp } from './camp';
import { CameraRig } from './cameraRig';
import { createDaylight } from './daylight';
import { createFires } from './fires';
import { createGoods } from './goods';
import { createOrderMarks } from './orderMarks';
import { TALLEST_TREE, createScenery, treeTop } from './scenery';
import type { Shapes } from './shapes';
import { createSites } from './sites';
import { seasonMixAt } from './seasonal';
import { createTerrain } from './terrainMesh';
import { createWater } from './water';

const NEAREST_VIEW = 14;
/** The camera flies this far above the tallest tree, in meters. */
const TREETOP_MARGIN = 1;
const FIRELIT = { from: 0.3, full: -0.05 };

/**
 * Builds the scene for a map, centered on the world origin, out of `shapes`,
 * and the camera that flies over it. `show` lights the scene and colors the
 * land for a tick of the simulation clock. `time` is the clock in ticks with
 * the part of a tick that has passed, and moves the wind, the water, and the
 * fire: it is the tick itself while the clock is paused, so a paused world
 * holds still. They move with the time of day alone, so the world looks the
 * same at the same time on every day. The simulation owns the map, and
 * `changeTiles` brings this copy of it, the ground, and the scenery up to date.
 */
export function createWorld(map: TileMap, shapes: Shapes) {
  const scene = new Scene();
  const seasonMix = { value: new Vector4(1, 0, 0, 0) };
  const clock = { value: 0 };
  const camp = campTile(map);
  const { terrain, repaint } = createTerrain(map, seasonMix, camp);
  /** The simulation's orders as the main thread knows them, for the interface's previews. */
  const orders = createOrders(map, camp);
  /** The simulation's field tiles as the main thread knows them, from the tile changes. */
  const fields = createFieldTiles(map.size * map.size, frostTick(map.seed, 0));
  const scenery = createScenery(map, seasonMix, clock, camp);
  const campsite = createCamp(map, camp, shapes);
  const { water, bed } = createWater(map, seasonMix, clock);
  scene.add(terrain, bed, water, campsite.mesh, ...scenery.meshes);
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

  const goods = createGoods(map, shapes);
  scene.add(goods.group);

  const sites = createSites(map, shapes);
  scene.add(...sites.buildings, ...sites.scaffolds);

  const marks = createOrderMarks(map, terrain.material as Material, (tile, out) => treeTop(map, tile, out), rig.target);
  scene.add(...marks.meshes);

  const fires = createFires(map, shapes);
  scene.add(fires.mesh);
  const show = (tick: number, time = tick) => {
    clock.value = time % TICKS_PER_DAY;
    const sun = light(tick, seasonMixAt(tick, seasonMix.value), rig.camera, rig.target);
    marks.showCropDay(tick);
    campsite.show(clock.value, MathUtils.smoothstep(-sun, -FIRELIT.from, -FIRELIT.full));
  };
  show(0);

  /** Shows the sign of each house whose fire burns tonight, from a frame's flags by store id. */
  const showFires = (burning: Uint8Array) => fires.show(orders, burning);

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
      if (fields.sownAt[tile] !== groups[i + 5] || fields.cutAt[tile] !== groups[i + 6]) {
        fields.sownAt[tile] = groups[i + 5]!;
        fields.cutAt[tile] = groups[i + 6]!;
        marks.showCrop(tile, fields.sownAt[tile]!, fields.cutAt[tile]!);
      }
      if (reshaped) repaint(tile);
      if (reshaped || felled || stacked) scenery.refresh(tile);
      if (stacked) goods.refresh(tile);
    }
  };

  /** Applies order changes from the simulation to this copy of the orders and to the marks. */
  const changeOrders = (changes: OrderChanges) => {
    if (changes.claims.length === 0 && changes.sites.length === 0) return;
    applyOrderChanges(orders, changes);
    marks.showOrders(orders);
    if (changes.sites.length > 0) sites.show(orders);
  };

  return { scene, rig, show, camp, changeTiles, orders, fields, marks, changeOrders, showFires };
}
