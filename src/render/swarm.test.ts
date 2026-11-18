import { InstancedMesh, Matrix4, type MeshLambertMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Good } from '../sim/goods';
import { heightAt } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { VillagerState } from '../sim/villagerState';
import { primitiveShapes } from './shapes';
import { type UnitFrame, createSwarm } from './swarm';

const SIZE = 64;
const map = generateMap(7, SIZE);
const CAMP = 32 * SIZE + 32;
const half = SIZE / 2;

const swarm = (villagers: number, monsters: number) => {
  const { meshes, show } = createSwarm(map, { villagers, monsters }, primitiveShapes(), CAMP);
  const named = (name: string) => meshes.find((mesh) => mesh.name === name)!;
  return { meshes, show, named };
};

const frame = (tick: number, villagers: number[], rest: Partial<UnitFrame> = {}): UnitFrame => ({
  tick,
  villagers: Float32Array.from(villagers),
  monsters: new Float32Array(0),
  carried: new Uint8Array(villagers.length / 2),
  states: new Uint8Array(villagers.length / 2),
  ...rest,
});

function matrixOf(mesh: InstancedMesh, instance: number): Matrix4 {
  const matrix = new Matrix4();
  mesh.getMatrixAt(instance, matrix);
  return matrix;
}

const placed = (mesh: InstancedMesh, instance: number) => new Vector3().setFromMatrixPosition(matrixOf(mesh, instance));
/** The direction, in the world, that an instance turns a direction of its shape to. Villagers differ in size, so the length says nothing. */
const reach = (mesh: InstancedMesh, instance: number, local: Vector3) =>
  local.clone().applyMatrix4(matrixOf(mesh, instance)).sub(placed(mesh, instance)).normalize();
const sizeOf = (mesh: InstancedMesh, instance: number) => new Vector3().setFromMatrixScale(matrixOf(mesh, instance)).y;
const limbs = (id: number) => [id * 2, id * 2 + 1];
const DOWN = new Vector3(0, -1, 0);

describe('createSwarm', () => {
  it('draws each group as one instanced mesh that shows nothing before the first frame', () => {
    expect(swarm(3, 2).meshes.map((mesh) => [mesh.name, mesh.constructor, mesh.count])).toEqual([
      ['villagers', InstancedMesh, 0],
      ['villager arms', InstancedMesh, 0],
      ['villager legs', InstancedMesh, 0],
      ['monsters', InstancedMesh, 0],
      ['carried logs', InstancedMesh, 0],
      ['carried stone', InstancedMesh, 0],
      ['carried food', InstancedMesh, 0],
      ['carried hides', InstancedMesh, 0],
      ['carried firewood', InstancedMesh, 0],
    ]);
  });

  it('lets the light of the world fall on the units, with no glow of their own', () => {
    for (const mesh of swarm(1, 1).meshes) {
      expect([mesh.castShadow, mesh.receiveShadow], mesh.name).toEqual([true, true]);
      expect((mesh.material as MeshLambertMaterial).emissive?.getHex(), mesh.name).toBe(0);
    }
  });

  it('stands every unit on the ground at its map position', () => {
    const { named, show } = swarm(2, 1);
    show(frame(0, [10.5, 20.25, 40, 3.75], { monsters: Float32Array.of(32, 32) }));
    expect(named('villagers').count).toBe(2);
    expect([named('villager arms').count, named('villager legs').count]).toEqual([4, 4]);
    expect(named('monsters').count).toBe(1);
    for (const [name, instance, x, y] of [
      ['villagers', 0, 10.5, 20.25],
      ['villagers', 1, 40, 3.75],
      ['monsters', 0, 32, 32],
    ] as const) {
      const position = placed(named(name), instance);
      expect(position.x).toBeCloseTo(x - half, 5);
      expect(position.z).toBeCloseTo(y - half, 5);
      expect(position.y).toBeCloseTo(heightAt(map, x, y), 5);
    }
  });

  it('stands a monster on its base and a villager on its two feet, its head a meter up', () => {
    const { named, show } = swarm(1, 1);
    show(frame(0, [10.5, 20.25]));
    const ground = heightAt(map, 10.5, 20.25);
    const ends = (name: string) => {
      named(name).geometry.computeBoundingBox();
      return named(name).geometry.boundingBox!;
    };
    expect(ends('monsters').min.y).toBeCloseTo(0, 5);
    for (const leg of limbs(0)) {
      const foot = new Vector3(0, ends('villager legs').min.y, 0).applyMatrix4(matrixOf(named('villager legs'), leg));
      expect(foot.y).toBeCloseTo(ground, 5);
      expect(Math.hypot(foot.x - (10.5 - half), foot.z - (20.25 - half))).toBeGreaterThan(0.05);
    }
    expect(ends('villagers').min.y).toBeLessThan(-ends('villager legs').min.y);
    const head = ends('villagers').max.y * sizeOf(named('villagers'), 0);
    expect(head).toBeGreaterThan(0.95);
    expect(head).toBeLessThan(1.25);
  });

  it('holds a carried log or stone above the head of the villager that carries it, on raised arms, and nothing over one that carries none', () => {
    const { named, show } = swarm(3, 0);
    const positions = [10.5, 20.5, 30.5, 30.5, 40.5, 12.5];
    show(frame(0, positions, { carried: Uint8Array.of(Good.Stone, Good.None, Good.Log) }));
    expect([named('carried logs').count, named('carried stone').count]).toEqual([1, 1]);
    named('villagers').geometry.computeBoundingBox();
    const head = named('villagers').geometry.boundingBox!.max.y;
    for (const [name, id, x, y] of [
      ['carried stone', 0, 10.5, 20.5],
      ['carried logs', 2, 40.5, 12.5],
    ] as const) {
      const position = placed(named(name), 0);
      expect(position.x).toBeCloseTo(x - half, 5);
      expect(position.z).toBeCloseTo(y - half, 5);
      expect(position.y).toBeGreaterThan(heightAt(map, x, y) + head * sizeOf(named('villagers'), id));
    }
    for (const arm of limbs(0)) expect(reach(named('villager arms'), arm, DOWN).y).toBeCloseTo(1, 5);
    for (const arm of limbs(1)) expect(reach(named('villager arms'), arm, DOWN).y).toBeCloseTo(-1, 5);

    show(frame(1, positions));
    expect([named('carried logs').count, named('carried stone').count]).toEqual([0, 0]);
  });

  it('turns a villager the way it walks, and keeps it turned that way once it stands', () => {
    const { named, show } = swarm(1, 0);
    const ahead = new Vector3(0, 0, 1);
    show(frame(0, [20, 20]));
    show(frame(1, [20.15, 20]));
    expect(reach(named('villagers'), 0, ahead).x).toBeCloseTo(1, 5);
    show(frame(2, [20.15, 20.15]));
    expect(reach(named('villagers'), 0, ahead).z).toBeCloseTo(1, 5);
    show(frame(3, [20.15, 20.15]));
    expect(reach(named('villagers'), 0, ahead).z).toBeCloseTo(1, 5);
  });

  it('swings the arms of a villager that works, and holds still the arms of one that stands', () => {
    const { named, show } = swarm(2, 0);
    const states = Uint8Array.of(VillagerState.Working, VillagerState.Waiting);
    const hands = [0, 1, 2, 3, 4, 5, 6, 7].map((tick) => {
      show(frame(tick, [20, 20, 25, 25], { states }));
      return [0, 1, 2, 3].map((arm) => reach(named('villager arms'), arm, DOWN).y);
    });
    const working = hands.map(([right]) => right!);
    expect(Math.max(...working) - Math.min(...working)).toBeGreaterThan(1);
    for (const [right, left, ...standing] of hands) {
      expect(left).toBeCloseTo(right!, 5);
      for (const arm of standing) expect(arm).toBeCloseTo(-1, 5);
    }
  });

  it('swings the arms of a walker against each other and against its legs, and stands a villager that stops on straight legs', () => {
    const { named, show } = swarm(1, 0);
    const ahead = new Vector3(0, 0, 1);
    const forward = (name: string) => limbs(0).map((limb) => reach(named(name), limb, DOWN).dot(ahead));
    show(frame(0, [20, 20]));
    let swung = 0;
    for (let tick = 1; tick <= 8; tick++) {
      show(frame(tick, [20, 20 + tick * 0.1]));
      const [leftArm, rightArm] = forward('villager arms');
      const [leftLeg, rightLeg] = forward('villager legs');
      expect(leftArm).toBeCloseTo(-rightArm!, 5);
      expect(leftLeg).toBeCloseTo(-rightLeg!, 5);
      expect(leftArm! * leftLeg!).toBeLessThanOrEqual(0);
      swung = Math.max(swung, Math.abs(leftLeg!));
    }
    expect(swung).toBeGreaterThan(0.3);
    show(frame(9, [20, 20.8]));
    for (const name of ['villager arms', 'villager legs']) {
      for (const limb of limbs(0)) expect(reach(named(name), limb, DOWN).y).toBeCloseTo(-1, 5);
    }
  });

  it('holds a walker in its stride for a frame that repeats the last tick, so a paused game holds still', () => {
    const { named, show } = swarm(1, 0);
    show(frame(4, [20, 20]));
    show(frame(5, [20, 20.5]));
    const body = matrixOf(named('villagers'), 0);
    const arms = matrixOf(named('villager arms'), 0);
    show(frame(5, [20, 20.5]));
    expect(matrixOf(named('villagers'), 0)).toEqual(body);
    expect(matrixOf(named('villager arms'), 0)).toEqual(arms);
  });

  it('takes the load off a villager that a command made drop it while the game is paused', () => {
    const { named, show } = swarm(1, 0);
    show(frame(4, [20, 20]));
    show(frame(5, [20, 20.5], { carried: Uint8Array.of(Good.Log) }));
    expect(named('carried logs').count).toBe(1);
    show(frame(5, [20, 20.5]));
    expect(named('carried logs').count).toBe(0);
    expect(reach(named('villager arms'), 0, new Vector3(0, -1, 0)).y).toBeLessThan(0);
  });

  it('draws no villager that is inside its house or dead, and leaves no gap among the others', () => {
    const { named, show } = swarm(3, 0);
    const positions = [10.5, 20.5, 30.5, 30.5, 40.5, 12.5];
    const inside = Uint8Array.of(VillagerState.Inside, VillagerState.Idle, VillagerState.Dead);
    show(frame(0, positions, { states: inside, carried: Uint8Array.of(Good.None, Good.Log, Good.Food) }));
    expect([named('villagers').count, named('villager arms').count, named('villager legs').count]).toEqual([1, 2, 2]);
    expect(named('carried logs').count).toBe(1);
    expect(named('carried food').count).toBe(0);
    const body = placed(named('villagers'), 0);
    expect([body.x, body.z]).toEqual([30.5 - half, 30.5 - half]);
    for (const name of ['villager arms', 'villager legs']) {
      for (const limb of limbs(0)) {
        const at = placed(named(name), limb);
        expect(Math.hypot(at.x - body.x, at.z - body.z), `${name} ${limb}`).toBeLessThan(0.5);
      }
    }

    show(frame(1, positions));
    expect([named('villagers').count, named('villager arms').count, named('villager legs').count]).toEqual([3, 6, 6]);
    expect([placed(named('villagers'), 2).x, placed(named('villagers'), 2).z]).toEqual([40.5 - half, 12.5 - half]);
  });

  it('faces a villager at its spot for the night toward the camp', () => {
    const { named, show } = swarm(1, 0);
    const states = Uint8Array.of(VillagerState.Settling);
    const ahead = new Vector3(0, 0, 1);
    show(frame(0, [31, 31.5]));
    show(frame(1, [31, 32.5], { states }));
    expect(reach(named('villagers'), 0, ahead).z).toBeCloseTo(1, 5);
    show(frame(2, [31, 32.5], { states }));
    expect(reach(named('villagers'), 0, ahead).x).toBeCloseTo(1, 5);
  });
});
