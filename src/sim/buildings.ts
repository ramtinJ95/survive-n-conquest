import { TICKS_PER_SECOND } from './calendar';
import type { Sites } from './orders';

export const Building = { House: 0, Hut: 1, Barn: 2 } as const;
export type Building = (typeof Building)[keyof typeof Building];

/** The work a villager does in a place at a workplace. A villager with no place has none. */
export const Job = { None: 0, Forager: 1 } as const;
export type Job = (typeof Job)[keyof typeof Job];
/** Where a rule takes a villager with any job, or with none. */
export const ANYONE = -1;

export type BuildingName = 'house' | 'hut' | 'barn';

export interface BuildingKind {
  /** What a place order and its outcome call it. */
  readonly name: BuildingName;
  /** Tiles along each side of its square footprint. */
  readonly side: number;
  /** Units of each good it needs, at index `good - 1` (logs, stone, food). */
  readonly needs: readonly number[];
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
  [Building.House]: { name: 'house', side: 3, needs: [12, 6, 0], workTicks: 90 * TICKS_PER_SECOND, places: 0, job: Job.None, reach: 0 },
  [Building.Hut]: { name: 'hut', side: 2, needs: [8, 0, 0], workTicks: 30 * TICKS_PER_SECOND, places: 2, job: Job.Forager, reach: 20 },
  [Building.Barn]: { name: 'barn', side: 3, needs: [16, 6, 0], workTicks: 90 * TICKS_PER_SECOND, places: 0, job: Job.None, reach: 0 },
};

/** The longest side of any kind, so `MAX_SIDE * MAX_SIDE` tiles hold any footprint. */
export const MAX_SIDE = Math.max(...Object.values(BUILDINGS).map((kind) => kind.side));

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
