import { Color, DirectionalLight, Mesh, PlaneGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_SIZE } from '../sim/map';
import { SKY_COLOR, createWorld } from './world';

describe('createWorld', () => {
  const { scene, camera } = createWorld(16 / 9);

  it('fills the background with the sky color', () => {
    expect(scene.background).toEqual(new Color(SKY_COLOR));
  });

  it('lays a ground plane over the whole default map', () => {
    const ground = scene.getObjectByName('ground');
    expect(ground).toBeInstanceOf(Mesh);
    const { width, height } = ((ground as Mesh).geometry as PlaneGeometry).parameters;
    expect([width, height]).toEqual([DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE]);
  });

  it('lights the ground from above', () => {
    const sun = scene.getObjectByName('sun');
    expect(sun).toBeInstanceOf(DirectionalLight);
    expect(sun!.position.y).toBeGreaterThan(0);
  });

  it('points the camera down at the ground', () => {
    expect(camera.getWorldDirection(new Vector3()).y).toBeLessThan(0);
  });
});
