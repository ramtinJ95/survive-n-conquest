import { describe, expect, it } from 'vitest';
import { Good } from '../sim/goods';
import { applyOrder, createOrders } from '../sim/orders';
import { at, mapFrom } from '../sim/testMaps';
import { stockpileTotals } from './stockpiles';

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
