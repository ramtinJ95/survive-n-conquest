import { describe, expect, it } from 'vitest';
import { frameOf } from '../frame';
import { finishBuilding } from '../sim/building';
import { Building } from '../sim/buildings';
import { generateMap } from '../sim/mapgen';
import { type Sex, nameOf } from '../sim/names';
import { createOrders } from '../sim/orders';
import { SETTLERS, type Sim, applyCommand, createSim, step } from '../sim/sim';
import { CAMP_STORE } from '../sim/stores';
import { at, mapFrom } from '../sim/testMaps';
import { die } from '../sim/villagers';
import { LINE_MS, createNews, listNames } from './news';

/** Runs a simulation, hearing a frame after every tick at 100 ms of wall time apiece, and keeps every line the news ever showed in its last words. */
function listen(sim: Sim, ticks: number, each: () => void = () => {}) {
  const news = createNews(sim.orders);
  const said = new Map<object, string>();
  news.hear(frameOf(sim).frame, 0);
  for (let tick = 0; tick < ticks && !sim.over; tick++) {
    step(sim);
    each();
    news.hear(frameOf(sim).frame, sim.tick * 100);
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

  it('shows at most five lines, keeps a sixth waiting until one has shown long enough, and then shows it for as long', () => {
    const news = createNews(createOrders(mapFrom(Array.from({ length: 8 }, () => '.'.repeat(8)))));
    const frame = (tick: number, missedMeals: number[]) => ({
      tick,
      states: new Uint8Array(missedMeals.length),
      missedMeals: Uint8Array.from(missedMeals),
      names: Uint16Array.from(missedMeals, (_, id) => id),
      sexes: new Uint8Array(missedMeals.length),
      workplaces: new Int16Array(missedMeals.length).fill(-1),
    });
    news.hear(frame(0, [0, 0, 0, 0, 0, 0]), 0);
    for (let id = 0; id < 6; id++) news.hear(frame(1000 * (id + 1), [0, 1, 2, 3, 4, 5].map((other) => (other <= id ? 1 : 0))), id * 1000);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[0], [1], [2], [3], [4]]);
    expect(news.prune(LINE_MS - 1)).toBe(false);
    expect(news.prune(LINE_MS + 500)).toBe(true);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[1], [2], [3], [4], [5]]);
    expect(news.prune(LINE_MS + 4500)).toBe(true);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[5]]);
    expect(news.prune(2 * LINE_MS + 400)).toBe(false);
    expect(news.prune(2 * LINE_MS + 600)).toBe(true);
    expect(news.lines()).toHaveLength(0);
  });

  it("says who became foragers at a finished hut, who left it when its places were lowered, and who took a dead forager's place", () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24))), { villagers: 4, monsters: 0 });
    const name = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
    const workers = () => [0, 1, 2, 3].filter((id) => sim.villagers.workplace[id]! >= 0).sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!);
    let slot = -1;
    const events: number[][] = [];
    const { said } = listen(sim, 2400, () => {
      if (sim.tick === 100) {
        expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x: 4, y: 4 })).toMatchObject({ ok: true });
        slot = sim.orders.siteOf[at(sim.map, 4, 4)]!;
        finishBuilding(sim, slot);
        events.push(workers());
      } else if (sim.tick === 1000) {
        applyCommand(sim, { kind: 'setPlaces', slot, places: 1 });
        events.push(workers());
      } else if (sim.tick === 2000) {
        const [dead] = workers();
        die(sim, dead!);
        events.push([dead!, ...workers()]);
      }
    });
    const [hired, kept, [dead, heir]] = events as [number[], number[], number[]];
    const freed = hired.find((id) => !kept.includes(id))!;
    expect(said).toEqual([
      `Day 1, 08:47. ${name(hired[0]!)} and ${name(hired[1]!)} became foragers.`,
      `Day 1, 15:59. ${name(freed)} left the forager's hut.`,
      `Day 1, 23:59. ${name(dead!)} starved.`,
      `Day 1, 23:59. ${name(heir!)} became a forager.`,
    ]);
  });
});
