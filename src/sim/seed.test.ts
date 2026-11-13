import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, parseSeed } from './seed';

describe('parseSeed', () => {
  it('falls back to the default seed when the player typed nothing', () => {
    expect(parseSeed(null)).toBe(DEFAULT_SEED);
    expect(parseSeed('')).toBe(DEFAULT_SEED);
    expect(parseSeed('   ')).toBe(DEFAULT_SEED);
  });

  it('uses a whole number as the seed', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed(' 0 ')).toBe(0);
    expect(parseSeed('4294967295')).toBe(4294967295);
  });

  it('turns any other text into a stable 32-bit seed', () => {
    const seed = parseSeed('winter');
    expect(parseSeed('winter')).toBe(seed);
    expect(parseSeed('summer')).not.toBe(seed);
    for (const text of ['winter', '-3', '1.5', '4294967296', '99999999999999999999']) {
      const parsed = parseSeed(text);
      expect(Number.isInteger(parsed)).toBe(true);
      expect(parsed).toBeGreaterThanOrEqual(0);
      expect(parsed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
