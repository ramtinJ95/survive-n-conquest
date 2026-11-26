import { ageOf } from './sim/aging';
import { Good } from './sim/goods';
import { type Readiness, readinessOf } from './sim/readiness';
import { type OrderChanges, type OrderOutcome, takeOrderChanges } from './sim/orders';
import type { Sim, Speed } from './sim/sim';
import { takeTileChanges } from './sim/tileChanges';
import type { Villagers } from './sim/villagers';

export interface ClockSnapshot {
  readonly tick: number;
  readonly speed: Speed;
  readonly paused: boolean;
  /** True once the settlement has died out. The clock never moves again. */
  readonly over: boolean;
}

/**
 * What the worker posts after the clock moves. Positions are pairs of map x and
 * y in tiles, one pair per unit in id order. Every villager column holds the
 * rows of the villagers table in use and no other, so it has one entry for
 * each villager that ever lived on the map.
 */
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
  /** The site slot of the house each villager lodges in while its household has none, in id order, or `NO_HOME`. */
  readonly lodgings: Int16Array;
  /** 1 for each villager in id order while it is a child, who does no work. */
  readonly children: Uint8Array;
  /** The ids of each villager's mother and of its father in id order, or -1 for a settler the map started with. */
  readonly mothers: Int32Array;
  readonly fathers: Int32Array;
  /** Per household that formed: the site slot of its house, or `NO_HOME`. */
  readonly homes: Int16Array;
  /** Per household that formed, two ids: its couple's man and woman, or `NO_VILLAGER`. */
  readonly couples: Int32Array;
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
  /** The `Good` each villager wears in id order, `Good.Clothing` or `Good.None`. */
  readonly worn: Uint8Array;
  /** One `Cause` per villager in id order: what it died of, or `Cause.None` while it lives. */
  readonly causes: Uint8Array;
  /** Each villager's age in whole years in id order: at the frame's tick, or at its death once it died. */
  readonly ages: Uint8Array;
  /** The births, and the deaths of every cause, since the first tick of the calendar year the frame's tick is in. */
  readonly bornThisYear: number;
  readonly diedThisYear: number;
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
  /** 1 for each store whose fire burned in the night that ended at the last dawn, by store id. */
  readonly firesLastNight: Uint8Array;
  /** How ready the settlement is for the cold nights still to come, or null while none is. */
  readonly readiness: Readiness | null;
  /** One `Stop` per site slot: what the worker of the workshop there does, or why it stopped, as its last look for work found. */
  readonly workshopStops: Uint8Array;
  /** 1 per site slot for a workshop whose worker has taken any of its work since the last dawn. */
  readonly workshopWorked: Uint8Array;
  /** The tiles changed since the last frame, as `takeTileChanges` groups them. */
  readonly tiles: Int32Array;
  /** The claims and sites changed since the last frame. */
  readonly orders: OrderChanges;
  /** What became of the order command applied just before this frame. */
  readonly outcome?: OrderOutcome;
}

function positions({ x, y }: { readonly x: Float32Array; readonly y: Float32Array }, count = x.length): Float32Array {
  const pairs = new Float32Array(count * 2);
  for (let id = 0; id < count; id++) {
    pairs[id * 2] = x[id]!;
    pairs[id * 2 + 1] = y[id]!;
  }
  return pairs;
}

function agesOf(villagers: Villagers, tick: number): Uint8Array {
  const ages = new Uint8Array(villagers.count);
  for (let id = 0; id < villagers.count; id++) ages[id] = ageOf(villagers, id, tick);
  return ages;
}

function couplesOf({ households }: Sim): Int32Array {
  const couples = new Int32Array(households.count * 2);
  for (let h = 0; h < households.count; h++) {
    couples[h * 2] = households.man[h]!;
    couples[h * 2 + 1] = households.woman[h]!;
  }
  return couples;
}

/**
 * The frame the worker posts, copied out of the simulation, and the buffers
 * the post transfers. It takes the tile and order changes, so each change is
 * in exactly one frame.
 */
export function frameOf(sim: Sim, outcome?: OrderOutcome): { readonly frame: SimFrame; readonly transfer: Transferable[] } {
  const { villagers } = sim;
  const { count } = villagers;
  const frame = {
    tick: sim.tick,
    speed: sim.speed,
    paused: sim.paused,
    over: sim.over,
    villagers: positions(villagers, count),
    monsters: positions(sim.monsters),
    animals: positions(sim.animals),
    animalKinds: sim.animals.kind.slice(),
    animalStates: sim.animals.state.slice(),
    carried: villagers.carried.slice(0, count),
    states: villagers.state.slice(0, count),
    tasks: villagers.task.slice(0, count),
    taskTiles: villagers.taskTile.slice(0, count),
    destinations: villagers.destination.slice(0, count),
    names: villagers.name.slice(0, count),
    sexes: villagers.sex.slice(0, count),
    households: villagers.household.slice(0, count),
    lodgings: villagers.lodging.slice(0, count),
    children: villagers.child.slice(0, count),
    mothers: villagers.mother.slice(0, count),
    fathers: villagers.father.slice(0, count),
    homes: sim.households.home.slice(0, sim.households.count),
    couples: couplesOf(sim),
    workplaces: villagers.workplace.slice(0, count),
    hired: villagers.hired.slice(0, count),
    missedMeals: villagers.missedMeals.slice(0, count),
    coldNights: villagers.coldNights.slice(0, count),
    stockGoods: villagers.stockGood.slice(0, count),
    worn: villagers.worn.slice(0, count),
    causes: villagers.cause.slice(0, count),
    ages: agesOf(villagers, sim.tick),
    bornThisYear: sim.thisYear.born,
    diedThisYear: sim.thisYear.died,
    storeFood: sim.stores.held[Good.Food - 1]!.slice(),
    campFoodLimit: sim.stores.campLimit,
    storeInbound: sim.stores.inbound[Good.Food - 1]!.slice(),
    storeFirewood: sim.stores.held[Good.Firewood - 1]!.slice(),
    storeClothing: sim.stores.held[Good.Clothing - 1]!.slice(),
    fires: sim.stores.burning.slice(),
    firesLastNight: sim.stores.burnedLastNight.slice(),
    readiness: readinessOf(sim),
    workshopStops: sim.workshops.stopped.slice(),
    workshopWorked: sim.workshops.worked.slice(),
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
    frame.lodgings,
    frame.children,
    frame.mothers,
    frame.fathers,
    frame.homes,
    frame.couples,
    frame.workplaces,
    frame.hired,
    frame.missedMeals,
    frame.coldNights,
    frame.stockGoods,
    frame.worn,
    frame.causes,
    frame.ages,
    frame.storeFood,
    frame.storeInbound,
    frame.storeFirewood,
    frame.storeClothing,
    frame.fires,
    frame.firesLastNight,
    frame.workshopStops,
    frame.workshopWorked,
    frame.tiles,
    frame.orders.claims,
    frame.orders.sites,
  ].map((column) => column.buffer as ArrayBuffer);
  return { frame, transfer };
}
