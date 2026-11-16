import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Building } from '../sim/buildings';
import { CAMP_RADIUS } from '../sim/camp';
import { applyOrder, createOrders, SiteState } from '../sim/orders';
import { at, mapFrom } from '../sim/testMaps';
import { VillagerState } from '../sim/villagerState';
import { CAMP_LAYOUT } from './camp';
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

const pick = (world: Setting, villagers: number[], click: { x: number; y: number }, states: number[] = Array(villagers.length / 2).fill(VillagerState.Walking)) =>
  pickSelection(
    { map: world.map, orders: world.orders, camp: world.camp, villagers: Float32Array.from(villagers), states: Uint8Array.from(states) },
    world.camera,
    click.x,
    click.y,
    WIDTH,
    HEIGHT,
  );

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
    expect(applyOrder(world.map, world.orders, { kind: 'place', building: Building.House, x: 32, y: 32 })).toMatchObject({ ok: true });
    const slot = world.orders.siteOf[at(world.map, 32, 32)]!;
    world.orders.sites.state[slot] = SiteState.Built;
    const front = { x: 32.5 + 1.9 * Math.sin(yaw), y: 32.5 + 1.9 * Math.cos(yaw) };
    const villagers = [front.x, front.y];
    const house = { kind: 'building', slot, anchor: at(world.map, 32, 32) };

    expect(pick(world, villagers, screen(world, front.x, GROUND + SETTLER_HEIGHT / 2, front.y))).toEqual({ kind: 'villager', id: 0 });
    expect(pick(world, villagers, screen(world, 32.5, GROUND + 2.5, 32.5))).toEqual(house);
    expect(pick(world, villagers, besideSettler(world, front.x, front.y, 6))).toEqual(house);
  });

  it.each([0, 1.6, 3.2, 4.8])('takes the house, not a settler hidden behind its walls, at yaw %d', (yaw) => {
    const world = setting(yaw, NEAREST);
    expect(applyOrder(world.map, world.orders, { kind: 'place', building: Building.House, x: 32, y: 32 })).toMatchObject({ ok: true });
    const slot = world.orders.siteOf[at(world.map, 32, 32)]!;
    world.orders.sites.state[slot] = SiteState.Built;
    const behind = { x: 32.5 - 1.9 * Math.sin(yaw), y: 32.5 - 1.9 * Math.cos(yaw) };
    const house = { kind: 'building', slot, anchor: at(world.map, 32, 32) };

    expect(pick(world, [behind.x, behind.y], screen(world, behind.x, GROUND + SETTLER_HEIGHT / 2, behind.y))).toEqual(house);
  });

  it.each([0, 1.6, 3.2, 4.8])('takes the house or the ground where a settler went inside or died, never the settler, at yaw %d', (yaw) => {
    const world = setting(yaw, NEAREST);
    expect(applyOrder(world.map, world.orders, { kind: 'place', building: Building.House, x: 32, y: 32 })).toMatchObject({ ok: true });
    const slot = world.orders.siteOf[at(world.map, 32, 32)]!;
    world.orders.sites.state[slot] = SiteState.Built;
    const door = { x: 32.5 + 2 * Math.sin(yaw), y: 32.5 + 2 * Math.cos(yaw) };
    const villagers = [door.x, door.y, 12.5, 50.5, 50.5, 12.5];
    const { Walking, Inside, Dead } = VillagerState;
    const body = screen(world, door.x, GROUND + SETTLER_HEIGHT / 2, door.y);

    expect(pick(world, villagers, body, [Walking, Walking, Walking])).toEqual({ kind: 'villager', id: 0 });
    expect(pick(world, villagers, body, [Inside, Walking, Walking])).toEqual({ kind: 'building', slot, anchor: at(world.map, 32, 32) });
    expect(pick(world, villagers, screen(world, 12.5, GROUND + SETTLER_HEIGHT / 2, 50.5), [Walking, Inside, Walking])).toBeNull();
    expect(pick(world, villagers, body, [Dead, Walking, Walking])).toEqual({ kind: 'building', slot, anchor: at(world.map, 32, 32) });
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

  it('takes the camp for a click on the outer side of each tent, beyond the ground the camp keeps free of orders', () => {
    const world = setting(FIRST_YAW, NEAREST, 32, 32);
    for (const { shape, x, z } of CAMP_LAYOUT.filter((placed) => placed.shape === 'tent')) {
      const out = Math.hypot(x, z);
      const reach = out + 0.6;
      expect(reach).toBeGreaterThan(CAMP_RADIUS);
      const click = screen(world, 32.5 + (x / out) * reach, GROUND + 0.2, 32.5 + (z / out) * reach);
      expect(pick(world, [], click), shape).toEqual({ kind: 'camp' });
    }
  });

  it.each([0, 1.6, 3.2, 4.8])("takes a forager's hut over its own 2 by 2 tiles from their top left, and the ground on the near side of them, at yaw %d", (yaw) => {
    const world = setting(yaw, NEAREST);
    expect(applyOrder(world.map, world.orders, { kind: 'place', building: Building.Hut, x: 31, y: 31 })).toMatchObject({ ok: true });
    const slot = world.orders.siteOf[at(world.map, 31, 31)]!;
    const hut = { kind: 'building', slot, anchor: at(world.map, 31, 31) };
    for (const [x, y] of [[31.1, 31.1], [32.9, 31.1], [31.1, 32.9], [32.9, 32.9], [32, 32]]) {
      expect(pick(world, [], screen(world, x!, GROUND, y!)), `${x}, ${y}`).toEqual(hut);
    }
    const near = { x: 32 + 1.6 * Math.sin(yaw), y: 32 + 1.6 * Math.cos(yaw) };
    expect(pick(world, [], screen(world, near.x, GROUND, near.y))).toBeNull();
  });

  it('takes nothing on bare ground', () => {
    const world = setting(FIRST_YAW, NEAREST);
    expect(pick(world, [6.5, 6.5], { x: WIDTH / 2, y: HEIGHT / 2 })).toBeNull();
  });
});
