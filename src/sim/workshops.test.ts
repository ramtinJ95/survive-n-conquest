import { describe, expect, it } from 'vitest';
import { arrived, finishBuilding } from './building';
import { BUILDINGS, Building, Job } from './buildings';
import { TICKS_PER_DAY, TICKS_PER_SECOND } from './calendar';
import { isNight } from './daylight';
import { Claim } from './claims';
import { EATING } from './eating';
import { Good, putDown } from './goods';
import { jobOf } from './jobs';
import { tileAt } from './map';
import { type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_STORE, WOODSHED_FIREWOOD_LIMIT } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { VillagerState } from './villagerState';
import { Stop, WORKSHOP } from './workshops';

const WORK = TASK_KINDS.indexOf(WORKSHOP) + 1;
const EAT = TASK_KINDS.indexOf(EATING) + 1;
const SPLIT_TICKS = 10 * TICKS_PER_SECOND;

/** An open map of `size` tiles a side, with its camp at its middle. */
const openMap = (size = 64) => mapFrom(Array.from({ length: size }, () => '.'.repeat(size)));

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/** A building of `kind` anchored on (x, y), finished at once. Returns its slot. */
function finished(sim: Sim, kind: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: kind, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

/** A stockpile on the one tile (x, y) holding `logs` logs. */
function logPile(sim: Sim, x: number, y: number, logs: number): void {
  expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: x, y0: y, x1: x, y1: y } })).toMatchObject({ ok: true });
  if (logs > 0) expect(putDown(sim, at(sim.map, x, y), Good.Log, logs)).toBe(true);
}

const logsOn = (sim: Sim, x: number, y: number) => (sim.map.stackGood[at(sim.map, x, y)] === Good.Log ? sim.map.stackSize[at(sim.map, x, y)]! : 0);
const firewood = (sim: Sim, slot: number) => sim.stores.held[Good.Firewood - 1]![slot]!;
const woodcutterAt = (sim: Sim, slot: number) => sim.villagers.workplace.indexOf(slot);
/** Whether the villager stands at its workshop's door at work on a batch, with empty hands and no unit to fetch: "Splitting a log". */
const splitting = (sim: Sim, id: number) =>
  sim.villagers.task[id] === WORK &&
  sim.villagers.state[id] === VillagerState.Working &&
  sim.villagers.carried[id] === Good.None &&
  sim.villagers.taskTile[id] === -1;

function logsOnGround(sim: Sim): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Log) units += sim.map.stackSize[tile]!;
  return units;
}

/** The logs on stockpile tiles that no carrier has reserved, counted tile by tile. */
function unreservedOnStockpiles(sim: Sim): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) {
    if (sim.orders.claims[tile] === Claim.Stockpile && sim.map.stackGood[tile] === Good.Log) units += sim.map.stackSize[tile]! - sim.goods.outbound[tile]!;
  }
  return units;
}

/** Runs the simulation until it is `ticks` before the first dusk from now. */
function runToBeforeDusk(sim: Sim, ticks: number): void {
  runUntil(sim, () => !isNight(sim.tick) && isNight(sim.tick + ticks), TICKS_PER_DAY);
}

describe('a woodshed', () => {
  it('is a workplace with one place, 6 logs to build, and a store of 40 firewood', () => {
    const { needs, places, job, reach, recipe } = BUILDINGS[Building.Woodshed];
    expect({ needs, places, job, reach, recipe }).toEqual({
      needs: { [Good.Log]: 6 },
      places: 1,
      job: Job.Woodcutter,
      reach: 30,
      recipe: { input: Good.Log, inputs: 1, output: Good.Firewood, outputs: 2, workTicks: SPLIT_TICKS },
    });
    expect(WOODSHED_FIREWOOD_LIMIT).toBe(40);
  });

  it('hires the nearest villager without a job as its woodcutter once it is finished', () => {
    const sim = createSim(openMap(), { villagers: 4, monsters: 0 });
    const hut = finished(sim, Building.Hut, 20, 32);
    const foragers = [0, 1, 2, 3].filter((id) => sim.villagers.workplace[id] === hut);
    expect(foragers).toHaveLength(2);
    const free = [0, 1, 2, 3].filter((id) => !foragers.includes(id));
    sim.villagers.x[foragers[0]!] = 41.5;
    sim.villagers.y[foragers[0]!] = 32.5;
    sim.villagers.x[free[0]!] = 30.5;
    sim.villagers.x[free[1]!] = 38.5;
    sim.villagers.y[free[1]!] = 33.5;
    const shed = finished(sim, Building.Woodshed, 40, 32);
    expect([0, 1, 2, 3].filter((id) => sim.villagers.workplace[id] === shed)).toEqual([free[1]]);
    expect(jobOf(sim, free[1]!)).toBe(Job.Woodcutter);
    expect(jobOf(sim, free[0]!)).toBe(Job.None);
  });

  it('carries 1 log from the nearest stockpile in reach, splits it in 10 seconds of work, and 2 firewood land in the shed', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    logPile(sim, 44, 32, 3);
    logPile(sim, 40, 36, 3);
    const shed = finished(sim, Building.Woodshed, 36, 32);
    const woodcutter = woodcutterAt(sim, shed);
    let work = 0;
    runUntil(sim, () => firewood(sim, shed) > 0, TICKS_PER_DAY / 2, () => {
      if (splitting(sim, woodcutter)) work++;
    });
    expect([firewood(sim, shed), logsOn(sim, 40, 36), logsOn(sim, 44, 32)]).toEqual([2, 2, 3]);
    expect(work).toBe(SPLIT_TICKS);
    expect([sim.tally.batches, sim.tally.made]).toEqual([1, 2]);
  });

  it('has a hungry woodcutter bring the log in its hands into the woodshed before it eats, and finish a half-split log after its meal', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0, campFood: 0 });
    logPile(sim, 40, 36, 2);
    const shed = finished(sim, Building.Woodshed, 36, 32);
    const woodcutter = woodcutterAt(sim, shed);
    const food = sim.stores.held[Good.Food - 1]!;
    const { progress, input } = sim.workshops;
    sim.villagers.missedMeals[woodcutter] = 1;
    runUntil(sim, () => sim.villagers.carried[woodcutter] === Good.Log, TICKS_PER_DAY / 2);
    food[CAMP_STORE] = 1;
    runUntil(sim, () => sim.villagers.task[woodcutter] === EAT, TICKS_PER_DAY / 2);
    expect([input[shed], logsOn(sim, 40, 36), logsOnGround(sim)]).toEqual([1, 1, 1]);
    runUntil(sim, () => sim.tally.meals === 1, TICKS_PER_DAY / 2);
    expect(sim.villagers.missedMeals[woodcutter]).toBe(0);

    runUntil(sim, () => progress[shed]! >= SPLIT_TICKS / 2, TICKS_PER_DAY / 2);
    sim.villagers.missedMeals[woodcutter] = 1;
    food[CAMP_STORE] = 1;
    const half = progress[shed]!;
    runUntil(sim, () => sim.villagers.task[woodcutter] === EAT, 10, () => expect(progress[shed]).toBeLessThanOrEqual(half + 10));
    const left = progress[shed]!;
    runUntil(sim, () => sim.tally.meals === 2, TICKS_PER_DAY / 2, () => expect(progress[shed]).toBe(left));
    runUntil(sim, () => firewood(sim, shed) > 0, TICKS_PER_DAY / 2, () => expect(progress[shed] === 0 || progress[shed]! >= left).toBe(true));
    expect([firewood(sim, shed), sim.tally.batches]).toEqual([2, 1]);
  });

  it('splits at half the rate while its woodcutter is hungry, and walks at full speed', () => {
    const run = (hungry: boolean) => {
      const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
      logPile(sim, 40, 36, 1);
      const shed = finished(sim, Building.Woodshed, 36, 32);
      const woodcutter = woodcutterAt(sim, shed);
      if (hungry) sim.villagers.missedMeals[woodcutter] = 1;
      sim.stores.held[Good.Food - 1]![CAMP_STORE] = 0;
      let work = 0;
      let walk = 0;
      runUntil(sim, () => firewood(sim, shed) > 0, TICKS_PER_DAY / 2, () => {
        if (splitting(sim, woodcutter)) work++;
        if (sim.villagers.state[woodcutter] === VillagerState.Walking) walk++;
      });
      return { work, walk };
    };
    const fed = run(false);
    const hungry = run(true);
    expect([fed.work, hungry.work]).toEqual([SPLIT_TICKS, 2 * SPLIT_TICKS]);
    expect(Math.abs(hungry.walk - fed.walk)).toBeLessThanOrEqual(2);
  });

  it('never takes a log that lies off a stockpile, and says it has none in reach', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    expect(putDown(sim, at(sim.map, 40, 36), Good.Log, 4)).toBe(true);
    logPile(sim, 44, 36, 0);
    const shed = finished(sim, Building.Woodshed, 36, 32);
    runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 3, TICKS_PER_DAY);
    expect([firewood(sim, shed), logsOn(sim, 40, 36), sim.workshops.stopped[shed]]).toEqual([0, 4, Stop.NoInput]);
  });

  it('takes logs from a stockpile 30 tiles from its middle, and none from one beyond', () => {
    const run = (x: number) => {
      const sim = createSim(openMap(80), { villagers: 1, monsters: 0 });
      const shed = finished(sim, Building.Woodshed, 10, 60);
      logPile(sim, x, 60, 2);
      runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 2, TICKS_PER_DAY);
      return { firewood: firewood(sim, shed), stopped: sim.workshops.stopped[shed], logs: logsOn(sim, x, 60) };
    };
    expect(run(40)).toMatchObject({ firewood: 4, logs: 0 });
    expect(run(42)).toEqual({ firewood: 0, stopped: Stop.NoInput, logs: 2 });
  });

  it('leaves on the stockpiles the logs a building site still lacks: of 15 logs it splits 3, and the house site gets its 12', () => {
    const sim = createSim(openMap(), { villagers: 3, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 26, y: 26 })).toMatchObject({ ok: true });
    const house = sim.orders.siteOf[at(sim.map, 26, 26)]!;
    logPile(sim, 40, 36, 8);
    logPile(sim, 41, 36, 7);
    const shed = finished(sim, Building.Woodshed, 36, 32);
    const stops = new Set<number>();
    const miscounts: number[] = [];
    runUntil(
      sim,
      () => arrived(sim.map, sim.orders, house, Good.Log) === 12 && logsOnGround(sim) === 12 && sim.tally.batches === 3,
      TICKS_PER_DAY * 3,
      () => {
        stops.add(sim.workshops.stopped[shed]!);
        if (sim.goods.stockedUnits[Good.Log - 1] !== unreservedOnStockpiles(sim)) miscounts.push(sim.tick);
      },
    );
    expect(miscounts).toEqual([]);
    runUntil(sim, () => sim.workshops.stopped[shed] === Stop.NoInput, TICKS_PER_DAY);
    expect([sim.tally.batches, sim.tally.made, arrived(sim.map, sim.orders, house, Good.Log)]).toEqual([3, 6, 12]);
    expect(stops.has(Stop.ForSites)).toBe(true);
  });

  it('says the building sites need the logs while a site lacks as many as the stockpiles hold', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 26, y: 26 })).toMatchObject({ ok: true });
    logPile(sim, 40, 36, 5);
    const shed = finished(sim, Building.Woodshed, 36, 32);
    runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 3, TICKS_PER_DAY);
    expect([firewood(sim, shed), logsOn(sim, 40, 36), sim.workshops.stopped[shed]]).toEqual([0, 5, Stop.ForSites]);
  });

  it('stops once the shed holds 40 firewood, and says it is full', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    logPile(sim, 40, 36, 5);
    const shed = finished(sim, Building.Woodshed, 36, 32);
    sim.stores.held[Good.Firewood - 1]![shed] = WOODSHED_FIREWOOD_LIMIT - 3;
    runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 3, TICKS_PER_DAY);
    expect([firewood(sim, shed), logsOn(sim, 40, 36), sim.workshops.stopped[shed]]).toEqual([WOODSHED_FIREWOOD_LIMIT - 1, 4, Stop.Full]);

    sim.stores.held[Good.Firewood - 1]![shed] = WOODSHED_FIREWOOD_LIMIT - 2;
    runUntil(sim, () => firewood(sim, shed) === WOODSHED_FIREWOOD_LIMIT, TICKS_PER_DAY / 3);
    runUntil(sim, () => sim.tick >= (2 * TICKS_PER_DAY) / 3, TICKS_PER_DAY);
    expect([firewood(sim, shed), logsOn(sim, 40, 36), sim.workshops.stopped[shed]]).toEqual([WOODSHED_FIREWOOD_LIMIT, 3, Stop.Full]);
  });

  it('says it has no log in reach once the stockpiles in reach are empty', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    logPile(sim, 40, 36, 2);
    const shed = finished(sim, Building.Woodshed, 36, 32);
    runUntil(sim, () => sim.workshops.stopped[shed] === Stop.NoInput, TICKS_PER_DAY / 2);
    expect([firewood(sim, shed), logsOn(sim, 40, 36)]).toEqual([4, 0]);
  });

  it('puts a log in its hands down at dusk, and a settler without a job carries it to a stockpile the next morning', () => {
    const sim = createSim(openMap(), { villagers: 2, monsters: 0 });
    const shed = finished(sim, Building.Woodshed, 36, 32);
    const woodcutter = woodcutterAt(sim, shed);
    logPile(sim, 60, 32, 0);
    runToBeforeDusk(sim, 22 * TICKS_PER_SECOND);
    expect(putDown(sim, at(sim.map, 60, 32), Good.Log, 1)).toBe(true);
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    expect(sim.villagers.carried[woodcutter]).toBe(Good.Log);
    step(sim);
    const where = tileAt(sim.map, sim.villagers.x[woodcutter]!, sim.villagers.y[woodcutter]!);
    expect([sim.villagers.carried[woodcutter], sim.map.stackGood[where], sim.map.stackSize[where]]).toEqual([Good.None, Good.Log, 1]);
    const stocked = sim.tally.stocked;
    runUntil(sim, () => sim.tally.stocked > stocked, TICKS_PER_DAY);
    expect(sim.map.stackSize[where]).toBe(0);
    expect(sim.villagers.workplace[1 - woodcutter]).toBe(-1);
  });

  it('keeps the work on a log half split at dusk and finishes it the next morning, in 10 seconds of work in all', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    const shed = finished(sim, Building.Woodshed, 36, 32);
    const woodcutter = woodcutterAt(sim, shed);
    logPile(sim, 38, 33, 0);
    runToBeforeDusk(sim, 9 * TICKS_PER_SECOND);
    expect(putDown(sim, at(sim.map, 38, 33), Good.Log, 1)).toBe(true);
    let work = 0;
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, () => {
      if (splitting(sim, woodcutter)) work++;
    });
    expect(work).toBeGreaterThan(0);
    expect(work).toBeLessThan(SPLIT_TICKS);
    runUntil(sim, () => !isNight(sim.tick), TICKS_PER_DAY);
    expect([firewood(sim, shed), logsOnGround(sim)]).toEqual([0, 0]);
    runUntil(sim, () => firewood(sim, shed) > 0, TICKS_PER_DAY / 2, () => {
      if (splitting(sim, woodcutter)) work++;
    });
    expect([firewood(sim, shed), work]).toEqual([2, SPLIT_TICKS]);
  });
});
