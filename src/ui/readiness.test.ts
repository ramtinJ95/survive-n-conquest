import { describe, expect, it } from 'vitest';
import type { Readiness } from '../sim/readiness';
import { readinessRows, readinessTitle } from './readiness';

const reading: Readiness = { nights: 3, housed: 2, households: 4, stocked: 1, houses: 2, clothed: 2, settlers: 8, cold: 3, camp: { firewood: 8, burns: 4, lights: true } };

describe('readinessRows', () => {
  it('reads the four numbers, and the camp fire while a household sleeps at the camp', () => {
    expect(readinessRows(reading)).toEqual([
      ['Households in a house', '2 of 4'],
      ['Houses with firewood', '1 of 2'],
      ['Settlers in clothing', '2 of 8'],
      ['Cold tonight', '3'],
      ['Camp fire', 'Lights, 8 firewood'],
    ]);
  });

  it('names the nights still to come, says how short the camp fire is, and leaves it out with nobody at the camp', () => {
    expect(readinessRows({ ...reading, nights: 1, camp: { firewood: 2, burns: 4, lights: false } })).toEqual([
      ['Households in a house', '2 of 4'],
      ['Houses with firewood', '1 of 2'],
      ['Settlers in clothing', '2 of 8'],
      ['Cold tonight', '3'],
      ['Camp fire', 'Out, 2 of 4 firewood'],
    ]);
    expect(readinessTitle(reading)).toBe('Winter readiness, 3 cold nights to come');
    expect(readinessTitle({ ...reading, nights: 1 })).toBe('Winter readiness, 1 cold night to come');
    expect(readinessRows({ ...reading, housed: 4, camp: null }).map(([label]) => label)).not.toContain('Camp fire');
  });
});
