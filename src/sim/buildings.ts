import { TICKS_PER_SECOND } from './calendar';
import { Good, type Unit } from './goods';
import type { Sites } from './orders';
import type { Sim } from './sim';

export const Building = { House: 0, Hut: 1, Barn: 2, Lodge: 3 } as const;
export type Building = (typeof Building)[keyof typeof Building];

/** The work a villager does in a place at a workplace. A villager with no place has none. */
export const Job = { None: 0, Forager: 1, Hunter: 2 } as const;
export type Job = (typeof Job)[keyof typeof Job];
/** Where a rule takes a villager with any job, or with none. */
export const ANYONE = -1;

export type BuildingName = 'house' | 'hut' | 'barn' | 'lodge';

export interface BuildingKind {
  /** What a place order and its outcome call it. */
  readonly name: BuildingName;
  /** Tiles along each side of its square footprint. */
  readonly side: number;
  /** Units of each good it needs. A good left out is needed 0 times. */
  readonly needs: Readonly<Partial<Record<Unit, number>>>;
  /** Ticks of building work once every unit has arrived, shared by its builders. */
  readonly workTicks: number;
  /** Places of work in the finished building; 0 for a building that is no workplace. */
  readonly places: number;
  /** The job a villager holds in one of its places; `Job.None` when it has none. */
  readonly job: Job;
  /** Tiles from the building's center within which its workers work; 0 when it has no workers. */
  readonly reach: number;
}

/** The one place a kind of building is declared. */
export const BUILDINGS: Readonly<Record<Building, BuildingKind>> = {
  [Building.House]: { name: 'house', side: 3, needs: { [Good.Log]: 12, [Good.Stone]: 6 }, workTicks: 90 * TICKS_PER_SECOND, places: 0, job: Job.None, reach: 0 },
  [Building.Hut]: { name: 'hut', side: 2, needs: { [Good.Log]: 8 }, workTicks: 30 * TICKS_PER_SECOND, places: 2, job: Job.Forager, reach: 20 },
  [Building.Barn]: { name: 'barn', side: 3, needs: { [Good.Log]: 16, [Good.Stone]: 6 }, workTicks: 90 * TICKS_PER_SECOND, places: 0, job: Job.None, reach: 0 },
  [Building.Lodge]: { name: 'lodge', side: 2, needs: { [Good.Log]: 8, [Good.Stone]: 4 }, workTicks: 30 * TICKS_PER_SECOND, places: 2, job: Job.Hunter, reach: 40 },
};

/** The longest side of any kind, so `MAX_SIDE * MAX_SIDE` tiles hold any footprint. */
export const MAX_SIDE = Math.max(...Object.values(BUILDINGS).map((kind) => kind.side));

/** Units of a good a kind of building needs. */
export function needOf(kind: BuildingKind, good: Unit): number {
  return kind.needs[good] ?? 0;
}

export function kindOf(sites: Sites, slot: number): BuildingKind {
  return BUILDINGS[sites.kind[slot] as Building];
}

/** The job of a villager whose workplace is the building in slot `workplace`, or `Job.None` for -1, no place. */
export function jobAt(sites: Sites, workplace: number): Job {
  return workplace < 0 ? Job.None : kindOf(sites, workplace).job;
}

/**
 * The first column or row of a footprint of `side` tiles, from the anchor tile
 * on that axis. A footprint of odd side is centered on its anchor, and one of
 * even side starts at it: a house covers its anchor and the eight tiles around
 * it, and a hut its anchor and the tiles right of it, below it, and both.
 */
export function footprintStart(anchor: number, side: number): number {
  return anchor - ((side - 1) >> 1);
}

/** The left column of the footprint of the site or building in a slot. */
export function siteX0(sites: Sites, slot: number): number {
  return footprintStart(sites.x[slot]!, kindOf(sites, slot).side);
}

/** The top row of the footprint of the site or building in a slot. */
export function siteY0(sites: Sites, slot: number): number {
  return footprintStart(sites.y[slot]!, kindOf(sites, slot).side);
}

/** The x of the middle of the footprint in a slot, in map units, where tile x spans x to x + 1. */
export function siteMidX(sites: Sites, slot: number): number {
  return siteX0(sites, slot) + kindOf(sites, slot).side / 2;
}

/** The y of the middle of the footprint in a slot, in map units. */
export function siteMidY(sites: Sites, slot: number): number {
  return siteY0(sites, slot) + kindOf(sites, slot).side / 2;
}

/** Whether a point lies within the reach of the workplace in `slot`, measured from the workplace's middle. */
export function withinReach(sites: Sites, slot: number, px: number, py: number): boolean {
  const { reach } = kindOf(sites, slot);
  const dx = px - siteMidX(sites, slot);
  const dy = py - siteMidY(sites, slot);
  return dx * dx + dy * dy <= reach * reach;
}

/**
 * The tile beside one of the building's tiles, sharing a side with it, that
 * has a walk to the camp and lies nearest a point in a straight line, or -1.
 * Equally near tiles go to the lowest.
 */
export function nearestDoor(sim: Sim, slot: number, px: number, py: number): number {
  const { size } = sim.map;
  const { sites } = sim.orders;
  const { side } = kindOf(sites, slot);
  const x0 = siteX0(sites, slot);
  const y0 = siteY0(sites, slot);
  let best = -1;
  let bestDistance = Infinity;
  for (let dy = -1; dy <= side; dy++) {
    for (let dx = -1; dx <= side; dx++) {
      if ((dx === -1 || dx === side) === (dy === -1 || dy === side)) continue;
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= size || y >= size || sim.flow.next[y * size + x] === -1) continue;
      const distance = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2;
      if (distance < bestDistance) {
        best = y * size + x;
        bestDistance = distance;
      }
    }
  }
  return best;
}
