import { describe, expect, it } from 'vitest';
import { Building } from '../sim/buildings';
import { Good } from '../sim/goods';
import { SiteState, applyOrder, createOrders } from '../sim/orders';
import { CAMP_STORE, STORES, StoreKind } from '../sim/stores';
import { at, mapFrom } from '../sim/testMaps';
import { foodTotals, stockpileTotals } from './stockpiles';

const ROWS = Array.from({ length: 12 }, () => '.'.repeat(12));

describe('stockpileTotals', () => {
  it('adds up each good on stockpile tiles only, and stops counting a tile that Cancel removes', () => {
    const map = mapFrom(ROWS);
    const orders = createOrders(map);
    for (const [x, y, good, size] of [
      [0, 0, Good.Log, 3],
      [1, 0, Good.Log, 5],
      [2, 0, Good.Stone, 2],
      [5, 10, Good.Log, 7],
      [6, 10, Good.Stone, 4],
    ] as const) {
      map.stackGood[at(map, x, y)] = good;
      map.stackSize[at(map, x, y)] = size;
    }
    expect(stockpileTotals(map, orders.claims)).toMatchObject({ [Good.Log]: 0, [Good.Stone]: 0 });

    applyOrder(map, orders, { kind: 'markArea', order: 'stockpile', area: { x0: 0, y0: 0, x1: 3, y1: 0 } });
    expect(stockpileTotals(map, orders.claims)).toMatchObject({ [Good.Log]: 8, [Good.Stone]: 2 });

    applyOrder(map, orders, { kind: 'markArea', order: 'cancel', area: { x0: 1, y0: 0, x1: 1, y1: 0 } });
    expect(stockpileTotals(map, orders.claims)).toMatchObject({ [Good.Log]: 3, [Good.Stone]: 2 });
  });
});

describe('foodTotals', () => {
  it('counts the camp as one total and the houses as another, and no food in a site that is not a house', () => {
    const map = mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24)));
    const orders = createOrders(map);
    for (const x of [2, 6]) expect(applyOrder(map, orders, { kind: 'place', building: Building.House, x, y: 2 })).toMatchObject({ ok: true });
    expect(applyOrder(map, orders, { kind: 'place', building: Building.House, x: 2, y: 8 })).toMatchObject({ ok: true });
    const [first, second, site] = [at(map, 2, 2), at(map, 6, 2), at(map, 2, 8)].map((tile) => orders.siteOf[tile]!);
    orders.sites.state[first!] = SiteState.Built;
    orders.sites.state[second!] = SiteState.Built;
    const storeFood = new Uint16Array(STORES);
    storeFood[CAMP_STORE] = 17;
    storeFood[first!] = 6;
    storeFood[second!] = 3;
    storeFood[site!] = 5;
    expect(foodTotals(orders, storeFood)).toMatchObject({ [StoreKind.Common]: 17, [StoreKind.Home]: 9 });
  });
});
