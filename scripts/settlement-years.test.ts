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

  it('turns births off from year 3 in its own run only', () => {
    const control = play({ hour: 8, ticks: yearsEnd(3) });
    const off = play({ hour: 8, ticks: yearsEnd(3), birthsOffFrom: 3 });
    const after = play({ hour: 8, ticks: yearsEnd(3) });
    expect(off.rows.slice(0, 2)).toEqual(control.rows.slice(0, 2));
    expect(control.rows[2]!.born).toBeGreaterThan(0);
    expect(off.rows[2]!.born).toBe(0);
    expect(after.rows).toEqual(control.rows);
  });

  it('orders a farm and marks 3 field tiles for each of the 8 settlers at the start of a run with farms from year 1', () => {
    let steps = 0;
    const { fields } = play({ hour: 8, ticks: 10, farmsFrom: 1, watch: () => steps++ });
    expect(steps).toBe(10);
    expect(fields).toHaveLength(1);
    expect(fields![0]).toMatchObject({ year: 1, living: 8, wanted: 24, held: 0, marked: 24 });
    expect(fields![0]!.farm).not.toBeNull();
  });
});
