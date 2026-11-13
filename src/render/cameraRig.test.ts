import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, type CameraDrive } from './cameraRig';

const LIMITS = { reach: 100, minDistance: 16, maxDistance: 240, clearance: 2 };
const FRAME = 1 / 60;
const flat = () => 0;
const hills = (x: number, z: number) => 30 + 25 * Math.sin(x / 9) * Math.cos(z / 7);

function hold(rig: CameraRig, drive: Partial<CameraDrive>, seconds: number, each?: () => void): void {
  Object.assign(rig.drive, drive);
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) {
    rig.update(FRAME);
    each?.();
  }
  for (const axis of Object.keys(drive) as (keyof CameraDrive)[]) rig.drive[axis] = 0;
}

const settle = (rig: CameraRig) => hold(rig, {}, 3);
const distance = (rig: CameraRig) => rig.camera.position.distanceTo(rig.target);
const heading = (rig: CameraRig) => rig.camera.getWorldDirection(new Vector3());

describe('CameraRig', () => {
  it('pans the look-at point along the view while a pan key is held', () => {
    const rig = new CameraRig(flat, LIMITS);
    const start = rig.target.clone();
    const ahead = heading(rig).setY(0).normalize();
    hold(rig, { forward: 1 }, 0.5);
    const moved = rig.target.clone().sub(start);
    expect(moved.length()).toBeGreaterThan(5);
    expect(moved.normalize().dot(ahead)).toBeCloseTo(1, 3);
  });

  it('pans sideways without turning', () => {
    const rig = new CameraRig(flat, LIMITS);
    const start = rig.target.clone();
    const before = heading(rig);
    hold(rig, { right: 1 }, 0.5);
    settle(rig);
    const moved = rig.target.clone().sub(start);
    expect(moved.length()).toBeGreaterThan(5);
    expect(moved.dot(before.clone().setY(0))).toBeCloseTo(0, 3);
    expect(heading(rig).distanceTo(before)).toBeLessThan(1e-6);
  });

  it.each([
    { forward: 1 },
    { forward: -1 },
    { right: 1 },
    { right: -1 },
    { forward: 1, right: 1 },
  ])('keeps the look-at point on the map however long %o is held', (drive) => {
    const rig = new CameraRig(flat, LIMITS);
    hold(rig, drive, 60, () => {
      expect(Math.abs(rig.target.x)).toBeLessThanOrEqual(LIMITS.reach);
      expect(Math.abs(rig.target.z)).toBeLessThanOrEqual(LIMITS.reach);
    });
    expect(Math.max(Math.abs(rig.target.x), Math.abs(rig.target.z))).toBe(LIMITS.reach);
  });

  it('keeps a drag on the map too', () => {
    const rig = new CameraRig(flat, LIMITS);
    rig.pan(-5000, 9000);
    settle(rig);
    expect(Math.abs(rig.target.x)).toBe(LIMITS.reach);
    expect(Math.abs(rig.target.z)).toBe(LIMITS.reach);
  });

  it('turns around the look-at point', () => {
    const rig = new CameraRig(flat, LIMITS);
    const before = heading(rig);
    const target = rig.target.clone();
    const range = distance(rig);
    hold(rig, { turn: 1 }, 1);
    settle(rig);
    expect(heading(rig).angleTo(before)).toBeGreaterThan(0.5);
    expect(rig.target.distanceTo(target)).toBeLessThan(1e-6);
    expect(distance(rig)).toBeCloseTo(range, 3);
  });

  it('zooms in and out between its nearest and farthest views', () => {
    const rig = new CameraRig(flat, LIMITS);
    const start = distance(rig);
    hold(rig, { zoom: 1 }, 0.3);
    expect(distance(rig)).toBeLessThan(start);
    hold(rig, { zoom: 1 }, 30);
    settle(rig);
    expect(distance(rig)).toBeCloseTo(LIMITS.minDistance, 3);
    hold(rig, { zoom: -1 }, 30);
    settle(rig);
    expect(distance(rig)).toBeCloseTo(LIMITS.maxDistance, 3);
    rig.zoom(1e9);
    settle(rig);
    expect(distance(rig)).toBeCloseTo(LIMITS.maxDistance, 3);
  });

  it('never tilts flat along the ground or past straight down', () => {
    const rig = new CameraRig(flat, LIMITS);
    hold(rig, { tilt: -1 }, 30);
    settle(rig);
    expect(heading(rig).y).toBeLessThan(-0.3);
    hold(rig, { tilt: 1 }, 30);
    settle(rig);
    expect(heading(rig).y).toBeGreaterThan(-1);
    expect(heading(rig).y).toBeLessThan(-0.9);
  });

  it('stays above the ground while it flies low over hills', () => {
    const rig = new CameraRig(hills, LIMITS);
    const above = () => {
      const { x, y, z } = rig.camera.position;
      expect(y).toBeGreaterThanOrEqual(hills(x, z) + LIMITS.clearance);
    };
    hold(rig, { zoom: 1, tilt: -1 }, 10, above);
    for (const drive of [{ forward: 1 }, { right: -1, turn: 1 }, { forward: -1, right: 1, turn: -1 }]) {
      hold(rig, drive, 20, above);
    }
    hold(rig, { zoom: -1 }, 10, above);
  });

  it('comes to rest after the player lets go', () => {
    const rig = new CameraRig(hills, LIMITS);
    hold(rig, { forward: 1, turn: 1, zoom: 1 }, 1);
    settle(rig);
    const position = rig.camera.position.clone();
    const quaternion = rig.camera.quaternion.clone();
    hold(rig, {}, 1);
    expect(rig.camera.position.equals(position)).toBe(true);
    expect(rig.camera.quaternion.equals(quaternion)).toBe(true);
  });
});
