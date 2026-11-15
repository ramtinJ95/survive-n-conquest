import { InstancedMesh, Matrix4, type MeshLambertMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Good } from '../sim/goods';
import { heightAt } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { VillagerState } from '../sim/villagers';
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
const reach = (mesh: InstancedMesh, instance: number, local: Vector3) => local.clone().applyMatrix4(matrixOf(mesh, instance)).sub(placed(mesh, instance));

describe('createSwarm', () => {
  it('draws each group as one instanced mesh that shows nothing before the first frame', () => {
    expect(swarm(3, 2).meshes.map((mesh) => [mesh.name, mesh.constructor, mesh.count])).toEqual([
      ['villagers', InstancedMesh, 0],
      ['villager arms', InstancedMesh, 0],
      ['monsters', InstancedMesh, 0],
      ['carried logs', InstancedMesh, 0],
      ['carried stone', InstancedMesh, 0],
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
    expect(named('villager arms').count).toBe(2);
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

  it('builds each unit with its base on the ground', () => {
    const { named } = swarm(1, 1);
    for (const name of ['villagers', 'monsters']) {
      named(name).geometry.computeBoundingBox();
      const { min, max } = named(name).geometry.boundingBox!;
      expect(min.y).toBeCloseTo(0, 5);
      expect(max.y).toBeGreaterThan(1.2);
    }
  });

  it('holds a carried log or stone above the head of the villager that carries it, on raised arms, and nothing over one that carries none', () => {
    const { named, show } = swarm(3, 0);
    const positions = [10.5, 20.5, 30.5, 30.5, 40.5, 12.5];
    show(frame(0, positions, { carried: Uint8Array.of(Good.Stone, Good.None, Good.Log) }));
    expect([named('carried logs').count, named('carried stone').count]).toEqual([1, 1]);
    named('villagers').geometry.computeBoundingBox();
    const head = named('villagers').geometry.boundingBox!.max.y;
    for (const [name, x, y] of [
      ['carried stone', 10.5, 20.5],
      ['carried logs', 40.5, 12.5],
    ] as const) {
      const position = placed(named(name), 0);
      expect(position.x).toBeCloseTo(x - half, 5);
      expect(position.z).toBeCloseTo(y - half, 5);
      expect(position.y).toBeGreaterThan(heightAt(map, x, y) + head);
    }
    const hand = new Vector3(0, -0.5, 0);
    expect(reach(named('villager arms'), 0, hand).y).toBeCloseTo(0.5, 5);
    expect(reach(named('villager arms'), 1, hand).y).toBeCloseTo(-0.5, 5);

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
    const hand = new Vector3(0, -0.5, 0);
    const states = Uint8Array.of(VillagerState.Working, VillagerState.Waiting);
    const hands = [0, 1, 2, 3, 4, 5, 6, 7].map((tick) => {
      show(frame(tick, [20, 20, 25, 25], { states }));
      return [0, 1].map((id) => reach(named('villager arms'), id, hand).y);
    });
    const working = hands.map(([worker]) => worker!);
    expect(Math.max(...working) - Math.min(...working)).toBeGreaterThan(0.5);
    for (const [, stander] of hands) expect(stander).toBeCloseTo(-0.5, 5);
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
