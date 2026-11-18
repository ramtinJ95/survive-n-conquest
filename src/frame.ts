import { Good } from './sim/goods';
import { type OrderChanges, type OrderOutcome, takeOrderChanges } from './sim/orders';
import type { Sim, Speed } from './sim/sim';
import { takeTileChanges } from './sim/tileChanges';

export interface ClockSnapshot {
  readonly tick: number;
  readonly speed: Speed;
  readonly paused: boolean;
  /** True once the settlement has died out. The clock never moves again. */
  readonly over: boolean;
}

/** What the worker posts after the clock moves. Positions are pairs of map x and y in tiles, one pair per unit in id order. */
export interface SimFrame extends ClockSnapshot {
  readonly villagers: Float32Array;
  readonly monsters: Float32Array;
  /** One position pair for every row of the animal table, living or not. */
  readonly animals: Float32Array;
  /** One `AnimalKind` per animal row. */
  readonly animalKinds: Uint8Array;
  /** One `AnimalState` per animal row. A row that is `AnimalState.Gone` holds no animal. */
  readonly animalStates: Uint8Array;
  /** One `Good` per villager in id order: what each one carries. */
  readonly carried: Uint8Array;
  /** One `VillagerState` per villager in id order. A villager in its house at night is `VillagerState.Inside`, on the tile it went in on. */
  readonly states: Uint8Array;
  /** One task column value per villager in id order: `NO_TASK`, or one more than its kind's index in `TASK_KINDS`. */
  readonly tasks: Uint8Array;
  /** The tile of each villager's task in id order, or -1. */
  readonly taskTiles: Int32Array;
  /** The tile each villager carries its unit to in id order, such as the anchor of the site it supplies, or -1. */
  readonly destinations: Int32Array;
  /** One index into `NAMES[sex]` per villager in id order. */
  readonly names: Uint16Array;
  /** One `Sex` per villager in id order. */
  readonly sexes: Uint8Array;
  /** The household of each villager in id order. */
  readonly households: Int16Array;
  /** Per household: the site slot of its house, or `NO_HOME`. */
  readonly homes: Int16Array;
  /** The site slot of the workplace where each villager holds a place in id order, or -1. */
  readonly workplaces: Int16Array;
  /** When each villager took its place, in id order: a higher number came later. 0 for a villager with no place. */
  readonly hired: Uint32Array;
  /** The meals each villager missed in a row, in id order. */
  readonly missedMeals: Uint8Array;
  /** The cold nights each villager had in a row, in id order. */
  readonly coldNights: Uint8Array;
  /** The `Good` each villager's stocking task carries in id order, or `Good.None`. */
  readonly stockGoods: Uint8Array;
  /** The food in each store, by store id: a site slot, or `CAMP_STORE`. */
  readonly storeFood: Uint16Array;
  /** The most food the camp holds. */
  readonly campFoodLimit: number;
  /** Units of food on their way into each store, by store id, which count against its room. */
  readonly storeInbound: Uint16Array;
  /** The firewood in each store, by store id. */
  readonly storeFirewood: Uint16Array;
  /** The clothing in each store, by store id. */
  readonly storeClothing: Uint16Array;
  /** 1 for each store whose fire burns tonight, by store id. */
  readonly fires: Uint8Array;
  /** One `Stop` per site slot: what the worker of the workshop there does, or why it stopped, as its last look for work found. */
  readonly workshopStops: Uint8Array;
  /** The tiles changed since the last frame, as `takeTileChanges` groups them. */
  readonly tiles: Int32Array;
  /** The claims and sites changed since the last frame. */
  readonly orders: OrderChanges;
  /** What became of the order command applied just before this frame. */
  readonly outcome?: OrderOutcome;
}

function positions({ x, y }: { readonly x: Float32Array; readonly y: Float32Array }): Float32Array {
  const pairs = new Float32Array(x.length * 2);
  for (let id = 0; id < x.length; id++) {
    pairs[id * 2] = x[id]!;
    pairs[id * 2 + 1] = y[id]!;
  }
  return pairs;
}

/**
 * The frame the worker posts, copied out of the simulation, and the buffers
 * the post transfers. It takes the tile and order changes, so each change is
 * in exactly one frame.
 */
export function frameOf(sim: Sim, outcome?: OrderOutcome): { readonly frame: SimFrame; readonly transfer: Transferable[] } {
  const { villagers } = sim;
  const frame = {
    tick: sim.tick,
    speed: sim.speed,
    paused: sim.paused,
    over: sim.over,
    villagers: positions(villagers),
    monsters: positions(sim.monsters),
    animals: positions(sim.animals),
    animalKinds: sim.animals.kind.slice(),
    animalStates: sim.animals.state.slice(),
    carried: villagers.carried.slice(),
    states: villagers.state.slice(),
    tasks: villagers.task.slice(),
    taskTiles: villagers.taskTile.slice(),
    destinations: villagers.destination.slice(),
    names: villagers.name.slice(),
    sexes: villagers.sex.slice(),
    households: villagers.household.slice(),
    homes: sim.households.home.slice(),
    workplaces: villagers.workplace.slice(),
    hired: villagers.hired.slice(),
    missedMeals: villagers.missedMeals.slice(),
    coldNights: villagers.coldNights.slice(),
    stockGoods: villagers.stockGood.slice(),
    storeFood: sim.stores.held[Good.Food - 1]!.slice(),
    campFoodLimit: sim.stores.campLimit,
    storeInbound: sim.stores.inbound[Good.Food - 1]!.slice(),
    storeFirewood: sim.stores.held[Good.Firewood - 1]!.slice(),
    storeClothing: sim.stores.held[Good.Clothing - 1]!.slice(),
    fires: sim.stores.burning.slice(),
    workshopStops: sim.workshops.stopped.slice(),
    tiles: takeTileChanges(sim),
    orders: takeOrderChanges(sim.orders),
    outcome,
  } satisfies SimFrame;
  const transfer = [
    frame.villagers,
    frame.monsters,
    frame.animals,
    frame.animalKinds,
    frame.animalStates,
    frame.carried,
    frame.states,
    frame.tasks,
    frame.taskTiles,
    frame.destinations,
    frame.names,
    frame.sexes,
    frame.households,
    frame.homes,
    frame.workplaces,
    frame.hired,
    frame.missedMeals,
    frame.coldNights,
    frame.stockGoods,
    frame.storeFood,
    frame.storeInbound,
    frame.storeFirewood,
    frame.storeClothing,
    frame.fires,
    frame.workshopStops,
    frame.tiles,
    frame.orders.claims,
    frame.orders.sites,
  ].map((column) => column.buffer as ArrayBuffer);
  return { frame, transfer };
}
