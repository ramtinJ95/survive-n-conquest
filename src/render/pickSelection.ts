import { Box3, type PerspectiveCamera, Ray, Raycaster, Vector2, Vector3 } from 'three';
import manifest from '../../assets/models.json';
import { CAMP_LAYOUT } from './camp';
import { type TileMap, heightAt } from '../sim/map';
import { MAX_SITES, type Orders, SiteState } from '../sim/orders';

/** What the player can select. A building is a site or a house, by its slot in the sites table and its center tile. */
export type Selection =
  | { readonly kind: 'villager'; readonly id: number }
  | { readonly kind: 'building'; readonly slot: number; readonly center: number }
  | { readonly kind: 'camp' };

export interface PickScene {
  readonly map: TileMap;
  readonly orders: Orders;
  readonly camp: number;
  /** Villager positions as the worker publishes them: pairs of map x and y in tiles, in id order. */
  readonly villagers: Float32Array;
}

/** A settler's height in meters, feet to the top of its hair. */
export const SETTLER_HEIGHT = 1.1;
/** Half the width of a settler's body at its hem, in meters. */
const SETTLER_HALF_WIDTH = 0.23;
/** A settler is a few pixels tall from afar, so a click this close to its body still takes it. */
export const SETTLER_REACH_PX = 16;
/** Over a building or the camp a settler must be clicked almost on its body, so the gaps between settlers at the fire select the camp. */
export const SETTLER_OVER_BUILDING_PX = 4;
/** A box over a building reaches this far above its highest tile, to take in the roof. */
const BUILDING_HEIGHT = 3;
const CAMP_HEIGHT = 1.8;
/** Half the side of the square that holds every model of the camp, so a click on the outer half of a tent selects the camp. */
const CAMP_REACH = Math.max(...CAMP_LAYOUT.map(({ shape, x, z }) => Math.max(Math.abs(x), Math.abs(z)) + manifest.models[shape].size / 2));

const feet = new Vector3();
const head = new Vector3();
const view = new Vector3();
const hit = new Vector3();
const box = new Box3();
const under = new Box3();
const chest = new Vector3();
const sight = new Ray();
const eye = new Vector3();
const pointer = new Vector2();
const ray = new Raycaster();

function toScreen(point: Vector3, camera: PerspectiveCamera, width: number, height: number): boolean {
  point.project(camera);
  if (point.z < -1 || point.z > 1) return false;
  point.set(((point.x + 1) / 2) * width, ((1 - point.y) / 2) * height, 0);
  return true;
}

function segmentDistance(px: number, py: number, a: Vector3, b: Vector3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length > 0 ? Math.min(Math.max(((px - a.x) * dx + (py - a.y) * dy) / length, 0), 1) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/**
 * Whether the box of the building under the click stands between the camera and
 * a settler. A settler inside the box, such as a builder on its site or a settler
 * at the fire, counts as seen.
 */
function hiddenBy(cover: Box3 | null, camera: PerspectiveCamera): boolean {
  if (!cover || cover.containsPoint(chest)) return false;
  eye.setFromMatrixPosition(camera.matrixWorld);
  sight.origin.copy(eye);
  sight.direction.subVectors(chest, eye).normalize();
  return sight.intersectBox(cover, hit) !== null && hit.distanceTo(eye) < chest.distanceTo(eye);
}

/** The pixels from a click to the nearest settler's body that `cover` does not hide, and that settler, or Infinity and -1. */
function nearestSettler(scene: PickScene, camera: PerspectiveCamera, x: number, y: number, width: number, height: number, cover: Box3 | null) {
  const { map, villagers } = scene;
  const half = map.size / 2;
  const focal = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  let best = Infinity;
  let id = -1;
  for (let villager = 0; villager * 2 < villagers.length; villager++) {
    const mapX = villagers[villager * 2]!;
    const mapY = villagers[villager * 2 + 1]!;
    const ground = heightAt(map, mapX, mapY);
    feet.set(mapX - half, ground, mapY - half);
    const depth = -view.copy(feet).applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= camera.near) continue;
    chest.set(feet.x, ground + SETTLER_HEIGHT / 2, feet.z);
    if (hiddenBy(cover, camera)) continue;
    head.set(feet.x, ground + SETTLER_HEIGHT, feet.z);
    if (!toScreen(feet, camera, width, height) || !toScreen(head, camera, width, height)) continue;
    const distance = Math.max(segmentDistance(x, y, feet, head) - (SETTLER_HALF_WIDTH * focal) / depth, 0);
    if (distance < best) {
      best = distance;
      id = villager;
    }
  }
  return { distance: best, id };
}

/** The lowest and the highest tile in a rectangle of tiles, clipped to the map. */
function heightRange(map: TileMap, x0: number, y0: number, x1: number, y1: number) {
  const { size, heights } = map;
  let lowest = Infinity;
  let highest = -Infinity;
  for (let y = Math.max(y0, 0); y <= Math.min(y1, size - 1); y++) {
    for (let x = Math.max(x0, 0); x <= Math.min(x1, size - 1); x++) {
      lowest = Math.min(lowest, heights[y * size + x]!);
      highest = Math.max(highest, heights[y * size + x]!);
    }
  }
  return { lowest, highest };
}

function rayDistance(): number {
  return ray.ray.intersectBox(box, hit) ? hit.distanceTo(ray.ray.origin) : Infinity;
}

function nearestBuilding(scene: PickScene): { distance: number; selection: Selection | null } {
  const { map, orders, camp } = scene;
  const { size } = map;
  const half = size / 2;
  let best = Infinity;
  let selection: Selection | null = null;
  for (let slot = 0; slot < MAX_SITES; slot++) {
    if (orders.sites.state[slot] === SiteState.Free) continue;
    const cx = orders.sites.x[slot]!;
    const cy = orders.sites.y[slot]!;
    const { lowest, highest } = heightRange(map, cx - 1, cy - 1, cx + 1, cy + 1);
    box.min.set(cx - 1 - half, lowest, cy - 1 - half);
    box.max.set(cx + 2 - half, highest + BUILDING_HEIGHT, cy + 2 - half);
    const distance = rayDistance();
    if (distance < best) {
      best = distance;
      under.copy(box);
      selection = { kind: 'building', slot, center: cy * size + cx };
    }
  }
  const tileX = camp % size;
  const tileY = Math.floor(camp / size);
  const campX = tileX + 0.5;
  const campY = tileY + 0.5;
  const reach = Math.ceil(CAMP_REACH);
  const { lowest } = heightRange(map, tileX - reach, tileY - reach, tileX + reach, tileY + reach);
  box.min.set(campX - CAMP_REACH - half, lowest, campY - CAMP_REACH - half);
  box.max.set(campX + CAMP_REACH - half, heightAt(map, campX, campY) + CAMP_HEIGHT, campY + CAMP_REACH - half);
  const distance = rayDistance();
  if (distance < best) {
    best = distance;
    under.copy(box);
    selection = { kind: 'camp' };
  }
  return { distance: best, selection };
}

/**
 * What a click at a point of the viewport, in pixels from its top left,
 * selects: the nearest settler within reach of its body, else the nearest
 * building or the camp under the click, or null for bare ground. Over a
 * building or the camp a settler wins only when the click is almost on it and
 * the building does not hide it.
 */
export function pickSelection(
  scene: PickScene,
  camera: PerspectiveCamera,
  x: number,
  y: number,
  width: number,
  height: number,
): Selection | null {
  camera.updateMatrixWorld();
  pointer.set((x / width) * 2 - 1, 1 - (y / height) * 2);
  ray.setFromCamera(pointer, camera);
  const building = nearestBuilding(scene);
  const settler = nearestSettler(scene, camera, x, y, width, height, building.selection ? under : null);
  const reach = building.selection ? SETTLER_OVER_BUILDING_PX : SETTLER_REACH_PX;
  if (settler.distance <= reach) return { kind: 'villager', id: settler.id };
  return building.selection;
}
