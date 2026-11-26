/** A chunk is `1 << CHUNK_SHIFT` tiles along each side. */
export const CHUNK_SHIFT = 4;
const CHUNK = 1 << CHUNK_SHIFT;

/**
 * A set of tiles on a square map, as a flag the size of the map. The tiles in
 * the set are counted by chunk, so the search for the nearest skips empty land.
 */
export interface TileSet {
  /** 1 where a tile is in the set. */
  readonly open: Uint8Array;
  /** Tiles in the set in each chunk, row by row. */
  readonly chunkOpen: Int32Array;
  /** Chunks along each side of the map. */
  readonly chunks: number;
  /** Tiles in the set. */
  count: number;
}

export function createTileSet(size: number): TileSet {
  const chunks = Math.ceil(size / CHUNK);
  return { open: new Uint8Array(size * size), chunkOpen: new Int32Array(chunks * chunks), chunks, count: 0 };
}

/** Puts a tile in the set or takes it out. */
export function setOpen(set: TileSet, size: number, tile: number, open: boolean): void {
  const value = open ? 1 : 0;
  if (set.open[tile] === value) return;
  set.open[tile] = value;
  const x = tile % size;
  const y = (tile - x) / size;
  const change = open ? 1 : -1;
  set.chunkOpen[(y >> CHUNK_SHIFT) * set.chunks + (x >> CHUNK_SHIFT)]! += change;
  set.count += change;
}

/**
 * The tile in the set nearest a point in a straight line, or -1. Rings of
 * chunks spread out from the point's chunk until no tile beyond them can be
 * nearer. Equally near tiles go to the lowest tile index.
 */
export function nearestOpen(set: TileSet, size: number, px: number, py: number): number {
  const { open, chunkOpen, chunks, count } = set;
  if (count === 0) return -1;
  const cx = Math.min(Math.max(Math.floor(px) >> CHUNK_SHIFT, 0), chunks - 1);
  const cy = Math.min(Math.max(Math.floor(py) >> CHUNK_SHIFT, 0), chunks - 1);
  let best = -1;
  let bestDistance = Infinity;
  let seen = 0;
  for (let ring = 0; ring < chunks; ring++) {
    const across = ring * 2;
    const ringChunks = ring === 0 ? 1 : ring * 8;
    for (let k = 0; k < ringChunks; k++) {
      let i: number;
      let j: number;
      if (k <= across) {
        i = cx - ring + k;
        j = cy - ring;
      } else if (k <= across * 2 + 1) {
        i = cx - ring + k - across - 1;
        j = cy + ring;
      } else {
        const m = k - across * 2 - 2;
        i = m % 2 === 0 ? cx - ring : cx + ring;
        j = cy - ring + 1 + (m >> 1);
      }
      if (i < 0 || j < 0 || i >= chunks || j >= chunks) continue;
      const inChunk = chunkOpen[j * chunks + i]!;
      if (inChunk === 0) continue;
      seen += inChunk;
      const x0 = i << CHUNK_SHIFT;
      const y0 = j << CHUNK_SHIFT;
      const x1 = Math.min(x0 + CHUNK, size);
      const y1 = Math.min(y0 + CHUNK, size);
      for (let y = y0; y < y1; y++) {
        const dy = y + 0.5 - py;
        for (let x = x0; x < x1; x++) {
          const tile = y * size + x;
          if (open[tile] === 0) continue;
          const dx = x + 0.5 - px;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance || (distance === bestDistance && tile < best)) {
            best = tile;
            bestDistance = distance;
          }
        }
      }
    }
    if (seen === count) break;
    if (best < 0) continue;
    const left = (cx - ring) << CHUNK_SHIFT;
    const right = (cx + ring + 1) << CHUNK_SHIFT;
    const top = (cy - ring) << CHUNK_SHIFT;
    const bottom = (cy + ring + 1) << CHUNK_SHIFT;
    let gap = Infinity;
    if (left > 0) gap = Math.min(gap, px - left + 0.5);
    if (right < size) gap = Math.min(gap, right + 0.5 - px);
    if (top > 0) gap = Math.min(gap, py - top + 0.5);
    if (bottom < size) gap = Math.min(gap, bottom + 0.5 - py);
    if (bestDistance < gap * gap) break;
  }
  return best;
}
