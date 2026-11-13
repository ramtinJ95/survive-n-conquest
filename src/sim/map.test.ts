import { describe, expect, it } from 'vitest';
import { heightAt, type TileMap } from './map';

const map: TileMap = {
  seed: 0,
  size: 3,
  heights: Float32Array.from([0, 2, 4, 0, 2, 4, 6, 8, 10]),
  kinds: new Uint8Array(9),
};

describe('heightAt', () => {
  it('returns the tile height at a tile center', () => {
    expect(heightAt(map, 0.5, 0.5)).toBe(0);
    expect(heightAt(map, 1.5, 1.5)).toBe(2);
    expect(heightAt(map, 2.5, 2.5)).toBe(10);
  });

  it('blends the heights of the surrounding tiles between centers', () => {
    expect(heightAt(map, 1, 0.5)).toBe(1);
    expect(heightAt(map, 1.5, 2)).toBe(5);
    expect(heightAt(map, 2, 2)).toBe(6);
  });

  it('takes the nearest edge outside the map', () => {
    expect(heightAt(map, -5, 0.5)).toBe(0);
    expect(heightAt(map, 99, 99)).toBe(10);
    expect(heightAt(map, 1.5, -3)).toBe(2);
  });
});
