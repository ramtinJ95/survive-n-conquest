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
import type { Population } from '../sim/sim';
import { VillagerState } from '../sim/villagers';
import { type Shapes, colored, shapeMaterial } from './shapes';

/** Villagers wear a saturated yellow and monsters a deep red, so neither reads as grass, sand, rock, or water from afar. */
export const VILLAGER_COLOR = 0xf2c12e;
export const MONSTER_COLOR = 0x9c1f2b;
const SKIN_COLOR = 0xe2b08a;
const BOOT_COLOR = 0x4a3626;
const SHOULDER_HEIGHT = 1.05;
const ARM_LENGTH = 0.55;
const CARRY_HEIGHT = SHOULDER_HEIGHT + ARM_LENGTH;
/** Radians of a walker's stride and of a worker's swing in one tick, so the motion follows the game's clock. */
const STRIDE = 0.9;
const SWING = 0.8;
const STEP_LIFT = 0.05;
/** The angle of the arms about the shoulders: 0 hangs down, a negative angle reaches forward, and `HELD_UP` reaches up. */
const HELD_UP = Math.PI;
const ARM_STRIDE = 0.5;
/** A worker's arms swing between over its head and down in front of it, and it leans into the stroke. */
const STROKE = { middle: -1.65, reach: 0.95, lean: 0.14 };

function bodyGeometry(): BufferGeometry {
  return mergeGeometries([
    colored(new CylinderGeometry(0.17, 0.19, 0.4, 6).translate(0, 0.2, 0), BOOT_COLOR),
    colored(new CylinderGeometry(0.2, 0.3, 0.8, 6).translate(0, 0.75, 0), VILLAGER_COLOR),
    colored(new IcosahedronGeometry(0.19, 0).translate(0, 1.31, 0), SKIN_COLOR),
  ]);
}

function armsGeometry(): BufferGeometry {
  const sleeve = ARM_LENGTH - 0.12;
  return mergeGeometries(
    [-0.27, 0.27].flatMap((side) => [
      colored(new BoxGeometry(0.11, sleeve, 0.11).translate(side, -sleeve / 2, 0), VILLAGER_COLOR),
      colored(new BoxGeometry(0.1, 0.12, 0.1).translate(side, -sleeve - 0.06, 0), SKIN_COLOR),
    ]),
  );
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
}

/**
 * Draws the units standing on the ground, each group as one instanced mesh.
 * A villager is a body and a pair of arms. It turns the way it walks, steps
 * and swings its arms as it goes, swings them over its head and down as it
 * works, and holds what it carries up on both hands. At its spot for the night
 * it faces the camp `camp`. The motion follows the
 * tick, so the units hold still while the clock is paused. They take the light
 * of the scene, and they cast and take its shadows.
 */
export function createSwarm(map: TileMap, population: Population, shapes: Shapes, camp: number) {
  const half = map.size / 2;
  const campX = (camp % map.size) + 0.5;
  const campY = Math.floor(camp / map.size) + 0.5;
  const villagers = group('villagers', bodyGeometry(), shapeMaterial(), population.villagers);
  const arms = group('villager arms', armsGeometry(), shapeMaterial(), population.villagers);
  const monsters = group(
    'monsters',
    new ConeGeometry(0.55, 1.5, 5).translate(0, 0.75, 0),
    new MeshLambertMaterial({ color: MONSTER_COLOR, flatShading: true }),
    population.monsters,
  );
  const carriedLogs = group('carried logs', shapes.log, shapeMaterial(), population.villagers);
  const carriedStone = group('carried stone', shapes.stone, shapeMaterial(), population.villagers);
  const carriedMeshes = [carriedLogs, carriedStone];
  const posed = [villagers, arms, ...carriedMeshes];
  const held: Readonly<Record<Good, InstancedMesh | null>> = { [Good.None]: null, [Good.Log]: carriedLogs, [Good.Stone]: carriedStone };

  const facing = new Float32Array(population.villagers);
  const last = new Float32Array(population.villagers * 2);
  const walking = new Uint8Array(population.villagers);
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

  const put = (mesh: InstancedMesh, instance: number, x: number, y: number, z: number, lean: number, turn: number) => {
    pose.position.set(x, y, z);
    pose.rotation.set(lean, turn, 0);
    pose.updateMatrix();
    mesh.setMatrixAt(instance, pose.matrix);
  };

  const act = ({ tick, villagers: positions, carried, states }: UnitFrame) => {
    const count = positions.length / 2;
    const stepped = tick !== shown;
    for (const mesh of carriedMeshes) mesh.count = 0;
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

      const walks = walking[id] === 1;
      const works = states[id] === VillagerState.Working;
      const load = held[carried[id] as Good];
      const stride = walks ? Math.sin(tick * STRIDE + id) : 0;
      const stroke = works ? Math.cos(tick * SWING + id) : 0;
      const x = mapX - half;
      const z = mapY - half;
      const ground = heightAt(map, mapX, mapY) + Math.abs(stride) * STEP_LIFT;
      const turn = facing[id]!;
      const lean = works ? STROKE.lean * (1 - stroke) : 0;
      const reach = load ? HELD_UP : works ? STROKE.middle - STROKE.reach * stroke : ARM_STRIDE * stride;
      put(villagers, id, x, ground, z, lean, turn);
      const forward = Math.sin(lean) * SHOULDER_HEIGHT;
      put(arms, id, x + Math.sin(turn) * forward, ground + Math.cos(lean) * SHOULDER_HEIGHT, z + Math.cos(turn) * forward, lean + reach, turn);
      if (load) put(load, load.count++, x, ground + CARRY_HEIGHT, z, 0, turn);
    }
    villagers.count = arms.count = count;
    for (const mesh of posed) mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    meshes: [villagers, arms, monsters, ...carriedMeshes],
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
