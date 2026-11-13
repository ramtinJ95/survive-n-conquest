import { Color } from 'three';

/** The color of each surface of the world in spring, summer, autumn, and winter, in `SEASONS` order. */
const SURFACES = {
  grassLow: [0x8abd55, 0x6fa23f, 0xa59a4b, 0xe6ecf1],
  grassHigh: [0xbccb6e, 0xa9b05a, 0xb99e58, 0xf6f8fb],
  meadow: [0xb5d665, 0xd2c161, 0xc68843, 0xd9e3ec],
  forestFloor: [0x5a8c45, 0x426f34, 0x86683a, 0xc9d5df],
  rockLow: [0x8c887d, 0x8c887d, 0x857f76, 0x8a8f98],
  rockHigh: [0xb3afa4, 0xb3afa4, 0xaaa59b, 0xe1e7ee],
  sand: [0xd9c68e, 0xdcc88c, 0xcdb884, 0xdbe5ee],
  lakeBed: [0x2c4a4c, 0x2c4a4c, 0x2e4648, 0x27404f],
  water: [0x3d8fbd, 0x3a8cc4, 0x4a82a3, 0x3b6b8f],
  soil: [0x86623f, 0x86623f, 0x80603f, 0x776456],
  bedrock: [0x4b3524, 0x4b3524, 0x4b3524, 0x473a31],
  trunk: [0x6e4b2e, 0x6e4b2e, 0x66452a, 0x594739],
  pineLow: [0x2f6140, 0x2b5a3a, 0x2c5437, 0x2c5142],
  pineMid: [0x3a7a4b, 0x316743, 0x325f40, 0x9ab5ab],
  pineHigh: [0x4f9757, 0x377349, 0x386a45, 0xeef3f6],
  leafLow: [0x7ab64a, 0x4f8f36, 0xcf6f2a, 0x9c938d],
  leafHigh: [0xf2bfd0, 0x6fa844, 0xe3a72f, 0xe8eef3],
  boulder: [0x99958b, 0x99958b, 0x918c82, 0xc6cdd5],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type Surface = keyof typeof SURFACES;
export type Palette = Readonly<Record<Surface, Color>>;

/** One palette for each season, in `SEASONS` order. The meshes copy them into vertex colors when the world is built. */
export const PALETTES: readonly Palette[] = [0, 1, 2, 3].map(
  (season) =>
    Object.fromEntries(
      Object.entries(SURFACES).map(([surface, colors]) => [surface, new Color(colors[season])]),
    ) as Palette,
);
