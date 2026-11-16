import { campTile, underCamp } from './camp';
import { TileKind, type TileMap, walkable } from './map';

export const Claim = { None: 0, Chop: 1, Quarry: 2, Stockpile: 3, Site: 4 } as const;
export type Claim = (typeof Claim)[keyof typeof Claim];

/** House: a finished house. */
export const SiteState = { Free: 0, Site: 1, House: 2 } as const;
export type SiteState = (typeof SiteState)[keyof typeof SiteState];

export const MAX_SITES = 1024;
/** The most that the highest of a site's nine tiles may stand above the lowest, in meters. */
export const MAX_SITE_RISE = 1.5;

/** Sites and houses, one fixed-capacity table. A slot index is the site's stable id. x, y is the center tile of the 3x3. */
export interface Sites {
  readonly x: Int16Array;
  readonly y: Int16Array;
  readonly state: Uint8Array;
  /** Ticks of building work done on each site. Work on a cancelled site is lost. */
  readonly work: Uint16Array;
  /** One past the highest slot ever placed, so no site or house lies at or above it. It never shrinks. */
  used: number;
}

export interface Orders {
  /** Tiles along each side of the map. */
  readonly size: number;
  /** The camp tile, from campTile(map). */
  readonly camp: number;
  /**
   * One Claim per tile, an array the size of the map. Chop only on tree tiles, Quarry only on rock tiles,
   * Stockpile and Site only on open ground. A tile holds at most one claim, so illegal combinations cannot
   * be represented. Site covers both unfinished sites and finished houses; the sites table tells them apart.
   */
  readonly claims: Uint8Array;
  readonly sites: Sites;
  /** The slot of the site or house on each tile, or -1. */
  readonly siteOf: Int16Array;
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

/** Int32 values per changed site in `OrderChanges.sites`: slot, center x, center y, state, work. */
export const SITE_CHANGE_STRIDE = 5;

/** What changed in the orders since the last frame, as the worker sends it to the main thread. */
export interface OrderChanges {
  /** Pairs of a tile index and its claim now. */
  readonly claims: Int32Array;
  /** Groups of `SITE_CHANGE_STRIDE`: a site slot, its center x and y, its state, and its work now. */
  readonly sites: Int32Array;
}

export function createOrders(map: TileMap, camp: number = campTile(map)): Orders {
  const tiles = map.size * map.size;
  return {
    size: map.size,
    camp,
    claims: new Uint8Array(tiles),
    sites: {
      x: new Int16Array(MAX_SITES),
      y: new Int16Array(MAX_SITES),
      state: new Uint8Array(MAX_SITES),
      work: new Uint16Array(MAX_SITES),
      used: 0,
    },
    siteOf: new Int16Array(tiles).fill(-1),
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

/** Sets a tile's claim and lists the tile for `takeOrderChanges`. */
export function setClaim(orders: Orders, tile: number, value: Claim): void {
  orders.claims[tile] = value;
  const { changes } = orders;
  if (changes.listed[tile]) return;
  changes.listed[tile] = 1;
  changes.tiles[changes.tileCount++] = tile;
}

/** Points the nine tiles centered on (x, y) at `slot`, or at no site when `slot` is -1. */
function pointNine(orders: Orders, x: number, y: number, slot: number): void {
  const { size } = orders;
  for (let ty = y - 1; ty <= y + 1; ty++) orders.siteOf.fill(slot, ty * size + x - 1, ty * size + x + 2);
}

/** Places a site in a free slot or frees one. Either way the slot starts with no work. */
function setSite(orders: Orders, slot: number, x: number, y: number, state: SiteState): void {
  orders.sites.x[slot] = x;
  orders.sites.y[slot] = y;
  orders.sites.state[slot] = state;
  orders.sites.work[slot] = 0;
  orders.changes.slots[slot] = 1;
  orders.sites.used = Math.max(orders.sites.used, slot + 1);
  pointNine(orders, x, y, state === SiteState.Free ? -1 : slot);
}

/** Sets the ticks of building work done on a site, and lists the site for `takeOrderChanges`. */
export function setSiteWork(orders: Orders, slot: number, work: number): void {
  orders.sites.work[slot] = work;
  orders.changes.slots[slot] = 1;
}

/** Turns a site whose work is done into a house. */
export function finishSite(orders: Orders, slot: number): void {
  orders.sites.state[slot] = SiteState.House;
  orders.changes.slots[slot] = 1;
}

/** The area with its corners in order, clipped to the map. */
export function clip(map: TileMap, { x0, y0, x1, y1 }: TileArea): TileArea {
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
  for (let slot = 0; slot < sites.used; slot++) {
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
      for (let tx = x - 1; tx <= x + 1; tx++) setClaim(orders, ty * map.size + tx, Claim.Site);
    }
    return { ok: true, order: 'house', tiles: 9 };
  }

  const { order, area } = command;
  const rule = AREA_RULES[order];
  const tiles = areaEffect(map, orders, order, area, (tile) => setClaim(orders, tile, rule.claim));
  if (tiles === 0) return { ok: false, order, refusal: rule.refusal };
  if (order === 'cancel') {
    const bounds = clip(map, area);
    for (let slot = 0; slot < orders.sites.used; slot++) {
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
  for (let slot = 0; slot < sites.used; slot++) slots += changes.slots[slot]!;
  const changed = new Int32Array(slots * SITE_CHANGE_STRIDE);
  for (let slot = 0, at = 0; slot < sites.used; slot++) {
    if (!changes.slots[slot]) continue;
    changed[at] = slot;
    changed[at + 1] = sites.x[slot]!;
    changed[at + 2] = sites.y[slot]!;
    changed[at + 3] = sites.state[slot]!;
    changed[at + 4] = sites.work[slot]!;
    at += SITE_CHANGE_STRIDE;
    changes.slots[slot] = 0;
  }
  return { claims, sites: changed };
}

/**
 * Applies changes taken from another copy of the orders, as the main thread's
 * copy does. Every changed site leaves its old tiles before any takes its new
 * ones, because a site freed and another placed on its tiles arrive together.
 */
export function applyOrderChanges(orders: Orders, { claims, sites }: OrderChanges): void {
  for (let i = 0; i < claims.length; i += 2) orders.claims[claims[i]!] = claims[i + 1]!;
  for (let i = 0; i < sites.length; i += SITE_CHANGE_STRIDE) {
    const slot = sites[i]!;
    if (orders.sites.state[slot] !== SiteState.Free) pointNine(orders, orders.sites.x[slot]!, orders.sites.y[slot]!, -1);
  }
  for (let i = 0; i < sites.length; i += SITE_CHANGE_STRIDE) {
    const slot = sites[i]!;
    orders.sites.x[slot] = sites[i + 1]!;
    orders.sites.y[slot] = sites[i + 2]!;
    orders.sites.state[slot] = sites[i + 3]!;
    orders.sites.work[slot] = sites[i + 4]!;
    orders.sites.used = Math.max(orders.sites.used, slot + 1);
    if (sites[i + 3] !== SiteState.Free) pointNine(orders, sites[i + 1]!, sites[i + 2]!, slot);
  }
}
