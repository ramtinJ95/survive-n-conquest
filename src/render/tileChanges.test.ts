import { type BufferAttribute, type InstancedMesh, Matrix4, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TileKind, type TileMap } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { SETTLERS, changeTile, createSim, takeTileChanges } from '../sim/sim';
import { SEASON_COLORS } from './seasonal';
import { createWorld } from './world';

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
  it('bring the main thread copy of the map, the ground, and the trees up to date', () => {
    const mainMap = generateMap(7, SIZE);
    const world = createWorld(mainMap);
    const sim = createSim(structuredClone(mainMap) as TileMap, SETTLERS);
    const trees = world.scene.getObjectByName('broadleaves') as InstancedMesh;
    const boulders = world.scene.getObjectByName('boulders') as InstancedMesh;
    const felled = tileOf(trees, 0);
    const quarried = tileOf(boulders, 0);
    expect(mainMap.kinds[felled]).toBe(TileKind.Forest);
    expect(mainMap.kinds[quarried]).toBe(TileKind.Rock);

    changeTile(sim, felled, TileKind.Grass);
    changeTile(sim, quarried, TileKind.Grass);
    world.changeTiles(takeTileChanges(sim));

    expect(mainMap.kinds).toEqual(sim.map.kinds);
    expect(scale(trees, 0)).toBe(0);
    expect(scale(boulders, 0)).toBe(0);
    expect(scale(trees, 1)).toBeGreaterThan(0);
    expect(groundColors(world)).toEqual(groundColors(createWorld(structuredClone(sim.map) as TileMap)));
  });

  it('change nothing when no tile changed', () => {
    const mainMap = generateMap(7, SIZE);
    const world = createWorld(mainMap);
    const before = groundColors(world);
    world.changeTiles(takeTileChanges(createSim(structuredClone(mainMap) as TileMap, SETTLERS)));
    expect(groundColors(world)).toEqual(before);
  });
});
