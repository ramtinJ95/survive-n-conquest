// The orders of the `frost` and `farm-counts` scenarios on seed 7, given at tick 0, 08:00 on day 1.
import { Building } from '../../../../src/sim/buildings';
import type { TileArea } from '../../../../src/sim/orders';
import type { Command } from '../../../../src/sim/sim';

/**
 * `harvest`'s farm, field of 24 tiles, and barn, and `cold`'s two houses and woodshed, so that two households live
 * through the winter and their settlers sow the field in the next spring. The stockpile, which the woodshed splits its
 * logs from, lies south of the camp, clear of the barn. The Chop drag marks 54 trees, for the 78 logs of the farm, the
 * barn, the shed, the houses, and the firewood of the winter, and the Quarry drag 5 rock tiles for the 18 stone of the
 * houses and the barn. The camp's 100 food feed the settlers until the harvest comes in.
 */
export const FARM = { x: 136, y: 127 };
export const FIELD: TileArea = { x0: 130, y0: 121, x1: 135, y1: 124 };
export const BARN = { x: 132, y: 126 };
export const WOODSHED = { x: 126, y: 123 };
export const HOUSES = [{ x: 121, y: 122 }, { x: 121, y: 127 }];
export const CAMP_FOOD = 100;
export const FROST_COMMANDS: Command[] = [
  { kind: 'place', building: Building.Farm, ...FARM },
  { kind: 'markArea', order: 'field', area: FIELD },
  { kind: 'place', building: Building.Barn, ...BARN },
  { kind: 'place', building: Building.Woodshed, ...WOODSHED },
  ...HOUSES.map((at): Command => ({ kind: 'place', building: Building.House, ...at })),
  { kind: 'markArea', order: 'stockpile', area: { x0: 127, y0: 130, x1: 129, y1: 132 } },
  { kind: 'markArea', order: 'chop', area: { x0: 137, y0: 114, x1: 149, y1: 140 } },
  { kind: 'markArea', order: 'quarry', area: { x0: 121, y0: 113, x1: 123, y1: 115 } },
];
