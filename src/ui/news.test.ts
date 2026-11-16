import { describe, expect, it } from 'vitest';
import { generateMap } from '../sim/mapgen';
import { type Sex, nameOf } from '../sim/names';
import { SETTLERS, type Sim, createSim, step } from '../sim/sim';
import { CAMP_STORE } from '../sim/stores';
import { mapFrom } from '../sim/testMaps';
import { LINE_MS, createNews, listNames } from './news';

/** What the main thread hears of a simulation in a frame. */
const frameOf = (sim: Sim) => ({
  tick: sim.tick,
  states: sim.villagers.state.slice(),
  missedMeals: sim.villagers.missedMeals.slice(),
  names: sim.villagers.name.slice(),
  sexes: sim.villagers.sex.slice(),
});

/** Runs a simulation, hearing a frame after every tick at 100 ms of wall time apiece, and keeps every line the news ever showed in its last words. */
function listen(sim: Sim, ticks: number, each: () => void = () => {}) {
  const news = createNews();
  const said = new Map<object, string>();
  news.hear(frameOf(sim), 0);
  for (let tick = 0; tick < ticks && !sim.over; tick++) {
    step(sim);
    each();
    news.hear(frameOf(sim), sim.tick * 100);
    for (const line of news.lines()) said.set(line, line.text);
  }
  return { news, said: [...said.values()] };
}

describe('listNames', () => {
  it('names up to eight settlers, the whole of a new game, and counts the rest', () => {
    expect(listNames(['Merek'])).toBe('Merek');
    expect(listNames(['Merek', 'Elsi'])).toBe('Merek and Elsi');
    expect(listNames(['Merek', 'Elsi', 'Ulvar', 'Ysa'])).toBe('Merek, Elsi, Ulvar and Ysa');
    const eight = ['Merek', 'Elsi', 'Ulvar', 'Ysa', 'Jorrin', 'Fenna', 'Dorran', 'Nella'];
    expect(listNames(eight)).toBe('Merek, Elsi, Ulvar, Ysa, Jorrin, Fenna, Dorran and Nella');
    expect(listNames([...eight, ...Array(1492).fill('Ysa')])).toBe('Merek, Elsi, Ulvar, Ysa, Jorrin, Fenna, Dorran and 1,493 others');
  });
});

describe('the settlement news', () => {
  it('says on seed 7 with no orders who went hungry on day 4 and who starved on day 6, one line for each dusk', () => {
    const { said } = listen(createSim(generateMap(7), SETTLERS), 3000 * 7);
    expect(said).toEqual([
      'Day 4, 20:29. Merek, Elsi, Ulvar, Ysa, Jorrin, Fenna, Dorran and Nella went hungry.',
      'Day 6, 20:24. Merek, Elsi, Ulvar, Ysa, Jorrin, Fenna, Dorran and Nella starved.',
    ]);
  });

  it('says who ate again when food came in the night', () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24))), { villagers: 2, monsters: 0, campFood: 0 });
    const { said } = listen(sim, 3000, () => {
      if (sim.tick === 2000) sim.stores.food[CAMP_STORE] = 1;
    });
    expect(said).toHaveLength(2);
    const [first, second] = [0, 1].map((id) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!));
    expect(said[0]).toMatch(new RegExp(`^Day 1, 19:\\d\\d\\. ${first} and ${second} went hungry\\.$`));
    expect(said[1]).toBe(`Day 2, 04:48. ${first} ate again.`);
  });

  it('shows at most five lines, and drops each once it has shown long enough', () => {
    const news = createNews();
    const frame = (tick: number, missedMeals: number[]) => ({
      tick,
      states: new Uint8Array(missedMeals.length),
      missedMeals: Uint8Array.from(missedMeals),
      names: Uint16Array.from(missedMeals, (_, id) => id),
      sexes: new Uint8Array(missedMeals.length),
    });
    news.hear(frame(0, [0, 0, 0, 0, 0, 0]), 0);
    for (let id = 0; id < 6; id++) news.hear(frame(1000 * (id + 1), [0, 1, 2, 3, 4, 5].map((other) => (other <= id ? 1 : 0))), id * 1000);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[1], [2], [3], [4], [5]]);
    expect(news.prune(LINE_MS + 1000)).toBe(true);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[2], [3], [4], [5]]);
    expect(news.prune(LINE_MS + 5000)).toBe(true);
    expect(news.lines()).toHaveLength(0);
  });
});
