import { ANYONE } from './buildings';
import { Good } from './goods';
import { tileAt } from './map';
import { planPath } from './paths';
import type { Sim } from './sim';
import { nearestWorkshopWith, storeDoor } from './stores';
import type { TaskKind } from './tasks';

const CLOTHING = Good.Clothing - 1;

/**
 * Sends a villager that wears nothing and has empty hands to the door of the
 * tailor's hut nearest it in a straight line that holds a piece no other
 * villager has spoken for, and speaks for the piece. Only a door with a walk
 * to the camp counts, and the camp's flow field tells at no cost whether the
 * villager has one too, so a villager cut off from every hut searches no route.
 */
function take(sim: Sim, id: number): boolean {
  const { villagers, stores, flow, map } = sim;
  if (villagers.worn[id] !== Good.None || villagers.carried[id] !== Good.None) return false;
  const x = villagers.x[id]!;
  const y = villagers.y[id]!;
  if (flow.walk[tileAt(map, x, y)] === Infinity) return false;
  const hut = nearestWorkshopWith(sim, x, y, Good.Clothing);
  if (hut < 0) return false;
  const door = storeDoor(sim, hut, x, y);
  if (door < 0 || !planPath(sim, id, door)) return false;
  stores.outbound[CLOTHING]![hut]! += 1;
  villagers.fromStore[id] = hut;
  villagers.taskTile[id] = door;
  villagers.workTile[id] = door;
  return true;
}

/** The fetch stands while the hut still holds the piece spoken for. */
function holds(sim: Sim, id: number): boolean {
  return sim.stores.held[CLOTHING]![sim.villagers.fromStore[id]!]! > 0;
}

/** Takes the piece out of the hut and puts it on at the door. It takes no work ticks, and nothing is carried. */
function work(sim: Sim, id: number): boolean {
  const { villagers, stores } = sim;
  const hut = villagers.fromStore[id]!;
  stores.outbound[CLOTHING]![hut]! -= 1;
  stores.held[CLOTHING]![hut]! -= 1;
  villagers.fromStore[id] = -1;
  villagers.worn[id] = Good.Clothing;
  sim.tally.dressed += 1;
  return true;
}

/** Gives back the piece when the villager did not put it on. */
function release(sim: Sim, id: number): void {
  const { villagers, stores } = sim;
  const hut = villagers.fromStore[id]!;
  if (hut < 0) return;
  stores.outbound[CLOTHING]![hut]! -= 1;
  villagers.fromStore[id] = -1;
}

const nothing = () => {};

/** Walking to a tailor's hut to put on a piece of clothing, after eating and stocking the home and before every other kind of work. */
export const WEARING: TaskKind = { job: ANYONE, take, holds, work, release, refresh: nothing, reopen: nothing };
