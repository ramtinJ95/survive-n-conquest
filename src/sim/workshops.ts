import { arrived, lacking, siteAnchor } from './building';
import { ANYONE, kindOf, nearestDoor, needOf, siteMidX, siteMidY, withinReach } from './buildings';
import { Claim } from './claims';
import { Good, type Unit, pickUp, putDownHeld, refreshStack, setAsideGoods } from './goods';
import { MAX_SITES, SiteState } from './orders';
import { planPath } from './paths';
import type { Sim } from './sim';
import { limitOf } from './stores';
import type { TaskKind } from './tasks';
import { nearestOpen } from './tileSet';

/** What a workshop's worker makes: `outputs` units of `output` from `inputs` units of `input`, with `workTicks` of work. */
export interface Recipe {
  readonly input: Unit;
  readonly inputs: number;
  readonly output: Unit;
  readonly outputs: number;
  readonly workTicks: number;
}

/** What a workshop's worker does, or why it stopped, as its last look for work found. */
export const Stop = { Working: 0, Full: 1, NoInput: 2, ForSites: 3 } as const;
export type Stop = (typeof Stop)[keyof typeof Stop];

/**
 * The work at each workshop, by site slot. A batch is the `inputs` units of
 * input that make one batch of output.
 */
export interface Workshops {
  /** Units of input in the workshop toward its next batch. */
  readonly input: Uint8Array;
  /** Units of input on their way to the workshop. */
  readonly inbound: Uint8Array;
  /** Ticks of work done on the batch. Work stays when the worker leaves. */
  readonly progress: Uint16Array;
  /** The villager working the batch, or -1. */
  readonly worker: Int16Array;
  readonly stopped: Uint8Array;
  /** 1 for a workshop whose worker has taken any of its work since the last dawn. */
  readonly worked: Uint8Array;
}

export function createWorkshops(): Workshops {
  return {
    input: new Uint8Array(MAX_SITES),
    inbound: new Uint8Array(MAX_SITES),
    progress: new Uint16Array(MAX_SITES),
    worker: new Int16Array(MAX_SITES).fill(-1),
    stopped: new Uint8Array(MAX_SITES),
    worked: new Uint8Array(MAX_SITES),
  };
}

/** The slot of the villager's workplace when it is a finished workshop, or -1. */
function workshopOf(sim: Sim, id: number): number {
  const slot = sim.villagers.workplace[id]!;
  const { sites } = sim.orders;
  return slot >= 0 && sites.state[slot] === SiteState.Built && kindOf(sites, slot).recipe !== null ? slot : -1;
}

/** Whether the workshop's store has room for what the batches of its input already there and on their way make, and of one unit more. */
function roomForOneMore(sim: Sim, slot: number, recipe: Recipe): boolean {
  const { workshops } = sim;
  const batches = Math.ceil((workshops.input[slot]! + workshops.inbound[slot]! + 1) / recipe.inputs);
  const held = sim.stores.held[recipe.output - 1]![slot]!;
  return held + recipe.outputs * batches <= limitOf(sim.orders, sim.stores.campLimit, slot, recipe.output);
}

/** The units of a good that the building sites a walk reaches still lack, counting the units on their way to them. */
function lackingAtSites(sim: Sim, good: Unit): number {
  const { sites } = sim.orders;
  let units = 0;
  for (let slot = 0; slot < sites.used; slot++) {
    if (sites.state[slot] === SiteState.Site && sim.flow.next[siteAnchor(sim.orders, slot)] !== -1) units += lacking(sim, slot, good);
  }
  return units;
}

/** Whether a building site a walk reaches has not yet received every unit of a good it needs, counting none on their way. */
function sitesShort(sim: Sim, good: Unit): boolean {
  const { sites } = sim.orders;
  for (let slot = 0; slot < sites.used; slot++) {
    if (sites.state[slot] !== SiteState.Site || sim.flow.next[siteAnchor(sim.orders, slot)] === -1) continue;
    if (arrived(sim.map, sim.orders, slot, good) < needOf(kindOf(sites, slot), good)) return true;
  }
  return false;
}

/**
 * Sends the villager to the workshop's door nearest a point, along a route
 * planned to `walkTo`, the door itself or a unit to pick up on the way.
 * Returns false when no door or no route has a walk.
 */
function sendTo(sim: Sim, id: number, slot: number, walkTo: number, px: number, py: number): boolean {
  const { villagers } = sim;
  const door = nearestDoor(sim, slot, px, py);
  if (door < 0 || !planPath(sim, id, walkTo < 0 ? door : walkTo)) return false;
  villagers.toStore[id] = slot;
  villagers.destination[id] = door;
  villagers.workTile[id] = walkTo < 0 ? door : walkTo;
  return true;
}

/**
 * Gives the villager the next step of its workshop's work. A batch that waits
 * in the workshop with no worker is worked first, at the door. Else, while
 * the store has room for what one more unit makes, the villager walks to the
 * unit of input on a stockpile nearest the workshop within its reach, as long
 * as the stockpiles keep the units the building sites still lack, and
 * reserves it. A unit off a stockpile is never taken. A villager that still
 * holds a unit of input brings it in. Each look that gives work, or finds the
 * store full, no input in reach, or the input kept for the sites, says so in `stopped`.
 * With no input in reach while a site a walk reaches has not received all of the
 * input it needs, the sites are the reason: carriers take every unit to a site
 * before it reaches a stockpile.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, workshops, goods, map, orders } = sim;
  const slot = workshopOf(sim, id);
  if (slot < 0) return false;
  const recipe = kindOf(orders.sites, slot).recipe!;
  const px = villagers.x[id]!;
  const py = villagers.y[id]!;
  const held = villagers.carried[id]!;
  if (held === Good.None && workshops.input[slot]! >= recipe.inputs && workshops.worker[slot] === -1) {
    if (!sendTo(sim, id, slot, -1, px, py)) return false;
    workshops.worker[slot] = id;
    workshops.stopped[slot] = Stop.Working;
    workshops.worked[slot] = 1;
    return true;
  }
  if (held !== Good.None && held !== recipe.input) return false;
  if (!roomForOneMore(sim, slot, recipe)) {
    workshops.stopped[slot] = Stop.Full;
    return false;
  }
  if (held !== Good.None) {
    if (!sendTo(sim, id, slot, -1, px, py)) return false;
    workshops.inbound[slot]! += 1;
    workshops.stopped[slot] = Stop.Working;
    workshops.worked[slot] = 1;
    return true;
  }
  const { size } = map;
  const index = recipe.input - 1;
  const mx = siteMidX(orders.sites, slot);
  const my = siteMidY(orders.sites, slot);
  if (nearestDoor(sim, slot, mx, my) < 0) return false;
  for (;;) {
    const source = nearestOpen(goods.stocked[index]!, size, mx, my);
    const sx = (source % size) + 0.5;
    const sy = (source - (source % size)) / size + 0.5;
    if (source < 0 || !withinReach(orders.sites, slot, sx, sy)) {
      workshops.stopped[slot] = sitesShort(sim, recipe.input) ? Stop.ForSites : Stop.NoInput;
      return false;
    }
    if (goods.stockedUnits[index]! <= lackingAtSites(sim, recipe.input)) {
      workshops.stopped[slot] = Stop.ForSites;
      return false;
    }
    if (!sendTo(sim, id, slot, source, sx, sy)) {
      setAsideGoods(sim, source);
      continue;
    }
    goods.outbound[source]! += 1;
    refreshStack(sim, source);
    workshops.inbound[slot]! += 1;
    villagers.taskTile[id] = source;
    workshops.stopped[slot] = Stop.Working;
    workshops.worked[slot] = 1;
    return true;
  }
}

/** The villager still works at the workshop the task is for, and a unit it has not picked up still lies on a stockpile. */
function holds(sim: Sim, id: number): boolean {
  const { villagers } = sim;
  const slot = villagers.toStore[id]!;
  if (slot < 0 || workshopOf(sim, id) !== slot) return false;
  const source = villagers.taskTile[id]!;
  return villagers.carried[id] !== Good.None || source < 0 || sim.orders.claims[source] === Claim.Stockpile;
}

/**
 * Picks the unit up and turns the villager toward the door, or puts the unit
 * into the workshop there, neither of which takes work ticks. With a batch in
 * the workshop and no one at work on it, the villager works it: one tick of
 * work at a time, until the batch's output goes into the workshop's store.
 */
function work(sim: Sim, id: number): boolean {
  const { villagers, workshops, goods } = sim;
  const slot = villagers.toStore[id]!;
  const recipe = kindOf(sim.orders.sites, slot).recipe!;
  const source = villagers.taskTile[id]!;
  if (villagers.carried[id] === Good.None && source >= 0) {
    goods.outbound[source]! -= 1;
    villagers.carried[id] = pickUp(sim, source);
    villagers.taskTile[id] = -1;
    villagers.workTile[id] = villagers.destination[id]!;
    return !planPath(sim, id, villagers.workTile[id]!);
  }
  if (villagers.carried[id] !== Good.None) {
    villagers.carried[id] = Good.None;
    workshops.inbound[slot]! -= 1;
    workshops.input[slot]! += 1;
    if (workshops.input[slot]! < recipe.inputs || workshops.worker[slot] !== -1) return true;
    workshops.worker[slot] = id;
    return false;
  }
  workshops.progress[slot]! += 1;
  if (workshops.progress[slot]! < recipe.workTicks) return false;
  workshops.progress[slot] = 0;
  workshops.input[slot]! -= recipe.inputs;
  workshops.worker[slot] = -1;
  sim.stores.held[recipe.output - 1]![slot]! += recipe.outputs;
  sim.tally.batches += 1;
  sim.tally.made += recipe.outputs;
  return true;
}

/**
 * Gives back what the task still holds: the unit until it is picked up, its
 * place among the units on their way to the workshop until it is put in, and
 * the batch, whose work stays in the workshop for the next look. A unit in
 * the villager's hands is put down where it stands, for a settler without a
 * job to carry to a stockpile, and stays in its hands when the land has no room for it.
 */
function release(sim: Sim, id: number): void {
  const { villagers, workshops, goods } = sim;
  const slot = villagers.toStore[id]!;
  if (slot < 0) return;
  if (workshops.worker[slot] === id) workshops.worker[slot] = -1;
  const source = villagers.taskTile[id]!;
  if (villagers.carried[id] !== Good.None) {
    workshops.inbound[slot]! -= 1;
    putDownHeld(sim, id);
  } else if (source >= 0) {
    workshops.inbound[slot]! -= 1;
    goods.outbound[source]! -= 1;
    refreshStack(sim, source);
  }
}

const nothing = () => {};

/**
 * Carrying a unit of input from a stockpile to the villager's workshop and
 * working each batch there, the work of a woodcutter and of every worker at a
 * workshop. A villager without a place at a finished workshop never takes it.
 */
export const WORKSHOP: TaskKind = { job: ANYONE, take, holds, work, release, refresh: nothing, reopen: nothing };
