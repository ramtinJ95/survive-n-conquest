import { type Job, jobAt, kindOf, siteMidX, siteMidY } from './buildings';
import { Good, putDownHeld } from './goods';
import { SiteState, setSitePlaces } from './orders';
import type { Sim } from './sim';
import { NO_TASK, VillagerState } from './villagerState';
import type { Villagers } from './villagers';

/**
 * Whether the villager works: it takes orders, fills places at workplaces,
 * carries, stocks, and wears clothing. A child does none of these. The tasks
 * and the jobs both ask this one test.
 */
export function works(villagers: Villagers, id: number): boolean {
  return villagers.child[id] === 0;
}

/** The job of the villager: the job of its workplace's kind, or `Job.None` when it has no place. */
export function jobOf(sim: Sim, id: number): Job {
  return jobAt(sim.orders.sites, sim.villagers.workplace[id]!);
}

/**
 * Gives the villager the place at `slot`, or takes its place away at -1. A
 * task its new job does not allow no longer stands, so it ends the way a
 * cancelled one does. A unit it holds for no task is put down.
 */
function assign(sim: Sim, id: number, slot: number): void {
  const { villagers } = sim;
  villagers.workplace[id] = slot;
  villagers.hired[id] = slot < 0 ? 0 : ++sim.hires;
  if (villagers.task[id] === NO_TASK && villagers.carried[id] !== Good.None) putDownHeld(sim, id);
}

/** The living villager without a job nearest the middle of a building in a straight line, or -1. Equally near villagers go to the lowest id. */
function nearestFree(sim: Sim, slot: number): number {
  const { villagers } = sim;
  const px = siteMidX(sim.orders.sites, slot);
  const py = siteMidY(sim.orders.sites, slot);
  let best = -1;
  let bestDistance = Infinity;
  for (let id = 0; id < villagers.count; id++) {
    if (villagers.state[id] === VillagerState.Dead || villagers.workplace[id]! >= 0 || !works(villagers, id)) continue;
    const dx = villagers.x[id]! - px;
    const dy = villagers.y[id]! - py;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Fills the open places of every finished workplace, in slot order, each with
 * the villager without a job nearest it, until every place the player wants
 * is filled or nobody is free. It runs when places open, never on its own.
 */
export function fillPlaces(sim: Sim): void {
  const { villagers, workers } = sim;
  const { sites } = sim.orders;
  workers.fill(0, 0, sites.used);
  for (let id = 0; id < villagers.count; id++) {
    const workplace = villagers.workplace[id]!;
    if (workplace >= 0) workers[workplace]! += 1;
  }
  for (let slot = 0; slot < sites.used; slot++) {
    if (sites.state[slot] !== SiteState.Built) continue;
    while (workers[slot]! < sites.places[slot]!) {
      const id = nearestFree(sim, slot);
      if (id < 0) return;
      assign(sim, id, slot);
      workers[slot]! += 1;
    }
  }
}

/** Asks for every place of a workplace just finished, and fills them. */
export function openWorkplace(sim: Sim, slot: number): void {
  setSitePlaces(sim.orders, slot, kindOf(sim.orders.sites, slot).places);
  fillPlaces(sim);
}

/** The worker at `slot` that came last, or -1 when it has none. */
function lastHired(sim: Sim, slot: number): number {
  const { workplace, hired, count } = sim.villagers;
  let last = -1;
  for (let id = 0; id < count; id++) if (workplace[id] === slot && (last < 0 || hired[id]! > hired[last]!)) last = id;
  return last;
}

/**
 * Sets how many places of a finished workplace the player wants filled,
 * clamped to its places. Lowering it frees the workers that came last, and
 * raising it fills the places by the nearest rule. Anything else is left as it is.
 */
export function setPlaces(sim: Sim, slot: number, places: number): void {
  const { sites } = sim.orders;
  if (sites.state[slot] !== SiteState.Built || kindOf(sites, slot).places === 0) return;
  const wanted = Math.min(Math.max(Math.trunc(places) || 0, 0), kindOf(sites, slot).places);
  setSitePlaces(sim.orders, slot, wanted);
  let workers = 0;
  for (let id = 0; id < sim.villagers.count; id++) if (sim.villagers.workplace[id] === slot) workers++;
  for (; workers > wanted; workers--) assign(sim, lastHired(sim, slot), -1);
  fillPlaces(sim);
}

/** Opens the place of a villager that just died, and fills it by the nearest rule. */
export function loseWorker(sim: Sim, id: number): void {
  if (sim.villagers.workplace[id]! < 0) return;
  sim.villagers.workplace[id] = -1;
  sim.villagers.hired[id] = 0;
  fillPlaces(sim);
}
