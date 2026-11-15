import { type BufferAttribute, type InstancedMesh, Matrix4, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TileKind, type TileMap } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { Good } from '../sim/goods';
import { SETTLERS, createSim } from '../sim/sim';
import { changeTile, noteTileChange, takeTileChanges } from '../sim/tileChanges';
import { SEASON_COLORS } from './seasonal';
import { primitiveShapes } from './shapes';
import { createWorld as createWorldFrom } from './world';

const createWorld = (map: TileMap) => createWorldFrom(map, primitiveShapes());

const SIZE = 64;

function tileOf(mesh: InstancedMesh, instance: number): number {
  const matrix = new Matrix4();
  mesh.getMatrixAt(instance, matrix);
  const { x, z } = new Vector3().setFromMatrixPosition(matrix);
  return Math.floor(z + SIZE / 2) * SIZE + Math.floor(x + SIZE / 2);
}

function groundColors(world: ReturnType<typeof createWorld>) {
  const terrain = world.scene.getObjectByName('terrain') as Mesh;
  return SEASON_COLORS.map((name) => Array.from((terrain.geometry.getAttribute(name) as BufferAttribute).array));
}

function scale(mesh: InstancedMesh, instance: number): number {
  const matrix = new Matrix4();
  mesh.getMatrixAt(instance, matrix);
  return new Vector3().setFromMatrixScale(matrix).x;
}

describe('tile changes from the simulation', () => {
  it('bring the main thread copy of the map, the ground, the trees, and the boulders up to date', () => {
    const mainMap = generateMap(7, SIZE);
    const world = createWorld(mainMap);
    const sim = createSim(mainMap, SETTLERS);
    const trees = world.scene.getObjectByName('oaks') as InstancedMesh;
    const boulders = world.scene.getObjectByName('boulders') as InstancedMesh;
    const felled = tileOf(trees, 0);
    const quarried = tileOf(boulders, 0);
    expect(mainMap.trees[felled]).toBe(1);
    expect(mainMap.kinds[quarried]).toBe(TileKind.Rock);

    sim.map.trees[felled] = 0;
    sim.map.stackGood[felled] = Good.Log;
    sim.map.stackSize[felled] = 2;
    noteTileChange(sim, felled);
    changeTile(sim, quarried, TileKind.Bare);
    world.changeTiles(takeTileChanges(sim));

    expect(mainMap.kinds).toEqual(sim.map.kinds);
    expect(mainMap.trees).toEqual(sim.map.trees);
    expect(mainMap.stackGood).toEqual(sim.map.stackGood);
    expect(mainMap.stackSize).toEqual(sim.map.stackSize);
    expect(scale(trees, 0)).toBe(0);
    expect(scale(boulders, 0)).toBe(0);
    expect(scale(trees, 1)).toBeGreaterThan(0);
    expect(scale(boulders, 1)).toBeGreaterThan(0);
    expect(groundColors(world)).toEqual(groundColors(createWorld(structuredClone(sim.map) as TileMap)));
    expect(groundColors(world)).not.toEqual(groundColors(createWorld(generateMap(7, SIZE))));
  });

  it('take the grass off a tile while goods lie on it, and off a tile that is no longer grass', () => {
    const mainMap = generateMap(7, SIZE);
    const world = createWorld(mainMap);
    const sim = createSim(mainMap, SETTLERS);
    const tufts = world.scene.getObjectByName('grass tufts') as InstancedMesh;
    const [stacked, built] = [tileOf(tufts, 0), tileOf(tufts, 1)];
    expect([mainMap.kinds[stacked], mainMap.kinds[built]]).toEqual([TileKind.Grass, TileKind.Grass]);

    sim.map.stackGood[stacked] = Good.Stone;
    sim.map.stackSize[stacked] = 1;
    noteTileChange(sim, stacked);
    changeTile(sim, built, TileKind.Bare);
    world.changeTiles(takeTileChanges(sim));
    expect([scale(tufts, 0), scale(tufts, 1)]).toEqual([0, 0]);
    expect(scale(tufts, 2)).toBeGreaterThan(0);

    sim.map.stackGood[stacked] = Good.None;
    sim.map.stackSize[stacked] = 0;
    noteTileChange(sim, stacked);
    world.changeTiles(takeTileChanges(sim));
    expect(scale(tufts, 0)).toBeGreaterThan(0);
    expect(scale(tufts, 1)).toBe(0);
  });

  it('change nothing when no tile changed', () => {
    const mainMap = generateMap(7, SIZE);
    const world = createWorld(mainMap);
    const before = groundColors(world);
    world.changeTiles(takeTileChanges(createSim(mainMap, SETTLERS)));
    expect(groundColors(world)).toEqual(before);
  });
});
