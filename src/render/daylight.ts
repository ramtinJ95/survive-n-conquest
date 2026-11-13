import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MathUtils,
  type PerspectiveCamera,
  type Scene,
  Vector3,
  type Vector4,
} from 'three';
import { sunCourse } from '../sim/daylight';

const { smoothstep } = MathUtils;

/** How high the sun stands at noon in each season, in `SEASONS` order, in radians. */
const NOON_ELEVATION = [54, 66, 46, 28].map(MathUtils.degToRad);
/** The color behind the map in full daylight in each season, in `SEASONS` order. */
const DAY_BACKDROP = [0x9fc9e8, 0x8ec3ee, 0xa9c4d8, 0xbccbd8].map((hex) => new Color(hex));

/**
 * The sun or the moon. Its light grows from nothing on the horizon to
 * `strength` at the height `full`, and turns from `low` to `high` by the
 * height `clear`. The light falls from no lower than `lowest` and no higher
 * than `highest`, so that shadows stay short enough to draw. Heights are
 * sines of the elevation.
 */
interface Body {
  strength: number;
  full: number;
  low: Color;
  high: Color;
  clear: number;
  lowest: number;
  highest: number;
}

const SUN: Body = {
  strength: 2.5,
  full: 0.22,
  low: new Color(0xff8a3d),
  high: new Color(0xfff0d2),
  clear: 0.42,
  lowest: 0.2,
  highest: 1,
};
/** The moon keeps one height all night, so the night is as bright at dusk as at midnight. */
const MOON: Body = {
  strength: 0.7,
  full: 0.07,
  low: new Color(0x9bb8ff),
  high: new Color(0x9bb8ff),
  clear: 1,
  lowest: 0.766,
  highest: 0.766,
};

/** The light that reaches the world from all of the sky when the sun is at `height`, the sine of its elevation. */
interface Ambience {
  height: number;
  backdrop: Color;
  sky: Color;
  ground: Color;
  strength: number;
}

const ambience = (height: number, backdrop: number, sky: number, ground: number, strength: number): Ambience => ({
  height,
  backdrop: new Color(backdrop),
  sky: new Color(sky),
  ground: new Color(ground),
  strength,
});

const NIGHT = ambience(-0.22, 0x0b1126, 0x4f73c9, 0x141c30, 0.6);
const DUSK = ambience(-MOON.full, 0x35325f, 0x8a7fc4, 0x3a3050, 0.95);
const HORIZON = ambience(0, 0xe6a584, 0xffd2b0, 0x7a5846, 1.15);
const GOLDEN_HOUR = ambience(0.12, 0xd4d3da, 0xffecd6, 0x8f7a5e, 1.35);
/** The sun is this high when the day is in full light. */
const DAY_HEIGHT = 0.35;

const SHADOW_MAP_SIZE = 2048;
/** A shadow starts this far behind the surface that casts it, in meters, so that no surface shades itself. */
const SHADOW_BIAS = 0.2;
/** Shadows reach this many times the camera's distance from the point it looks at. */
const SHADOW_REACH = 3;
const SHADOW_MARGIN = 1.1;

function blend(keys: readonly Ambience[], height: number, out: Ambience): void {
  let next = 1;
  while (next < keys.length - 1 && keys[next]!.height < height) next++;
  const from = keys[next - 1]!;
  const to = keys[next]!;
  const share = smoothstep(height, from.height, to.height);
  out.backdrop.lerpColors(from.backdrop, to.backdrop, share);
  out.sky.lerpColors(from.sky, to.sky, share);
  out.ground.lerpColors(from.ground, to.ground, share);
  out.strength = from.strength + (to.strength - from.strength) * share;
}

/**
 * Adds the sky, the sun, and the moon to a scene. The returned function lights
 * the scene for a tick. The sun rises in the east at +x, stands in the south
 * at +z at noon, and sets in the west. One light is the sun by day and the
 * moon by night. The moon is always opposite the sun, and each is dark on the
 * horizon, so the change from one to the other never shows.
 *
 * `seasonMix` holds the weight of each season's look. Shadows are drawn around
 * the ground that `camera` sees near `focus`, the point it looks at. Everything
 * that takes a shadow stands between the heights `lowest` and `highest`.
 */
export function createDaylight(scene: Scene, mapSize: number, lowest: number, highest: number) {
  const backdrop = new Color();
  const fog = new Fog(backdrop, mapSize * 0.8, mapSize * 3.2);
  scene.background = backdrop;
  scene.fog = fog;

  const sky = new HemisphereLight();
  sky.name = 'sky';
  const light = new DirectionalLight();
  light.name = 'sun';
  light.castShadow = true;
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  scene.add(sky, light, light.target);

  const middle = (lowest + highest) / 2;
  /** Seen from the light, a point at any height lies at most this far from the point at the middle height under or over it. */
  const relief = (highest - lowest) / 2;
  const mapRadius = mapSize * Math.SQRT1_2 * 1.05 + relief;
  const lightDistance = 2 * mapRadius;
  const lens = light.shadow.camera;
  lens.near = 1;
  lens.far = 2 * lightDistance;
  light.shadow.bias = -SHADOW_BIAS / (lens.far - lens.near);

  const day = ambience(DAY_HEIGHT, 0, 0xdcecff, 0x8f7f5e, 1.35);
  const keys = [NIGHT, DUSK, HORIZON, GOLDEN_HOUR, day];
  const now: Ambience = { height: 0, backdrop, sky: sky.color, ground: sky.groundColor, strength: 0 };
  const toBody = new Vector3();
  const center = new Vector3();
  const corner = new Vector3();
  const across = new Vector3();
  const upward = new Vector3();
  const seen = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  /** Fits the shadow map to the ground in view, and steps it by whole texels so that shadows hold still. */
  function aimShadows(camera: PerspectiveCamera, focus: Vector3) {
    camera.updateMatrixWorld();
    const reach = SHADOW_REACH * camera.position.distanceTo(focus);
    center.set(0, 0, 0);
    for (let index = 0; index < seen.length; index++) {
      corner.set(index % 2 ? 1 : -1, index < 2 ? 1 : -1, 0.5).unproject(camera).sub(camera.position).normalize();
      const toGround = corner.y < 0 ? (focus.y - camera.position.y) / corner.y : reach;
      const point = seen[index]!.copy(camera.position).addScaledVector(corner, Math.min(toGround, reach));
      center.addScaledVector(point, 1 / seen.length);
    }
    let farthest = 0;
    for (const point of seen) farthest = Math.max(farthest, point.distanceToSquared(center));
    const needed = SHADOW_MARGIN * Math.sqrt(farthest) + relief;
    const halvings = Math.max(Math.floor(2 * Math.log2(mapRadius / needed)), 0);
    const radius = mapRadius / Math.SQRT2 ** halvings;

    center.y = 0;
    const offCenter = center.length();
    if (offCenter > mapRadius - radius) center.multiplyScalar((mapRadius - radius) / offCenter);
    center.y = middle;
    const texel = (2 * radius) / SHADOW_MAP_SIZE;
    across.set(toBody.z, 0, -toBody.x).normalize();
    upward.crossVectors(toBody, across);
    center.addScaledVector(across, -(center.dot(across) % texel));
    center.addScaledVector(upward, -(center.dot(upward) % texel));

    light.target.position.copy(center);
    light.position.copy(center).addScaledVector(toBody, lightDistance);
    lens.left = -radius;
    lens.right = radius;
    lens.top = radius;
    lens.bottom = -radius;
    lens.updateProjectionMatrix();
  }

  return (tick: number, seasonMix: Vector4, camera: PerspectiveCamera, focus: Vector3) => {
    let noon = 0;
    day.backdrop.setRGB(0, 0, 0);
    for (let season = 0; season < NOON_ELEVATION.length; season++) {
      const weight = seasonMix.getComponent(season);
      const color = DAY_BACKDROP[season]!;
      noon += weight * NOON_ELEVATION[season]!;
      day.backdrop.r += weight * color.r;
      day.backdrop.g += weight * color.g;
      day.backdrop.b += weight * color.b;
    }

    const angle = Math.PI * sunCourse(tick);
    const height = Math.sin(angle) * Math.sin(noon);
    const body = height >= 0 ? SUN : MOON;
    const risen = Math.abs(height);
    const lift = MathUtils.clamp(risen, body.lowest, body.highest);
    toBody
      .set(Math.cos(angle), 0, Math.sin(angle) * Math.cos(noon))
      .setLength(Math.sqrt(1 - lift * lift) * Math.sign(height || 1))
      .setY(lift);
    light.intensity = body.strength * smoothstep(risen, 0, body.full);
    light.color.lerpColors(body.low, body.high, smoothstep(risen, 0, body.clear));

    blend(keys, height, now);
    sky.intensity = now.strength;
    fog.color.copy(backdrop);
    aimShadows(camera, focus);
  };
}
