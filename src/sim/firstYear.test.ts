import { describe, expect, it } from 'vitest';
import { dateAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { FIRST_YEAR_HUT, FIRST_YEAR_SEED, firstYearCommands } from './firstYear';
import { FORAGING } from './foraging';
import { Good } from './goods';
import { generateMap } from './mapgen';
import { type Sex, nameOf } from './names';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
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
