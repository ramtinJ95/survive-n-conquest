import { DIRECTIONS, stepTo, tileAt, walkable } from './map';
import { Claim } from './orders';
import type { Sim } from './sim';
import { noteTileChange } from './tileChanges';
import { type TileSet, createTileSet, setOpen } from './tileSet';

export const Good = { None: 0, Log: 1, Stone: 2, Food: 3 } as const;
export type Good = (typeof Good)[keyof typeof Good];
/** How many goods there are, `Good.None` aside. */
export const GOOD_KINDS = 3;
/** Food put down on open ground is gone at this dawn after it was put down: the second. */
export const FOOD_KEEPS_DAWNS = 2;

/** A tile holds up to this many units of one good. */
export const STACK_LIMIT = 8;

/**
 * Which goods carriers can fetch, which stockpile places can take them, and
 * what carriers have already spoken for, as tile state the size of the map.
 * The goods themselves are the map's stacks.
 */
export interface GoodsState {
  /** Units of each tile's stack reserved by a carrier that walks to pick them up. */
  readonly outbound: Uint8Array;
  /** Places in each tile's stack reserved for units on their way to it. */
  readonly inbound: Uint8Array;
  /** The good of a tile's inbound units, where `inbound` is above 0. */
  readonly inboundGood: Uint8Array;
  /** By good, at index `good - 1`: the tiles off any stockpile, site, or house with an unreserved unit of that good that a walk from the camp reaches, not set aside. */
  readonly loose: readonly TileSet[];
  /** By good, at index `good - 1`: the stockpile tiles with an unreserved unit of that good that a walk from the camp reaches, not set aside. */
  readonly stocked: readonly TileSet[];
  /** By good, at index `good - 1`: the stockpile tiles that can take one more unit of that good that a walk from the camp reaches, not set aside. */
  readonly room: readonly TileSet[];
  /** 1 where a tile is set aside as out of reach for carrying and supplying, until dawn or until land gains walks. */
  readonly setAside: Uint8Array;
  /** The first `setAsideCount` are the tiles set aside. */
  readonly setAsideTiles: Int32Array;
  setAsideCount: number;
  /** The value of `Sim.dawns` at which the food stack on each tile is gone, where a stack of food lies. */
  readonly foodGoneAt: Uint16Array;
  /** 1 where a tile is among the first `foodCount` of `foodTiles`, the tiles that held food when it was put down. */
  readonly foodListed: Uint8Array;
  readonly foodTiles: Int32Array;
  foodCount: number;
}

export function createGoodsState(size: number): GoodsState {
  const tiles = size * size;
  return {
    outbound: new Uint8Array(tiles),
    inbound: new Uint8Array(tiles),
    inboundGood: new Uint8Array(tiles),
    loose: Array.from({ length: GOOD_KINDS }, () => createTileSet(size)),
    stocked: Array.from({ length: GOOD_KINDS }, () => createTileSet(size)),
    room: Array.from({ length: GOOD_KINDS }, () => createTileSet(size)),
    setAside: new Uint8Array(tiles),
    setAsideTiles: new Int32Array(tiles),
    setAsideCount: 0,
    foodGoneAt: new Uint16Array(tiles),
    foodListed: new Uint8Array(tiles),
    foodTiles: new Int32Array(tiles),
    foodCount: 0,
  };
}

/** Scratch for `putDown`'s walk, so putting goods down allocates nothing. Not part of the simulation's state. */
export interface PutDownSearch {
  /** The tiles the walk reached, in the order it reached them. */
  readonly queue: Int32Array;
  /** The search in which each tile was last reached. */
  readonly reached: Uint32Array;
  searches: number;
}

export function createPutDownSearch(tiles: number): PutDownSearch {
  return { queue: new Int32Array(tiles), reached: new Uint32Array(tiles), searches: 0 };
}

/**
 * How many units of `good` a tile can still take: walkable, no site or house,
 * and a stack that is empty or holds that good. A place reserved for a unit on
 * its way is taken, and an empty stack with units on their way holds their good.
 * A stockpile takes no food, and food joins only a stack put down since the
 * same dawn, so each unit is gone on the day its own night set.
 */
function room(sim: Sim, tile: number, good: Good): number {
  const { map, goods } = sim;
  const claim = sim.orders.claims[tile];
  if (!walkable(map, tile) || claim === Claim.Site) return 0;
  const size = map.stackSize[tile]!;
  if (good === Good.Food && (claim === Claim.Stockpile || (size > 0 && goods.foodGoneAt[tile] !== sim.dawns + FOOD_KEEPS_DAWNS))) return 0;
  const inbound = goods.inbound[tile]!;
  const held = size > 0 ? map.stackGood[tile] : inbound > 0 ? goods.inboundGood[tile] : Good.None;
  return held === Good.None || held === good ? STACK_LIMIT - size - inbound : 0;
}

/** Brings a tile's place in `loose`, `stocked`, and `room` up to date with its stack, its claim, its reservations, and its reach. */
export function refreshStack(sim: Sim, tile: number): void {
  const { map, goods } = sim;
  const reached = sim.flow.next[tile] !== -1 && goods.setAside[tile] === 0;
  const claim = sim.orders.claims[tile];
  const stockpile = claim === Claim.Stockpile;
  const unreserved = reached && map.stackSize[tile]! > goods.outbound[tile]! ? map.stackGood[tile] : Good.None;
  // Food is never stocked, so food lying on a stockpile tile is loose.
  const stocked = stockpile && unreserved !== Good.Food ? unreserved : Good.None;
  const loose = claim === Claim.Site || stocked !== Good.None ? Good.None : unreserved;
  for (let index = 0; index < GOOD_KINDS; index++) {
    const good = (index + 1) as Good;
    setOpen(goods.loose[index]!, map.size, tile, loose === good);
    setOpen(goods.stocked[index]!, map.size, tile, stocked === good);
    setOpen(goods.room[index]!, map.size, tile, reached && stockpile && room(sim, tile, good) > 0);
  }
}

/** Sets a tile aside as out of reach for carrying and supplying, until dawn or until land gains walks. */
export function setAsideGoods(sim: Sim, tile: number): void {
  const { goods } = sim;
  if (goods.setAside[tile] === 1) return;
  goods.setAside[tile] = 1;
  goods.setAsideTiles[goods.setAsideCount++] = tile;
  refreshStack(sim, tile);
}

/** Opens again every tile set aside for carrying and supplying. */
export function reopenGoods(sim: Sim): void {
  const { goods } = sim;
  for (let i = 0; i < goods.setAsideCount; i++) {
    const tile = goods.setAsideTiles[i]!;
    goods.setAside[tile] = 0;
    refreshStack(sim, tile);
  }
  goods.setAsideCount = 0;
}

/** Takes one unit off a tile's stack, as a carrier that reserved it picks it up, and returns its good. */
export function pickUp(sim: Sim, tile: number): Good {
  const { stackGood, stackSize } = sim.map;
  const good = stackGood[tile]! as Good;
  stackSize[tile] = stackSize[tile]! - 1;
  if (stackSize[tile] === 0) stackGood[tile] = Good.None;
  noteTileChange(sim, tile);
  refreshStack(sim, tile);
  return good;
}

/**
 * Puts `units` of `good` down, starting on tile `from`. A unit that the tile
 * cannot take lands on the nearest tile that can, counted in steps of a walk
 * from `from`, so a walker there can reach every unit. When the land that walks
 * from `from` reach lacks room for all of them, nothing is put down and it
 * returns false.
 */
export function putDown(sim: Sim, from: number, good: Good, units: number): boolean {
  const { map } = sim;
  const { size, stackGood, stackSize } = map;
  const { queue, reached } = sim.putDownSearch;
  const search = ++sim.putDownSearch.searches;
  reached[from] = search;
  queue[0] = from;
  let head = 0;
  let tail = 1;
  let found = 0;
  while (head < tail && found < units) {
    const tile = queue[head++]!;
    found += room(sim, tile, good);
    const x = tile % size;
    const y = (tile - x) / size;
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const neighbor = stepTo(map, x, y, direction);
      if (neighbor < 0 || reached[neighbor] === search) continue;
      reached[neighbor] = search;
      queue[tail++] = neighbor;
    }
  }
  if (found < units) return false;

  let left = units;
  for (let i = 0; left > 0; i++) {
    const tile = queue[i]!;
    const placed = Math.min(room(sim, tile, good), left);
    if (placed === 0) continue;
    if (good === Good.Food && stackSize[tile] === 0) listFood(sim, tile);
    stackGood[tile] = good;
    stackSize[tile] = stackSize[tile]! + placed;
    left -= placed;
    noteTileChange(sim, tile);
    refreshStack(sim, tile);
  }
  return true;
}

/** Starts a stack of food on a tile: it is gone at the second dawn from now. */
function listFood(sim: Sim, tile: number): void {
  const { goods } = sim;
  goods.foodGoneAt[tile] = sim.dawns + FOOD_KEEPS_DAWNS;
  if (goods.foodListed[tile] === 1) return;
  goods.foodListed[tile] = 1;
  goods.foodTiles[goods.foodCount++] = tile;
}

/**
 * Takes away the food on open ground whose day has come, at a dawn after
 * `Sim.dawns` counted it. Tiles whose food is not yet due stay listed, and
 * tiles that no longer hold food leave the list.
 */
export function spoilFood(sim: Sim): void {
  const { map, goods } = sim;
  let kept = 0;
  for (let i = 0; i < goods.foodCount; i++) {
    const tile = goods.foodTiles[i]!;
    const food = map.stackGood[tile] === Good.Food && map.stackSize[tile]! > 0;
    if (food && goods.foodGoneAt[tile]! > sim.dawns) {
      goods.foodTiles[kept++] = tile;
      continue;
    }
    goods.foodListed[tile] = 0;
    if (!food) continue;
    sim.tally.spoiled += map.stackSize[tile]!;
    map.stackGood[tile] = Good.None;
    map.stackSize[tile] = 0;
    noteTileChange(sim, tile);
    refreshStack(sim, tile);
  }
  goods.foodCount = kept;
}

/** Puts the unit in the villager's hands down where it stands. It stays in its hands when the land has no room for it. */
export function putDownHeld(sim: Sim, id: number): void {
  const { villagers } = sim;
  const good = villagers.carried[id]! as Good;
  if (putDown(sim, tileAt(sim.map, villagers.x[id]!, villagers.y[id]!), good, 1)) villagers.carried[id] = Good.None;
}
