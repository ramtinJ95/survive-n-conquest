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
