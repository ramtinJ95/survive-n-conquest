import { describe, expect, it } from 'vitest';
import { BUILDINGS, Building } from '../sim/buildings';
import { TICKS_PER_SECOND } from '../sim/calendar';
import { Good } from '../sim/goods';
import { applyOrder, createOrders } from '../sim/orders';
import { at, mapFrom } from '../sim/testMaps';
import { siteProgress } from './sites';

const ROWS = Array.from({ length: 12 }, () => '.'.repeat(12));

describe('siteProgress', () => {
  it('counts the units on the nine tiles of a site only, and shows the work once all of them have arrived', () => {
    const map = mapFrom(ROWS);
    const orders = createOrders(map, at(map, 10, 10));
    expect(applyOrder(map, orders, { kind: 'place', building: Building.House, x: 4, y: 4 })).toMatchObject({ ok: true });
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

    orders.sites.work[slot] = BUILDINGS[Building.House].workTicks - 1;
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [12, 6], percent: 99 });
  });

  it("counts only the logs on the four tiles of a forager's hut site, and shows its work against its own 30 seconds once all 8 have arrived", () => {
    const map = mapFrom(ROWS);
    const orders = createOrders(map, at(map, 10, 10));
    expect(applyOrder(map, orders, { kind: 'place', building: Building.Hut, x: 4, y: 4 })).toMatchObject({ ok: true });
    const slot = orders.siteOf[at(map, 4, 4)]!;
    const stack = (x: number, y: number, good: Good, size: number) => {
      map.stackGood[at(map, x, y)] = good;
      map.stackSize[at(map, x, y)] = size;
    };
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [0], percent: null });

    stack(3, 3, Good.Log, 8);
    stack(4, 4, Good.Log, 5);
    stack(5, 5, Good.Stone, 3);
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [5], percent: null });

    stack(5, 4, Good.Log, 3);
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [8], percent: 0 });
    orders.sites.work[slot] = 15 * TICKS_PER_SECOND;
    expect(siteProgress(map, orders, slot)).toEqual({ arrived: [8], percent: 50 });
  });
});
