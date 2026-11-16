import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PointLight,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TICKS_PER_DAY } from '../sim/calendar';
import { heightAt, type TileMap } from '../sim/map';
import { WIND, daily } from './seasonal';
import { type ShapeName, type Shapes, colored, shapeMaterial } from './shapes';

interface Placed {
  readonly shape: ShapeName;
  readonly x: number;
  readonly z: number;
  readonly turn: number;
  readonly lift?: number;
  readonly cloth?: number;
}

const around = (shape: ShapeName, angle: number, reach: number, turn = -angle, rest: Partial<Placed> = {}): Placed => ({
  shape,
  x: Math.cos(angle) * reach,
  z: Math.sin(angle) * reach,
  turn,
  ...rest,
});

/**
 * The fire burns where the settlers gather for the night. Each tent stands
 * behind a gap between two of their spots, door to the fire, and the stores
 * stand behind another gap. Each stands with its center on a tile that the
 * camp keeps free of orders, as `underCamp` says. No cloth is yellow, orange,
 * or red, the colors of the settlers, the fire, and the monsters.
 */
export const CAMP_LAYOUT: readonly Placed[] = [
  { shape: 'fire', x: 0, z: 0, turn: 0 },
  { shape: 'pot', x: 0, z: 0, turn: 0.6 },
  around('tent', 1.38, 1.9, -1.38, { cloth: 0xf1e6cc }),
  around('tent', 3.77, 1.9, -3.77, { cloth: 0x7f9dbd }),
  around('tent', 5.25, 1.9, -5.25, { cloth: 0xd9c7a3 }),
  around('barrel', 2.74, 2.15, 0.4),
  around('crate', 3.0, 2.2, 0.3),
  around('crate', 3.0, 2.2, 0.9, { lift: 0.26 }),
];

/** A face of a model is cloth when its color is this pale and this close to grey: the packs' tents are undyed canvas. */
const CLOTH = { palest: 0.15, greyest: 0.25 };

function dyed(shape: BufferGeometry, hex: number): BufferGeometry {
  const copy = shape.clone();
  const colors = copy.getAttribute('color');
  const dye = new Color(hex);
  for (let corner = 0; corner < colors.count; corner++) {
    const most = Math.max(colors.getX(corner), colors.getY(corner), colors.getZ(corner));
    const least = Math.min(colors.getX(corner), colors.getY(corner), colors.getZ(corner));
    if (most > CLOTH.palest && most - least < CLOTH.greyest * most) colors.setXYZ(corner, dye.r, dye.g, dye.b);
  }
  return copy;
}

/** The flame is the one thing in the settlement that the sun does not light, so the camp shows in the dark. */
const FLAME = { outer: 0xff7a1a, inner: 0xffd35a, radius: 0.24, height: 0.62, base: 0.1, flicker: daily(0.9), turn: daily(0.35), sway: 0.18 };

const FIRELIGHT = { color: 0xff9a4d, day: 0.2, night: 11, height: 0.75, reach: 15, waver: 0.1, flutter: daily(2.3) };

/** A puff lives a whole share of the day, so the smoke repeats at the same time every day. */
const SMOKE = { puffs: 9, livesPerDay: 43, rise: 3.6, drift: 1.5, color: 0xc4beb6, opacity: 0.42, size: 0.17 };

function flameGeometry() {
  const { outer, inner, radius, height } = FLAME;
  return mergeGeometries([
    colored(new ConeGeometry(radius, height, 5).translate(0, height / 2, 0), outer),
    colored(new ConeGeometry(radius * 0.55, height * 0.7, 5).translate(0, height * 0.35 + 0.02, radius * 0.5), inner),
    colored(new ConeGeometry(radius * 0.55, height * 0.7, 5).translate(0, height * 0.35 + 0.02, -radius * 0.5), inner),
  ]);
}

/**
 * `show` moves the flame, the light, and the smoke with `time`, the time of
 * day in ticks, so they hold still while the clock is paused. `dark` is 0 in
 * full daylight and 1 at night.
 */
export function createCamp(map: TileMap, tile: number, shapes: Shapes) {
  const x = (tile % map.size) + 0.5;
  const y = Math.floor(tile / map.size) + 0.5;
  const ground = heightAt(map, x, y);
  const placed = new Matrix4();
  const camp = new Mesh(
    mergeGeometries(
      CAMP_LAYOUT.map(({ shape, x: east, z: south, turn, lift = 0, cloth }) =>
        (cloth === undefined ? shapes[shape].clone() : dyed(shapes[shape], cloth))
          .applyMatrix4(placed.makeRotationY(turn).setPosition(east, heightAt(map, x + east, y + south) - ground + lift, south)),
      ),
    ),
    shapeMaterial(),
  );
  camp.name = 'camp';
  camp.position.set(x - map.size / 2, ground, y - map.size / 2);
  camp.castShadow = true;
  camp.receiveShadow = true;

  const flame = new Mesh(flameGeometry(), new MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  flame.name = 'flame';
  flame.position.set(0, FLAME.base, 0);
  const light = new PointLight(FIRELIGHT.color, FIRELIGHT.day, FIRELIGHT.reach);
  light.name = 'firelight';
  light.position.set(0, FIRELIGHT.height, 0);
  const smoke = new InstancedMesh(
    new IcosahedronGeometry(SMOKE.size, 0),
    new MeshLambertMaterial({ color: SMOKE.color, flatShading: true, transparent: true, opacity: SMOKE.opacity, depthWrite: false }),
    SMOKE.puffs,
  );
  smoke.name = 'smoke';
  smoke.frustumCulled = false;
  smoke.instanceMatrix.setUsage(DynamicDrawUsage);
  camp.add(flame, light, smoke);

  const puff = new Object3D();
  const show = (time: number, dark: number) => {
    const beat = Math.sin(time * FLAME.flicker);
    flame.scale.set(1 - 0.5 * FLAME.sway * beat, 1 + FLAME.sway * beat, 1 - 0.5 * FLAME.sway * beat);
    flame.rotation.y = time * FLAME.turn;
    light.intensity =
      (FIRELIGHT.day + (FIRELIGHT.night - FIRELIGHT.day) * dark) * (1 + FIRELIGHT.waver * (0.6 * beat + 0.4 * Math.sin(time * FIRELIGHT.flutter + 1)));
    for (let i = 0; i < SMOKE.puffs; i++) {
      const age = ((((time * SMOKE.livesPerDay) / TICKS_PER_DAY + i / SMOKE.puffs) % 1) + 1) % 1;
      const out = SMOKE.drift * age * age;
      puff.position.set(WIND.x * out + 0.1 * Math.sin(i * 2.4 + age * 5), FLAME.base + FLAME.height + SMOKE.rise * age, WIND.z * out + 0.1 * Math.cos(i * 1.7 + age * 4));
      puff.rotation.set(i, age * 2 + i, 0);
      puff.scale.setScalar((0.6 + 2.2 * age) * MathUtils.smoothstep(age, 0, 0.1) * (1 - MathUtils.smoothstep(age, 0.65, 1)));
      puff.updateMatrix();
      smoke.setMatrixAt(i, puff.matrix);
    }
    smoke.instanceMatrix.needsUpdate = true;
  };
  show(0, 0);

  return { mesh: camp, show };
}
