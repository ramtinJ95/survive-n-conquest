import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Good } from '../sim/goods';
import { heightAt, type TileMap } from '../sim/map';
import { hashUnit } from '../sim/noise';
import type { Population } from '../sim/sim';
import { VILLAGER_ROWS, VillagerState } from '../sim/villagerState';
import { type Shapes, colored, firewoodShape, foodShape, hideShape, shapeMaterial } from './shapes';

/** Villagers wear a saturated yellow and monsters a deep red, so neither reads as grass, sand, rock, or water from afar. */
export const VILLAGER_COLOR = 0xf2c12e;
export const MONSTER_COLOR = 0x9c1f2b;
const SKIN_COLOR = 0xe8b48c;
const HAIR_COLOR = 0x4a3222;
const BELT_COLOR = 0x6b4a2b;
const TROUSER_COLOR = 0x5a4632;
const HEM_HEIGHT = 0.24;
const BOOT_COLOR = 0x3b2a1e;
/** A clothed settler wears a rawhide hood and a mantle over its shoulders, which leave the lower tunic and its yellow in view. */
const HOOD_COLOR = 0x8a5a3c;
/**
 * A settler is a little over a meter tall, with a large head, so that it reads as a person from the game's camera and
 * a house on its nine tiles stands over it. Heights are in meters above its feet, and sides in meters from its middle.
 */
const HIP_HEIGHT = 0.3;
const LEG_SIDE = 0.09;
const SHOULDER_HEIGHT = 0.66;
const ARM_SIDE = 0.2;
const ARM_LENGTH = 0.46;
const CARRY_HEIGHT = SHOULDER_HEIGHT + ARM_LENGTH;
const SIZE_SPREAD = 0.08;
/** A child is drawn at this share of an adult's size, so the two differ at the game's usual zoom. */
const CHILD_SIZE = 0.6;
/** Radians of a walker's stride and of a worker's swing in one tick, so the motion follows the game's clock. */
const STRIDE = 0.9;
const SWING = 0.8;
const STEP_LIFT = 0.04;
/** The angle of a limb about its joint: 0 hangs down, a negative angle reaches forward, and `HELD_UP` reaches up. */
const HELD_UP = Math.PI;
const ARM_STRIDE = 0.6;
const LEG_STRIDE = 0.55;
/** A worker's arms swing between over its head and down in front of it, and it leans into the stroke. */
const STROKE = { middle: -1.65, reach: 0.95, lean: 0.14 };

function bodyGeometry(): BufferGeometry {
  return mergeGeometries([
    colored(new CylinderGeometry(0.15, 0.23, 0.48, 7).translate(0, HEM_HEIGHT + 0.24, 0), VILLAGER_COLOR),
    colored(new CylinderGeometry(0.2, 0.215, 0.06, 7).translate(0, 0.41, 0), BELT_COLOR),
    colored(new IcosahedronGeometry(0.2, 0).translate(0, 0.9, 0), SKIN_COLOR),
    colored(new IcosahedronGeometry(0.205, 0).rotateY(0.6).translate(0, 0.94, -0.05), HAIR_COLOR),
  ]);
}

function hoodGeometry(): BufferGeometry {
  return mergeGeometries([
    colored(new IcosahedronGeometry(0.235, 0).rotateY(0.6).translate(0, 0.95, -0.06), HOOD_COLOR),
    colored(new CylinderGeometry(0.16, 0.235, 0.12, 7).translate(0, 0.68, 0), HOOD_COLOR),
  ]);
}

function armGeometry(): BufferGeometry {
  const sleeve = ARM_LENGTH - 0.1;
  return mergeGeometries([
    colored(new BoxGeometry(0.1, sleeve, 0.11).translate(0, -sleeve / 2, 0), VILLAGER_COLOR),
    colored(new BoxGeometry(0.09, 0.1, 0.1).translate(0, -sleeve - 0.05, 0), SKIN_COLOR),
  ]);
}

function legGeometry(): BufferGeometry {
  const boot = 0.1;
  return mergeGeometries([
    colored(new BoxGeometry(0.11, HIP_HEIGHT - boot, 0.12).translate(0, -(HIP_HEIGHT - boot) / 2, 0), TROUSER_COLOR),
    colored(new BoxGeometry(0.12, boot, 0.17).translate(0, -HIP_HEIGHT + boot / 2, 0.02), BOOT_COLOR),
  ]);
}

function group(name: string, geometry: BufferGeometry, material: Material, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  return mesh;
}

/** What `show` reads of a frame from the simulation. */
export interface UnitFrame {
  readonly tick: number;
  readonly villagers: Float32Array;
  readonly monsters: Float32Array;
  readonly carried: Uint8Array;
  readonly states: Uint8Array;
  /** One `Good` per villager in id order: what each one wears. */
  readonly worn: Uint8Array;
  /** 1 per villager in id order while it is a child. */
  readonly children: Uint8Array;
}

/**
 * Draws the units standing on the ground, each group as one instanced mesh.
 * A villager is a body, two arms, and two legs: the villager drawn `n`th has
 * the body `n` and the limbs `2 * n` on its right and `2 * n + 1` on its left,
 * so villagers that are not drawn leave no gap. It turns the way it walks,
 * steps and swings its arms against its legs as it goes, swings both arms over
 * its head and down as it works, and holds what it carries up on both hands.
 * At its spot for the night it faces the camp `camp`. Inside its house, and
 * once dead, it is not drawn. The motion follows the tick, so the units hold still while the
 * clock is paused. They take the light of the scene, and they cast and take
 * its shadows.
 */
export function createSwarm(map: TileMap, population: Population, shapes: Shapes, camp: number) {
  const half = map.size / 2;
  const campX = (camp % map.size) + 0.5;
  const campY = Math.floor(camp / map.size) + 0.5;
  const villagers = group('villagers', bodyGeometry(), shapeMaterial(), VILLAGER_ROWS);
  const hoods = group('villager hoods', hoodGeometry(), shapeMaterial(), VILLAGER_ROWS);
  const arms = group('villager arms', armGeometry(), shapeMaterial(), VILLAGER_ROWS * 2);
  const legs = group('villager legs', legGeometry(), shapeMaterial(), VILLAGER_ROWS * 2);
  const monsters = group(
    'monsters',
    new ConeGeometry(0.55, 1.5, 5).translate(0, 0.75, 0),
    new MeshLambertMaterial({ color: MONSTER_COLOR, flatShading: true }),
    population.monsters,
  );
  const carriedLogs = group('carried logs', shapes.log, shapeMaterial(), VILLAGER_ROWS);
  const carriedStone = group('carried stone', shapes.stone, shapeMaterial(), VILLAGER_ROWS);
  const carriedFood = group('carried food', foodShape(), shapeMaterial(), VILLAGER_ROWS);
  const carriedHides = group('carried hides', hideShape(), shapeMaterial(), VILLAGER_ROWS);
  const carriedFirewood = group('carried firewood', firewoodShape(), shapeMaterial(), VILLAGER_ROWS);
  const carriedMeshes = [carriedLogs, carriedStone, carriedFood, carriedHides, carriedFirewood];
  const posed = [villagers, hoods, arms, legs, ...carriedMeshes];
  const held: Readonly<Record<Good, InstancedMesh | null>> = {
    [Good.None]: null,
    [Good.Log]: carriedLogs,
    [Good.Stone]: carriedStone,
    [Good.Food]: carriedFood,
    [Good.Firewood]: carriedFirewood,
    [Good.Hide]: carriedHides,
    [Good.Clothing]: null,
  };

  const sizes = Float32Array.from({ length: VILLAGER_ROWS }, (_, id) => 1 + SIZE_SPREAD * (2 * hashUnit(0x5e77, id, 0) - 1));
  const facing = new Float32Array(VILLAGER_ROWS);
  const last = new Float32Array(VILLAGER_ROWS * 2);
  const walking = new Uint8Array(VILLAGER_ROWS);
  let shown = -1;
  const pose = new Object3D();
  pose.rotation.order = 'YXZ';

  const place = (mesh: InstancedMesh, positions: Float32Array) => {
    const matrices = mesh.instanceMatrix.array;
    const count = positions.length / 2;
    for (let id = 0; id < count; id++) {
      const x = positions[id * 2]!;
      const y = positions[id * 2 + 1]!;
      matrices[id * 16 + 12] = x - half;
      matrices[id * 16 + 13] = heightAt(map, x, y);
      matrices[id * 16 + 14] = y - half;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  };

  const put = (mesh: InstancedMesh, instance: number, x: number, y: number, z: number, lean: number, turn: number, size: number) => {
    pose.position.set(x, y, z);
    pose.rotation.set(lean, turn, 0);
    pose.scale.setScalar(size);
    pose.updateMatrix();
    mesh.setMatrixAt(instance, pose.matrix);
  };

  const act = ({ tick, villagers: positions, carried, states, worn, children }: UnitFrame) => {
    const count = positions.length / 2;
    const stepped = tick !== shown;
    for (const mesh of carriedMeshes) mesh.count = 0;
    hoods.count = 0;
    let drawn = 0;
    for (let id = 0; id < count; id++) {
      const mapX = positions[id * 2]!;
      const mapY = positions[id * 2 + 1]!;
      if (stepped) {
        const dx = mapX - last[id * 2]!;
        const dy = mapY - last[id * 2 + 1]!;
        walking[id] = shown >= 0 && (dx !== 0 || dy !== 0) ? 1 : 0;
        if (walking[id]) facing[id] = Math.atan2(dx, dy);
        else if (shown < 0 || states[id] === VillagerState.Settling) facing[id] = Math.atan2(campX - mapX, campY - mapY);
        last[id * 2] = mapX;
        last[id * 2 + 1] = mapY;
      }
      if (states[id] === VillagerState.Inside || states[id] === VillagerState.Dead) continue;

      const walks = walking[id] === 1;
      const works = states[id] === VillagerState.Working;
      const load = held[carried[id] as Good];
      const size = sizes[id]! * (children[id] === 1 ? CHILD_SIZE : 1);
      const stride = walks ? Math.sin(tick * STRIDE + id) : 0;
      const stroke = works ? Math.cos(tick * SWING + id) : 0;
      const x = mapX - half;
      const z = mapY - half;
      const ground = heightAt(map, mapX, mapY) + Math.abs(stride) * STEP_LIFT;
      const turn = facing[id]!;
      const lean = works ? STROKE.lean * (1 - stroke) : 0;
      const both = load ? HELD_UP : works ? STROKE.middle - STROKE.reach * stroke : null;
      put(villagers, drawn, x, ground, z, lean, turn, size);
      if (worn[id] === Good.Clothing) put(hoods, hoods.count++, x, ground, z, lean, turn, size);
      const forward = Math.sin(lean) * SHOULDER_HEIGHT * size;
      const shoulder = ground + Math.cos(lean) * SHOULDER_HEIGHT * size;
      const acrossX = Math.cos(turn) * size;
      const acrossZ = -Math.sin(turn) * size;
      for (let left = 0; left < 2; left++) {
        const side = left ? 1 : -1;
        const swing = side * stride;
        put(
          arms,
          drawn * 2 + left,
          x + Math.sin(turn) * forward + side * ARM_SIDE * acrossX,
          shoulder,
          z + Math.cos(turn) * forward + side * ARM_SIDE * acrossZ,
          lean + (both ?? ARM_STRIDE * swing),
          turn,
          size,
        );
        put(legs, drawn * 2 + left, x + side * LEG_SIDE * acrossX, ground + HIP_HEIGHT * size, z + side * LEG_SIDE * acrossZ, -LEG_STRIDE * swing, turn, size);
      }
      if (load) put(load, load.count++, x, ground + CARRY_HEIGHT * size, z, 0, turn, 1);
      drawn += 1;
    }
    villagers.count = drawn;
    arms.count = legs.count = drawn * 2;
    for (const mesh of posed) mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    meshes: [villagers, hoods, arms, legs, monsters, ...carriedMeshes],
    /**
     * Moves every unit to its place in a frame from the simulation. A frame that repeats the last tick comes from a
     * command given while the clock is paused: it keeps each villager's gait and can still change what one carries.
     */
    show(frame: UnitFrame) {
      place(monsters, frame.monsters);
      act(frame);
      shown = frame.tick;
    },
  };
}
