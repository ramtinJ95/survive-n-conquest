import { campTile, underCamp } from './camp';
import { TileKind, type TileMap, walkable } from './map';

export const Claim = { None: 0, Chop: 1, Quarry: 2, Stockpile: 3, Site: 4 } as const;
export type Claim = (typeof Claim)[keyof typeof Claim];

/** House: a finished house. Nothing finishes one before pull request 2.5. */
export const SiteState = { Free: 0, Site: 1, House: 2 } as const;
export type SiteState = (typeof SiteState)[keyof typeof SiteState];

export const MAX_SITES = 256;
/** The most that the highest of a site's nine tiles may stand above the lowest, in meters. */
export const MAX_SITE_RISE = 1.5;

/** Sites and houses, one fixed-capacity table. A slot index is the site's stable id. x, y is the center tile of the 3x3. */
export interface Sites {
  readonly x: Int16Array;
  readonly y: Int16Array;
  readonly state: Uint8Array;
}

export interface Orders {
  /** The camp tile, from campTile(map). */
  readonly camp: number;
  /**
   * One Claim per tile, an array the size of the map. Chop only on tree tiles, Quarry only on rock tiles,
   * Stockpile and Site only on open ground. A tile holds at most one claim, so illegal combinations cannot
   * be represented. Site covers both unfinished sites and finished houses; the sites table tells them apart.
   */
  readonly claims: Uint8Array;
  readonly sites: Sites;
  /** The tiles and site slots changed since the last `takeOrderChanges`. A refused order changes nothing and lists nothing. */
  readonly changes: {
    readonly listed: Uint8Array;
    readonly tiles: Int32Array;
    tileCount: number;
    readonly slots: Uint8Array;
  };
  /** Scratch for the divide test, so placing a house allocates nothing. Not part of the orders' state. */
  readonly reached: Uint8Array;
  readonly queue: Int32Array;
}

/** Inclusive tile rectangle; corners in any order; the sim normalizes and clips to the map. */
export interface TileArea {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export type AreaOrder = 'chop' | 'quarry' | 'stockpile' | 'cancel';

export type OrderCommand =
  | { readonly kind: 'markArea'; readonly order: AreaOrder; readonly area: TileArea }
  // x, y is the center tile of the 3x3.
  | { readonly kind: 'placeHouse'; readonly x: number; readonly y: number };

export type Refusal =
  // Area orders that would change no tile.
  | 'no-trees'
  | 'no-rock'
  | 'no-open-ground'
  | 'nothing-to-cancel'
  // A tile of the house site.
  | 'off-map'
  | 'water'
  | 'rock'
  | 'trees'
  | 'camp'
  | 'site'
  | 'stockpile'
  | 'goods'
  // The whole site.
  | 'uneven'
  | 'divides'
  | 'full';

export type OrderOutcome =
  | { readonly ok: true; readonly order: AreaOrder | 'house'; readonly tiles: number }
  | { readonly ok: false; readonly order: AreaOrder | 'house'; readonly refusal: Refusal };

/** What changed in the orders since the last frame, as the worker sends it to the main thread. */
export interface OrderChanges {
  /** Pairs of a tile index and its claim now. */
  readonly claims: Int32Array;
  /** Groups of four: a site slot, its center x and y, and its state now. */
  readonly sites: Int32Array;
}

export function createOrders(map: TileMap, camp: number = campTile(map)): Orders {
  const tiles = map.size * map.size;
  return {
    camp,
    claims: new Uint8Array(tiles),
    sites: { x: new Int16Array(MAX_SITES), y: new Int16Array(MAX_SITES), state: new Uint8Array(MAX_SITES) },
    changes: { listed: new Uint8Array(tiles), tiles: new Int32Array(tiles), tileCount: 0, slots: new Uint8Array(MAX_SITES) },
    reached: new Uint8Array(tiles),
    queue: new Int32Array(tiles),
  };
}

/** Grass, forest with no tree, or a spent rock tile. */
export function openGround(map: TileMap, tile: number): boolean {
  const kind = map.kinds[tile];
  return kind === TileKind.Grass || kind === TileKind.Bare || (kind === TileKind.Forest && map.trees[tile] === 0);
}

function claim(orders: Orders, tile: number, value: Claim): void {
  orders.claims[tile] = value;
  const { changes } = orders;
  if (changes.listed[tile]) return;
  changes.listed[tile] = 1;
  changes.tiles[changes.tileCount++] = tile;
}

function setSite(orders: Orders, slot: number, x: number, y: number, state: SiteState): void {
  orders.sites.x[slot] = x;
  orders.sites.y[slot] = y;
  orders.sites.state[slot] = state;
  orders.changes.slots[slot] = 1;
}

function clip(map: TileMap, { x0, y0, x1, y1 }: TileArea): TileArea {
  const last = map.size - 1;
  return {
    x0: Math.max(Math.min(x0, x1), 0),
    y0: Math.max(Math.min(y0, y1), 0),
    x1: Math.min(Math.max(x0, x1), last),
    y1: Math.min(Math.max(y0, y1), last),
  };
}

function siteTouches(sites: Sites, slot: number, area: TileArea): boolean {
  const x = sites.x[slot]!;
  const y = sites.y[slot]!;
  return x + 1 >= area.x0 && x - 1 <= area.x1 && y + 1 >= area.y0 && y - 1 <= area.y1;
}

interface AreaRule {
  /** The claim that the order leaves on each tile it changes. */
  readonly claim: Claim;
  readonly refusal: Refusal;
  readonly changes: (map: TileMap, orders: Orders, tile: number) => boolean;
}

const AREA_RULES: Record<AreaOrder, AreaRule> = {
  chop: {
    claim: Claim.Chop,
    refusal: 'no-trees',
    changes: (map, orders, tile) => orders.claims[tile] === Claim.None && map.trees[tile] === 1,
  },
  quarry: {
    claim: Claim.Quarry,
    refusal: 'no-rock',
    changes: (map, orders, tile) => orders.claims[tile] === Claim.None && map.kinds[tile] === TileKind.Rock,
  },
  stockpile: {
    claim: Claim.Stockpile,
    refusal: 'no-open-ground',
    changes: (map, orders, tile) =>
      orders.claims[tile] === Claim.None && !underCamp(map, orders.camp, tile) && openGround(map, tile),
  },
  cancel: {
    claim: Claim.None,
    refusal: 'nothing-to-cancel',
    changes: (_map, orders, tile) => {
      const claim = orders.claims[tile];
      return claim === Claim.Chop || claim === Claim.Quarry || claim === Claim.Stockpile;
    },
  },
};

/**
 * Calls visit for each tile the area order would change, and returns the count. applyOrder uses it, and the
 * interface uses it for the drag preview. Cancel visits marked/stockpile tiles in the area and all nine tiles
 * of each unfinished site that touches the area (never a House).
 */
export function areaEffect(
  map: TileMap,
  orders: Orders,
  order: AreaOrder,
  area: TileArea,
  visit?: (tile: number) => void,
): number {
  const { size } = map;
  const { changes } = AREA_RULES[order];
  const bounds = clip(map, area);
  let count = 0;
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    for (let x = bounds.x0; x <= bounds.x1; x++) {
      const tile = y * size + x;
      if (!changes(map, orders, tile)) continue;
      visit?.(tile);
      count += 1;
    }
  }
  if (order !== 'cancel') return count;

  const { sites } = orders;
  for (let slot = 0; slot < MAX_SITES; slot++) {
    if (sites.state[slot] !== SiteState.Site || !siteTouches(sites, slot, bounds)) continue;
    for (let y = sites.y[slot]! - 1; y <= sites.y[slot]! + 1; y++) {
      for (let x = sites.x[slot]! - 1; x <= sites.x[slot]! + 1; x++) visit?.(y * size + x);
    }
    count += 9;
  }
  return count;
}

/**
 * What stops this one tile from taking part in a house site, or null. Order: water, rock, trees, camp,
 * site (incl. house), stockpile, goods.
 */
export function siteTileProblem(map: TileMap, orders: Orders, tile: number): Refusal | null {
  const kind = map.kinds[tile];
  if (kind === TileKind.Water) return 'water';
  if (kind === TileKind.Rock) return 'rock';
  if (map.trees[tile] === 1) return 'trees';
  if (underCamp(map, orders.camp, tile)) return 'camp';
  const claim = orders.claims[tile];
  if (claim === Claim.Site) return 'site';
  if (claim === Claim.Stockpile) return 'stockpile';
  if (map.stackSize[tile]! > 0) return 'goods';
  return null;
}

function freeSlot(orders: Orders): number {
  return orders.sites.state.indexOf(SiteState.Free);
}

const BEFORE = 1;
const AFTER = 2;

/**
 * Marks with `bit` every tile that a walk from the camp reaches, where sites, houses, and tiles that already
 * hold `bit` block the walk. Walks cut a corner only past two walkable tiles, so side steps reach exactly
 * what walks reach.
 */
function markReach(map: TileMap, orders: Orders, bit: number): void {
  const { size } = map;
  const { claims, reached, queue } = orders;
  let head = 0;
  let tail = 0;
  const enqueue = (tile: number) => {
    if ((reached[tile]! & bit) !== 0 || !walkable(map, tile) || claims[tile] === Claim.Site) return;
    reached[tile] = reached[tile]! | bit;
    queue[tail++] = tile;
  };
  enqueue(orders.camp);
  while (head < tail) {
    const tile = queue[head++]!;
    const x = tile % size;
    if (x > 0) enqueue(tile - 1);
    if (x < size - 1) enqueue(tile + 1);
    if (tile >= size) enqueue(tile - size);
    if (tile < size * (size - 1)) enqueue(tile + size);
  }
}

function divides(map: TileMap, orders: Orders, x: number, y: number): boolean {
  const { size } = map;
  const { reached } = orders;
  reached.fill(0);
  markReach(map, orders, BEFORE);
  // Holding only AFTER, the nine tiles block the second walk and drop out of the check below.
  for (let ty = y - 1; ty <= y + 1; ty++) reached.fill(AFTER, ty * size + x - 1, ty * size + x + 2);
  markReach(map, orders, AFTER);
  return reached.includes(BEFORE);
}

/**
 * Why a house centered on (x, y) is refused, or null if it fits. Checks in order: off-map (any of the nine
 * outside), each tile's problem, uneven (> MAX_SITE_RISE), full (no free slot), divides.
 */
export function siteRefusal(map: TileMap, orders: Orders, x: number, y: number): Refusal | null {
  const { size, heights } = map;
  if (x < 1 || y < 1 || x > size - 2 || y > size - 2) return 'off-map';
  let lowest = Infinity;
  let highest = -Infinity;
  for (let ty = y - 1; ty <= y + 1; ty++) {
    for (let tx = x - 1; tx <= x + 1; tx++) {
      const tile = ty * size + tx;
      const problem = siteTileProblem(map, orders, tile);
      if (problem) return problem;
      lowest = Math.min(lowest, heights[tile]!);
      highest = Math.max(highest, heights[tile]!);
    }
  }
  if (highest - lowest > MAX_SITE_RISE) return 'uneven';
  if (freeSlot(orders) < 0) return 'full';
  if (divides(map, orders, x, y)) return 'divides';
  return null;
}

export function applyOrder(map: TileMap, orders: Orders, command: OrderCommand): OrderOutcome {
  if (command.kind === 'placeHouse') {
    const { x, y } = command;
    const refusal = siteRefusal(map, orders, x, y);
    if (refusal) return { ok: false, order: 'house', refusal };
    const slot = freeSlot(orders);
    setSite(orders, slot, x, y, SiteState.Site);
    for (let ty = y - 1; ty <= y + 1; ty++) {
      for (let tx = x - 1; tx <= x + 1; tx++) claim(orders, ty * map.size + tx, Claim.Site);
    }
    return { ok: true, order: 'house', tiles: 9 };
  }

  const { order, area } = command;
  const rule = AREA_RULES[order];
  const tiles = areaEffect(map, orders, order, area, (tile) => claim(orders, tile, rule.claim));
  if (tiles === 0) return { ok: false, order, refusal: rule.refusal };
  if (order === 'cancel') {
    const bounds = clip(map, area);
    for (let slot = 0; slot < MAX_SITES; slot++) {
      if (orders.sites.state[slot] === SiteState.Site && siteTouches(orders.sites, slot, bounds)) {
        setSite(orders, slot, orders.sites.x[slot]!, orders.sites.y[slot]!, SiteState.Free);
      }
    }
  }
  return { ok: true, order, tiles };
}

/** The claims and sites changed since the last call, and forgets them. */
export function takeOrderChanges(orders: Orders): OrderChanges {
  const { changes, claims: claimed, sites } = orders;
  const claims = new Int32Array(changes.tileCount * 2);
  for (let i = 0; i < changes.tileCount; i++) {
    const tile = changes.tiles[i]!;
    claims[i * 2] = tile;
    claims[i * 2 + 1] = claimed[tile]!;
    changes.listed[tile] = 0;
  }
  changes.tileCount = 0;
  let slots = 0;
  for (let slot = 0; slot < MAX_SITES; slot++) slots += changes.slots[slot]!;
  const changed = new Int32Array(slots * 4);
  for (let slot = 0, at = 0; slot < MAX_SITES; slot++) {
    if (!changes.slots[slot]) continue;
    changed.set([slot, sites.x[slot]!, sites.y[slot]!, sites.state[slot]!], at);
    at += 4;
    changes.slots[slot] = 0;
  }
  return { claims, sites: changed };
}

/** Applies changes taken from another copy of the orders, as the main thread's copy does. */
export function applyOrderChanges(orders: Orders, { claims, sites }: OrderChanges): void {
  for (let i = 0; i < claims.length; i += 2) orders.claims[claims[i]!] = claims[i + 1]!;
  for (let i = 0; i < sites.length; i += 4) {
    const slot = sites[i]!;
    orders.sites.x[slot] = sites[i + 1]!;
    orders.sites.y[slot] = sites[i + 2]!;
    orders.sites.state[slot] = sites[i + 3]!;
  }
}
