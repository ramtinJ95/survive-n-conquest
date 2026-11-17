import { describe, expect, it } from 'vitest';
import { dateAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { FIRST_YEAR_BARNS, FIRST_YEAR_HUT, FIRST_YEAR_LODGE, FIRST_YEAR_SEED, barnYearCommands, firstYearCommands, huntYearCommands } from './firstYear';
import { FORAGING } from './foraging';
import { Good } from './goods';
import { generateMap } from './mapgen';
import { type Sex, nameOf } from './names';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_STORE, StoreKind, storeKind } from './stores';
import { TASK_KINDS } from './tasks';

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
  it('has the first forager hired pick 4 food on a spring day and 4 on an autumn day, and keeps all 8 alive past the day the settlement without one dies out', () => {
    const sim = firstYear();
    const hut = sim.orders.siteOf[FIRST_YEAR_HUT.y * sim.map.size + FIRST_YEAR_HUT.x]!;
    const spring = picksOn(sim, 2);
    const foragers = Array.from(sim.villagers.workplace, (place, id) => [place, id] as const).filter(([place]) => place === hut);
    const first = foragers.map(([, id]) => id).sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!)[0]!;
    expect(nameOf(sim.villagers.sex[first] as Sex, sim.villagers.name[first]!)).toBe('Ysa');
    expect(spring[first]).toBe(4);
    const autumn = picksOn(sim, 7);
    expect(autumn[first]).toBe(4);
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
    while (dateAt(sim.tick).day <= 12) {
      if (isNight(sim.tick) && !isNight(sim.tick - 1) && dateAt(sim.tick).day === 9) barnAtAutumnsEnd = sim.stores.food[slot]!;
      step(sim);
    }
    return { sim, barnAtAutumnsEnd };
  }

  it('has two foragers pick more with the barn beside the hut than with it far away, where the camp stays nearer every tree', () => {
    const beside = yearWith(FIRST_YEAR_BARNS.beside);
    const far = yearWith(FIRST_YEAR_BARNS.far);
    expect([beside.sim.tally.foraged, beside.barnAtAutumnsEnd, beside.sim.tally.missed, beside.sim.living]).toEqual([102, 53, 0, 8]);
    expect([far.sim.tally.foraged, far.barnAtAutumnsEnd, far.sim.tally.missed, far.sim.living]).toEqual([71, 0, 1, 8]);
  });
});

describe("the first year on seed 7 with a hunter's lodge", () => {
  function huntYear(hut: boolean) {
    const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
    for (const command of huntYearCommands({ hut })) expect(applyCommand(sim, command)).toMatchObject({ ok: true });
    const lodge = sim.orders.siteOf[FIRST_YEAR_LODGE.y * sim.map.size + FIRST_YEAR_LODGE.x]!;
    const barns = () => {
      let food = 0;
      for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === StoreKind.Common) food += sim.stores.food[slot]!;
      return food;
    };
    let atAutumnsEnd: number[] = [];
    let winterKills = 0;
    while (dateAt(sim.tick).day <= 12) {
      if (dateAt(sim.tick).day === 10 && atAutumnsEnd.length === 0) atAutumnsEnd = [barns(), sim.stores.food[CAMP_STORE]!, sim.tally.kills];
      const kills = sim.tally.kills;
      step(sim);
      if (dateAt(sim.tick).season === 'Winter') winterKills += sim.tally.kills - kills;
    }
    return { sim, lodge, atAutumnsEnd, winterKills };
  }

  it('brings all 8 settlers through the winter with the hut, the barn beside it, and the lodge, on stored forage and hunted deer', () => {
    const { sim, lodge, atAutumnsEnd, winterKills } = huntYear(true);
    expect(Array.from(sim.villagers.workplace).filter((place) => place === lodge).length).toBe(2);
    const { tally } = sim;
    expect([tally.foraged, tally.shots, tally.kills, tally.hunted, tally.huntedIn, tally.fromGround, tally.spoiled]).toEqual([96, 17, 14, 84, 29, 58, 0]);
    expect(atAutumnsEnd).toEqual([117, 9, 13]);
    expect(winterKills).toBe(1);
    expect([tally.meals, tally.missed, sim.living]).toEqual([96, 0, 8]);
  });

  it('brings all 8 through the year on hunted deer alone with the barn and the lodge and no hut', () => {
    const { sim, atAutumnsEnd, winterKills } = huntYear(false);
    const { tally } = sim;
    expect([tally.foraged, tally.shots, tally.kills, tally.hunted, tally.huntedIn, tally.fromGround, tally.spoiled]).toEqual([0, 15, 12, 72, 16, 56, 0]);
    expect(atAutumnsEnd).toEqual([18, 0, 11]);
    expect(winterKills).toBe(1);
    expect([tally.meals, tally.missed, sim.living]).toEqual([96, 0, 8]);
  });
});
