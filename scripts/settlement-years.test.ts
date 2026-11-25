import { describe, expect, it } from 'vitest';
import { NEAR_HOUSES_LATE_SHED, ordersOf, playYear } from './firewood-years';
import { play, yearsEnd } from './settlement-years';

describe('settlement years', () => {
  it('plays the first year of #45 untouched by the rule', () => {
    const { sim: year } = playYear({ title: 'near houses, late woodshed', orders: ordersOf(NEAR_HOUSES_LATE_SHED) });
    const { sim } = play({ hour: 8, ticks: year.tick });
    expect(sim.tick).toBe(year.tick);
    expect(sim.living).toBe(year.living);
    expect(sim.tally).toEqual(year.tally);
    expect(sim.stores.held).toEqual(year.stores.held);
  });

  it('gives the same tables on two runs', () => {
    const first = play({ hour: 8, ticks: yearsEnd(3) });
    const second = play({ hour: 8, ticks: yearsEnd(3) });
    expect(first.rows).toHaveLength(3);
    expect(second.rows).toEqual(first.rows);
    expect(second.camp).toEqual(first.camp);
  });
});
