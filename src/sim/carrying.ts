import { Job } from './buildings';
import { GOOD_KINDS, Good, type Unit, pickUp, putDown, putDownHeld, refreshStack, reopenGoods, setAsideGoods } from './goods';
import { Claim } from './orders';
import { planPath } from './paths';
import type { Sim } from './sim';
import { Wants, nearestCommonStore, storeDoor } from './stores';
import type { TaskKind } from './tasks';
import { nearestOpen } from './tileSet';

function reservePlace(sim: Sim, place: number, good: Good): void {
  const { goods } = sim;
  goods.inbound[place]! += 1;
  goods.inboundGood[place] = good;
  refreshStack(sim, place);
}

/** Whether some place takes one more unit of a good: a stockpile place for logs and stone, a common store for food. */
function roomFor(sim: Sim, good: Good, px: number, py: number): boolean {
  return good === Good.Food ? nearestCommonStore(sim, px, py, Wants.Room) >= 0 : sim.goods.room[good - 1]!.count > 0;
}

/**
 * The loose unit nearest a point in a straight line, among the goods that
 * some stockpile or store has room for, or -1. Equally near units go to the lowest tile index.
 */
function nearestLoose(sim: Sim, px: number, py: number): number {
  const { goods } = sim;
  const { size } = sim.map;
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < GOOD_KINDS; index++) {
    if (!roomFor(sim, (index + 1) as Good, px, py)) continue;
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

/**
 * Reserves a place for a unit of food in the common store nearest a point
 * with room, and points the villager at the store's door. Returns false when
 * no store has room or its door has no walk.
 */
function reserveStore(sim: Sim, id: number, px: number, py: number): boolean {
  const { villagers, stores } = sim;
  const store = nearestCommonStore(sim, px, py, Wants.Room);
  const door = store < 0 ? -1 : storeDoor(sim, store, px, py);
  if (door < 0) return false;
  stores.inbound[store] = stores.inbound[store]! + 1;
  villagers.toStore[id] = store;
  villagers.destination[id] = door;
  return true;
}

/** Sends a villager whose hands are full to the stockpile place, or the store for food, nearest it with room for its unit. */
export function takeHeld(sim: Sim, id: number): boolean {
  const { villagers, goods } = sim;
  const good = villagers.carried[id]! as Good;
  if (good === Good.Food) {
    if (!reserveStore(sim, id, villagers.x[id]!, villagers.y[id]!)) return false;
    villagers.workTile[id] = villagers.destination[id]!;
    if (planPath(sim, id, villagers.workTile[id]!)) return true;
    const store = villagers.toStore[id]!;
    sim.stores.inbound[store] = sim.stores.inbound[store]! - 1;
    villagers.toStore[id] = -1;
    villagers.destination[id] = -1;
    villagers.workTile[id] = -1;
    return false;
  }
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
 * Reserves the loose unit nearest the villager and the stockpile place, or for
 * food the common store, nearest that unit, and sends the villager to the
 * unit. A villager that already holds a unit only needs a place for it.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers } = sim;
  if (villagers.carried[id] !== Good.None) return takeHeld(sim, id);
  for (;;) {
    const source = nearestLoose(sim, villagers.x[id]!, villagers.y[id]!);
    if (source < 0) return false;
    if (!planPath(sim, id, source)) {
      setAsideGoods(sim, source);
      continue;
    }
    return reserveLoose(sim, id, source);
  }
}

/**
 * Reserves the loose unit on `source`, to which the villager's route is
 * planned, and the stockpile place, or for food the common store, nearest the
 * unit with room, and sends the villager to the unit. Returns false when no
 * store has room for food.
 */
export function reserveLoose(sim: Sim, id: number, source: number): boolean {
  const { villagers, goods } = sim;
  const { size } = sim.map;
  const good = sim.map.stackGood[source]! as Good;
  const sx = (source % size) + 0.5;
  const sy = (source - (source % size)) / size + 0.5;
  if (good === Good.Food) {
    if (!reserveStore(sim, id, sx, sy)) return false;
  } else {
    const place = nearestOpen(goods.room[good - 1]!, size, sx, sy);
    reservePlace(sim, place, good);
    villagers.destination[id] = place;
  }
  goods.outbound[source]! += 1;
  refreshStack(sim, source);
  villagers.taskTile[id] = source;
  villagers.workTile[id] = source;
  return true;
}

/**
 * The place is still in a stockpile, and a unit not yet picked up still lies
 * off one. A store never goes, and food lying on a stockpile stays loose, so a
 * task for food always stands.
 */
function holds(sim: Sim, id: number): boolean {
  const { villagers } = sim;
  const { claims } = sim.orders;
  if (villagers.toStore[id]! >= 0) return true;
  if (claims[villagers.destination[id]!] !== Claim.Stockpile) return false;
  return villagers.carried[id] !== Good.None || claims[villagers.taskTile[id]!] !== Claim.Stockpile;
}

/**
 * Picks the unit up at its tile and turns the villager toward the place, or
 * stacks the unit at the place, or puts food into the store. None takes work ticks.
 */
function work(sim: Sim, id: number): boolean {
  const { villagers, goods } = sim;
  const place = villagers.destination[id]!;
  if (villagers.carried[id] === Good.None) return pickUpReserved(sim, id);
  if (villagers.toStore[id]! >= 0) {
    putInStore(sim, id);
    sim.tally.fromGround += 1;
    return true;
  }
  goods.inbound[place]! -= 1;
  refreshStack(sim, place);
  if (putDown(sim, place, villagers.carried[id]! as Unit, 1)) {
    villagers.carried[id] = Good.None;
    sim.tally.stocked += 1;
  }
  villagers.destination[id] = -1;
  return true;
}

/**
 * Picks up the unit the villager reserved on its task tile and turns it toward
 * the place or store the unit goes to. Returns true, which ends the task, when
 * no walk reaches there.
 */
export function pickUpReserved(sim: Sim, id: number): boolean {
  const { villagers, goods } = sim;
  const place = villagers.destination[id]!;
  const source = villagers.taskTile[id]!;
  goods.outbound[source]! -= 1;
  villagers.carried[id] = pickUp(sim, source);
  villagers.workTile[id] = place;
  if (planPath(sim, id, place)) return false;
  if (villagers.toStore[id]! < 0) setAsideGoods(sim, place);
  return true;
}

/** Puts the unit of food in the villager's hands into the store it reserved a place in. */
export function putInStore(sim: Sim, id: number): void {
  const { villagers, stores } = sim;
  const store = villagers.toStore[id]!;
  stores.inbound[store] = stores.inbound[store]! - 1;
  stores.food[store] = stores.food[store]! + 1;
  villagers.carried[id] = Good.None;
  villagers.toStore[id] = -1;
  villagers.destination[id] = -1;
}

/**
 * Gives back what the task still holds: the place until the unit is stacked,
 * and the unit until it is picked up. A unit in the villager's hands is put
 * down where it stands, and stays in its hands when the land has no room for it.
 */
function release(sim: Sim, id: number): void {
  const { villagers, goods, stores } = sim;
  const place = villagers.destination[id]!;
  if (place < 0) return;
  const store = villagers.toStore[id]!;
  if (store >= 0) {
    stores.inbound[store] = stores.inbound[store]! - 1;
    villagers.toStore[id] = -1;
  } else {
    goods.inbound[place]! -= 1;
    refreshStack(sim, place);
  }
  villagers.destination[id] = -1;
  const good = villagers.carried[id]! as Good;
  if (good === Good.None) {
    const source = villagers.taskTile[id]!;
    goods.outbound[source]! -= 1;
    refreshStack(sim, source);
    return;
  }
  putDownHeld(sim, id);
}

/** Carrying one unit from the ground to a stockpile place, or food to the nearest common store with room. */
export const CARRYING: TaskKind = { job: Job.None, take, holds, work, release, refresh: refreshStack, reopen: reopenGoods };
