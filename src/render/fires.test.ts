import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Building } from '../sim/buildings';
import { generateMap } from '../sim/mapgen';
import { MAX_SITES, SiteState, createOrders } from '../sim/orders';
import { createFires } from './fires';
import { primitiveShapes } from './shapes';
import { floorOf } from './sites';

describe('the signs of the house fires', () => {
  it('stand on the roof of each finished house whose fire burns, over the highest tile of its footprint, and on no other', () => {
    const map = generateMap(7, 64);
    const orders = createOrders(map);
    const shapes = primitiveShapes();
    const fires = createFires(map, shapes);
    for (const [slot, x] of [[3, 20], [4, 30], [5, 40]] as const) {
      orders.sites.x[slot] = x;
      orders.sites.y[slot] = 30;
      orders.sites.kind[slot] = Building.House;
      orders.sites.state[slot] = SiteState.Built;
    }
    orders.sites.state[5] = SiteState.Site;
    orders.sites.used = 6;
    // A footprint corner well above the rest, where the middle of the house lies lower than its floor.
    map.heights[29 * map.size + 19] = map.heights[30 * map.size + 20]! + 1.5;
    const burning = new Uint8Array(MAX_SITES + 1);
    burning[3] = burning[5] = 1;

    fires.show(orders, burning);

    expect(fires.mesh.count).toBe(1);
    shapes.house.computeBoundingBox();
    const roofTop = shapes.house.boundingBox!.max.y;
    const sign = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(fires.mesh.instanceMatrix.array, 0));
    expect(sign.y).toBeGreaterThan(floorOf(map, orders.sites, 3) + roofTop);
    expect([sign.x, sign.z]).toEqual([20 + 0.5 - 32, 30 + 0.5 - 32]);

    burning[3] = 0;
    fires.show(orders, burning);
    expect(fires.mesh.count).toBe(0);
  });
});
