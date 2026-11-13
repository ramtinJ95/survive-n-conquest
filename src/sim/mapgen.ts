import { DEFAULT_MAP_SIZE, TileKind, WATER_LEVEL, type TileMap } from './map';
import { fractalNoise, hash, hashUnit } from './noise';

// Distances are in tiles and heights in meters. Features keep their size when the map grows.
const LAND = { span: 150, octaves: 3, lift: 5.5, relief: 15, peaks: 26 };
const HILLS = { span: 45, octaves: 4, relief: 6 };
const RIVER = { span: 190, octaves: 2, plain: 0.22, plainHeight: 1, bank: 0.05, bed: -2.4 };
const CRAGS = { span: 22, octaves: 2, from: 0.3, to: 0.46, highland: 0.012, rise: 3.2, rock: 0.45 };
const FOREST = { span: 70, octaves: 3, ragged: 0.12, floor: 0.6, treeLine: 12, thinning: 0.03 };
const CLIFF_SLOPE = 0.85;
const WOODED_SLOPE = 0.6;

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Builds the map for a seed. The same seed and size always give the same map. */
export function generateMap(seed: number, size: number = DEFAULT_MAP_SIZE): TileMap {
  const root = seed >>> 0;
  const layer = (index: number) => hash(root, index, 0x51ed);
  const land = layer(1);
  const hills = layer(2);
  const river = layer(3);
  const crags = layer(4);
  const moisture = layer(5);
  const scatter = layer(6);

  const heights = new Float32Array(size * size);
  const kinds = new Uint8Array(size * size);
  const outcrop = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const broad = fractalNoise(land, x / LAND.span, y / LAND.span, LAND.octaves);
      let height =
        LAND.lift +
        LAND.relief * broad +
        LAND.peaks * Math.max(broad, 0) ** 2 +
        HILLS.relief * fractalNoise(hills, x / HILLS.span, y / HILLS.span, HILLS.octaves);

      const channel = Math.abs(fractalNoise(river, x / RIVER.span, y / RIVER.span, RIVER.octaves));
      const plain = 1 - smoothstep(0, RIVER.plain, channel);
      height += (Math.min(height, RIVER.plainHeight + 0.2 * height) - height) * plain;
      height += (RIVER.bed - height) * (1 - smoothstep(0, RIVER.bank, channel));

      const crag =
        smoothstep(
          CRAGS.from,
          CRAGS.to,
          fractalNoise(crags, x / CRAGS.span, y / CRAGS.span, CRAGS.octaves) + CRAGS.highland * height,
        ) * smoothstep(0.5, 2.5, height);
      outcrop[i] = crag;
      heights[i] = height + CRAGS.rise * crag;
    }
  }

  const last = size - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const height = heights[i]!;
      const west = heights[i - (x > 0 ? 1 : 0)]!;
      const east = heights[i + (x < last ? 1 : 0)]!;
      const north = heights[i - (y > 0 ? size : 0)]!;
      const south = heights[i + (y < last ? size : 0)]!;
      const slope = Math.max(Math.abs(east - west), Math.abs(south - north)) / 2;
      const wet =
        fractalNoise(moisture, x / FOREST.span, y / FOREST.span, FOREST.octaves) +
        FOREST.ragged * (hashUnit(scatter, x, y) - 0.5) -
        FOREST.thinning * Math.max(height - FOREST.treeLine, 0);

      if (height < WATER_LEVEL) kinds[i] = TileKind.Water;
      else if (outcrop[i]! > CRAGS.rock || slope > CLIFF_SLOPE) kinds[i] = TileKind.Rock;
      else if (wet > 0 && height > FOREST.floor && slope < WOODED_SLOPE) kinds[i] = TileKind.Forest;
      else kinds[i] = TileKind.Grass;
    }
  }

  return { seed: root, size, heights, kinds };
}
