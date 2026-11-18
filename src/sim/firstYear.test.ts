import { describe, expect, it } from 'vitest';
import { BUILDINGS, type Building } from './buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, dateAt, tickOfDay } from './calendar';
import { isDawn, isNight } from './daylight';
import {
  FIRST_YEAR_BARNS,
  FIRST_YEAR_HUT,
  FIRST_YEAR_LODGE,
  FIRST_YEAR_SEED,
  HIDES_LAYOUT,
  NOTHING_FOR_WARMTH,
  WOOD_LAYOUT,
  type WinterYear,
  barnYearCommands,
  firstYearCommands,
  huntYearCommands,
  playWinterYear,
  winterYearCommands,
} from './firstYear';
import { FORAGING } from './foraging';
import { Good } from './goods';
import { generateMap } from './mapgen';
import { type Sex, nameOf } from './names';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { SiteState } from './orders';
import { readinessOf } from './readiness';
import { CAMP_STORE, StoreKind, storeKind } from './stores';
import { TASK_KINDS } from './tasks';
import { VillagerState } from './villagerState';

const FORAGE = TASK_KINDS.indexOf(FORAGING) + 1;

function firstYear(): Sim {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of firstYearCommands()) expect(applyCommand(sim, command)).toMatchObject({ ok: true });
  return sim;
}

/** Steps through the day `day`, from its dawn to its dusk, and counts the units each villager picked in it. */
function picksOn(sim: Sim, day: number): number[] {
  while (!(isDawn(sim.tick) && dateAt(sim.tick).day === day)) step(sim);
  const picks = new Array<number>(sim.villagers.state.length).fill(0);
  const carried = Uint8Array.from(sim.villagers.carried);
  while (!isNight(sim.tick)) {
    step(sim);
    for (let id = 0; id < picks.length; id++) {
      if (sim.villagers.task[id] === FORAGE && carried[id] === Good.None && sim.villagers.carried[id] === Good.Food) picks[id]!++;
      carried[id] = sim.villagers.carried[id]!;
    }
  }
  return picks;
}

describe('the first year on seed 7 with a hut', () => {
  it('has the first forager hired pick 3 food on a spring day and 3 on an autumn day, and keeps all 8 alive past the day the settlement without one dies out', () => {
    const sim = firstYear();
    const hut = sim.orders.siteOf[FIRST_YEAR_HUT.y * sim.map.size + FIRST_YEAR_HUT.x]!;
    const spring = picksOn(sim, 2);
    const foragers = Array.from(sim.villagers.workplace, (place, id) => [place, id] as const).filter(([place]) => place === hut);
    const first = foragers.map(([, id]) => id).sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!)[0]!;
    expect(nameOf(sim.villagers.sex[first] as Sex, sim.villagers.name[first]!)).toBe('Ysa');
    expect(spring[first]).toBe(3);
    const autumn = picksOn(sim, 7);
    expect(autumn[first]).toBe(3);
    expect([sim.living, sim.tally.died]).toEqual([8, 0]);
  });

  it('reaches the same state at every dawn from the same commands', () => {
    const play = () => {
      const sim = firstYear();
      const dawns: unknown[] = [];
      while (dateAt(sim.tick).day < 7) {
        step(sim);
        if (!isDawn(sim.tick - 1)) continue;
        dawns.push(structuredClone({ villagers: sim.villagers, stores: sim.stores, foraging: sim.foraging, sites: sim.orders.sites, stackSize: sim.map.stackSize, trees: sim.map.trees }));
      }
      return { sim, dawns };
    };
    const first = play();
    const second = play();
    expect(first.dawns.length).toBe(5);
    expect(first.sim.tally.foraged).toBeGreaterThan(0);
    expect(second.dawns).toEqual(first.dawns);
    expect(second.sim.tally).toEqual(first.sim.tally);
  });
});

describe('the first year on seed 7 with a barn', () => {
  function yearWith(barn: { readonly x: number; readonly y: number }) {
    const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
    for (const command of barnYearCommands(barn)) expect(applyCommand(sim, command)).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[barn.y * sim.map.size + barn.x]!;
    let barnAtAutumnsEnd = 0;
    while (!sim.over && dateAt(sim.tick).day <= 12) {
      if (isNight(sim.tick) && !isNight(sim.tick - 1) && dateAt(sim.tick).day === 9) barnAtAutumnsEnd = sim.stores.held[Good.Food - 1]![slot]!;
      step(sim);
    }
    return { sim, barnAtAutumnsEnd };
  }

  it('has two foragers pick more with the barn beside the hut than with it far away, where the camp stays nearer every tree, and all 8 freeze in the last night of winter', () => {
    const beside = yearWith(FIRST_YEAR_BARNS.beside);
    const far = yearWith(FIRST_YEAR_BARNS.far);
    expect([beside.sim.tally.foraged, beside.barnAtAutumnsEnd, beside.sim.tally.missed, beside.sim.tally.froze, beside.sim.living]).toEqual([78, 30, 0, 8, 0]);
    expect([far.sim.tally.foraged, far.barnAtAutumnsEnd, far.sim.tally.missed, far.sim.tally.froze, far.sim.living]).toEqual([56, 0, 16, 8, 0]);
  });
});

describe("the first year on seed 7 with a hunter's lodge", () => {
  function huntYear(hut: boolean) {
    const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
    for (const command of huntYearCommands({ hut })) expect(applyCommand(sim, command)).toMatchObject({ ok: true });
    const lodge = sim.orders.siteOf[FIRST_YEAR_LODGE.y * sim.map.size + FIRST_YEAR_LODGE.x]!;
    const barns = () => {
      let food = 0;
      for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === StoreKind.Common) food += sim.stores.held[Good.Food - 1]![slot]!;
      return food;
    };
    let atAutumnsEnd: number[] = [];
    let huntersAtAutumnsEnd = 0;
    let winterKills = 0;
    while (!sim.over && dateAt(sim.tick).day <= 12) {
      if (dateAt(sim.tick).day === 10 && atAutumnsEnd.length === 0) {
        atAutumnsEnd = [barns(), sim.stores.held[Good.Food - 1]![CAMP_STORE]!, sim.tally.kills];
        huntersAtAutumnsEnd = Array.from(sim.villagers.workplace).filter((place) => place === lodge).length;
      }
      const kills = sim.tally.kills;
      step(sim);
      if (dateAt(sim.tick).season === 'Winter') winterKills += sim.tally.kills - kills;
    }
    return { sim, huntersAtAutumnsEnd, atAutumnsEnd, winterKills };
  }

  it('feeds all 8 settlers through the winter with the hut, the barn beside it, and the lodge, on stored forage and hunted deer, and all 8 freeze in its last night', () => {
    const { sim, huntersAtAutumnsEnd, atAutumnsEnd, winterKills } = huntYear(true);
    expect(huntersAtAutumnsEnd).toBe(2);
    const { tally } = sim;
    expect([tally.foraged, tally.shots, tally.kills, tally.hunted, tally.huntedIn, tally.fromGround, tally.spoiled]).toEqual([73, 17, 14, 84, 28, 57, 0]);
    expect(atAutumnsEnd).toEqual([97, 6, 13]);
    expect(winterKills).toBe(1);
    expect([tally.meals, tally.missed, tally.coldNights, tally.froze, sim.living]).toEqual([96, 0, 24, 8, 0]);
  });

  it('feeds all 8 through the year on hunted deer alone with the barn and the lodge and no hut, and all 8 freeze in the last night of winter', () => {
    const { sim, atAutumnsEnd, winterKills } = huntYear(false);
    const { tally } = sim;
    expect([tally.foraged, tally.shots, tally.kills, tally.hunted, tally.huntedIn, tally.fromGround, tally.spoiled]).toEqual([0, 15, 12, 72, 15, 57, 0]);
    expect(atAutumnsEnd).toEqual([18, 0, 11]);
    expect(winterKills).toBe(1);
    expect([tally.meals, tally.missed, tally.coldNights, tally.froze, sim.living]).toEqual([96, 0, 24, 8, 0]);
  });
});

describe('the first year on seed 7 with warmth', () => {
  const clock = (tick: number) => {
    const { day, minuteOfDay } = dateAt(tick);
    return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
  };
  const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);
  const barns = (sim: Sim) => {
    let food = 0;
    for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === StoreKind.Common) food += sim.stores.held[Good.Food - 1]![slot]!;
    return food;
  };

  /**
   * Plays the year to the dawn after its last night. Reads how many settlers
   * the reading counts cold at noon and at the last tick before each winter
   * night, and counts the cold nights each of those nights gave.
   */
  function winterYear(year: WinterYear) {
    const { sim, step } = playWinterYear(year);
    const finished = new Map<number, string>();
    const coldAtNoon: number[] = [];
    const coldBeforeNight: number[] = [];
    const coldNightsAtDusk: number[] = [];
    let barnAtYearEnd = 0;
    while (!sim.over && !(isDawn(sim.tick) && dateAt(sim.tick).day > DAYS_PER_YEAR)) {
      const { day, season } = dateAt(sim.tick);
      if (season === 'Winter' && tickOfDay(sim.tick) === TICKS_PER_DAY / 2) coldAtNoon.push(readinessOf(sim)!.cold);
      if (season === 'Winter' && isDusk(sim.tick + 1)) coldBeforeNight.push(readinessOf(sim)!.cold);
      if (season === 'Winter' && isDusk(sim.tick)) coldNightsAtDusk.push(sim.tally.coldNights);
      if (tickOfDay(sim.tick) === 0 && day === DAYS_PER_YEAR + 1) barnAtYearEnd = barns(sim);
      const ticked = sim.tick;
      step();
      for (let slot = 0; slot < sim.orders.sites.used; slot++) {
        if (sim.orders.sites.state[slot] === SiteState.Built && !finished.has(slot)) finished.set(slot, `${BUILDINGS[sim.orders.sites.kind[slot] as Building].name} ${clock(ticked)}`);
      }
    }
    if (sim.over) barnAtYearEnd = barns(sim);
    coldNightsAtDusk.push(sim.tally.coldNights);
    const coldNights = coldNightsAtDusk.slice(1).map((count, night) => count - coldNightsAtDusk[night]!);
    const living = Array.from(sim.villagers.state, (state, id) => [state, id] as const)
      .filter(([state]) => state !== VillagerState.Dead)
      .map(([, id]) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!));
    return { sim, finished: [...finished.values()], coldAtNoon, coldBeforeNight, coldNights, barnAtYearEnd, living };
  }

  it('with a house for each household and a woodshed, puts every log felled into the building sites, so the woodshed splits none and all 8 freeze in the last night', () => {
    const year = winterYear(winterYearCommands({ houses: 4, layout: WOOD_LAYOUT, tailor: 'at start' }));
    expect(year.finished).toEqual(['hut day 1 13:03', 'woodshed day 2 15:37', 'lodge day 3 17:43', 'barn day 5 17:35', 'house day 7 09:31', 'house day 8 13:03', 'house day 10 17:14']);
    const { tally } = year.sim;
    expect([tally.felled, tally.batches, tally.burnt, tally.firewoodHome, tally.firewoodToCamp]).toEqual([44, 0, 0, 0, 0]);
    expect([tally.foraged, tally.kills, tally.hides, tally.dressed]).toEqual([55, 11, 11, 0]);
    expect([tally.meals, tally.missed, year.barnAtYearEnd]).toEqual([96, 2, 37]);
    expect([tally.starved, tally.froze, year.living]).toEqual([0, 8, []]);
    expect(year.coldNights).toEqual([8, 8, 8]);
    expect(year.coldBeforeNight).toEqual(year.coldNights);
  });

  it("with two houses, a woodshed, and a tailor's hut placed when the lodge is finished, splits no firewood, and only the clothed household whose house is finished on the last day lives", () => {
    const year = winterYear(winterYearCommands({ houses: 2, layout: HIDES_LAYOUT, tailor: 'after lodge' }));
    expect(year.finished).toEqual([
      'hut day 1 13:03',
      'woodshed day 2 14:52',
      'lodge day 3 07:58',
      'barn day 3 15:37',
      'tailor day 7 08:07',
      'house day 9 14:43',
      'house day 12 14:39',
    ]);
    const { tally } = year.sim;
    expect([tally.felled, tally.made - tally.batches, tally.burnt, tally.firewoodHome, tally.firewoodToCamp]).toEqual([35, 0, 0, 0, 0]);
    expect([tally.foraged, tally.kills, tally.hides, tally.batches, tally.dressed]).toEqual([66, 11, 11, 4, 4]);
    expect([tally.meals, tally.missed, year.barnAtYearEnd]).toEqual([92, 6, 56]);
    expect([tally.starved, tally.froze, year.living]).toEqual([0, 6, ['Ulvar', 'Ysa']]);
    expect(year.coldNights).toEqual([8, 8, 6]);
    expect(year.coldBeforeNight).toEqual(year.coldNights);
    expect(year.coldAtNoon, 'the house of Ulvar and Ysa is finished between noon and dusk on the last day').toEqual([8, 8, 8]);
  });

  it("with nothing for warmth, keeps stage 3's food, and all 8 freeze in the last night", () => {
    const year = winterYear(NOTHING_FOR_WARMTH);
    expect(year.finished).toEqual(['hut day 1 13:08', 'lodge day 2 10:01', 'barn day 2 18:24']);
    const { tally } = year.sim;
    expect([tally.foraged, tally.kills, tally.hides, tally.batches, tally.burnt]).toEqual([73, 14, 14, 0, 0]);
    expect([tally.meals, tally.missed, year.barnAtYearEnd]).toEqual([96, 0, 85]);
    expect([tally.starved, tally.froze, year.living]).toEqual([0, 8, []]);
    expect(year.coldNights).toEqual([8, 8, 8]);
    expect(year.coldBeforeNight).toEqual(year.coldNights);
  });
});
