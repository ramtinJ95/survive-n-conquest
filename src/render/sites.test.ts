import { describe, expect, it } from 'vitest';
import { BUILDINGS, Building } from '../sim/buildings';
import { generateMap } from '../sim/mapgen';
import { SiteState, createOrders } from '../sim/orders';
import { primitiveShapes } from './shapes';
import { createSites } from './sites';

const SIZE = 64;

describe('sites and houses', () => {
  it('raises a house in a scaffold on its site with the work done, walls first, and stands it whole and alone once the site is finished', () => {
    const map = generateMap(7, SIZE);
    const orders = createOrders(map);
    const shapes = primitiveShapes();
    const sites = createSites(map, shapes);
    const { show } = sites;
    const houses = sites.buildings[Building.House]!;
    const scaffolds = sites.scaffolds[Building.House]!;
    shapes.house.computeBoundingBox();
    const roofTop = shapes.house.boundingBox!.max.y;
    const rise = () => houses.geometry.getAttribute('rise').getX(0);
    orders.sites.x[3] = 20;
    orders.sites.y[3] = 30;
    orders.sites.state[3] = SiteState.Site;

    show(orders);
    expect(houses.count).toBe(0);
    expect(scaffolds.count).toBe(0);

    orders.sites.work[3] = BUILDINGS[Building.House].workTicks / 4;
    show(orders);
    expect(houses.count).toBe(1);
    expect(scaffolds.count).toBe(1);
    expect(scaffolds.instanceMatrix.array.slice(0, 16)).toEqual(houses.instanceMatrix.array.slice(0, 16));
    const quarter = rise();
    expect(quarter).toBeGreaterThan(0);
    orders.sites.work[3] = BUILDINGS[Building.House].workTicks / 2;
    show(orders);
    const half = rise();
    expect(half).toBeGreaterThan(quarter);
    expect(half).toBeLessThan(roofTop / 2);
    orders.sites.work[3] = BUILDINGS[Building.House].workTicks;
    show(orders);
    expect(rise()).toBeCloseTo(roofTop);

    orders.sites.state[3] = SiteState.Built;
    show(orders);
    expect(houses.count).toBe(1);
    expect(scaffolds.count).toBe(0);
    expect(rise()).toBeGreaterThan(roofTop);
  });

  it('stands a house on the highest of its nine tiles, on a footing that reaches below the lowest', () => {
    const map = generateMap(7, SIZE);
    const orders = createOrders(map);
    const { buildings, show } = createSites(map, primitiveShapes());
    const houses = buildings[Building.House]!;
    orders.sites.x[0] = 20;
    orders.sites.y[0] = 30;
    orders.sites.state[0] = SiteState.Built;
    for (let y = 29; y <= 31; y++) for (let x = 19; x <= 21; x++) map.heights[y * SIZE + x] = 5;
    map.heights[31 * SIZE + 21] = 6.5;
    show(orders);

    const floor = houses.instanceMatrix.array[13]!;
    houses.geometry.computeBoundingBox();
    expect(floor).toBe(6.5);
    expect(floor + houses.geometry.boundingBox!.min.y).toBeLessThan(5);
  });

  it('draws a hut site as a hut, smaller than a house, rising in its own scaffold over the middle of its 2 by 2 tiles', () => {
    const map = generateMap(7, SIZE);
    const orders = createOrders(map);
    const { buildings, scaffolds, show } = createSites(map, primitiveShapes());
    const huts = buildings[Building.Hut]!;
    orders.sites.x[0] = 20;
    orders.sites.y[0] = 30;
    orders.sites.kind[0] = Building.Hut;
    orders.sites.state[0] = SiteState.Site;
    orders.sites.work[0] = BUILDINGS[Building.Hut].workTicks / 2;
    for (let y = 30; y <= 31; y++) for (let x = 20; x <= 21; x++) map.heights[y * SIZE + x] = 5;
    map.heights[31 * SIZE + 21] = 5.5;
    map.heights[32 * SIZE + 22] = 9;
    show(orders);

    expect([buildings[Building.House]!.count, huts.count, scaffolds[Building.Hut]!.count, scaffolds[Building.House]!.count]).toEqual([0, 1, 1, 0]);
    const matrix = huts.instanceMatrix.array;
    expect([matrix[12], matrix[13], matrix[14]]).toEqual([21 - SIZE / 2, 5.5, 31 - SIZE / 2]);
    huts.geometry.computeBoundingBox();
    scaffolds[Building.Hut]!.geometry.computeBoundingBox();
    buildings[Building.House]!.geometry.computeBoundingBox();
    const hut = huts.geometry.boundingBox!;
    const house = buildings[Building.House]!.geometry.boundingBox!;
    const scaffold = scaffolds[Building.Hut]!.geometry.boundingBox!;
    expect(hut.max.x - hut.min.x).toBeLessThanOrEqual(2.1);
    expect(hut.max.y).toBeLessThan(house.max.y);
    expect(scaffold.max.x - scaffold.min.x).toBeLessThanOrEqual(2.1);
    expect(scaffold.max.x - scaffold.min.x).toBeGreaterThan(1.7);
    const rise = huts.geometry.getAttribute('rise').getX(0);
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThan(hut.max.y / 2);

    orders.sites.state[0] = SiteState.Built;
    show(orders);
    expect([huts.count, scaffolds[Building.Hut]!.count]).toEqual([1, 0]);
    expect(huts.geometry.getAttribute('rise').getX(0)).toBeGreaterThan(hut.max.y);
  });
});
