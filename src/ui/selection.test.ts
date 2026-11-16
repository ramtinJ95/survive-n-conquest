import { describe, expect, it } from 'vitest';
import { BUILDING, HOUSE_WORK_TICKS, finishHouse } from '../sim/building';
import { TICKS_PER_DAY } from '../sim/calendar';
import { CARRYING } from '../sim/carrying';
import { GATHERING } from '../sim/gathering';
import { Good } from '../sim/goods';
import { NO_HOME } from '../sim/households';
import { TileKind } from '../sim/map';
import { Sex } from '../sim/names';
import { SiteState, applyOrder, createOrders } from '../sim/orders';
import { type Sim, applyCommand, createSim, step } from '../sim/sim';
import { STOCKING } from '../sim/stocking';
import { CAMP_STORE, STORES } from '../sim/stores';
import { SUPPLYING } from '../sim/supplying';
import { NO_TASK, TASK_KINDS, type TaskKind } from '../sim/tasks';
import { at, mapFrom } from '../sim/testMaps';
import { VillagerState, die } from '../sim/villagers';
import { type Facts, type Panels, type Selection, keepSelection, markPlace, readPanel } from './selection';

const task = (kind: TaskKind) => TASK_KINDS.indexOf(kind) + 1;

/** The facts the main thread holds about a simulation, with the frame built from its villager columns as the worker publishes them. */
function factsOf(sim: Sim): Facts {
  const { x, y, carried, state, task: tasks, taskTile, name, sex, household, missedMeals } = sim.villagers;
  const villagers = new Float32Array(x.length * 2);
  for (let id = 0; id < x.length; id++) {
    villagers[id * 2] = x[id]!;
    villagers[id * 2 + 1] = y[id]!;
  }
  return {
    map: sim.map,
    orders: sim.orders,
    camp: sim.camp,
    frame: {
      villagers,
      carried: carried.slice(),
      states: state.slice(),
      tasks: tasks.slice(),
      taskTiles: taskTile.slice(),
      names: name.slice(),
      sexes: sex.slice(),
      households: household.slice(),
      homes: sim.households.home.slice(),
      missedMeals: missedMeals.slice(),
      storeFood: sim.stores.food.slice(),
      campFoodLimit: sim.stores.campLimit,
    },
  };
}

const settler = (facts: Facts, id: number) => readPanel({ kind: 'villager', id }, facts).rows.find((row) => row.label === 'Doing')!.value;

/** Settler 0 of seed 7 is Merek, a man, and settler 1 is Elsi, a woman, of household 0. */
const SEED = 7;

function settlement(seed = 3, villagers = 8): Sim {
  const rows = Array.from({ length: 24 }, () => '.'.repeat(24).split(''));
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]] as const) rows[y]![x] = 'T';
  for (const [x, y] of [[20, 3], [20, 4]] as const) rows[y]![x] = '#';
  const map = mapFrom(rows.map((row) => row.join('')), seed);
  const lying = [[6, 18, Good.Log, 8], [7, 18, Good.Log, 8], [8, 18, Good.Log, 8], [9, 18, Good.Stone, 8], [10, 18, Good.Stone, 4]] as const;
  for (const [x, y, good, size] of lying) {
    map.stackGood[at(map, x, y)] = good;
    map.stackSize[at(map, x, y)] = size;
  }
  const sim = createSim(map, { villagers, monsters: 0 });
  applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 3, y0: 3, x1: 4, y1: 4 } });
  applyCommand(sim, { kind: 'markArea', order: 'quarry', area: { x0: 20, y0: 3, x1: 20, y1: 4 } });
  applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 18, y0: 18, x1: 20, y1: 20 } });
  expect(applyCommand(sim, { kind: 'placeHouse', x: 12, y: 6 })).toMatchObject({ ok: true });
  return sim;
}

interface Seen {
  readonly state: number;
  readonly task: number;
  readonly carried: number;
  /** The kind of the task's tile, or the good lying on it. */
  readonly kind: number;
  readonly good: number;
}

describe("a settler's panel", () => {
  it('says what each settler does through two days of a settlement that chops, quarries, stocks, supplies, and builds', () => {
    const sim = settlement();
    const seen = new Map<string, Seen>();
    for (let tick = 0; tick < TICKS_PER_DAY * 2; tick++) {
      step(sim);
      const facts = factsOf(sim);
      for (let id = 0; id < 8; id++) {
        const words = settler(facts, id);
        const tile = sim.villagers.taskTile[id]!;
        if (!seen.has(words)) {
          seen.set(words, {
            state: sim.villagers.state[id]!,
            task: sim.villagers.task[id]!,
            carried: sim.villagers.carried[id]!,
            kind: tile < 0 ? -1 : sim.map.kinds[tile]!,
            good: tile < 0 ? -1 : sim.map.stackGood[tile]!,
          });
        }
      }
    }
    const { Walking, Working } = VillagerState;
    const expected: Record<string, Partial<Seen>> = {
      Idle: { task: NO_TASK },
      'Walking to the camp': { state: VillagerState.GoingToCamp },
      'Resting at the camp': { state: VillagerState.Settling },
      'Walking home': { state: VillagerState.GoingIn },
      'At home': { state: VillagerState.Inside },
      'Walking to a tree': { state: Walking, task: task(GATHERING), kind: TileKind.Forest },
      'Chopping a tree': { state: Working, task: task(GATHERING), kind: TileKind.Forest },
      'Walking to the rock': { state: Walking, task: task(GATHERING), kind: TileKind.Rock },
      'Quarrying stone': { state: Working, task: task(GATHERING), kind: TileKind.Rock },
      'Walking to pick up a log': { task: task(CARRYING), carried: Good.None, good: Good.Log },
      'Walking to pick up stone': { task: task(CARRYING), carried: Good.None, good: Good.Stone },
      'Carrying a log to the stockpile': { task: task(CARRYING), carried: Good.Log },
      'Carrying stone to the stockpile': { task: task(CARRYING), carried: Good.Stone },
      'Walking to fetch a log for a house site': { task: task(SUPPLYING), carried: Good.None, good: Good.Log },
      'Walking to fetch stone for a house site': { task: task(SUPPLYING), carried: Good.None, good: Good.Stone },
      'Carrying a log to a house site': { task: task(SUPPLYING), carried: Good.Log },
      'Carrying stone to a house site': { task: task(SUPPLYING), carried: Good.Stone },
      'Walking to a house site': { state: Walking, task: task(BUILDING) },
      'Building a house': { state: Working, task: task(BUILDING) },
      'Walking to the camp for food': { task: task(STOCKING), carried: Good.None },
      'Carrying food home': { task: task(STOCKING), carried: Good.Food },
    };
    expect([...seen.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [words, when] of Object.entries(expected)) expect(seen.get(words), words).toMatchObject(when);
  });

  it('says a waiting settler is idle, names goods it cannot see, and says what it carries', () => {
    const map = mapFrom(Array.from({ length: 12 }, () => '.'.repeat(12)));
    const facts = (state: number, taskValue: number, carried: Good): Facts => ({
      map,
      orders: createOrders(map, at(map, 6, 6)),
      camp: at(map, 6, 6),
      frame: {
        villagers: Float32Array.of(3.5, 3.5),
        carried: Uint8Array.of(carried),
        states: Uint8Array.of(state),
        tasks: Uint8Array.of(taskValue),
        taskTiles: Int32Array.of(at(map, 2, 2)),
        names: Uint16Array.of(0),
        sexes: Uint8Array.of(Sex.Man),
        households: Int16Array.of(0),
        homes: Int16Array.of(NO_HOME),
        missedMeals: Uint8Array.of(0),
        storeFood: new Uint16Array(STORES),
        campFoodLimit: 40,
      },
    });
    const panel = (state: number, taskValue: number, carried: Good) => readPanel({ kind: 'villager', id: 0 }, facts(state, taskValue, carried));

    expect(panel(VillagerState.Waiting, task(GATHERING), Good.None).rows.slice(0, 2)).toEqual([
      { label: 'Doing', value: 'Idle' },
      { label: 'Carries', value: 'Nothing' },
    ]);
    expect(panel(VillagerState.Walking, task(CARRYING), Good.None).rows[0]!.value).toBe('Walking to pick up goods');
    expect(panel(VillagerState.Walking, task(CARRYING), Good.Log)).toEqual({
      kind: 'villager',
      title: 'Edrik',
      rows: [
        { label: 'Doing', value: 'Carrying a log to the stockpile' },
        { label: 'Carries', value: '1 log' },
        { label: 'Sex', value: 'Man' },
        { label: 'Household', value: 'Household 1' },
        { label: 'Home', value: 'None, sleeps at the camp' },
        { label: 'Missed meals', value: 'None' },
      ],
    });
    expect(panel(VillagerState.Working, task(SUPPLYING), Good.Stone).rows[1]).toEqual({ label: 'Carries', value: '1 stone' });
    expect(panel(VillagerState.Walking, task(STOCKING), Good.Food).rows.slice(0, 2)).toEqual([
      { label: 'Doing', value: 'Carrying food home' },
      { label: 'Carries', value: '1 food' },
    ]);
  });

  it('is titled with the settler\'s name and says its sex, its household with the others in it, and its home once a house is finished', () => {
    const sim = settlement(SEED);
    const panel = (id: number) => readPanel({ kind: 'villager', id }, factsOf(sim));
    const rows = (id: number) => Object.fromEntries(panel(id).rows.slice(2).map(({ label, value }) => [label, value]));

    expect(panel(0).title).toBe('Merek');
    expect(rows(0)).toEqual({ Sex: 'Man', Household: 'Household 1, with Elsi', Home: 'None, sleeps at the camp', 'Missed meals': 'None' });
    expect(panel(1).title).toBe('Elsi');
    expect(rows(1)).toEqual({ Sex: 'Woman', Household: 'Household 1, with Merek', Home: 'None, sleeps at the camp', 'Missed meals': 'None' });
    expect(rows(2)).toMatchObject({ Sex: 'Man', Household: `Household 2, with ${panel(3).title}` });

    while (sim.orders.sites.state[0] !== SiteState.House) step(sim);
    expect(rows(0).Home).toBe('A house');
    expect(rows(1).Home).toBe('A house');
    expect(rows(2).Home).toBe('None, sleeps at the camp');
  });

  it('names a household of one settler alone', () => {
    const panel = readPanel({ kind: 'villager', id: 2 }, factsOf(settlement(SEED, 3)));
    expect(panel.rows.find((row) => row.label === 'Household')!.value).toBe('Household 2');
  });

  it('stays on a selected settler while it is in its house, reading At home, with no ring, and rings it again where it comes out at dawn', () => {
    const sim = settlement(SEED);
    const merek: Selection = { kind: 'villager', id: 0 };
    while (sim.villagers.state[0] !== VillagerState.Inside) step(sim);
    const door = { x: sim.villagers.x[0]!, y: sim.villagers.y[0]! };
    expect(settler(factsOf(sim), 0)).toBe('At home');
    expect(markPlace(merek, factsOf(sim))).toBeNull();

    while (sim.villagers.state[0] === VillagerState.Inside) {
      step(sim);
      expect(keepSelection(merek, sim.orders)).toBe(merek);
    }
    expect(settler(factsOf(sim), 0)).not.toBe('At home');
    const ring = markPlace(merek, factsOf(sim))!;
    expect(ring).toEqual({ x: sim.villagers.x[0], y: sim.villagers.y[0], radius: 0.55 });
    expect([Math.floor(ring.x), Math.floor(ring.y)]).toEqual([Math.floor(door.x), Math.floor(door.y)]);
  });

  it('counts the meals a settler missed in a row, says it is hungry, and stays open with no ring once it died of hunger', () => {
    const map = mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24)), SEED);
    const sim = createSim(map, { villagers: 2, monsters: 0, campFood: 0 });
    const merek: Selection = { kind: 'villager', id: 0 };
    const row = (label: string) => readPanel(merek, factsOf(sim)).rows.find((entry) => entry.label === label)!.value;
    const seen = [row('Missed meals')];
    while (sim.villagers.state[0] !== VillagerState.Dead) {
      step(sim);
      if (seen.at(-1) !== row('Missed meals')) seen.push(row('Missed meals'));
    }
    expect(seen).toEqual(['None', '1, hungry', '2, hungry', '3']);
    expect(row('Doing')).toBe('Died of hunger');
    expect(keepSelection(merek, sim.orders)).toBe(merek);
    expect(markPlace(merek, factsOf(sim))).toBeNull();
    expect(readPanel({ kind: 'villager', id: 1 }, factsOf(sim)).rows.find((entry) => entry.label === 'Household')!.value).toBe('Household 1, with Merek (died)');
  });
});

function siteFacts() {
  const map = mapFrom(Array.from({ length: 16 }, () => '.'.repeat(16)));
  const camp = at(map, 12, 12);
  const orders = createOrders(map, camp);
  expect(applyOrder(map, orders, { kind: 'placeHouse', x: 4, y: 4 })).toMatchObject({ ok: true });
  const slot = orders.siteOf[at(map, 4, 4)]!;
  const building: Selection = { kind: 'building', slot, center: at(map, 4, 4) };
  const frame = (villagers: number[], tasks: number[], taskTiles: number[], states = tasks.map(() => VillagerState.Walking as number)) => ({
    villagers: Float32Array.from(villagers),
    carried: new Uint8Array(tasks.length),
    states: Uint8Array.from(states),
    tasks: Uint8Array.from(tasks),
    taskTiles: Int32Array.from(taskTiles),
    names: new Uint16Array(tasks.length),
    sexes: new Uint8Array(tasks.length),
    households: Int16Array.from(tasks, (_, id) => id >> 1),
    homes: new Int16Array((tasks.length + 1) >> 1).fill(NO_HOME),
    missedMeals: new Uint8Array(tasks.length),
    storeFood: new Uint16Array(STORES),
    campFoodLimit: 40,
  });
  return { map, camp, orders, slot, building, frame };
}

describe('a building panel', () => {
  it('shows what has arrived at a site, its work, and its builders', () => {
    const { map, camp, orders, slot, building, frame } = siteFacts();
    const center = at(map, 4, 4);
    const elsewhere = at(map, 9, 9);
    const facts: Facts = {
      map,
      orders,
      camp,
      frame: frame([3.5, 3.5, 5.5, 5.5, 1.5, 1.5, 4.5, 2.5], [task(BUILDING), task(BUILDING), task(SUPPLYING), task(BUILDING)], [center, center, center, elsewhere]),
    };
    expect(readPanel(building, facts)).toEqual({
      kind: 'site',
      title: 'House site',
      rows: [
        { label: 'Logs', value: '0/12' },
        { label: 'Stone', value: '0/6' },
        { label: 'Work', value: 'Waiting for materials' },
        { label: 'Builders', value: '2' },
      ],
    });

    map.stackGood[at(map, 3, 3)] = Good.Log;
    map.stackSize[at(map, 3, 3)] = 8;
    map.stackGood[at(map, 4, 3)] = Good.Log;
    map.stackSize[at(map, 4, 3)] = 4;
    map.stackGood[at(map, 5, 5)] = Good.Stone;
    map.stackSize[at(map, 5, 5)] = 6;
    orders.sites.work[slot] = HOUSE_WORK_TICKS / 2;
    expect(readPanel(building, facts).rows.slice(0, 3)).toEqual([
      { label: 'Logs', value: '12/12' },
      { label: 'Stone', value: '6/6' },
      { label: 'Work', value: '50%' },
    ]);

    orders.sites.state[slot] = SiteState.House;
    facts.frame.storeFood[slot] = 7;
    expect(readPanel(building, facts)).toEqual({
      kind: 'house',
      title: 'House',
      note: 'A finished house.',
      rows: [
        { label: 'Household', value: 'Nobody' },
        { label: 'Food', value: '7 of 16' },
      ],
    });
  });

  it("names the household that lives in a house, and nobody in a house past the last household's, by internals for the houses", () => {
    const sim = settlement(SEED, 2);
    expect(applyCommand(sim, { kind: 'placeHouse', x: 6, y: 10 })).toMatchObject({ ok: true });
    const household = (slot: number) => readPanel({ kind: 'building', slot, center: 0 }, factsOf(sim)).rows;
    finishHouse(sim, 0);
    finishHouse(sim, 1);
    expect(household(0)[0]).toEqual({ label: 'Household', value: 'Household 1: Merek and Elsi' });
    expect(household(1)[0]).toEqual({ label: 'Household', value: 'Nobody' });
  });

  it('says how much food a house and the camp hold, as the household stocks its home', () => {
    const sim = settlement(SEED, 2);
    finishHouse(sim, 0);
    const food = (selection: Selection) => readPanel(selection, factsOf(sim)).rows.find((entry) => entry.label === 'Food')!.value;
    const house: Selection = { kind: 'building', slot: 0, center: 0 };
    expect([food(house), food({ kind: 'camp' })]).toEqual(['0 of 16', '24 of 40']);
    while (sim.stores.food[0]! < 6) step(sim);
    expect([food(house), food({ kind: 'camp' })]).toEqual(['6 of 16', '18 of 40']);
    die(sim, 0);
    die(sim, 1);
    expect(food(house)).toBe('6 of 16');
  });

  it('counts the settlers under the camp', () => {
    const { map, camp, orders, frame } = siteFacts();
    const facts: Facts = { map, orders, camp, frame: frame([12.5, 12.5, 14.4, 12.5, 10.2, 11.1, 15.5, 12.5, 3.5, 3.5], [0, 0, 0, 0, 0], [-1, -1, -1, -1, -1]) };
    facts.frame.storeFood[CAMP_STORE] = 24;
    expect(readPanel({ kind: 'camp' }, facts)).toEqual({
      kind: 'camp',
      title: 'Camp',
      rows: [
        { label: 'Settlers here', value: '3' },
        { label: 'Food', value: '24 of 40' },
      ],
    });
  });

  it('does not count a settler inside its house, or a dead one, as here, even on a camp tile', () => {
    const { map, camp, orders, frame } = siteFacts();
    const { Settling, Inside, Dead } = VillagerState;
    const facts: Facts = { map, orders, camp, frame: frame([12.5, 12.5, 14.4, 12.5, 10.2, 11.1], [0, 0, 0], [-1, -1, -1], [Settling, Inside, Dead]) };
    expect(readPanel({ kind: 'camp' }, facts).rows[0]).toEqual({ label: 'Settlers here', value: '1' });
  });
});

describe('a control', () => {
  it('is declared in one panel entry, reads its value, and presses its buttons on the selection', () => {
    const { map, camp, orders, frame, slot, building: house } = siteFacts();
    const facts: Facts = { map, orders, camp, frame: frame([12.5, 12.5], [0], [-1]) };
    const places = new Map<number, number>();
    const filled = (center: number) => places.get(center) ?? 0;
    const panels: Panels = {
      villager: { title: 'Settler', rows: [] },
      site: { title: 'House site', rows: [] },
      house: {
        title: 'House',
        rows: [
          {
            label: 'Places',
            read: (_, { center }) => String(filled(center)),
            buttons: [
              { text: '−', name: 'Fewer places', press: (_, { center }) => places.set(center, filled(center) - 1) },
              { text: '+', name: 'More places', press: (_, { center }) => places.set(center, filled(center) + 1) },
            ],
          },
        ],
      },
      camp: { title: 'Camp', rows: [] },
    };
    orders.sites.state[slot] = SiteState.House;

    const before = readPanel(house, facts, panels);
    expect(before.rows).toMatchObject([{ label: 'Places', value: '0', buttons: [{ text: '−', name: 'Fewer places' }, { text: '+', name: 'More places' }] }]);
    before.rows[0]!.buttons![1]!.press();
    before.rows[0]!.buttons![1]!.press();
    expect(readPanel(house, facts, panels).rows[0]).toMatchObject({ value: '2' });
    expect(readPanel(house, facts).rows[0]).toEqual({ label: 'Household', value: 'Nobody' });
  });
});

describe('keepSelection', () => {
  it('keeps a site through its finish, and clears it when the site is cancelled or its slot holds a site elsewhere', () => {
    const { map, orders, slot, building } = siteFacts();
    expect(keepSelection(building, orders)).toBe(building);

    expect(applyOrder(map, orders, { kind: 'markArea', order: 'cancel', area: { x0: 4, y0: 4, x1: 4, y1: 4 } })).toMatchObject({ ok: true });
    expect(keepSelection(building, orders)).toBeNull();

    expect(applyOrder(map, orders, { kind: 'placeHouse', x: 10, y: 4 })).toMatchObject({ ok: true });
    expect(orders.siteOf[at(map, 10, 4)]).toBe(slot);
    expect(keepSelection(building, orders)).toBeNull();

    const moved: Selection = { kind: 'building', slot, center: at(map, 10, 4) };
    expect(keepSelection(moved, orders)).toBe(moved);
    orders.sites.state[slot] = SiteState.House;
    expect(keepSelection(moved, orders)).toBe(moved);
  });

  it('keeps a settler or the camp', () => {
    const { orders } = siteFacts();
    expect(keepSelection({ kind: 'villager', id: 3 }, orders)).toEqual({ kind: 'villager', id: 3 });
    expect(keepSelection({ kind: 'camp' }, orders)).toEqual({ kind: 'camp' });
  });
});
