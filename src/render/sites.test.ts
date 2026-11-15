import { type InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HOUSE_WORK_TICKS } from '../sim/building';
import { generateMap } from '../sim/mapgen';
import { SiteState, createOrders } from '../sim/orders';
import { createSites } from './sites';

const SIZE = 64;

function heights(mesh: InstancedMesh): number[] {
  const matrix = new Matrix4();
  const scale = new Vector3();
  return Array.from({ length: mesh.count }, (_, instance) => {
    mesh.getMatrixAt(instance, matrix);
    return scale.setFromMatrixScale(matrix).y;
  });
}

describe('sites and houses', () => {
  it('raises a frame with the work done, and stands a house in its place once the site is finished', () => {
    const map = generateMap(7, SIZE);
    const orders = createOrders(map);
    const sites = createSites(map);
    const part = (name: string) => sites.group.getObjectByName(name) as InstancedMesh;
    orders.sites.x[3] = 20;
    orders.sites.y[3] = 30;
    orders.sites.state[3] = SiteState.Site;

    sites.show(orders);
    expect(part('site-posts').count).toBe(0);

    orders.sites.work[3] = HOUSE_WORK_TICKS / 4;
    sites.show(orders);
    const quarter = heights(part('site-posts'));
    orders.sites.work[3] = HOUSE_WORK_TICKS / 2;
    sites.show(orders);
    const halfway = heights(part('site-posts'));
    expect(quarter).toHaveLength(4);
    expect(halfway[0]).toBeCloseTo(2 * quarter[0]!);
    expect(part('house-walls').count).toBe(0);

    orders.sites.state[3] = SiteState.House;
    sites.show(orders);
    expect(part('site-posts').count).toBe(0);
    expect(part('house-walls').count).toBe(1);
    expect(part('house-roofs').count).toBe(1);
  });
});
