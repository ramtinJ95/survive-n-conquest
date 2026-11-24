import { describe, expect, it } from 'vitest';
import { frameOf } from '../frame';
import { finishBuilding } from '../sim/building';
import { Building } from '../sim/buildings';
import { TICKS_PER_DAY, dateAt, tickOfDay } from '../sim/calendar';
import { isNight } from '../sim/daylight';
import { Good, type Unit, putDown } from '../sim/goods';
import { generateMap } from '../sim/mapgen';
import { Sex, nameOf } from '../sim/names';
import { HUNGER } from '../sim/needs';
import { die } from '../sim/villagers';
import { createOrders } from '../sim/orders';
import { SETTLERS, type Sim, applyCommand, createSim, step } from '../sim/sim';
import { CAMP_STORE } from '../sim/stores';
import { at, mapFrom } from '../sim/testMaps';
import { Cause, VillagerState } from '../sim/villagerState';
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
  it('names a settler that died of old age at the dawn it died', () => {
    const map = mapFrom(Array.from({ length: 32 }, () => '.'.repeat(32)), 7);
    const settlers = [[{ sex: Sex.Man, age: 24 }, { sex: Sex.Woman, age: 22 }], [{ sex: Sex.Man, age: 69, span: 70 }, { sex: Sex.Woman, age: 20 }]];
    const sim = createSim(map, { villagers: 4, monsters: 0, campFood: 200, animals: false, settlers });
    const { said } = listen(sim, 3000 * 4);
    expect(said).toEqual(['Day 4, 03:36. Ulvar died of old age.']);
  });

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
      if (sim.tick === 2000) sim.stores.held[Good.Food - 1]![CAMP_STORE] = 1;
    });
    expect(said).toHaveLength(2);
    const [first, second] = [0, 1].map((id) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!));
    expect(said[0]).toMatch(new RegExp(`^Day 1, 19:\\d\\d\\. ${first} and ${second} went hungry\\.$`));
    expect(said[1]).toBe(`Day 2, 04:48. ${first} ate again.`);
  });

  it('shows at most four lines, keeps a fifth waiting until one has shown long enough, and then shows it for as long', () => {
    const news = createNews(createOrders(mapFrom(Array.from({ length: 8 }, () => '.'.repeat(8)))));
    const frame = (tick: number, missedMeals: number[]) => ({
      tick,
      states: new Uint8Array(missedMeals.length),
      causes: new Uint8Array(missedMeals.length),
      missedMeals: Uint8Array.from(missedMeals),
      coldNights: new Uint8Array(missedMeals.length),
      names: Uint16Array.from(missedMeals, (_, id) => id),
      sexes: new Uint8Array(missedMeals.length),
      workplaces: new Int16Array(missedMeals.length).fill(-1),
      workshopStops: new Uint8Array(0),
      workshopWorked: new Uint8Array(0),
    });
    news.hear(frame(0, [0, 0, 0, 0, 0]), 0);
    for (let id = 0; id < 5; id++) news.hear(frame(1000 * (id + 1), [0, 1, 2, 3, 4].map((other) => (other <= id ? 1 : 0))), id * 1000);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[0], [1], [2], [3]]);
    expect(news.prune(LINE_MS - 1)).toBe(false);
    expect(news.prune(LINE_MS + 500)).toBe(true);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[1], [2], [3], [4]]);
    expect(news.prune(LINE_MS + 3500)).toBe(true);
    expect(news.lines().map(({ ids }) => ids)).toEqual([[4]]);
    expect(news.prune(2 * LINE_MS + 400)).toBe(false);
    expect(news.prune(2 * LINE_MS + 600)).toBe(true);
    expect(news.lines()).toHaveLength(0);
  });

  it('says at each dusk that the woodcutter split no firewood that day and why, once a day, and nothing on a day it split a log', () => {
    const idle = createSim(mapFrom(Array.from({ length: 48 }, () => '.'.repeat(48))), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    expect(applyCommand(idle, { kind: 'place', building: Building.House, x: 10, y: 10 })).toMatchObject({ ok: true });
    expect(applyCommand(idle, { kind: 'place', building: Building.Woodshed, x: 30, y: 30 })).toMatchObject({ ok: true });
    finishBuilding(idle, idle.orders.siteOf[at(idle.map, 30, 30)]!);
    const name = nameOf(idle.villagers.sex[0] as Sex, idle.villagers.name[0]!);
    const idleDays = listen(idle, TICKS_PER_DAY * 2).said;
    expect(idleDays).toHaveLength(2);
    expect(idleDays[0]).toMatch(new RegExp(`^Day 1, 19:1\\d\\. ${name} split no firewood: sites need the logs\\.$`));
    expect(idleDays[1]).toMatch(new RegExp(`^Day 2, 19:1\\d\\. ${name} split no firewood: sites need the logs\\.$`));

    const alone = createSim(mapFrom(Array.from({ length: 48 }, () => '.'.repeat(48))), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    expect(applyCommand(alone, { kind: 'place', building: Building.Woodshed, x: 30, y: 30 })).toMatchObject({ ok: true });
    finishBuilding(alone, alone.orders.siteOf[at(alone.map, 30, 30)]!);
    expect(listen(alone, TICKS_PER_DAY).said).toEqual([expect.stringMatching(/split no firewood: no log in reach\.$/)]);

    const working = createSim(mapFrom(Array.from({ length: 48 }, () => '.'.repeat(48))), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    expect(applyCommand(working, { kind: 'markArea', order: 'stockpile', area: { x0: 26, y0: 30, x1: 26, y1: 30 } })).toMatchObject({ ok: true });
    expect(putDown(working, at(working.map, 26, 30), Good.Log, 1)).toBe(true);
    expect(applyCommand(working, { kind: 'place', building: Building.Woodshed, x: 30, y: 30 })).toMatchObject({ ok: true });
    finishBuilding(working, working.orders.siteOf[at(working.map, 30, 30)]!);
    const workedDays = listen(working, TICKS_PER_DAY * 2).said;
    expect(workedDays).toEqual([expect.stringMatching(/^Day 2, 19:1\d\. .+ split no firewood: no log in reach\.$/)]);
  });

  it("says at dusk that a workshop's worker made nothing because no unit of its input has been carried to a stockpile yet", () => {
    const loose = (building: Building, good: Unit) => {
      const sim = createSim(mapFrom(Array.from({ length: 48 }, () => '.'.repeat(48))), { villagers: 1, monsters: 0, campFood: 100, animals: false });
      expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 26, y0: 30, x1: 26, y1: 30 } })).toMatchObject({ ok: true });
      expect(putDown(sim, at(sim.map, 10, 40), good, 2)).toBe(true);
      expect(applyCommand(sim, { kind: 'place', building, x: 30, y: 30 })).toMatchObject({ ok: true });
      finishBuilding(sim, sim.orders.siteOf[at(sim.map, 30, 30)]!);
      return { said: listen(sim, TICKS_PER_DAY).said, name: nameOf(sim.villagers.sex[0] as Sex, sim.villagers.name[0]!) };
    };
    const tailor = loose(Building.Tailor, Good.Hide);
    expect(tailor.said).toEqual([expect.stringMatching(new RegExp(`^Day 1, 19:1\\d\\. ${tailor.name} made no clothing: no hide carried yet\\.$`))]);
    const woodcutter = loose(Building.Woodshed, Good.Log);
    expect(woodcutter.said).toEqual([expect.stringMatching(new RegExp(`^Day 1, 19:1\\d\\. ${woodcutter.name} split no firewood: no log carried yet\\.$`))]);
  });

  it('reads the day of work from the frame that crosses dusk, so work taken in the ticks between two frames counts', () => {
    const sim = createSim(mapFrom(Array.from({ length: 48 }, () => '.'.repeat(48))), { villagers: 1, monsters: 0, campFood: 100, animals: false });
    expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 26, y0: 30, x1: 26, y1: 30 } })).toMatchObject({ ok: true });
    expect(applyCommand(sim, { kind: 'place', building: Building.Woodshed, x: 30, y: 30 })).toMatchObject({ ok: true });
    const shed = sim.orders.siteOf[at(sim.map, 30, 30)]!;
    finishBuilding(sim, shed);
    const news = createNews(sim.orders);
    while (!isNight(sim.tick + 40)) step(sim);
    expect(sim.workshops.worked[shed]).toBe(0);
    news.hear(frameOf(sim).frame, 0);
    expect(putDown(sim, at(sim.map, 26, 30), Good.Log, 1)).toBe(true);
    while (!isNight(sim.tick)) step(sim);
    expect(sim.workshops.worked[shed]).toBe(1);
    news.hear(frameOf(sim).frame, 1000);
    expect(news.lines()).toEqual([]);
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
        die(sim, dead!, Cause.Hunger);
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

  it('says who left one hut and took a place at another when lowering the places moves a forager there', () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24))), { villagers: 2, monsters: 0 });
    const name = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
    const slots: number[] = [];
    let moved = -1;
    const { said } = listen(sim, 1200, () => {
      if (sim.tick === 100) {
        for (const [x, y] of [[4, 4], [18, 18]] as const) {
          expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x, y })).toMatchObject({ ok: true });
          slots.push(sim.orders.siteOf[at(sim.map, x, y)]!);
          finishBuilding(sim, slots.at(-1)!);
        }
      } else if (sim.tick === 1000) {
        applyCommand(sim, { kind: 'setPlaces', slot: slots[0]!, places: 1 });
        moved = [0, 1].find((id) => sim.villagers.workplace[id] === slots[1])!;
      }
    });
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(said).toEqual([
      `Day 1, 08:47. ${name(0)} and ${name(1)} became foragers.`,
      `Day 1, 15:59. ${name(moved)} left the forager's hut.`,
      `Day 1, 15:59. ${name(moved)} became a forager.`,
    ]);
  });

  it('says who became the woodcutter at a finished woodshed', () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24))), { villagers: 3, monsters: 0 });
    const name = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
    let woodcutter = -1;
    const { said } = listen(sim, 200, () => {
      if (sim.tick !== 100) return;
      expect(applyCommand(sim, { kind: 'place', building: Building.Woodshed, x: 4, y: 4 })).toMatchObject({ ok: true });
      const slot = sim.orders.siteOf[at(sim.map, 4, 4)]!;
      finishBuilding(sim, slot);
      woodcutter = sim.villagers.workplace.indexOf(slot);
    });
    expect(said).toEqual([`Day 1, 08:47. ${name(woodcutter)} became a woodcutter.`]);
  });

  it("says who became the tailor at a finished tailor's hut", () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24))), { villagers: 3, monsters: 0 });
    const name = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
    let tailor = -1;
    const { said } = listen(sim, 200, () => {
      if (sim.tick !== 100) return;
      expect(applyCommand(sim, { kind: 'place', building: Building.Tailor, x: 4, y: 4 })).toMatchObject({ ok: true });
      const slot = sim.orders.siteOf[at(sim.map, 4, 4)]!;
      finishBuilding(sim, slot);
      tailor = sim.villagers.workplace.indexOf(slot);
    });
    expect(said).toEqual([`Day 1, 08:47. ${name(tailor)} became a tailor.`]);
  });

  it('says who had a cold night at each winter dusk and who froze at the last, by name', () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24))), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    while (dateAt(sim.tick).day < 10) step(sim);
    const [first, second] = [0, 1].map((id) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!));
    const { said } = listen(sim, TICKS_PER_DAY * 4);
    expect(sim.tally).toMatchObject({ froze: 2, starved: 0 });
    expect(said).toHaveLength(3);
    expect(said[0]).toMatch(new RegExp(`^Day 10, \\d\\d:\\d\\d\\. ${first} and ${second} had a cold night\\.$`));
    expect(said[1]).toMatch(new RegExp(`^Day 11, \\d\\d:\\d\\d\\. ${first} and ${second} had a cold night\\.$`));
    expect(said[2]).toMatch(new RegExp(`^Day 12, \\d\\d:\\d\\d\\. ${first} and ${second} froze\\.$`));
  });

  it('says a settler with two cold nights who starves on a winter night starved, and one who freezes there froze', () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24))), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    while (!(dateAt(sim.tick).day === 12 && isNight(sim.tick) && tickOfDay(sim.tick) >= TICKS_PER_DAY / 2)) step(sim);
    expect(Array.from(sim.villagers.coldNights.subarray(0, sim.villagers.count))).toEqual([2, 2]);
    sim.villagers.missedMeals[0] = HUNGER.diesAt - 1;
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 0;
    const [first, second] = [0, 1].map((id) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!));
    const { said } = listen(sim, TICKS_PER_DAY);
    expect(Array.from(sim.villagers.state.subarray(0, sim.villagers.count))).toEqual([VillagerState.Dead, VillagerState.Dead]);
    expect(sim.tally).toMatchObject({ starved: 1, froze: 1 });
    expect(said).toHaveLength(2);
    expect(said).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^Day 12, \\d\\d:\\d\\d\\. ${first} starved\\.$`)),
        expect.stringMatching(new RegExp(`^Day 12, \\d\\d:\\d\\d\\. ${second} froze\\.$`)),
      ]),
    );
  });
});
