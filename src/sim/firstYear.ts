import { BUILDINGS, Building } from './buildings';
import { LOGS_PER_TREE, STONE_PER_ROCK } from './gathering';
import { Good } from './goods';
import { generateMap } from './mapgen';
import { SiteState, type TileArea } from './orders';
import { type Command, SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_FIREWOOD_LIMIT, HOUSE_FIREWOOD_LIMIT } from './stores';

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
 * The farm of the first spring on seed 7, on the hut's anchor, and its field of
 * 24 tiles of grass north west of it, 6 by 4, clear of the camp, whose middle
 * is 6.4 tiles from the farm's middle. The hut's four trees give the farm's 8 logs.
 */
export const FIRST_SPRING_FARM = FIRST_YEAR_HUT;
export const FIRST_SPRING_FIELD: TileArea = { x0: 129, y0: 122, x1: 134, y1: 125 };

/** The commands given at the first tick of the first spring: the farm, its field, and a chop order for each of its log trees. */
export function firstSpringCommands(): Command[] {
  return [
    { kind: 'place', building: Building.Farm, x: FIRST_SPRING_FARM.x, y: FIRST_SPRING_FARM.y },
    { kind: 'markArea', order: 'field', area: FIRST_SPRING_FIELD },
    ...FIRST_YEAR_LOG_TREES.map((at): Command => ({ kind: 'markArea', order: 'chop', area: { x0: at[0], y0: at[1], x1: at[0], y1: at[1] } })),
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

/**
 * The trees nearest the camp center that #30's orders leave standing, nearest
 * first, then the lowest tile. The years with warmth fell the first of them,
 * as many as their buildings and firewood need.
 */
export const WINTER_TREES: readonly (readonly [number, number])[] = [
  [141, 132], [142, 126], [139, 137], [141, 120], [142, 133], [144, 129], [144, 132], [144, 121],
  [145, 126], [145, 128], [144, 134], [145, 131], [141, 139], [145, 132], [143, 137], [145, 121],
  [146, 127], [143, 116], [146, 131], [145, 119], [143, 139], [147, 125], [147, 130], [144, 116],
  [143, 114], [147, 132], [147, 121], [147, 120], [141, 143], [148, 123], [145, 115], [142, 143],
  [144, 113], [149, 126], [149, 129], [145, 114], [145, 140], [148, 135], [146, 139],
];
/** The rock tiles nearest the camp center that #30's orders leave unmarked, nearest first. */
export const WINTER_ROCKS: readonly (readonly [number, number])[] = [
  [123, 113],
  [122, 113],
  [121, 113],
];

/** Where a year with warmth puts its woodshed, its stockpile, and its tailor's hut. */
export interface WarmthLayout {
  readonly woodshed: { readonly x: number; readonly y: number };
  readonly stockpile: TileArea;
  readonly tailor: { readonly x: number; readonly y: number } | null;
}

/**
 * 4.2's layout, east of the camp, with no tailor's hut. The woodshed takes the
 * anchor that the rules accept beside #30's buildings and two houses whose
 * middle lies nearest the camp center, 3.5 tiles, and the stockpile the 3 by 3
 * square nearest the camp center, 4.0 tiles.
 */
export const WOOD_LAYOUT: WarmthLayout = { woodshed: { x: 126, y: 123 }, stockpile: { x0: 130, y0: 126, x1: 132, y1: 128 }, tailor: null };
/**
 * 4.4's layout, west of the camp: the stockpile and the tailor's hut of #36's
 * tailor year, and the woodshed on the anchor the rules accept beside them
 * whose middle lies nearest the camp center, 3.5 tiles.
 */
export const HIDES_LAYOUT: WarmthLayout = { woodshed: { x: 124, y: 124 }, stockpile: { x0: 122, y0: 126, x1: 124, y1: 128 }, tailor: { x: 126, y: 123 } };

const WINTER_NIGHTS = 3;
const HOUSE_FIRE = 2;
const CAMP_FIRE = 4;

/** When a year with warmth gives its commands: all at the first tick, or the tailor's hut on the tick the lodge is finished, so the lodge hires its hunters first. */
export type TailorOrder = 'at start' | 'after lodge';

export interface WinterYear {
  readonly atStart: readonly Command[];
  /** Given on the tick the hunter's lodge is finished. */
  readonly afterLodge: readonly Command[];
}

/** Stage 3's year with a hut, a barn, and a lodge, with nothing for warmth. */
export const NOTHING_FOR_WARMTH: WinterYear = { atStart: huntYearCommands({ hut: true }), afterLodge: [] };

/**
 * #30's commands, the first `houses` of the first year's houses, the layout's
 * stockpile, tailor's hut, and woodshed, and chop and quarry orders on the
 * winter's trees and rocks for the logs and stone of these buildings and for
 * the firewood that fills each fire the winter lights once and then burns on
 * each of its nights. The camp's fire is among them while fewer houses than
 * households stand.
 */
export function winterYearCommands({ houses, layout, tailor }: { readonly houses: number; readonly layout: WarmthLayout; readonly tailor: TailorOrder }): WinterYear {
  const split = BUILDINGS[Building.Woodshed].recipe!;
  const firewoodPerLog = split.outputs / split.inputs;
  const logs = (building: Building) => BUILDINGS[building].needs[Good.Log] ?? 0;
  const firewood =
    houses * (HOUSE_FIREWOOD_LIMIT + HOUSE_FIRE * WINTER_NIGHTS) + (houses < FIRST_YEAR_HOUSES.length ? CAMP_FIREWOOD_LIMIT + CAMP_FIRE * WINTER_NIGHTS : 0);
  const logsNeeded = logs(Building.Woodshed) + (layout.tailor ? logs(Building.Tailor) : 0) + houses * logs(Building.House) + Math.ceil(firewood / firewoodPerLog);
  const trees = Math.ceil(logsNeeded / LOGS_PER_TREE);
  const rocks = Math.ceil((houses * (BUILDINGS[Building.House].needs[Good.Stone] ?? 0)) / STONE_PER_ROCK);
  if (trees > WINTER_TREES.length || rocks > WINTER_ROCKS.length) throw new Error(`a year with ${houses} houses needs ${trees} trees and ${rocks} rocks`);
  const placeTailor: Command[] = layout.tailor ? [{ kind: 'place', building: Building.Tailor, x: layout.tailor.x, y: layout.tailor.y }] : [];
  return {
    atStart: [
      ...huntYearCommands({ hut: true }),
      ...FIRST_YEAR_HOUSES.slice(0, houses).map(([x, y]): Command => ({ kind: 'place', building: Building.House, x, y })),
      { kind: 'markArea', order: 'stockpile', area: layout.stockpile },
      ...(tailor === 'at start' ? placeTailor : []),
      { kind: 'place', building: Building.Woodshed, x: layout.woodshed.x, y: layout.woodshed.y },
      ...WINTER_TREES.slice(0, trees).map((at): Command => ({ kind: 'markArea', order: 'chop', area: tile(at) })),
      ...WINTER_ROCKS.slice(0, rocks).map((at): Command => ({ kind: 'markArea', order: 'quarry', area: tile(at) })),
    ],
    afterLodge: tailor === 'after lodge' ? placeTailor : [],
  };
}

/**
 * A simulation on seed 7 with the year's first commands, the slot of its
 * lodge, and a step that gives the commands that wait for the lodge right
 * after the tick that finishes it. Throws on a refused command.
 */
export function playWinterYear(year: WinterYear): { readonly sim: Sim; readonly lodge: number; readonly step: () => void } {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  const give = (command: Command) => {
    const outcome = applyCommand(sim, command);
    if (!outcome?.ok) throw new Error(`refused at tick ${sim.tick}: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  };
  year.atStart.forEach(give);
  const lodge = sim.orders.siteOf[FIRST_YEAR_LODGE.y * sim.map.size + FIRST_YEAR_LODGE.x]!;
  let waiting = year.afterLodge.length > 0;
  return {
    sim,
    lodge,
    step: () => {
      step(sim);
      if (!waiting || sim.orders.sites.state[lodge] !== SiteState.Built) return;
      waiting = false;
      year.afterLodge.forEach(give);
    },
  };
}
