import { ANIMALS, type AnimalKind, AnimalState, MAX_ANIMALS, removeAnimal, startFlight } from './animals';
import { Job, withinReach } from './buildings';
import { TICKS_PER_SECOND } from './calendar';
import { CARRYING, pickUpReserved, putInStore, reserveLoose, takeHeld } from './carrying';
import { Good, putDown, setAsideGoods } from './goods';
import { tileAt } from './map';
import { hashUnit } from './noise';
import { planPath } from './paths';
import type { Sim } from './sim';
import { Wants, nearestCommonStore } from './stores';
import type { TaskKind } from './tasks';
import { THINK_GROUPS } from './villagerState';

/** A hunter stops to aim once its deer is this many tiles away or nearer. */
export const AIM_FROM = 10;
/** Ticks of work a hunter aims before it shoots. */
export const AIM_TICKS = 4 * TICKS_PER_SECOND;
/** A hunter shoots only at a deer this many tiles away or nearer once its aim is done. */
export const SHOT_REACH = 12;
/** The share of shots that hit. */
export const HIT_CHANCE = 2 / 3;
const SHOT_SALT = 0x51a7_0c4d;

/** What each villager hunts, as columns of the villager table. */
export interface Hunting {
  /** The animal row each villager follows, or -1. */
  readonly prey: Int16Array;
  /** Ticks of aim each villager has done at its prey. */
  readonly aimed: Uint16Array;
  /** The tile of each villager's last kill, whose food it carries in until none is left there, or -1. */
  readonly kill: Int32Array;
}

export function createHunting(villagers: number): Hunting {
  return { prey: new Int16Array(villagers).fill(-1), aimed: new Uint16Array(villagers), kill: new Int32Array(villagers).fill(-1) };
}

/**
 * The living animal nearest a point in a straight line that lies within the
 * reach of the workplace in `slot`, stands where a walk from the camp reaches,
 * and that no other hunter follows, or -1. Equally near animals go to the lowest row.
 */
function nearestPrey(sim: Sim, slot: number, px: number, py: number): number {
  const { animals, map, flow } = sim;
  const { sites } = sim.orders;
  let best = -1;
  let bestDistance = Infinity;
  for (let row = 0; row < MAX_ANIMALS; row++) {
    if (animals.state[row] === AnimalState.Gone || animals.hunter[row] !== -1) continue;
    const ax = animals.x[row]!;
    const ay = animals.y[row]!;
    if (!withinReach(sites, slot, ax, ay) || flow.next[tileAt(map, ax, ay)] === -1) continue;
    const distance = (ax - px) ** 2 + (ay - py) ** 2;
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether the villager stands `reach` tiles from the animal or nearer. */
function within(sim: Sim, id: number, row: number, reach: number): boolean {
  const dx = sim.animals.x[row]! - sim.villagers.x[id]!;
  const dy = sim.animals.y[row]! - sim.villagers.y[id]!;
  return dx * dx + dy * dy <= reach * reach;
}

/**
 * Sends a hunter with empty hands after the deer nearest it in its lodge's
 * reach that no other hunter follows, while some common store has room for
 * what a kill gives. It claims the deer and walks to the deer's tile, or aims
 * from where it stands when the deer is already within `AIM_FROM`.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, animals, hunting, map } = sim;
  const workplace = villagers.workplace[id]!;
  if (workplace < 0 || villagers.carried[id] !== Good.None) return false;
  const px = villagers.x[id]!;
  const py = villagers.y[id]!;
  if (nearestCommonStore(sim, px, py, Wants.Room) < 0) return false;
  const deer = nearestPrey(sim, workplace, px, py);
  if (deer < 0) return false;
  const tile = tileAt(map, animals.x[deer]!, animals.y[deer]!);
  const workTile = within(sim, id, deer, AIM_FROM) ? tileAt(map, px, py) : tile;
  if (!planPath(sim, id, workTile)) return false;
  animals.hunter[deer] = id;
  hunting.prey[id] = deer;
  hunting.aimed[id] = 0;
  villagers.taskTile[id] = tile;
  villagers.workTile[id] = workTile;
  return true;
}

/**
 * Keeps a stalking hunter on its deer's trail until it aims. Once the deer
 * is within `AIM_FROM`, the hunter's route ends on the tile it stands on, and
 * it aims there. Farther off, on its think tick, it plans its route again to
 * the deer's tile when the deer has left the tile its route ends on. Returns
 * false when no walk reaches the deer.
 */
function follow(sim: Sim, id: number): boolean {
  const { villagers, animals, hunting, map } = sim;
  if (hunting.aimed[id]! > 0) return true;
  const deer = hunting.prey[id]!;
  if (within(sim, id, deer, AIM_FROM)) {
    const here = tileAt(map, villagers.x[id]!, villagers.y[id]!);
    if (villagers.workTile[id] === here) return true;
    villagers.workTile[id] = here;
    return planPath(sim, id, here);
  }
  if (sim.tick % THINK_GROUPS !== id % THINK_GROUPS) return true;
  const tile = tileAt(map, animals.x[deer]!, animals.y[deer]!);
  villagers.taskTile[id] = tile;
  if (villagers.workTile[id] === tile) return true;
  villagers.workTile[id] = tile;
  return planPath(sim, id, tile);
}

/** The hunter's deer still lives, the hunter still follows it, and it lies within the reach of the lodge the hunter works at now. */
function holds(sim: Sim, id: number): boolean {
  const { animals, hunting } = sim;
  const deer = hunting.prey[id]!;
  const workplace = sim.villagers.workplace[id]!;
  return (
    deer >= 0 &&
    workplace >= 0 &&
    animals.state[deer] !== AnimalState.Gone &&
    animals.hunter[deer] === id &&
    withinReach(sim.orders.sites, workplace, animals.x[deer]!, animals.y[deer]!)
  );
}

/** Whether the shot that is number `shot` on a map of `seed`, counted from 0, hits. It is a draw, so the same commands give the same hunts. */
export function shotHits(seed: number, shot: number): boolean {
  return hashUnit(seed ^ SHOT_SALT, shot, 0) < HIT_CHANCE;
}

/**
 * A hit kills the deer and puts its food down on its tile, spilling to the
 * nearest tiles with room, and the hunter carries that food in next. A miss
 * sends the deer running from the hunter.
 */
function shoot(sim: Sim, id: number, deer: number): void {
  const { animals, villagers, hunting, map } = sim;
  sim.tally.shots += 1;
  if (!shotHits(sim.seed, animals.shots++)) {
    startFlight(sim, deer, villagers.x[id]!, villagers.y[id]!);
    return;
  }
  const tile = tileAt(map, animals.x[deer]!, animals.y[deer]!);
  const { food } = ANIMALS[animals.kind[deer] as AnimalKind];
  removeAnimal(animals, deer);
  sim.tally.kills += 1;
  if (!putDown(sim, tile, Good.Food, food)) return;
  sim.tally.hunted += food;
  hunting.kill[id] = tile;
}

/**
 * One tick of aim. With the aim done, the hunter shoots if the deer is still
 * within `SHOT_REACH`. The task is over either way: the hunter carries a kill
 * in next, or stalks again.
 */
function work(sim: Sim, id: number): boolean {
  const { hunting } = sim;
  hunting.aimed[id] = hunting.aimed[id]! + 1;
  if (hunting.aimed[id]! < AIM_TICKS) return false;
  const deer = hunting.prey[id]!;
  if (within(sim, id, deer, SHOT_REACH)) shoot(sim, id, deer);
  return true;
}

/** Lets the deer go for any hunter to follow. */
function release(sim: Sim, id: number): void {
  const { animals, hunting } = sim;
  const deer = hunting.prey[id]!;
  if (deer >= 0 && animals.hunter[deer] === id) animals.hunter[deer] = -1;
  hunting.prey[id] = -1;
  hunting.aimed[id] = 0;
}

/** The loose unit of food on the kill's tile or on the eight tiles around it nearest a point, or -1. Equally near units go to the lowest tile. */
function nearestKillFood(sim: Sim, kill: number, px: number, py: number): number {
  const { size } = sim.map;
  const loose = sim.goods.loose[Good.Food - 1]!;
  const kx = kill % size;
  const ky = (kill - kx) / size;
  let best = -1;
  let bestDistance = Infinity;
  for (let y = Math.max(ky - 1, 0); y <= Math.min(ky + 1, size - 1); y++) {
    for (let x = Math.max(kx - 1, 0); x <= Math.min(kx + 1, size - 1); x++) {
      const tile = y * size + x;
      if (loose.open[tile] !== 1) continue;
      const distance = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2;
      if (distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Sends a hunter with empty hands to the unit of its kill's food nearest it,
 * and reserves the unit and a place in the common store nearest the unit with
 * room, as a settler without a job carries food from the ground. With no food
 * left at the kill, the hunter is done with it. A hunter that still holds a
 * unit, because the land had no room to put it down, takes it to a store.
 */
function fetch(sim: Sim, id: number): boolean {
  const { villagers, hunting } = sim;
  const held = villagers.carried[id]!;
  if (held === Good.Food) return takeHeld(sim, id);
  const kill = hunting.kill[id]!;
  if (held !== Good.None || kill < 0) return false;
  const source = nearestKillFood(sim, kill, villagers.x[id]!, villagers.y[id]!);
  if (source < 0) {
    hunting.kill[id] = -1;
    return false;
  }
  if (!planPath(sim, id, source)) {
    setAsideGoods(sim, source);
    return false;
  }
  return reserveLoose(sim, id, source);
}

/** Picks the unit up, or puts it into the store, as carrying does, and counts it among the food hunters carried in. */
function carryIn(sim: Sim, id: number): boolean {
  if (sim.villagers.carried[id] === Good.None) return pickUpReserved(sim, id);
  putInStore(sim, id);
  sim.tally.huntedIn += 1;
  return true;
}

const nothing = () => {};

/**
 * Carrying the food of the hunter's last kill to the nearest common store with
 * room, 1 unit at a time. The reservations, the hold, and the dusk rule are
 * carrying's: a unit in the hunter's hands at dusk is put down where it stands.
 */
export const FETCHING_KILL: TaskKind = { job: Job.Hunter, take: fetch, holds: CARRYING.holds, work: carryIn, release: CARRYING.release, refresh: nothing, reopen: nothing };

/** Stalking a deer in the lodge's reach, aiming, and shooting it, the work of a hunter. */
export const HUNTING: TaskKind = { job: Job.Hunter, take, follow, holds, work, release, refresh: nothing, reopen: nothing };
