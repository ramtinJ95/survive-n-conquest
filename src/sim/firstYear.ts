import { Building } from './buildings';
import type { TileArea } from './orders';
import type { Command } from './sim';

/**
 * The one forager's hut of the first year on seed 7, which
 * `scripts/first-year.ts` runs and the tests measure. The hut stands on open
 * ground at the forest's edge east of the camp, its middle 9.5 tiles from the
 * camp center, with 90 trees in its reach. The camp starts with no logs, so
 * the settlers also fell the four trees nearest the camp for the hut's 8 logs,
 * as a player would. They lie in the hut's reach and leave 86 trees to forage.
 */
export const FIRST_YEAR_SEED = 7;
/** The hut's anchor, its top left tile. */
export const FIRST_YEAR_HUT = { x: 136, y: 127 } as const;
/** The trees marked for chopping, whose logs build the hut. */
export const FIRST_YEAR_LOG_TREES: readonly (readonly [number, number])[] = [
  [137, 129],
  [138, 130],
  [134, 131],
  [135, 134],
];

/** The commands given at the first tick: the hut, and a chop order for each of its log trees. */
export function firstYearCommands(): Command[] {
  const tree = ([x, y]: readonly [number, number]): TileArea => ({ x0: x, y0: y, x1: x, y1: y });
  return [
    { kind: 'place', building: Building.Hut, x: FIRST_YEAR_HUT.x, y: FIRST_YEAR_HUT.y },
    ...FIRST_YEAR_LOG_TREES.map((at): Command => ({ kind: 'markArea', order: 'chop', area: tree(at) })),
  ];
}

/**
 * Where the first year's barn stands in the two runs that compare its place.
 * Beside the hut, the barn is on the forest side of it, its middle 2.5 tiles
 * from the hut's middle and 12 tiles from the camp center. Far from it, the barn
 * stands on open grass west of the camp, 32.5 tiles from the hut's middle and
 * 23 from the camp center, so the camp lies nearer every tree the hut reaches.
 */
export const FIRST_YEAR_BARNS = { beside: { x: 139, y: 127 }, far: { x: 104, y: 127 } } as const;
/** The eight trees nearest the camp after the hut's four, whose 16 logs build the barn. They lie in the hut's reach. */
export const FIRST_YEAR_BARN_TREES: readonly (readonly [number, number])[] = [
  [138, 132],
  [139, 125],
  [139, 124],
  [139, 130],
  [140, 125],
  [140, 129],
  [138, 135],
  [139, 120],
];
/** The rock tile nearest the camp, whose 8 stone hold the barn's 6. */
export const FIRST_YEAR_BARN_ROCK = [122, 115] as const;

/** One house for each of the four households, on open grass west of the camp, with the 24 trees and 3 rock tiles their goods come from. */
export const FIRST_YEAR_HOUSES: readonly (readonly [number, number])[] = [
  [121, 122],
  [121, 127],
  [121, 132],
  [117, 124],
];
export const FIRST_YEAR_HOUSE_TREES: readonly (readonly [number, number])[] = [
  [140, 132], [141, 125], [138, 118], [141, 130], [141, 132], [142, 126], [139, 137], [141, 120],
  [142, 133], [144, 129], [144, 132], [144, 121], [145, 126], [145, 128], [144, 134], [145, 131],
  [141, 139], [145, 132], [143, 137], [145, 121], [146, 127], [143, 116], [146, 131], [145, 119],
];
export const FIRST_YEAR_HOUSE_ROCKS: readonly (readonly [number, number])[] = [
  [121, 114],
  [123, 113],
  [122, 113],
];

const tile = ([x, y]: readonly [number, number]): TileArea => ({ x0: x, y0: y, x1: x, y1: y });

/**
 * The first year's commands with a barn anchored on `barn`, and the orders for
 * its goods. With `houses`, also a house for each household and their orders.
 */
export function barnYearCommands(barn: { readonly x: number; readonly y: number }, houses = false): Command[] {
  return [
    ...firstYearCommands(),
    { kind: 'place', building: Building.Barn, x: barn.x, y: barn.y },
    ...FIRST_YEAR_BARN_TREES.map((at): Command => ({ kind: 'markArea', order: 'chop', area: tile(at) })),
    { kind: 'markArea', order: 'quarry', area: tile(FIRST_YEAR_BARN_ROCK) },
    ...(houses
      ? [
          ...FIRST_YEAR_HOUSES.map(([x, y]): Command => ({ kind: 'place', building: Building.House, x, y })),
          ...FIRST_YEAR_HOUSE_TREES.map((at): Command => ({ kind: 'markArea', order: 'chop', area: tile(at) })),
          ...FIRST_YEAR_HOUSE_ROCKS.map((at): Command => ({ kind: 'markArea', order: 'quarry', area: tile(at) })),
        ]
      : []),
  ];
}

/**
 * The hunter's lodge of the first year with a hut, a barn, and a lodge, beside
 * the camp to its south west, its middle 3.5 tiles from the camp center. Of
 * the anchors within 14 tiles of the camp center that the rules accept beside
 * the hut and the barn of `barnYearCommands`, the most hold 4,613 tiles of
 * grass and forest within the lodge's 40, and this is the one of them nearest
 * the camp center, then the lowest tile. `scripts/hunt-year.ts` ranks them.
 */
export const FIRST_YEAR_LODGE = { x: 124, y: 129 } as const;
/** The four trees nearest the camp after the hut's four and the barn's eight, whose 8 logs build the lodge. */
export const FIRST_YEAR_LODGE_TREES: readonly (readonly [number, number])[] = [
  [140, 132],
  [141, 125],
  [138, 118],
  [141, 130],
];
/** The rock tile nearest the camp after the barn's, whose 8 stone hold the lodge's 4. */
export const FIRST_YEAR_LODGE_ROCK = [121, 114] as const;

/**
 * The commands of the first year with a barn beside the hut and a hunter's
 * lodge beside the camp, and the orders for the lodge's goods. Without `hut`,
 * the same commands but the hut's place command, so its four trees are still felled.
 */
export function huntYearCommands({ hut }: { readonly hut: boolean }): Command[] {
  const commands = [
    ...barnYearCommands(FIRST_YEAR_BARNS.beside),
    { kind: 'place', building: Building.Lodge, x: FIRST_YEAR_LODGE.x, y: FIRST_YEAR_LODGE.y },
    ...FIRST_YEAR_LODGE_TREES.map((at): Command => ({ kind: 'markArea', order: 'chop', area: tile(at) })),
    { kind: 'markArea', order: 'quarry', area: tile(FIRST_YEAR_LODGE_ROCK) },
  ] satisfies Command[];
  return hut ? commands : commands.filter((command) => !(command.kind === 'place' && command.building === Building.Hut));
}
