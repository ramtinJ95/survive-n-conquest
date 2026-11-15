import { describe, expect, it } from 'vitest';
import { HOUSE_WORK_TICKS } from '../sim/building';
import { Good } from '../sim/goods';
import { applyOrder, createOrders } from '../sim/orders';
import { at, mapFrom } from '../sim/testMaps';
import { siteProgress } from './sites';

const ROWS = Array.from({ length: 12 }, () => '.'.repeat(12));

describe('siteProgress', () => {
  it('counts the units on the nine tiles of a site only, and shows the work once all of them have arrived', () => {
    const map = mapFrom(ROWS);
    const orders = createOrders(map, at(map, 10, 10));
    expect(applyOrder(map, orders, { kind: 'placeHouse', x: 4, y: 4 })).toMatchObject({ ok: true });
    const slot = orders.siteOf[at(map, 4, 4)]!;
    const stack = (x: number, y: number, good: Good, size: number) => {
      map.stackGood[at(map, x, y)] = good;
      map.stackSize[at(map, x, y)] = size;
    };
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [0, 0], percent: null });

    stack(3, 3, Good.Log, 8);
    stack(1, 1, Good.Log, 8);
    stack(5, 5, Good.Stone, 5);
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [8, 5], percent: null });

    stack(4, 3, Good.Log, 4);
    stack(5, 5, Good.Stone, 6);
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [12, 6], percent: 0 });

    orders.sites.work[slot] = HOUSE_WORK_TICKS - 1;
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [12, 6], percent: 99 });
  });
});
