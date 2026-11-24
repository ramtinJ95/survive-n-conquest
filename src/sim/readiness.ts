import { Building } from './buildings';
import { DAYS_PER_SEASON, TICKS_PER_DAY, seasonAt, tickOfDay, tickOfSeason } from './calendar';
import { COLD_SEASON, isNight } from './daylight';
import { Good } from './goods';
import { NO_HOME } from './households';
import { works } from './jobs';
import { WARM_SOURCES, clothed, fireLights, storeOf, warmth } from './needs';
import { SiteState } from './orders';
import type { Sim } from './sim';
import { CAMP_STORE, fireOf } from './stores';
import { VillagerState } from './villagerState';

/** The season before the cold one, from whose first day the reading shows. */
const READY_SEASON = 'Autumn';

/**
 * How ready the settlement is for the cold nights still to come, from what
 * each settler has now. `stocked` counts the houses that hold the firewood
 * their fires burn on every cold night whose dusk is still to come. The camp's
 * fire is read only while a household sleeps there. `settlers` and `clothed`
 * count only those who can wear clothing, so no child, and `cold` counts a
 * child by its own rule: it has no clothing to warm it.
 */
export interface Readiness {
  readonly nights: number;
  readonly housed: number;
  readonly households: number;
  readonly stocked: number;
  readonly houses: number;
  readonly clothed: number;
  readonly settlers: number;
  readonly cold: number;
  readonly camp: { readonly firewood: number; readonly burns: number; readonly lights: boolean } | null;
}

/** The cold nights whose dusk is still to come: all of them from the first day of the season before, and none outside those two seasons. */
export function nightsToCome(tick: number): number {
  const season = seasonAt(tick);
  if (season === READY_SEASON) return DAYS_PER_SEASON;
  if (season !== COLD_SEASON) return 0;
  const day = Math.floor(tickOfSeason(tick) / TICKS_PER_DAY);
  const evening = isNight(tick) && tickOfDay(tick) >= TICKS_PER_DAY / 2;
  return DAYS_PER_SEASON - day - Number(evening);
}

/** Whether a living villager would have a cold night if one fell now: it comes home to its house or the camp with what it has, by the rule that judges a night. */
export function wouldBeCold(sim: Sim, id: number): boolean {
  const store = storeOf(sim, id);
  return warmth(sim, id, store, fireLights(sim, store)) < WARM_SOURCES;
}

/** The reading, or null while no cold night is to come. Read once a frame, never inside a tick. */
export function readinessOf(sim: Sim): Readiness | null {
  const nights = nightsToCome(sim.tick);
  if (nights === 0) return null;
  const { households, villagers, orders, stores } = sim;
  let housed = 0;
  let living = 0;
  for (let h = 0; h < households.count; h++) {
    if (households.living[h] === 0) continue;
    living += 1;
    if (households.home[h] !== NO_HOME) housed += 1;
  }
  let houses = 0;
  let stocked = 0;
  for (let slot = 0; slot < orders.sites.used; slot++) {
    if (orders.sites.state[slot] !== SiteState.Built || orders.sites.kind[slot] !== Building.House) continue;
    houses += 1;
    if (stores.held[Good.Firewood - 1]![slot]! >= fireOf(orders, slot) * nights) stocked += 1;
  }
  let settlers = 0;
  let dressed = 0;
  let cold = 0;
  for (let id = 0; id < villagers.count; id++) {
    if (villagers.state[id] === VillagerState.Dead) continue;
    if (wouldBeCold(sim, id)) cold += 1;
    if (!works(villagers, id)) continue;
    settlers += 1;
    if (clothed(sim, id)) dressed += 1;
  }
  const camp =
    households.atCamp > 0
      ? { firewood: stores.held[Good.Firewood - 1]![CAMP_STORE]!, burns: fireOf(orders, CAMP_STORE), lights: fireLights(sim, CAMP_STORE) }
      : null;
  return { nights, housed, households: living, stocked, houses, clothed: dressed, settlers, cold, camp };
}
