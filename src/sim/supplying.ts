import { deliver, lacking, siteAnchor } from './building';
import { Job, siteMidX, siteMidY } from './buildings';
import { GOOD_KINDS, Good, pickUp, putDownHeld, refreshStack, reopenGoods, setAsideGoods } from './goods';
import { SiteState } from './orders';
import { planPath } from './paths';
import type { Sim } from './sim';
import type { TaskKind } from './tasks';
import { nearestOpen } from './tileSet';

/** Whether a carrier can fetch a unit of the good from somewhere, on the ground or in a stockpile. */
function fetchable(sim: Sim, good: Good): boolean {
  return sim.goods.loose[good - 1]!.count + sim.goods.stocked[good - 1]!.count > 0;
}

/** Whether a site lacks a unit of `good`, or, for `Good.None`, a unit of any good a carrier can fetch. */
function wants(sim: Sim, slot: number, good: Good): boolean {
  if (good !== Good.None) return lacking(sim, slot, good) > 0;
  for (let index = 0; index < GOOD_KINDS; index++) {
    const kind = (index + 1) as Good;
    if (fetchable(sim, kind) && lacking(sim, slot, kind) > 0) return true;
  }
  return false;
}

/**
 * The site whose middle lies nearest a point in a straight line, among those
 * a walk from the camp reaches at their anchor and that want a unit, or -1.
 * Equally near sites go to the lowest slot.
 */
function nearestSite(sim: Sim, px: number, py: number, good: Good): number {
  const { sites } = sim.orders;
  let best = -1;
  let bestDistance = Infinity;
  for (let slot = 0; slot < sites.used; slot++) {
    if (sites.state[slot] !== SiteState.Site || sim.flow.next[siteAnchor(sim.orders, slot)] === -1) continue;
    const dx = siteMidX(sites, slot) - px;
    const dy = siteMidY(sites, slot) - py;
    const distance = dx * dx + dy * dy;
    if (distance >= bestDistance || !wants(sim, slot, good)) continue;
    best = slot;
    bestDistance = distance;
  }
  return best;
}

/**
 * The unit nearest a site's middle in a straight line among the goods it
 * lacks, on the ground or in a stockpile, or -1. Equally near units go to the lowest tile.
 */
function nearestUnit(sim: Sim, slot: number): number {
  const { goods } = sim;
  const { size } = sim.orders;
  const cx = siteMidX(sim.orders.sites, slot);
  const cy = siteMidY(sim.orders.sites, slot);
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < GOOD_KINDS; index++) {
    if (lacking(sim, slot, (index + 1) as Good) <= 0) continue;
    for (let kept = 0; kept < 2; kept++) {
      const tile = nearestOpen(kept === 0 ? goods.loose[index]! : goods.stocked[index]!, size, cx, cy);
      if (tile < 0) continue;
      const dx = (tile % size) + 0.5 - cx;
      const dy = (tile - (tile % size)) / size + 0.5 - cy;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance || (distance === bestDistance && tile < best)) {
        best = tile;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function reserve(sim: Sim, slot: number, good: Good): void {
  sim.siteTasks.inbound[slot * GOOD_KINDS + good - 1]! += 1;
}

/**
 * Reserves for the site nearest the villager the unit it lacks that lies
 * nearest the site, and sends the villager to the unit. A villager that
 * already holds a unit takes it to the nearest site that lacks one.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, goods, map, orders } = sim;
  const px = villagers.x[id]!;
  const py = villagers.y[id]!;
  const held = villagers.carried[id]! as Good;
  if (held !== Good.None) {
    const slot = nearestSite(sim, px, py, held);
    if (slot < 0) return false;
    const anchor = siteAnchor(orders, slot);
    if (!planPath(sim, id, anchor)) return false;
    reserve(sim, slot, held);
    villagers.destination[id] = anchor;
    villagers.workTile[id] = anchor;
    return true;
  }
  for (;;) {
    const slot = nearestSite(sim, px, py, Good.None);
    if (slot < 0) return false;
    const source = nearestUnit(sim, slot);
    if (!planPath(sim, id, source)) {
      setAsideGoods(sim, source);
      continue;
    }
    goods.outbound[source]! += 1;
    refreshStack(sim, source);
    reserve(sim, slot, map.stackGood[source]! as Good);
    villagers.taskTile[id] = source;
    villagers.destination[id] = siteAnchor(orders, slot);
    villagers.workTile[id] = source;
    return true;
  }
}

/** The site the unit goes to is still a site: not cancelled and not finished. */
function holds(sim: Sim, id: number): boolean {
  const slot = sim.orders.siteOf[sim.villagers.destination[id]!]!;
  return slot >= 0 && sim.orders.sites.state[slot] === SiteState.Site;
}

/** Picks the unit up and turns the villager toward the site, or delivers it there. Neither takes work ticks. */
function work(sim: Sim, id: number): boolean {
  const { villagers, goods, orders } = sim;
  const anchor = villagers.destination[id]!;
  if (villagers.carried[id] === Good.None) {
    const source = villagers.taskTile[id]!;
    goods.outbound[source]! -= 1;
    villagers.carried[id] = pickUp(sim, source);
    villagers.workTile[id] = anchor;
    return !planPath(sim, id, anchor);
  }
  const slot = orders.siteOf[anchor]!;
  const good = villagers.carried[id]! as Good;
  sim.siteTasks.inbound[slot * GOOD_KINDS + good - 1]! -= 1;
  villagers.carried[id] = Good.None;
  villagers.destination[id] = -1;
  deliver(sim, slot, good);
  return true;
}

/**
 * Gives back what the task still holds: the unit's place in what the site
 * lacks while the site stands, and the unit until it is picked up. A unit in
 * the villager's hands is put down where it stands, and stays in its hands
 * when the land has no room for it.
 */
function release(sim: Sim, id: number): void {
  const { villagers, goods } = sim;
  const anchor = villagers.destination[id]!;
  if (anchor < 0) return;
  const held = villagers.carried[id]! as Good;
  const source = villagers.taskTile[id]!;
  const good = held !== Good.None ? held : (sim.map.stackGood[source]! as Good);
  if (holds(sim, id)) sim.siteTasks.inbound[sim.orders.siteOf[anchor]! * GOOD_KINDS + good - 1]! -= 1;
  if (held !== Good.None) {
    putDownHeld(sim, id);
    return;
  }
  goods.outbound[source]! -= 1;
  refreshStack(sim, source);
}

/** Carrying one unit to a site that lacks it, from the ground or from a stockpile. */
export const SUPPLYING: TaskKind = { job: Job.None, take, holds, work, release, refresh: refreshStack, reopen: reopenGoods };
