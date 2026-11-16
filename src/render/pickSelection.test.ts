import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMP_RADIUS } from '../sim/camp';
import { applyOrder, createOrders, SiteState } from '../sim/orders';
import { at, mapFrom } from '../sim/testMaps';
import { CameraRig } from './cameraRig';
import { SETTLER_HEIGHT, pickSelection } from './pickSelection';

const SIZE = 64;
const WIDTH = 960;
const HEIGHT = 540;
const NEAREST = 14;
const FARTHEST = 256 * 0.95;
const GROUND = 1;
const FIRST_YAW = 0.55;

/** A camera looking at the middle of a flat map, the tile (32, 32), and the camp at `campX`, `campY`. */
function setting(yaw: number, distance: number, campX = 6, campY = 6) {
  const map = mapFrom(Array.from({ length: SIZE }, () => '.'.repeat(SIZE)));
  const half = SIZE / 2;
  const rig = new CameraRig(() => GROUND, { reach: half - 1, minDistance: NEAREST, maxDistance: FARTHEST, clearance: 2 });
  rig.camera.aspect = WIDTH / HEIGHT;
  rig.camera.updateProjectionMatrix();
  rig.rotate(yaw - FIRST_YAW, 0);
  rig.zoom(distance === NEAREST ? 1e-9 : 1e9);
  for (let i = 0; i < 5; i++) rig.update(10);
  rig.camera.updateMatrixWorld();
  const camp = at(map, campX, campY);
  return { map, orders: createOrders(map, camp), camera: rig.camera, half, camp };
}

type Setting = ReturnType<typeof setting>;

function screen({ camera, half }: Setting, mapX: number, height: number, mapY: number) {
  const point = new Vector3(mapX - half, height, mapY - half).project(camera);
  return { x: ((point.x + 1) / 2) * WIDTH, y: ((1 - point.y) / 2) * HEIGHT };
}

/** The point on screen this many pixels right of the edge of a settler's body, halfway up. */
function besideSettler(world: Setting, mapX: number, mapY: number, pixels: number) {
  const middle = screen(world, mapX, GROUND + SETTLER_HEIGHT / 2, mapY);
  const right = new Vector3().setFromMatrixColumn(world.camera.matrixWorld, 0).multiplyScalar(0.23);
  const edge = screen(world, mapX + right.x, GROUND + SETTLER_HEIGHT / 2 + right.y, mapY + right.z);
  return { x: edge.x + pixels, y: middle.y };
}

const pick = (world: Setting, villagers: number[], click: { x: number; y: number }) =>
  pickSelection({ map: world.map, orders: world.orders, camp: world.camp, villagers: Float32Array.from(villagers) }, world.camera, click.x, click.y, WIDTH, HEIGHT);

describe('pickSelection', () => {
  describe.each([NEAREST, FARTHEST])('at a camera distance of %d m', (distance) => {
    it.each([0, 1.6, 3.2, 4.8])('takes a settler on open ground within 16 px of its body at yaw %d', (yaw) => {
      const world = setting(yaw, distance);
      const villagers = [12.5, 50.5, 32.5, 32.5];
      expect(pick(world, villagers, besideSettler(world, 32.5, 32.5, 15))).toEqual({ kind: 'villager', id: 1 });
      expect(pick(world, villagers, besideSettler(world, 32.5, 32.5, 17))).toBeNull();
      expect(pick(world, villagers, besideSettler(world, 32.5, 32.5, -60))).toBeNull();
    });
  });

  it.each([0, 1.6, 3.2, 4.8])('takes a settler standing in front of a house when its body is clicked, and the house over its roof, at yaw %d', (yaw) => {
    const world = setting(yaw, NEAREST);
    expect(applyOrder(world.map, world.orders, { kind: 'placeHouse', x: 32, y: 32 })).toMatchObject({ ok: true });
    const slot = world.orders.siteOf[at(world.map, 32, 32)]!;
    world.orders.sites.state[slot] = SiteState.House;
    const front = { x: 32.5 + 1.9 * Math.sin(yaw), y: 32.5 + 1.9 * Math.cos(yaw) };
    const villagers = [front.x, front.y];
    const house = { kind: 'building', slot, center: at(world.map, 32, 32) };

    expect(pick(world, villagers, screen(world, front.x, GROUND + SETTLER_HEIGHT / 2, front.y))).toEqual({ kind: 'villager', id: 0 });
    expect(pick(world, villagers, screen(world, 32.5, GROUND + 2.5, 32.5))).toEqual(house);
    expect(pick(world, villagers, besideSettler(world, front.x, front.y, 6))).toEqual(house);
  });

  it('takes the camp for a click on the fire between the settlers ringed around it', () => {
    const world = setting(FIRST_YAW, NEAREST, 32, 32);
    const villagers = Array.from({ length: 8 }, (_, id) => {
      const angle = (id / 8) * Math.PI * 2;
      return [32.5 + 1.5 * Math.cos(angle), 32.5 + 1.5 * Math.sin(angle)];
    }).flat();
    expect(pick(world, villagers, screen(world, 32.5, GROUND + 0.3, 32.5))).toEqual({ kind: 'camp' });
    expect(pick(world, villagers, screen(world, 32.5 + CAMP_RADIUS - 0.2, GROUND, 32.5 - CAMP_RADIUS + 0.2))).toEqual({ kind: 'camp' });
    expect(pick(world, villagers, screen(world, 34, GROUND + SETTLER_HEIGHT / 2, 32.5))).toEqual({ kind: 'villager', id: 0 });
  });

  it('takes nothing on bare ground', () => {
    const world = setting(FIRST_YAW, NEAREST);
    expect(pick(world, [6.5, 6.5], { x: WIDTH / 2, y: HEIGHT / 2 })).toBeNull();
  });
});
