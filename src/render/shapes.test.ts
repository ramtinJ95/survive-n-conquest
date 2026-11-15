import { BoxGeometry, type BufferGeometry, Group, Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import manifest from '../../assets/models.json';
import { colored, loadShapes, modelShapes, primitiveShapes, readShapes } from './shapes';

const NAMES = Object.keys(manifest.models);

function expectPlain(name: string, shape: BufferGeometry) {
  expect(shape.index, name).toBeNull();
  expect(Object.keys(shape.attributes).sort(), name).toEqual(['color', 'position']);
  expect(shape.getAttribute('color').count, name).toBe(shape.getAttribute('position').count);
}

function loaded(names: readonly string[]): Group {
  const models = new Group();
  for (const name of names) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1));
    mesh.geometry.setAttribute('color', mesh.geometry.getAttribute('position').clone());
    mesh.name = name;
    models.add(mesh);
  }
  return models;
}

describe('the shapes of the settlement', () => {
  it('builds a stand-in for every model the manifest names, standing on the origin', () => {
    const shapes = primitiveShapes();
    expect(Object.keys(shapes).sort()).toEqual([...NAMES].sort());
    for (const [name, shape] of Object.entries(shapes)) {
      expectPlain(name, shape);
      shape.computeBoundingBox();
      expect(shape.boundingBox!.min.y, name).toBeCloseTo(0, 5);
    }
  });

  it('takes every model out of a loaded file as plain colored triangles', () => {
    const shapes = modelShapes(loaded(NAMES));
    for (const [name, shape] of Object.entries(shapes)) {
      expectPlain(name, shape);
      expect(shape.getAttribute('position').count, name).toBe(36);
    }
  });

  it('names the model that a loaded file lacks', () => {
    expect(() => modelShapes(loaded(NAMES.filter((name) => name !== 'tent')))).toThrow('"tent"');
  });

  it('draws the stand-ins and says why when the server has no models file', async () => {
    const page = new TextEncoder().encode('<!doctype html><html></html>').buffer;
    for (const file of [null, page]) {
      const look = await readShapes(file);
      expect(look.fallback).toMatch(/not installed/);
      expect(Object.keys(look.shapes).sort()).toEqual([...NAMES].sort());
    }
  });

  it('draws the stand-ins when the download of the models file fails or breaks off', async () => {
    const brokenOff = { ok: true, arrayBuffer: () => Promise.reject(new TypeError('network error')) } as unknown as Response;
    for (const answer of [() => Promise.reject(new TypeError('failed to fetch')), () => Promise.resolve(brokenOff)]) {
      vi.stubGlobal('fetch', answer);
      const look = await loadShapes();
      expect(look.fallback).toMatch(/not installed/);
      expect(Object.keys(look.shapes).sort()).toEqual([...NAMES].sort());
    }
    vi.unstubAllGlobals();
  });

  it('paints a primitive in one color on every corner', () => {
    const box = colored(new BoxGeometry(1, 1, 1), 0xffffff);
    expectPlain('box', box);
    expect(new Set(box.getAttribute('color').array)).toEqual(new Set([1]));
  });
});
