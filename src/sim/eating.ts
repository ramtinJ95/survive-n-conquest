import { ANYONE } from './buildings';
import { Good } from './goods';
import { eat, storeOf } from './needs';
import { planPath } from './paths';
import type { Sim } from './sim';
import { free, storeDoor } from './stores';
import type { TaskKind } from './tasks';

/** Whether the villager missed a meal, has empty hands, and the store it eats from holds a unit no carrier has spoken for. */
export function wantsMeal(sim: Sim, id: number): boolean {
  const { villagers } = sim;
  return villagers.missedMeals[id]! > 0 && villagers.carried[id] === Good.None && free(sim.stores, storeOf(sim, id), Good.Food) > 0;
}

/** Sends a villager that wants a meal to the door of the store it eats from, the camp center for the camp, and reserves the unit there. */
function take(sim: Sim, id: number): boolean {
  const { villagers, stores } = sim;
  if (!wantsMeal(sim, id)) return false;
  const store = storeOf(sim, id);
  const door = storeDoor(sim, store, villagers.x[id]!, villagers.y[id]!);
  if (door < 0 || !planPath(sim, id, door)) return false;
  stores.outbound[Good.Food - 1]![store]! += 1;
  villagers.fromStore[id] = store;
  villagers.taskTile[id] = door;
  villagers.workTile[id] = door;
  return true;
}

/** The meal stands while its store is still the one the villager eats from, which a house its household gains on the way is instead. */
function holds(sim: Sim, id: number): boolean {
  return sim.villagers.fromStore[id] === storeOf(sim, id);
}

/** Eats the reserved unit at the door. It takes no work ticks. */
function work(sim: Sim, id: number): boolean {
  const { villagers, stores } = sim;
  const store = villagers.fromStore[id]!;
  stores.outbound[Good.Food - 1]![store]! -= 1;
  villagers.fromStore[id] = -1;
  eat(sim, id, store);
  return true;
}

/** Gives back the reserved unit when the villager did not eat it. */
function release(sim: Sim, id: number): void {
  const { villagers, stores } = sim;
  const store = villagers.fromStore[id]!;
  if (store < 0) return;
  stores.outbound[Good.Food - 1]![store]! -= 1;
  villagers.fromStore[id] = -1;
}

const nothing = () => {};

/** Walking to the store a villager eats from to take the meal it missed, the most urgent kind of task. */
export const EATING: TaskKind = { job: ANYONE, take, holds, work, release, refresh: nothing, reopen: nothing };
