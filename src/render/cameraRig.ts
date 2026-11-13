import { PerspectiveCamera, Vector3 } from 'three';

export interface CameraLimits {
  /** The look-at point stays within this distance of the origin on both ground axes. */
  reach: number;
  minDistance: number;
  maxDistance: number;
  /** The camera stays this far above the ground under it, in meters. */
  clearance: number;
}

/** Signed rates for the motions that a held key drives, each from -1 to 1. */
export interface CameraDrive {
  forward: number;
  right: number;
  turn: number;
  tilt: number;
  zoom: number;
}

const MIN_PITCH = 0.45;
const MAX_PITCH = 1.38;
const PAN_SPEED = 0.9;
const TURN_SPEED = 1.5;
const TILT_SPEED = 0.9;
const ZOOM_SPEED = 1.3;
/** How fast the view closes on the place the player sent it, per second. */
const EASE = 9;
const SETTLED = 1e-3;
const FIRST_VIEW = { yaw: 0.55, pitch: 0.68, distance: 120 };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface Orbit {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
}

/**
 * A camera that orbits a point on the ground. The player moves the point, turns
 * and tilts around it, and zooms toward it. The point never leaves the map and
 * the camera never sinks below the ground.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(45, 1, 0.5, 1500);
  /** The point on the ground that the camera looks at. */
  readonly target = new Vector3();
  readonly drive: CameraDrive = { forward: 0, right: 0, turn: 0, tilt: 0, zoom: 0 };

  private readonly goal: Orbit;
  private readonly orbit: Orbit;

  constructor(
    private readonly groundAt: (x: number, z: number) => number,
    private readonly limits: CameraLimits,
  ) {
    const distance = clamp(FIRST_VIEW.distance, limits.minDistance, limits.maxDistance);
    this.goal = { x: 0, z: 0, yaw: FIRST_VIEW.yaw, pitch: FIRST_VIEW.pitch, distance };
    this.orbit = { ...this.goal };
    this.place();
  }

  /** Moves the look-at point over the ground, in meters along the camera's right and forward. */
  pan(right: number, forward: number): void {
    const sin = Math.sin(this.goal.yaw);
    const cos = Math.cos(this.goal.yaw);
    const { reach } = this.limits;
    this.goal.x = clamp(this.goal.x + right * cos - forward * sin, -reach, reach);
    this.goal.z = clamp(this.goal.z - right * sin - forward * cos, -reach, reach);
  }

  /** Turns around the look-at point and tilts toward or away from the ground, in radians. */
  rotate(turn: number, tilt: number): void {
    this.goal.yaw += turn;
    this.goal.pitch = clamp(this.goal.pitch + tilt, MIN_PITCH, MAX_PITCH);
  }

  /** Scales the distance to the look-at point. A factor below 1 zooms in. */
  zoom(factor: number): void {
    const { minDistance, maxDistance } = this.limits;
    this.goal.distance = clamp(this.goal.distance * factor, minDistance, maxDistance);
  }

  /** Meters of ground that one pixel covers at the look-at point, across and into the screen. */
  groundPerPixel(viewportHeight: number): { across: number; into: number } {
    const across =
      (2 * this.orbit.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportHeight;
    return { across, into: across / Math.sin(this.orbit.pitch) };
  }

  /** Advances the view by `seconds`: applies the held drive, then eases toward the goal. */
  update(seconds: number): void {
    const { drive, goal, orbit } = this;
    const step = goal.distance * PAN_SPEED * seconds;
    this.pan(drive.right * step, drive.forward * step);
    this.rotate(drive.turn * TURN_SPEED * seconds, drive.tilt * TILT_SPEED * seconds);
    this.zoom(Math.exp(-drive.zoom * ZOOM_SPEED * seconds));

    const closing = 1 - Math.exp(-EASE * seconds);
    for (const key of ['x', 'z', 'yaw', 'pitch', 'distance'] as const) {
      const gap = goal[key] - orbit[key];
      orbit[key] = Math.abs(gap) < SETTLED ? goal[key] : orbit[key] + gap * closing;
    }
    this.place();
  }

  private place(): void {
    const { orbit, target, camera } = this;
    target.set(orbit.x, this.groundAt(orbit.x, orbit.z), orbit.z);
    const flat = orbit.distance * Math.cos(orbit.pitch);
    const x = target.x + flat * Math.sin(orbit.yaw);
    const z = target.z + flat * Math.cos(orbit.yaw);
    const y = target.y + orbit.distance * Math.sin(orbit.pitch);
    camera.position.set(x, Math.max(y, this.groundAt(x, z) + this.limits.clearance), z);
    camera.lookAt(target);
  }
}
