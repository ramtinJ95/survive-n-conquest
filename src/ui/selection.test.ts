import { describe, expect, it } from 'vitest';
import { frameOf } from '../frame';
import { AnimalKind, addAnimal } from '../sim/animals';
import { BUILDING, finishBuilding } from '../sim/building';
import { BUILDINGS, Building } from '../sim/buildings';
import { TICKS_PER_DAY, dateAt, tickOfDay } from '../sim/calendar';
import { isNight } from '../sim/daylight';
import { CARRYING } from '../sim/carrying';
import { EATING } from '../sim/eating';
import { FORAGING } from '../sim/foraging';
import { GATHERING } from '../sim/gathering';
import { shotHits } from '../sim/hunting';
import { Good, refreshStack } from '../sim/goods';
import { NO_HOME } from '../sim/households';
import { TileKind } from '../sim/map';
import { Sex, nameOf } from '../sim/names';
import { MAX_SITES, SiteState, applyOrder, createOrders } from '../sim/orders';
import { type Sim, applyCommand, createSim, step } from '../sim/sim';
import { STOCKING } from '../sim/stocking';
import { CAMP_STORE, STORES } from '../sim/stores';
import { SUPPLYING } from '../sim/supplying';
import { TASK_KINDS, type TaskKind } from '../sim/tasks';
import { at, mapFrom } from '../sim/testMaps';
import { die } from '../sim/villagers';
import { NO_TASK, VillagerState } from '../sim/villagerState';
import { Stop } from '../sim/workshops';
import { type Facts, type Selection, keepSelection, markPlace, readPanel } from './selection';

const task = (kind: TaskKind) => TASK_KINDS.indexOf(kind) + 1;

/** The facts the main thread holds about a simulation, with the frame the worker would post. */
function factsOf(sim: Sim): Facts {
  return { map: sim.map, orders: sim.orders, camp: sim.camp, frame: frameOf(sim).frame };
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
  expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 12, y: 6 })).toMatchObject({ ok: true });
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
        tick: 0,
        villagers: Float32Array.of(3.5, 3.5),
        carried: Uint8Array.of(carried),
        states: Uint8Array.of(state),
        tasks: Uint8Array.of(taskValue),
        taskTiles: Int32Array.of(at(map, 2, 2)),
        destinations: Int32Array.of(-1),
        names: Uint16Array.of(0),
        sexes: Uint8Array.of(Sex.Man),
        households: Int16Array.of(0),
        homes: Int16Array.of(NO_HOME),
        workplaces: Int16Array.of(-1),
        hired: Uint32Array.of(0),
        missedMeals: Uint8Array.of(0),
        coldNights: Uint8Array.of(0),
        stockGoods: Uint8Array.of(carried),
        worn: Uint8Array.of(Good.None),
        storeFood: new Uint16Array(STORES),
        campFoodLimit: 40,
        storeInbound: new Uint16Array(STORES),
        storeFirewood: new Uint16Array(STORES),
        storeClothing: new Uint16Array(STORES),
        workshopStops: new Uint8Array(MAX_SITES),
        animals: new Float32Array(0),
        animalStates: new Uint8Array(0),
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
        { label: 'Job', value: 'None' },
        { label: 'Sex', value: 'Man' },
        { label: 'Household', value: 'Household 1' },
        { label: 'Home', value: 'None, sleeps at the camp' },
        { label: 'Missed meals', value: 'None' },
        { label: 'Cold nights', value: 'None' },
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
    expect(rows(0)).toEqual({ Job: 'None', Sex: 'Man', Household: 'Household 1, with Elsi', Home: 'None, sleeps at the camp', 'Missed meals': 'None', 'Cold nights': 'None' });
    expect(panel(1).title).toBe('Elsi');
    expect(rows(1)).toEqual({ Job: 'None', Sex: 'Woman', Household: 'Household 1, with Merek', Home: 'None, sleeps at the camp', 'Missed meals': 'None', 'Cold nights': 'None' });
    expect(rows(2)).toMatchObject({ Sex: 'Man', Household: `Household 2, with ${panel(3).title}` });

    while (sim.orders.sites.state[0] !== SiteState.Built) step(sim);
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

  it('says a settler that missed a meal walks home or to the camp to eat, and eats there', () => {
    const map = mapFrom(Array.from({ length: 32 }, () => '.'.repeat(32)), SEED);
    const sim = createSim(map, { villagers: 3, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 4, y: 4 })).toMatchObject({ ok: true });
    const house = sim.orders.siteOf[at(sim.map, 4, 4)]!;
    finishBuilding(sim, house);
    sim.stores.held[Good.Food - 1]![house] = 2;
    for (const id of [0, 2]) {
      sim.villagers.x[id] = sim.villagers.targetX[id] = 28.5;
      sim.villagers.y[id] = sim.villagers.targetY[id] = 28.5;
      sim.villagers.missedMeals[id] = 1;
    }
    const seen = [new Set<string>(), new Set<string>()];
    while (sim.tally.meals < 2) {
      step(sim);
      const facts = factsOf(sim);
      seen[0]!.add(settler(facts, 0));
      seen[1]!.add(settler(facts, 2));
    }
    expect(seen[0]).toEqual(new Set(['Idle', 'Walking home to eat']));
    expect(seen[1]).toEqual(new Set(['Idle', 'Walking to the camp to eat']));
    // A settler eats on the tick it arrives, so it reads Eating only when its half-rate skips that tick.
    const facts = factsOf(sim);
    facts.frame.states[2] = VillagerState.Working;
    facts.frame.tasks[2] = task(EATING);
    facts.frame.taskTiles[2] = sim.camp;
    expect(settler(facts, 2)).toBe('Eating');
  });
});

/**
 * Four settlers of seed 7 at the camp of an open map, a grove east of it, and
 * a forager's hut between them, finished at once, so its two places are
 * filled by the settlers nearest it.
 */
function hutSettlement(campFood?: number): { sim: Sim; slot: number } {
  const rows = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (_, x) => (x >= 22 && x <= 28 && y >= 6 && y <= 26 ? 'T' : '.')).join(''));
  const sim = createSim(mapFrom(rows, SEED), { villagers: 4, monsters: 0, ...(campFood === undefined ? {} : { campFood }) });
  const x = (sim.camp % sim.map.size) + 4;
  const y = Math.floor(sim.camp / sim.map.size);
  expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return { sim, slot };
}

/** The settlers that work at a slot, in the order they took their places. */
const workersOf = (sim: Sim, slot: number) =>
  [...sim.villagers.workplace.keys()].filter((id) => sim.villagers.workplace[id] === slot).sort((a, b) => sim.villagers.hired[a]! - sim.villagers.hired[b]!);

const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);

describe("a forager's hut's panel", () => {
  it('says what the hut does, names its two foragers in the order they came, and reads both its places filled', () => {
    const { sim, slot } = hutSettlement();
    const [first, second] = workersOf(sim, slot);
    const hut: Selection = { kind: 'building', slot, anchor: sim.orders.sites.y[slot]! * sim.map.size + sim.orders.sites.x[slot]! };
    expect(readPanel(hut, factsOf(sim))).toMatchObject({
      kind: 'hut',
      title: "Forager's hut",
      note: 'Its foragers pick food in the forest within 20 tiles and carry it to the nearest store with room.',
      rows: [
        { label: 'Foragers', value: `${nameOfId(sim, first!)} and ${nameOfId(sim, second!)}` },
        {
          label: 'Places',
          value: '2 of 2',
          buttons: [
            { text: '−', name: 'Fewer places', disabled: false },
            { text: '+', name: 'More places', disabled: true },
          ],
        },
      ],
    });
  });

  it('sends one place fewer and one more with its buttons, frees the forager that came last, and stops at either end', () => {
    const { sim, slot } = hutSettlement();
    const [first, second] = workersOf(sim, slot);
    const hut: Selection = { kind: 'building', slot, anchor: sim.orders.sites.y[slot]! * sim.map.size + sim.orders.sites.x[slot]! };
    const rows = () => readPanel(hut, factsOf(sim)).rows;
    const press = (name: string) => {
      const button = rows()[1]!.buttons!.find((candidate) => candidate.name === name)!;
      expect(button.disabled, name).toBe(false);
      const command = button.press();
      applyCommand(sim, command);
      return command;
    };

    expect(press('Fewer places')).toEqual({ kind: 'setPlaces', slot, places: 1 });
    expect(rows().map(({ value }) => value)).toEqual([nameOfId(sim, first!), '1 of 2']);
    expect(readPanel({ kind: 'villager', id: second! }, factsOf(sim)).rows.find(({ label }) => label === 'Job')!.value).toBe('None');
    expect(press('Fewer places')).toEqual({ kind: 'setPlaces', slot, places: 0 });
    expect(rows()[0]!.value).toBe('Nobody');
    expect(rows()[1]).toMatchObject({ value: '0 of 2', buttons: [{ disabled: true }, { disabled: false }] });
    expect(press('More places')).toEqual({ kind: 'setPlaces', slot, places: 1 });
    expect(press('More places')).toEqual({ kind: 'setPlaces', slot, places: 2 });
    expect(rows()[1]).toMatchObject({ value: '2 of 2', buttons: [{ disabled: false }, { disabled: true }] });
  });

  it('is the panel of a hut site, with its 8 logs and no stone, until the hut is finished', () => {
    const map = mapFrom(Array.from({ length: 16 }, () => '.'.repeat(16)));
    const orders = createOrders(map, at(map, 12, 12));
    expect(applyOrder(map, orders, { kind: 'place', building: Building.Hut, x: 4, y: 4 })).toMatchObject({ ok: true });
    const slot = orders.siteOf[at(map, 4, 4)]!;
    const site: Selection = { kind: 'building', slot, anchor: at(map, 4, 4) };
    const { frame } = siteFacts();
    const facts: Facts = {
      map,
      orders,
      camp: at(map, 12, 12),
      frame: frame([4.5, 4.5, 8.5, 8.5], [task(BUILDING), task(SUPPLYING)], [at(map, 4, 4), at(map, 9, 9)], [VillagerState.Working, VillagerState.Walking]),
    };
    facts.frame.carried[1] = Good.Log;
    facts.frame.destinations[1] = at(map, 4, 4);
    expect(readPanel(site, facts)).toEqual({
      kind: 'hutSite',
      title: "Forager's hut site",
      rows: [
        { label: 'Logs', value: '0/8' },
        { label: 'Work', value: 'Waiting for materials' },
        { label: 'Builders', value: '1' },
      ],
    });
    expect(readPanel({ kind: 'villager', id: 0 }, facts).rows[0]).toEqual({ label: 'Doing', value: "Building a forager's hut" });
    expect(readPanel({ kind: 'villager', id: 1 }, facts).rows[0]).toEqual({ label: 'Doing', value: "Carrying a log to a forager's hut site" });
  });
});

describe("a forager's panel", () => {
  it('reads its job and what it does through a spring day: walking to a tree, foraging, and carrying the food to the camp', () => {
    const { sim, slot } = hutSettlement();
    const foragers = workersOf(sim, slot);
    const others = [0, 1, 2, 3].filter((id) => !foragers.includes(id));
    const row = (id: number, label: string) => readPanel({ kind: 'villager', id }, factsOf(sim)).rows.find((entry) => entry.label === label)!.value;
    expect(foragers.map((id) => row(id, 'Job'))).toEqual(['Forager', 'Forager']);
    expect(others.map((id) => row(id, 'Job'))).toEqual(['None', 'None']);

    const seen = new Set<string>();
    while (!isNight(sim.tick)) {
      step(sim);
      for (const id of foragers) seen.add(row(id, 'Doing'));
    }
    expect(seen).toEqual(new Set(['Walking to a tree to forage', 'Foraging', 'Carrying food to the camp', 'Looking for forage']));
  });

  it('says it finds nothing to forage in winter', () => {
    const { sim, slot } = hutSettlement(200);
    const foragers = workersOf(sim, slot);
    while (dateAt(sim.tick).season !== 'Winter' || dateAt(sim.tick).minuteOfDay < 12 * 60) step(sim);
    expect(foragers.map((id) => settler(factsOf(sim), id))).toEqual(['Idle, nothing grows until spring', 'Idle, nothing grows until spring']);
  });

  it('says it waits for room while no store has room, counting the food on its way into the camp', () => {
    const { sim, slot } = hutSettlement(39);
    const foragers = workersOf(sim, slot);
    const FORAGE = task(FORAGING);
    while (!foragers.some((id) => sim.villagers.task[id] === FORAGE)) step(sim);
    for (let tick = 0; tick < 50; tick++) step(sim);
    const idle = foragers.filter((id) => sim.villagers.task[id] !== FORAGE);
    expect([sim.stores.held[Good.Food - 1]![CAMP_STORE], idle.length]).toEqual([39, 1]);
    expect(settler(factsOf(sim), idle[0]!)).toBe('Idle, waiting for room in a store');
  });
});

/**
 * One hunter and one settler without a job at the camp of an open map of 38
 * by 38 tiles, too small for a deer of its own, with a hunter's lodge at
 * (4, 4) whose one filled place takes the settler nearest it.
 */
function lodgeSettlement(): { sim: Sim; slot: number; hunter: number } {
  const sim = createSim(mapFrom(Array.from({ length: 38 }, () => '.'.repeat(38)), SEED), { villagers: 2, monsters: 0 });
  expect(applyCommand(sim, { kind: 'place', building: Building.Lodge, x: 4, y: 4 })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, 4, 4)]!;
  finishBuilding(sim, slot);
  applyCommand(sim, { kind: 'setPlaces', slot, places: 1 });
  return { sim, slot, hunter: workersOf(sim, slot)[0]! };
}

describe("a hunter's lodge's panel and a hunter's panel", () => {
  it('says what the lodge does and names its hunter, with its places', () => {
    const { sim, slot, hunter } = lodgeSettlement();
    const lodge: Selection = { kind: 'building', slot, anchor: at(sim.map, 4, 4) };
    expect(readPanel(lodge, factsOf(sim))).toMatchObject({
      kind: 'lodge',
      title: "Hunter's lodge",
      note: 'Its hunters hunt deer within 40 tiles and carry the food to the nearest store with room.',
      rows: [{ label: 'Hunters', value: nameOfId(sim, hunter) }, { label: 'Places', value: '1 of 2' }],
    });
    expect(readPanel({ kind: 'villager', id: hunter }, factsOf(sim)).rows.find(({ label }) => label === 'Job')!.value).toBe('Hunter');
  });

  it('reads what a hunter does through a hunt: stalking, aiming, idle once the only deer is killed, walking to its kill, and carrying the food to the camp', () => {
    const { sim, hunter } = lodgeSettlement();
    expect(settler(factsOf(sim), hunter)).toBe('Idle, no deer within 40 tiles of the lodge');
    const deer = addAnimal(sim.animals, AnimalKind.Deer, 30.5, 30.5);
    sim.animals.until[deer] = 1_000_000;
    expect(settler(factsOf(sim), hunter)).toBe('Looking for deer');
    while (!shotHits(sim.seed, sim.animals.shots)) sim.animals.shots++;
    const seen = new Set<string>();
    while (sim.tally.huntedIn === 0) {
      step(sim);
      seen.add(settler(factsOf(sim), hunter));
    }
    expect(seen).toEqual(
      new Set([
        'Looking for deer',
        'Stalking a deer',
        'Aiming at a deer',
        'Idle, no deer within 40 tiles of the lodge',
        'Walking to a kill to pick up food',
        'Carrying food to the camp',
      ]),
    );
  });

  it('says a hunter waits for room while no store has room', () => {
    const { sim, hunter } = lodgeSettlement();
    addAnimal(sim.animals, AnimalKind.Deer, 30.5, 30.5);
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = sim.stores.campLimit;
    expect(settler(factsOf(sim), hunter)).toBe('Idle, waiting for room in a store');
  });
});

function siteFacts() {
  const map = mapFrom(Array.from({ length: 16 }, () => '.'.repeat(16)));
  const camp = at(map, 12, 12);
  const orders = createOrders(map, camp);
  expect(applyOrder(map, orders, { kind: 'place', building: Building.House, x: 4, y: 4 })).toMatchObject({ ok: true });
  const slot = orders.siteOf[at(map, 4, 4)]!;
  const building: Selection = { kind: 'building', slot, anchor: at(map, 4, 4) };
  const frame = (villagers: number[], tasks: number[], taskTiles: number[], states = tasks.map(() => VillagerState.Walking as number)) => ({
    tick: 0,
    villagers: Float32Array.from(villagers),
    carried: new Uint8Array(tasks.length),
    states: Uint8Array.from(states),
    tasks: Uint8Array.from(tasks),
    taskTiles: Int32Array.from(taskTiles),
    destinations: new Int32Array(tasks.length).fill(-1),
    names: new Uint16Array(tasks.length),
    sexes: new Uint8Array(tasks.length),
    households: Int16Array.from(tasks, (_, id) => id >> 1),
    homes: new Int16Array((tasks.length + 1) >> 1).fill(NO_HOME),
    workplaces: new Int16Array(tasks.length).fill(-1),
    hired: new Uint32Array(tasks.length),
    missedMeals: new Uint8Array(tasks.length),
    coldNights: new Uint8Array(tasks.length),
    stockGoods: new Uint8Array(tasks.length),
    worn: new Uint8Array(tasks.length),
    storeFood: new Uint16Array(STORES),
    campFoodLimit: 40,
    storeInbound: new Uint16Array(STORES),
    storeFirewood: new Uint16Array(STORES),
    storeClothing: new Uint16Array(STORES),
    workshopStops: new Uint8Array(MAX_SITES),
    animals: new Float32Array(0),
    animalStates: new Uint8Array(0),
  });
  return { map, camp, orders, slot, building, frame };
}

/**
 * A woodcutter and a settler without a job at the camp of an open map of 38
 * by 38 tiles, with a woodshed at (24, 12) whose one place takes the settler
 * nearest it, and a stockpile of `logs` logs at (28, 14).
 */
function woodshedSettlement(logs: number): { sim: Sim; slot: number; woodcutter: number; shed: Selection } {
  const sim = createSim(mapFrom(Array.from({ length: 38 }, () => '.'.repeat(38)), SEED), { villagers: 2, monsters: 0 });
  applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 28, y0: 14, x1: 28, y1: 14 } });
  sim.map.stackGood[at(sim.map, 28, 14)] = Good.Log;
  sim.map.stackSize[at(sim.map, 28, 14)] = logs;
  refreshStack(sim, at(sim.map, 28, 14));
  expect(applyCommand(sim, { kind: 'place', building: Building.Woodshed, x: 24, y: 12 })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, 24, 12)]!;
  finishBuilding(sim, slot);
  return { sim, slot, woodcutter: workersOf(sim, slot)[0]!, shed: { kind: 'building', slot, anchor: at(sim.map, 24, 12) } };
}

const NO_LOG = 'Idle, no log in a stockpile within 30 tiles of the woodshed';

describe("a woodshed's panel and a woodcutter's panel", () => {
  it('says what the shed does, names its woodcutter, its firewood, and why the woodcutter stopped', () => {
    const { sim, woodcutter, shed } = woodshedSettlement(0);
    for (let tick = 0; tick < 10; tick++) step(sim);
    expect(readPanel(shed, factsOf(sim))).toMatchObject({
      kind: 'woodshed',
      title: 'Woodshed',
      note: 'Its woodcutter carries logs from the stockpiles within 30 tiles and splits each into 2 firewood.',
      rows: [
        { label: 'Woodcutter', value: nameOfId(sim, woodcutter) },
        { label: 'Places', value: '1 of 1' },
        { label: 'Firewood', value: '0 of 40' },
        { label: 'Doing', value: NO_LOG },
      ],
    });
    expect(readPanel({ kind: 'villager', id: woodcutter }, factsOf(sim)).rows.find(({ label }) => label === 'Job')!.value).toBe('Woodcutter');
    expect(settler(factsOf(sim), woodcutter)).toBe(NO_LOG);
  });

  it('reads what a woodcutter does through a split: to the stockpile for a log, carrying it to the shed, splitting it, then idle with 2 firewood in the shed', () => {
    const { sim, slot, woodcutter, shed } = woodshedSettlement(1);
    const seen = new Set<string>();
    const doing = new Set<string>();
    while (sim.workshops.stopped[slot] !== Stop.NoInput || sim.tally.made === 0) {
      step(sim);
      seen.add(settler(factsOf(sim), woodcutter));
      doing.add(readPanel(shed, factsOf(sim)).rows.find(({ label }) => label === 'Doing')!.value);
    }
    expect(seen).toEqual(new Set(['Looking for a log', 'Walking to a stockpile for a log', 'Carrying a log to the woodshed', 'Splitting a log', NO_LOG]));
    expect(doing).toEqual(seen);
    expect(readPanel(shed, factsOf(sim)).rows.find(({ label }) => label === 'Firewood')!.value).toBe('2 of 40');
  });

  it('says the woodshed is full, and that the building sites need the logs', () => {
    const full = woodshedSettlement(4);
    full.sim.stores.held[Good.Firewood - 1]![full.slot] = 39;
    for (let tick = 0; tick < 10; tick++) step(full.sim);
    expect(settler(factsOf(full.sim), full.woodcutter)).toBe('Idle, the woodshed is full');

    const kept = woodshedSettlement(4);
    expect(applyCommand(kept.sim, { kind: 'place', building: Building.House, x: 8, y: 30 })).toMatchObject({ ok: true });
    for (let tick = 0; tick < 10; tick++) step(kept.sim);
    expect(settler(factsOf(kept.sim), kept.woodcutter)).toBe('Idle, the building sites need the logs');
    expect(readPanel(kept.shed, factsOf(kept.sim)).rows.find(({ label }) => label === 'Doing')!.value).toBe('Idle, the building sites need the logs');
  });

  it('says nobody works at a shed whose place the player emptied', () => {
    const { sim, slot, shed } = woodshedSettlement(0);
    applyCommand(sim, { kind: 'setPlaces', slot, places: 0 });
    expect(readPanel(shed, factsOf(sim)).rows.filter(({ label }) => label !== 'Places' && label !== 'Firewood')).toEqual([
      { label: 'Woodcutter', value: 'Nobody' },
      { label: 'Doing', value: 'Nobody works here' },
    ]);
  });

  it('is the panel of a woodshed site, with its 6 logs and no stone, until the woodshed is finished', () => {
    const sim = createSim(mapFrom(Array.from({ length: 38 }, () => '.'.repeat(38)), SEED), { villagers: 0, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.Woodshed, x: 24, y: 12 })).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[at(sim.map, 24, 12)]!;
    expect(readPanel({ kind: 'building', slot, anchor: at(sim.map, 24, 12) }, factsOf(sim))).toEqual({
      kind: 'woodshedSite',
      title: 'Woodshed site',
      rows: [
        { label: 'Logs', value: '0/6' },
        { label: 'Work', value: 'Waiting for materials' },
        { label: 'Builders', value: '0' },
      ],
    });
  });
});

/**
 * A tailor and a settler without a job at the camp of an open map of 38 by 38
 * tiles, with a tailor's hut at (24, 12) whose one place takes the settler
 * nearest it, and a stockpile of `hides` hides at (28, 14).
 */
/** A tailor's hut with its tailor and `hides` hides on a stockpile. Both settlers already wear clothing, so the pieces stay in the hut. */
function tailorSettlement(hides: number): { sim: Sim; slot: number; tailor: number; hut: Selection } {
  const sim = createSim(mapFrom(Array.from({ length: 38 }, () => '.'.repeat(38)), SEED), { villagers: 2, monsters: 0 });
  sim.villagers.worn.fill(Good.Clothing);
  applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 28, y0: 14, x1: 28, y1: 14 } });
  sim.map.stackGood[at(sim.map, 28, 14)] = Good.Hide;
  sim.map.stackSize[at(sim.map, 28, 14)] = hides;
  refreshStack(sim, at(sim.map, 28, 14));
  expect(applyCommand(sim, { kind: 'place', building: Building.Tailor, x: 24, y: 12 })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, 24, 12)]!;
  finishBuilding(sim, slot);
  return { sim, slot, tailor: workersOf(sim, slot)[0]!, hut: { kind: 'building', slot, anchor: at(sim.map, 24, 12) } };
}

const NO_HIDE = "Idle, no hide in a stockpile within 30 tiles of the tailor's hut";

describe("a tailor's hut's panel and a tailor's panel", () => {
  it('says what the hut does, names its tailor, its clothing, and why the tailor stopped', () => {
    const { sim, tailor, hut } = tailorSettlement(0);
    for (let tick = 0; tick < 10; tick++) step(sim);
    expect(readPanel(hut, factsOf(sim))).toMatchObject({
      kind: 'tailor',
      title: "Tailor's hut",
      note: 'Its tailor carries hides from the stockpiles within 30 tiles and makes 1 piece of clothing from each 2.',
      rows: [
        { label: 'Tailor', value: nameOfId(sim, tailor) },
        { label: 'Places', value: '1 of 1' },
        { label: 'Clothing', value: '0 of 8' },
        { label: 'Doing', value: NO_HIDE },
      ],
    });
    expect(readPanel({ kind: 'villager', id: tailor }, factsOf(sim)).rows.find(({ label }) => label === 'Job')!.value).toBe('Tailor');
    expect(settler(factsOf(sim), tailor)).toBe(NO_HIDE);
  });

  it('reads what a tailor does through a piece: to the stockpile for a hide, carrying it to the hut, twice, making clothing, then idle with 1 piece in the hut', () => {
    const { sim, slot, tailor, hut } = tailorSettlement(2);
    const seen = new Set<string>();
    const doing = new Set<string>();
    const carries = new Set<string>();
    while (sim.workshops.stopped[slot] !== Stop.NoInput || sim.tally.made === 0) {
      step(sim);
      seen.add(settler(factsOf(sim), tailor));
      doing.add(readPanel(hut, factsOf(sim)).rows.find(({ label }) => label === 'Doing')!.value);
      carries.add(readPanel({ kind: 'villager', id: tailor }, factsOf(sim)).rows.find(({ label }) => label === 'Carries')!.value);
    }
    expect(seen).toEqual(new Set(['Looking for a hide', 'Walking to a stockpile for a hide', "Carrying a hide to the tailor's hut", 'Making clothing', NO_HIDE]));
    expect(doing).toEqual(seen);
    expect(carries).toEqual(new Set(['Nothing', '1 hide']));
    expect(readPanel(hut, factsOf(sim)).rows.find(({ label }) => label === 'Clothing')!.value).toBe('1 of 8');
  });

  it("reads a settler's walk to the tailor's hut, then the clothing it wears beside its cold nights, while the hut's panel counts down", () => {
    const sim = createSim(mapFrom(Array.from({ length: 38 }, () => '.'.repeat(38)), SEED), { villagers: 1, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.Tailor, x: 30, y: 12 })).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[at(sim.map, 30, 12)]!;
    finishBuilding(sim, slot);
    applyCommand(sim, { kind: 'setPlaces', slot, places: 0 });
    sim.stores.held[Good.Clothing - 1]![slot] = 2;
    const hut: Selection = { kind: 'building', slot, anchor: at(sim.map, 30, 12) };
    const row = (selection: Selection, label: string) => readPanel(selection, factsOf(sim)).rows.find((r) => r.label === label)!.value;
    const villager: Selection = { kind: 'villager', id: 0 };
    expect([row(villager, 'Cold nights'), row(hut, 'Clothing')]).toEqual(['None', '2 of 8']);
    const seen = new Set<string>();
    while (sim.villagers.worn[0] === Good.None) {
      step(sim);
      seen.add(`${row(villager, 'Doing')} | ${row(villager, 'Carries')} | ${row(villager, 'Cold nights')} | ${row(hut, 'Clothing')}`);
    }
    expect(seen).toContain("Walking to the tailor's hut for clothing | Nothing | None | 2 of 8");
    expect([...seen].at(-1)).toBe('Idle | Nothing | None, clothed | 1 of 8');
    sim.villagers.coldNights[0] = 2;
    expect(row(villager, 'Cold nights')).toBe('2, cold, clothed');
  });

  it("says the tailor's hut is full", () => {
    const full = tailorSettlement(4);
    full.sim.stores.held[Good.Clothing - 1]![full.slot] = 8;
    for (let tick = 0; tick < 10; tick++) step(full.sim);
    expect(settler(factsOf(full.sim), full.tailor)).toBe("Idle, the tailor's hut is full");
    expect(readPanel(full.hut, factsOf(full.sim)).rows.find(({ label }) => label === 'Doing')!.value).toBe("Idle, the tailor's hut is full");
  });

  it("is the panel of a tailor's hut site, with its 8 logs and no stone, until the hut is finished", () => {
    const sim = createSim(mapFrom(Array.from({ length: 38 }, () => '.'.repeat(38)), SEED), { villagers: 0, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.Tailor, x: 24, y: 12 })).toMatchObject({ ok: true });
    const slot = sim.orders.siteOf[at(sim.map, 24, 12)]!;
    expect(readPanel({ kind: 'building', slot, anchor: at(sim.map, 24, 12) }, factsOf(sim))).toEqual({
      kind: 'tailorSite',
      title: "Tailor's hut site",
      rows: [
        { label: 'Logs', value: '0/8' },
        { label: 'Work', value: 'Waiting for materials' },
        { label: 'Builders', value: '0' },
      ],
    });
  });
});

describe('a building panel', () => {
  it('shows what has arrived at a site, its work, and its builders', () => {
    const { map, camp, orders, slot, building, frame } = siteFacts();
    const anchor = at(map, 4, 4);
    const elsewhere = at(map, 9, 9);
    const facts: Facts = {
      map,
      orders,
      camp,
      frame: frame([3.5, 3.5, 5.5, 5.5, 1.5, 1.5, 4.5, 2.5], [task(BUILDING), task(BUILDING), task(SUPPLYING), task(BUILDING)], [anchor, anchor, anchor, elsewhere]),
    };
    expect(readPanel(building, facts)).toEqual({
      kind: 'houseSite',
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
    orders.sites.work[slot] = BUILDINGS[Building.House].workTicks / 2;
    expect(readPanel(building, facts).rows.slice(0, 3)).toEqual([
      { label: 'Logs', value: '12/12' },
      { label: 'Stone', value: '6/6' },
      { label: 'Work', value: '50%' },
    ]);

    orders.sites.state[slot] = SiteState.Built;
    facts.frame.storeFood[slot] = 7;
    expect(readPanel(building, facts)).toEqual({
      kind: 'house',
      title: 'House',
      note: 'A finished house.',
      rows: [
        { label: 'Household', value: 'Nobody' },
        { label: 'Food', value: '7 of 16' },
        { label: 'Firewood', value: '0 of 6' },
      ],
    });
  });

  it("names the household that lives in a house, and nobody in a house past the last household's, by internals for the houses", () => {
    const sim = settlement(SEED, 2);
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 6, y: 10 })).toMatchObject({ ok: true });
    const household = (slot: number) => readPanel({ kind: 'building', slot, anchor: 0 }, factsOf(sim)).rows;
    finishBuilding(sim, 0);
    finishBuilding(sim, 1);
    expect(household(0)[0]).toEqual({ label: 'Household', value: 'Household 1: Merek and Elsi' });
    expect(household(1)[0]).toEqual({ label: 'Household', value: 'Nobody' });
  });

  it('says how much food a house and the camp hold, as the household stocks its home', () => {
    const sim = settlement(SEED, 2);
    finishBuilding(sim, 0);
    const food = (selection: Selection) => readPanel(selection, factsOf(sim)).rows.find((entry) => entry.label === 'Food')!.value;
    const house: Selection = { kind: 'building', slot: 0, anchor: 0 };
    expect([food(house), food({ kind: 'camp' })]).toEqual(['0 of 16', '24 of 40']);
    while (sim.stores.held[Good.Food - 1]![0]! < 6) step(sim);
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
        { label: 'Firewood', value: '0 of 12' },
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

describe('the mark of a building', () => {
  it("rings a house and a forager's hut over the middle of their own tiles, just clear of their corners", () => {
    const { map, camp, orders, frame, building: house } = siteFacts();
    expect(applyOrder(map, orders, { kind: 'place', building: Building.Hut, x: 9, y: 4 })).toMatchObject({ ok: true });
    const hut: Selection = { kind: 'building', slot: orders.siteOf[at(map, 9, 4)]!, anchor: at(map, 9, 4) };
    const facts: Facts = { map, orders, camp, frame: frame([12.5, 12.5], [0], [-1]) };

    const houseRing = markPlace(house, facts)!;
    const hutRing = markPlace(hut, facts)!;
    expect([houseRing.x, houseRing.y]).toEqual([4.5, 4.5]);
    expect([hutRing.x, hutRing.y]).toEqual([10, 5]);
    const corner = (side: number) => (side / 2) * Math.SQRT2;
    expect(houseRing.radius).toBeGreaterThan(corner(3));
    expect(houseRing.radius).toBeLessThan(corner(3) + 0.25);
    expect(hutRing.radius).toBeGreaterThan(corner(2));
    expect(hutRing.radius).toBeLessThan(corner(2) + 0.25);
  });
});

describe('keepSelection', () => {
  it('keeps a site through its finish, and clears it when the site is cancelled or its slot holds a site elsewhere', () => {
    const { map, orders, slot, building } = siteFacts();
    expect(keepSelection(building, orders)).toBe(building);

    expect(applyOrder(map, orders, { kind: 'markArea', order: 'cancel', area: { x0: 4, y0: 4, x1: 4, y1: 4 } })).toMatchObject({ ok: true });
    expect(keepSelection(building, orders)).toBeNull();

    expect(applyOrder(map, orders, { kind: 'place', building: Building.House, x: 10, y: 4 })).toMatchObject({ ok: true });
    expect(orders.siteOf[at(map, 10, 4)]).toBe(slot);
    expect(keepSelection(building, orders)).toBeNull();

    const moved: Selection = { kind: 'building', slot, anchor: at(map, 10, 4) };
    expect(keepSelection(moved, orders)).toBe(moved);
    orders.sites.state[slot] = SiteState.Built;
    expect(keepSelection(moved, orders)).toBe(moved);
  });

  it('keeps a settler or the camp', () => {
    const { orders } = siteFacts();
    expect(keepSelection({ kind: 'villager', id: 3 }, orders)).toEqual({ kind: 'villager', id: 3 });
    expect(keepSelection({ kind: 'camp' }, orders)).toEqual({ kind: 'camp' });
  });
});

/** Runs to the first tick of the night that falls at the dusk of `day`. */
function toDusk(sim: Sim, day: number): void {
  while (!(dateAt(sim.tick).day === day && isNight(sim.tick) && tickOfDay(sim.tick) >= TICKS_PER_DAY / 2)) step(sim);
}

describe("a settler's panel in winter", () => {
  it('counts the cold nights a settler had in a row, says it is cold, and says it died of cold', () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24)), SEED), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    const merek: Selection = { kind: 'villager', id: 0 };
    const row = (label: string) => readPanel(merek, factsOf(sim)).rows.find((entry) => entry.label === label)!.value;
    const seen = [row('Cold nights')];
    while (!sim.over) {
      step(sim);
      if (seen.at(-1) !== row('Cold nights')) seen.push(row('Cold nights'));
    }
    expect(seen).toEqual(['None', '1, cold', '2, cold', '3']);
    expect(row('Doing')).toBe('Died of cold');
    expect(row('Missed meals')).toBe('None');
  });

  it('says a settler with two cold nights that starves on a winter night died of hunger, and one that freezes there died of cold', () => {
    const sim = createSim(mapFrom(Array.from({ length: 24 }, () => '.'.repeat(24)), SEED), { villagers: 2, monsters: 0, campFood: 100, animals: false });
    toDusk(sim, 12);
    sim.villagers.missedMeals[0] = 2;
    sim.stores.held[Good.Food - 1]![CAMP_STORE] = 0;
    while (!sim.over) step(sim);
    const rows = (id: number) => Object.fromEntries(readPanel({ kind: 'villager', id }, factsOf(sim)).rows.map(({ label, value }) => [label, value]));
    expect(rows(0)).toMatchObject({ Doing: 'Died of hunger', 'Missed meals': '3', 'Cold nights': '2' });
    expect(rows(1)).toMatchObject({ Doing: 'Died of cold', 'Missed meals': '1', 'Cold nights': '3' });
  });

  it('says a settler walks to a woodshed for firewood, carries it home, and one without a job carries it to the camp', () => {
    const sim = createSim(mapFrom(Array.from({ length: 40 }, () => '.'.repeat(40)), SEED), { villagers: 4, monsters: 0, campFood: 100, animals: false });
    for (const [kind, x, y] of [[Building.House, 16, 14], [Building.Woodshed, 23, 14]] as const) {
      expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
      finishBuilding(sim, sim.orders.siteOf[at(sim.map, x, y)]!);
    }
    const shed = sim.orders.siteOf[at(sim.map, 23, 14)]!;
    sim.stores.held[Good.Firewood - 1]![shed] = 30;
    const seen = new Map<string, string>();
    while (!isNight(sim.tick)) {
      step(sim);
      const facts = factsOf(sim);
      for (let id = 0; id < 4; id++) {
        if (sim.villagers.task[id] !== task(STOCKING)) continue;
        const panel = Object.fromEntries(readPanel({ kind: 'villager', id }, facts).rows.map(({ label, value }) => [label, value]));
        seen.set(panel.Doing!, panel.Carries!);
      }
    }
    expect(Object.fromEntries(seen)).toEqual({
      'Walking to the camp for food': 'Nothing',
      'Carrying food home': '1 food',
      'Walking to a woodshed for firewood': 'Nothing',
      'Carrying firewood home': '1 firewood',
      'Carrying firewood to the camp': '1 firewood',
    });
  });
});
