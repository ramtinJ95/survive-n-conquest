import { describe, expect, it } from 'vitest';
import { TileKind, type TileMap, createTileMap } from './map';
import { generateMap } from './mapgen';
import {
  type AreaOrder,
  Claim,
  MAX_SITES,
  type OrderCommand,
  type Orders,
  SiteState,
  type TileArea,
  applyOrder,
  areaEffect,
  createOrders,
  openGround,
  siteRefusal,
  applyOrderChanges,
  takeOrderChanges,
} from './orders';
import { underCamp } from './camp';
import { Good } from './goods';

function plainMap(size: number): TileMap {
  return createTileMap(11, size, new Float32Array(size * size), new Uint8Array(size * size).fill(TileKind.Grass));
}

function paint(map: TileMap, kind: TileKind, x0: number, y0: number, x1 = x0, y1 = y0): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) map.kinds[y * map.size + x] = kind;
}

/** Turns the first grass tile in the rectangle into forest, with a tree on it or, with `tree` false, without. */
function forestTile(map: TileMap, tree: boolean, x0: number, y0: number, x1: number, y1: number): number {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tile = y * map.size + x;
      if (map.kinds[tile] !== TileKind.Grass) continue;
      map.kinds[tile] = TileKind.Forest;
      map.trees[tile] = tree ? 1 : 0;
      return tile;
    }
  }
  throw new Error('no such tile in the rectangle');
}

function xy(map: TileMap, tile: number): [number, number] {
  return [tile % map.size, Math.floor(tile / map.size)];
}

const WHOLE = (map: TileMap): TileArea => ({ x0: 0, y0: 0, x1: map.size - 1, y1: map.size - 1 });
const area = (x0: number, y0: number, x1 = x0, y1 = y0): TileArea => ({ x0, y0, x1, y1 });
const mark = (order: AreaOrder, on: TileArea): OrderCommand => ({ kind: 'markArea', order, area: on });
const house = (x: number, y: number): OrderCommand => ({ kind: 'placeHouse', x, y });

function nine(map: TileMap, x: number, y: number): number[] {
  const tiles: number[] = [];
  for (let ty = y - 1; ty <= y + 1; ty++) for (let tx = x - 1; tx <= x + 1; tx++) tiles.push(ty * map.size + tx);
  return tiles;
}

function tilesWith(orders: Orders, claim: Claim): number[] {
  const tiles: number[] = [];
  orders.claims.forEach((value, tile) => {
    if (value === claim) tiles.push(tile);
  });
  return tiles;
}

function tilesWhere(map: TileMap, keep: (tile: number) => boolean): number[] {
  return Array.from({ length: map.size * map.size }, (_, tile) => tile).filter(keep);
}

/** The first house center in the rectangle where a house fits. */
function fit(map: TileMap, orders: Orders, x0: number, y0: number, x1: number, y1: number): [number, number] {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (siteRefusal(map, orders, x, y) === null) return [x, y];
  throw new Error('no house fits in the rectangle');
}

/** The slot of the site centered on (x, y), or -1. */
function slotAt(orders: Orders, x: number, y: number): number {
  const { sites } = orders;
  for (let slot = 0; slot < MAX_SITES; slot++) {
    if (sites.state[slot] !== SiteState.Free && sites.x[slot] === x && sites.y[slot] === y) return slot;
  }
  return -1;
}

/** The state the orders hold, without their scratch buffers and change log. */
function stateOf({ claims, sites }: Orders) {
  return { claims: claims.slice(), x: sites.x.slice(), y: sites.y.slice(), state: sites.state.slice() };
}

describe('open ground', () => {
  it('is grass, forest without a tree, or a spent rock tile', () => {
    const map = plainMap(20);
    paint(map, TileKind.Water, 0, 0);
    paint(map, TileKind.Rock, 1, 0);
    paint(map, TileKind.Bare, 3, 0);
    const bare = forestTile(map, false, 0, 5, 19, 5);
    const tree = forestTile(map, true, 0, 6, 19, 19);
    expect(openGround(map, 2)).toBe(true);
    expect(openGround(map, 3)).toBe(true);
    expect(openGround(map, bare)).toBe(true);
    expect(openGround(map, tree)).toBe(false);
    expect(openGround(map, 0)).toBe(false);
    expect(openGround(map, 1)).toBe(false);
  });
});

describe('area orders on a generated map', () => {
  const map = generateMap(7, 64);
  const orders = createOrders(map);
  const chop = applyOrder(map, orders, mark('chop', WHOLE(map)));
  const quarry = applyOrder(map, orders, mark('quarry', WHOLE(map)));
  const stockpile = applyOrder(map, orders, mark('stockpile', WHOLE(map)));

  it('marks exactly the tiles that hold a tree for chopping', () => {
    const trees = tilesWhere(map, (tile) => map.trees[tile] === 1);
    expect(trees.length).toBeGreaterThan(0);
    expect(tilesWith(orders, Claim.Chop)).toEqual(trees);
    expect(chop).toEqual({ ok: true, order: 'chop', tiles: trees.length });
  });

  it('marks exactly the rock tiles for quarrying', () => {
    const rock = tilesWhere(map, (tile) => map.kinds[tile] === TileKind.Rock);
    expect(rock.length).toBeGreaterThan(0);
    expect(tilesWith(orders, Claim.Quarry)).toEqual(rock);
    expect(quarry).toEqual({ ok: true, order: 'quarry', tiles: rock.length });
  });

  it('lays a stockpile on every open ground tile but the camp', () => {
    const ground = tilesWhere(map, (tile) => openGround(map, tile) && !underCamp(map, orders.camp, tile));
    expect(tilesWith(orders, Claim.Stockpile)).toEqual(ground);
    expect(stockpile).toEqual({ ok: true, order: 'stockpile', tiles: ground.length });
    expect(orders.claims[orders.camp]).toBe(Claim.None);
  });

  it('refuses an area order that would change no tile', () => {
    const before = stateOf(orders);
    expect(applyOrder(map, orders, mark('chop', WHOLE(map)))).toEqual({ ok: false, order: 'chop', refusal: 'no-trees' });
    expect(applyOrder(map, orders, mark('quarry', WHOLE(map)))).toEqual({ ok: false, order: 'quarry', refusal: 'no-rock' });
    expect(applyOrder(map, orders, mark('stockpile', WHOLE(map)))).toEqual({
      ok: false,
      order: 'stockpile',
      refusal: 'no-open-ground',
    });
    expect(stateOf(orders)).toEqual(before);
  });
});

describe('area orders', () => {
  it('take corners in any order and clip to the map', () => {
    const map = plainMap(20);
    const orders = createOrders(map);
    expect(applyOrder(map, orders, mark('stockpile', area(5, 3, -4, -9)))).toEqual({
      ok: true,
      order: 'stockpile',
      tiles: 6 * 4,
    });
    expect(tilesWith(orders, Claim.Stockpile)).toEqual(tilesWhere(map, (tile) => tile % 20 <= 5 && tile < 4 * 20));
  });

  it('skip the camp, trees, rock, water, and sites when laying a stockpile', () => {
    const map = plainMap(20);
    paint(map, TileKind.Water, 0, 0, 19, 0);
    paint(map, TileKind.Rock, 0, 1);
    const tree = forestTile(map, true, 1, 1, 19, 2);
    const bare = forestTile(map, false, 1, 1, 19, 2);
    const orders = createOrders(map);
    applyOrder(map, orders, house(4, 6));
    applyOrder(map, orders, mark('stockpile', WHOLE(map)));

    const skipped = new Set([
      ...tilesWhere(map, (tile) => tile < 21 || tile === tree || underCamp(map, orders.camp, tile)),
      ...nine(map, 4, 6),
    ]);
    expect(tilesWith(orders, Claim.Stockpile)).toEqual(tilesWhere(map, (tile) => !skipped.has(tile)));
    expect(orders.claims[bare]).toBe(Claim.Stockpile);
  });

  it('preview exactly the tiles that the order then changes', () => {
    const map = generateMap(7, 64);
    const orders = createOrders(map);
    applyOrder(map, orders, house(...fit(map, orders, 1, 1, 62, 62)));
    applyOrder(map, orders, mark('chop', area(0, 0, 31, 63)));
    const drag = area(2, 70, 63, -5);
    for (const order of ['chop', 'quarry', 'stockpile', 'cancel'] as const) {
      const previewed: number[] = [];
      const count = areaEffect(map, orders, order, drag, (tile) => previewed.push(tile));
      const before = orders.claims.slice();
      applyOrder(map, orders, mark(order, drag));
      const changed = tilesWhere(map, (tile) => orders.claims[tile] !== before[tile]);
      expect(count, order).toBeGreaterThan(0);
      expect(previewed.sort((a, b) => a - b), order).toEqual(changed);
      expect(count, order).toBe(changed.length);
    }
  });
});

describe('placing a house', () => {
  it('claims its nine tiles and takes a slot in the sites table', () => {
    const map = plainMap(20);
    const orders = createOrders(map);
    expect(applyOrder(map, orders, house(4, 5))).toEqual({ ok: true, order: 'house', tiles: 9 });
    expect(tilesWith(orders, Claim.Site)).toEqual(nine(map, 4, 5));
    expect(slotAt(orders, 4, 5)).toBeGreaterThanOrEqual(0);
    expect(orders.sites.state[slotAt(orders, 4, 5)]).toBe(SiteState.Site);
  });

  it('allows 1.5 m between the highest and the lowest tile and refuses more', () => {
    const map = plainMap(20);
    map.heights[5 * 20 + 5] = 1.5;
    map.heights[15 * 20 + 15] = 1.51;
    const orders = createOrders(map);
    expect(siteRefusal(map, orders, 4, 4)).toBeNull();
    expect(siteRefusal(map, orders, 14, 14)).toBe('uneven');
  });

  type Setup = (map: TileMap, orders: Orders) => [number, number];
  const REFUSED: [string, Setup][] = [
    [
      'stockpile',
      (map, orders) => {
        applyOrder(map, orders, mark('stockpile', area(5, 5)));
        return [4, 4];
      },
    ],
    [
      'site',
      (map, orders) => {
        applyOrder(map, orders, house(4, 4));
        return [6, 6];
      },
    ],
    [
      'site',
      (map, orders) => {
        applyOrder(map, orders, house(4, 4));
        orders.sites.state[slotAt(orders, 4, 4)] = SiteState.House;
        return [5, 3];
      },
    ],
    ['camp', (map, orders) => xy(map, orders.camp)],
    [
      'camp',
      (map, orders) => {
        const [x, y] = xy(map, orders.camp);
        return [x + 3, y + 1];
      },
    ],
    ['trees', (map) => xy(map, forestTile(map, true, 3, 3, 7, 7))],
    [
      'goods',
      (map) => {
        map.stackGood[5 * map.size + 5] = Good.Log;
        map.stackSize[5 * map.size + 5] = 1;
        return [4, 4];
      },
    ],
    [
      'water',
      (map) => {
        paint(map, TileKind.Water, 3, 5);
        return [4, 4];
      },
    ],
    [
      'rock',
      (map) => {
        paint(map, TileKind.Rock, 5, 3);
        return [4, 4];
      },
    ],
    ['off-map', () => [0, 4]],
    ['off-map', (map) => [4, map.size - 1]],
  ];

  it.each(REFUSED)('is refused with %s', (refusal, setup) => {
    const map = plainMap(20);
    const orders = createOrders(map);
    const [x, y] = setup(map, orders);
    expect(siteRefusal(map, orders, x, y)).toBe(refusal);
    const before = stateOf(orders);
    expect(applyOrder(map, orders, house(x, y))).toEqual({ ok: false, order: 'house', refusal });
    expect(stateOf(orders)).toEqual(before);
  });

  it('is refused where it would block a corridor one tile wide', () => {
    const map = plainMap(30);
    paint(map, TileKind.Water, 21, 0, 23, 9);
    paint(map, TileKind.Water, 21, 11, 23, 29);
    const orders = createOrders(map);
    expect(siteRefusal(map, orders, 19, 10)).toBe('divides');
    expect(siteRefusal(map, orders, 25, 10)).toBe('divides');
    expect(siteRefusal(map, orders, 4, 4)).toBeNull();
    expect(siteRefusal(map, orders, 19, 13)).toBeNull();
  });

  it('counts spent rock as land: it opens a second way past a corridor, and a pocket of it must keep its walk', () => {
    const map = plainMap(30);
    paint(map, TileKind.Water, 21, 0, 23, 9);
    paint(map, TileKind.Water, 21, 11, 23, 19);
    paint(map, TileKind.Rock, 21, 20, 23, 20);
    paint(map, TileKind.Water, 21, 21, 23, 29);
    const orders = createOrders(map);
    expect(siteRefusal(map, orders, 19, 10)).toBe('divides');
    paint(map, TileKind.Bare, 21, 20, 23, 20);
    expect(siteRefusal(map, orders, 19, 10)).toBeNull();
    expect(applyOrder(map, orders, house(19, 10))).toMatchObject({ ok: true });
    expect(siteRefusal(map, orders, 19, 20)).toBe('divides');

    const pocket = plainMap(24);
    paint(pocket, TileKind.Rock, 1, 1, 10, 1);
    paint(pocket, TileKind.Rock, 1, 1, 1, 8);
    paint(pocket, TileKind.Rock, 10, 1, 10, 8);
    paint(pocket, TileKind.Rock, 2, 2, 9, 7);
    paint(pocket, TileKind.Rock, 1, 8, 3, 8);
    paint(pocket, TileKind.Rock, 7, 8, 10, 8);
    paint(pocket, TileKind.Bare, 5, 5);
    paint(pocket, TileKind.Bare, 5, 6, 5, 7);
    const pocketOrders = createOrders(pocket);
    expect(siteRefusal(pocket, pocketOrders, 5, 9)).toBe('divides');
    paint(pocket, TileKind.Rock, 5, 5, 5, 7);
    expect(siteRefusal(pocket, pocketOrders, 5, 9)).toBeNull();
  });

  it('is refused where it would seal a pocket, counting the sites already placed', () => {
    const map = plainMap(24);
    paint(map, TileKind.Rock, 1, 1, 10, 1);
    paint(map, TileKind.Rock, 1, 1, 1, 8);
    paint(map, TileKind.Rock, 10, 1, 10, 8);
    paint(map, TileKind.Rock, 8, 8, 10, 8);
    const orders = createOrders(map);
    expect(applyOrder(map, orders, house(3, 8))).toEqual({ ok: true, order: 'house', tiles: 9 });
    expect(siteRefusal(map, orders, 6, 8)).toBe('divides');

    orders.sites.state[slotAt(orders, 3, 8)] = SiteState.House;
    expect(siteRefusal(map, orders, 6, 8)).toBe('divides');

    orders.sites.state[slotAt(orders, 3, 8)] = SiteState.Site;
    applyOrder(map, orders, mark('cancel', area(3, 8)));
    expect(siteRefusal(map, orders, 6, 8)).toBeNull();
  });

  it(`holds ${MAX_SITES} sites and refuses the next as full`, () => {
    // The camp sits at the center of the map, clear of the grid of sites and of the one past the limit.
    const map = plainMap(140);
    const orders = createOrders(map);
    for (let j = 0; j < 16; j++) {
      for (let i = 0; i < 16; i++) {
        expect(applyOrder(map, orders, house(4 + 4 * i, 4 + 4 * j))).toMatchObject({ ok: true });
      }
    }
    expect(applyOrder(map, orders, house(100, 100))).toEqual({ ok: false, order: 'house', refusal: 'full' });

    const freed = slotAt(orders, 8, 4);
    applyOrder(map, orders, mark('cancel', area(8, 4)));
    expect(applyOrder(map, orders, house(100, 100))).toMatchObject({ ok: true });
    expect(slotAt(orders, 100, 100)).toBe(freed);
  });
});

describe('cancel', () => {
  it('removes marks, stockpile tiles, and unfinished sites it touches, and keeps houses', () => {
    const map = plainMap(20);
    paint(map, TileKind.Rock, 16, 5);
    const tree = forestTile(map, true, 10, 1, 13, 4);
    const orders = createOrders(map);
    applyOrder(map, orders, mark('chop', area(10, 1, 13, 4)));
    applyOrder(map, orders, mark('quarry', area(16, 5)));
    applyOrder(map, orders, mark('stockpile', area(14, 1, 15, 2)));
    applyOrder(map, orders, house(4, 4));
    applyOrder(map, orders, house(15, 15));
    applyOrder(map, orders, house(2, 15));
    orders.sites.state[slotAt(orders, 15, 15)] = SiteState.House;
    const untouched = slotAt(orders, 2, 15);

    expect(applyOrder(map, orders, mark('cancel', area(5, 0, 19, 19)))).toEqual({
      ok: true,
      order: 'cancel',
      tiles: 1 + 1 + 4 + 9,
    });
    expect(orders.claims[tree]).toBe(Claim.None);
    expect(slotAt(orders, 4, 4)).toBe(-1);
    expect(orders.sites.state[slotAt(orders, 15, 15)]).toBe(SiteState.House);
    expect(orders.sites.state[untouched]).toBe(SiteState.Site);
    expect(tilesWith(orders, Claim.Site)).toEqual([...nine(map, 2, 15), ...nine(map, 15, 15)].sort((a, b) => a - b));
    expect(tilesWhere(map, (tile) => orders.claims[tile] !== Claim.None && orders.claims[tile] !== Claim.Site)).toEqual([]);
  });

  it('is refused when the area holds nothing it can remove', () => {
    const map = plainMap(20);
    const orders = createOrders(map);
    applyOrder(map, orders, house(15, 15));
    orders.sites.state[slotAt(orders, 15, 15)] = SiteState.House;
    const before = stateOf(orders);
    expect(applyOrder(map, orders, mark('cancel', area(10, 10, 19, 19)))).toEqual({
      ok: false,
      order: 'cancel',
      refusal: 'nothing-to-cancel',
    });
    expect(stateOf(orders)).toEqual(before);
  });
});

describe('order changes', () => {
  it('bring another copy of the orders to the same claims and sites', () => {
    const map = generateMap(7, 64);
    const orders = createOrders(map);
    const mirror = createOrders(map);
    const commands = [
      mark('chop', WHOLE(map)),
      house(...fit(map, orders, 1, 1, 62, 62)),
      mark('stockpile', area(0, 0, 30, 30)),
      mark('cancel', area(0, 0, 40, 40)),
    ];
    for (const command of commands) {
      applyOrder(map, orders, command);
      applyOrderChanges(mirror, takeOrderChanges(orders));
      expect(stateOf(mirror)).toEqual(stateOf(orders));
    }
  });

  it('list nothing after a refused order', () => {
    const map = plainMap(20);
    const orders = createOrders(map);
    applyOrder(map, orders, house(4, 4));
    takeOrderChanges(orders);
    expect(applyOrder(map, orders, house(4, 4)).ok).toBe(false);
    const changes = takeOrderChanges(orders);
    expect([changes.claims.length, changes.sites.length]).toEqual([0, 0]);
  });
});

describe('the camp', () => {
  it('keeps a house off every tile its disc touches, and lets one stand just beyond it', () => {
    const map = plainMap(20);
    const orders = createOrders(map);
    const [x, y] = xy(map, orders.camp);
    expect(siteRefusal(map, orders, x + 3, y)).toBe('camp');
    expect(siteRefusal(map, orders, x + 3, y + 2)).toBe('camp');
    expect(siteRefusal(map, orders, x + 4, y)).toBeNull();
    expect(siteRefusal(map, orders, x + 3, y + 3)).toBeNull();
  });
});
