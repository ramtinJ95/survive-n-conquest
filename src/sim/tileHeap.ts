/**
 * A binary min-heap of tiles keyed by a number, with room for every tile of a
 * map. Each tile sits in it at most once, so pushing a queued tile again only
 * lowers its key. Nothing allocates after `createTileHeap`.
 */
export interface TileHeap {
  readonly tiles: Int32Array;
  readonly keys: Float64Array;
  /** Where each tile sits in `tiles`, or -1 when it is not queued. */
  readonly at: Int32Array;
  size: number;
}

export function createTileHeap(tiles: number): TileHeap {
  return { tiles: new Int32Array(tiles), keys: new Float64Array(tiles), at: new Int32Array(tiles).fill(-1), size: 0 };
}

function siftUp(heap: TileHeap, from: number, tile: number, key: number): void {
  const { tiles, keys, at } = heap;
  let i = from;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (keys[parent]! <= key) break;
    tiles[i] = tiles[parent]!;
    keys[i] = keys[parent]!;
    at[tiles[i]!] = i;
    i = parent;
  }
  tiles[i] = tile;
  keys[i] = key;
  at[tile] = i;
}

/** Queues a tile, or lowers the key of a queued tile. A key higher than the queued one changes nothing. */
export function pushTile(heap: TileHeap, tile: number, key: number): void {
  const queued = heap.at[tile]!;
  if (queued === -1) {
    siftUp(heap, heap.size++, tile, key);
  } else if (key < heap.keys[queued]!) {
    siftUp(heap, queued, tile, key);
  }
}

/** Removes the tile with the lowest key and returns it. The heap must not be empty. */
export function popTile(heap: TileHeap): number {
  const { tiles, keys, at } = heap;
  const top = tiles[0]!;
  at[top] = -1;
  const size = --heap.size;
  if (size === 0) return top;
  const tile = tiles[size]!;
  const key = keys[size]!;
  let i = 0;
  for (;;) {
    let child = i * 2 + 1;
    if (child >= size) break;
    if (child + 1 < size && keys[child + 1]! < keys[child]!) child += 1;
    if (keys[child]! >= key) break;
    tiles[i] = tiles[child]!;
    keys[i] = keys[child]!;
    at[tiles[i]!] = i;
    i = child;
  }
  tiles[i] = tile;
  keys[i] = key;
  at[tile] = i;
  return top;
}

/** Empties the heap. */
export function clearHeap(heap: TileHeap): void {
  for (let i = 0; i < heap.size; i++) heap.at[heap.tiles[i]!] = -1;
  heap.size = 0;
}
