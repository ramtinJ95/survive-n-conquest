import { Job } from './buildings';
import { GOOD_KINDS, Good, pickUp, putDown, putDownHeld, refreshStack, reopenGoods, setAsideGoods } from './goods';
import { Claim } from './orders';
import { planPath } from './paths';
import type { Sim } from './sim';
import type { TaskKind } from './tasks';
import { nearestOpen } from './tileSet';

function reservePlace(sim: Sim, place: number, good: Good): void {
  const { goods } = sim;
  goods.inbound[place]! += 1;
  goods.inboundGood[place] = good;
  refreshStack(sim, place);
}

/**
 * The loose unit nearest a point in a straight line, among the goods that
 * some stockpile has room for, or -1. Equally near units go to the lowest tile index.
 */
function nearestLoose(sim: Sim, px: number, py: number): number {
  const { goods } = sim;
  const { size } = sim.map;
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < GOOD_KINDS; index++) {
    if (goods.room[index]!.count === 0) continue;
    const tile = nearestOpen(goods.loose[index]!, size, px, py);
    if (tile < 0) continue;
    const dx = (tile % size) + 0.5 - px;
    const dy = (tile - (tile % size)) / size + 0.5 - py;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance || (distance === bestDistance && tile < best)) {
      best = tile;
      bestDistance = distance;
    }
  }
  return best;
}

/** Sends a villager whose hands are full to the stockpile place nearest it with room for its unit. */
function takeHeld(sim: Sim, id: number): boolean {
  const { villagers, goods } = sim;
  const good = villagers.carried[id]! as Good;
  for (;;) {
    const place = nearestOpen(goods.room[good - 1]!, sim.map.size, villagers.x[id]!, villagers.y[id]!);
    if (place < 0) return false;
    if (!planPath(sim, id, place)) {
      setAsideGoods(sim, place);
      continue;
    }
    reservePlace(sim, place, good);
    villagers.destination[id] = place;
    villagers.workTile[id] = place;
    return true;
  }
}

/**
 * Reserves the loose unit nearest the villager and the stockpile place nearest
 * that unit, and sends the villager to the unit. A villager that already holds
 * a unit only needs a place for it.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, goods, map } = sim;
  if (villagers.carried[id] !== Good.None) return takeHeld(sim, id);
  const { size } = map;
  for (;;) {
    const source = nearestLoose(sim, villagers.x[id]!, villagers.y[id]!);
    if (source < 0) return false;
    if (!planPath(sim, id, source)) {
      setAsideGoods(sim, source);
      continue;
    }
    const good = map.stackGood[source]! as Good;
    const sx = (source % size) + 0.5;
    const sy = (source - (source % size)) / size + 0.5;
    const place = nearestOpen(goods.room[good - 1]!, size, sx, sy);
    goods.outbound[source]! += 1;
    refreshStack(sim, source);
    reservePlace(sim, place, good);
    villagers.taskTile[id] = source;
    villagers.destination[id] = place;
    villagers.workTile[id] = source;
    return true;
  }
}

/** The place is still in a stockpile, and a unit not yet picked up still lies off one. */
function holds(sim: Sim, id: number): boolean {
  const { villagers } = sim;
  const { claims } = sim.orders;
  if (claims[villagers.destination[id]!] !== Claim.Stockpile) return false;
  return villagers.carried[id] !== Good.None || claims[villagers.taskTile[id]!] !== Claim.Stockpile;
}

/**
 * Picks the unit up at its tile and turns the villager toward the place, or
 * stacks the unit at the place. Neither takes work ticks.
 */
function work(sim: Sim, id: number): boolean {
  const { villagers, goods } = sim;
  const place = villagers.destination[id]!;
  if (villagers.carried[id] === Good.None) {
    const source = villagers.taskTile[id]!;
    goods.outbound[source]! -= 1;
    villagers.carried[id] = pickUp(sim, source);
    villagers.workTile[id] = place;
    if (planPath(sim, id, place)) return false;
    setAsideGoods(sim, place);
    return true;
  }
  goods.inbound[place]! -= 1;
  refreshStack(sim, place);
  if (putDown(sim, place, villagers.carried[id]! as Good, 1)) {
    villagers.carried[id] = Good.None;
    sim.tally.stocked += 1;
  }
  villagers.destination[id] = -1;
  return true;
}

/**
 * Gives back what the task still holds: the place until the unit is stacked,
 * and the unit until it is picked up. A unit in the villager's hands is put
 * down where it stands, and stays in its hands when the land has no room for it.
 */
function release(sim: Sim, id: number): void {
  const { villagers, goods } = sim;
  const place = villagers.destination[id]!;
  if (place < 0) return;
  goods.inbound[place]! -= 1;
  refreshStack(sim, place);
  const good = villagers.carried[id]! as Good;
  if (good === Good.None) {
    const source = villagers.taskTile[id]!;
    goods.outbound[source]! -= 1;
    refreshStack(sim, source);
    return;
  }
  putDownHeld(sim, id);
}

/** Carrying one unit from the ground to a stockpile place. */
export const CARRYING: TaskKind = { job: Job.None, take, holds, work, release, refresh: refreshStack, reopen: reopenGoods };
