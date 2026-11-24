import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building, Job } from './buildings';
import { CARRYING } from './carrying';
import { isNight } from './daylight';
import { Good } from './goods';
import { jobOf } from './jobs';
import { type Sim, applyCommand, createSim, step } from './sim';
import { STOCKING } from './stocking';
import { SUPPLYING } from './supplying';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { die } from './villagers';
import { Cause, NO_TASK, VillagerState } from './villagerState';

const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;
const SUPPLY = TASK_KINDS.indexOf(SUPPLYING) + 1;
const CARRY = TASK_KINDS.indexOf(CARRYING) + 1;

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

/** A hut anchored on (x, y), finished at once. Returns its slot. */
function finishedHut(sim: Sim, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

function standAt(sim: Sim, id: number, x: number, y: number): void {
  sim.villagers.x[id] = sim.villagers.targetX[id] = x;
  sim.villagers.y[id] = sim.villagers.targetY[id] = y;
}

const workplaces = (sim: Sim) => Array.from(sim.villagers.workplace.subarray(0, sim.villagers.count));
const setPlaces = (sim: Sim, slot: number, places: number) => applyCommand(sim, { kind: 'setPlaces', slot, places });

/**
 * Five settlers around the middle of a hut anchored on (10, 10), whose middle
 * is (11, 11): settler 2 at 3 tiles, settler 1 at 4, settlers 3 and 4 at 5,
 * and settler 0 far off.
 */
function aroundAHut(): { sim: Sim; slot: number } {
  const sim = createSim(mapFrom(open(40)), { villagers: 5, monsters: 0 });
  standAt(sim, 0, 35.5, 35.5);
  standAt(sim, 1, 11, 15);
  standAt(sim, 2, 14, 11);
  standAt(sim, 3, 11, 6);
  standAt(sim, 4, 6, 11);
  return { sim, slot: finishedHut(sim, 10, 10) };
}

describe('the places of a finished hut', () => {
  it('are both asked for and filled by the two settlers without a job nearest the hut', () => {
    const { sim, slot } = aroundAHut();
    expect(sim.orders.sites.places[slot]).toBe(2);
    expect(workplaces(sim)).toEqual([-1, slot, slot, -1, -1]);
    expect([0, 1, 2, 3, 4].map((id) => jobOf(sim, id))).toEqual([Job.None, Job.Forager, Job.Forager, Job.None, Job.None]);
  });

  it('go to a second hut from those still without a job, and never to a settler that holds one', () => {
    const { sim, slot } = aroundAHut();
    const second = finishedHut(sim, 12, 13);
    expect(workplaces(sim)).toEqual([-1, slot, slot, second, second]);
  });

  it('are emptied from the one that came last, though it stands nearest, and filled again by the nearest rule', () => {
    const { sim, slot } = aroundAHut();
    setPlaces(sim, slot, 1);
    expect(workplaces(sim)).toEqual([-1, -1, slot, -1, -1]);
    standAt(sim, 1, 11, 12);
    setPlaces(sim, slot, 2);
    expect(workplaces(sim)).toEqual([-1, slot, slot, -1, -1]);
    setPlaces(sim, slot, 1);
    expect(workplaces(sim)).toEqual([-1, -1, slot, -1, -1]);
    setPlaces(sim, slot, 0);
    expect(workplaces(sim)).toEqual([-1, -1, -1, -1, -1]);
    expect(sim.orders.sites.places[slot]).toBe(0);
    standAt(sim, 3, 11, 9);
    setPlaces(sim, slot, 2);
    expect(workplaces(sim)).toEqual([-1, slot, -1, slot, -1]);
  });

  it('clamp to none and to all, and refuse a site, a house, or a slot that holds nothing', () => {
    const { sim, slot } = aroundAHut();
    setPlaces(sim, slot, 7);
    expect([sim.orders.sites.places[slot], workplaces(sim)]).toEqual([2, [-1, slot, slot, -1, -1]]);
    setPlaces(sim, slot, -3);
    expect([sim.orders.sites.places[slot], workplaces(sim)]).toEqual([0, [-1, -1, -1, -1, -1]]);
    expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x: 30, y: 4 })).toMatchObject({ ok: true });
    const site = sim.orders.siteOf[at(sim.map, 30, 4)]!;
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 30, y: 30 })).toMatchObject({ ok: true });
    const house = sim.orders.siteOf[at(sim.map, 30, 30)]!;
    finishBuilding(sim, house);
    for (const refused of [site, house, 40, -1]) setPlaces(sim, refused, 2);
    expect([sim.orders.sites.places[site], sim.orders.sites.places[house], workplaces(sim)]).toEqual([0, 0, [-1, -1, -1, -1, -1]]);
  });

  it('open again when a worker dies, and go to the nearest settler without a job, the lower id between two as near', () => {
    const { sim, slot } = aroundAHut();
    die(sim, 2, Cause.Hunger);
    expect(workplaces(sim)).toEqual([-1, slot, -1, slot, -1]);
    die(sim, 3, Cause.Hunger);
    expect(workplaces(sim)).toEqual([-1, slot, -1, -1, slot]);
    die(sim, 0, Cause.Hunger);
    expect(workplaces(sim)).toEqual([-1, slot, -1, -1, slot]);
  });
});

describe('a settler that takes a place', () => {
  it('gives up a task its job does not allow on its next tick, as a cancelled one, and puts down what it carries', () => {
    const map = mapFrom(open(32));
    map.stackGood[at(map, 4, 20)] = Good.Log;
    map.stackSize[at(map, 4, 20)] = 1;
    const sim = createSim(map, { villagers: 1, monsters: 0 });
    applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 28, y0: 28, x1: 28, y1: 28 } });
    for (let tick = 0; tick < 400 && sim.villagers.carried[0] === Good.None; tick++) step(sim);
    expect([sim.villagers.task[0], sim.villagers.carried[0]]).toEqual([CARRY, Good.Log]);
    const slot = finishedHut(sim, 4, 4);
    expect(sim.villagers.workplace[0]).toBe(slot);
    step(sim);
    const tile = at(sim.map, Math.floor(sim.villagers.x[0]!), Math.floor(sim.villagers.y[0]!));
    expect([sim.villagers.task[0], sim.villagers.carried[0], sim.villagers.state[0]]).toEqual([NO_TASK, Good.None, VillagerState.Waiting]);
    expect([sim.map.stackGood[tile], sim.map.stackSize[tile]]).toEqual([Good.Log, 1]);
  });

  it('takes no order to the land through a whole day of it, while a settler without a job does', () => {
    const rows = open(32);
    rows[20] = '.'.repeat(20) + 'TT' + '.'.repeat(10);
    const map = mapFrom(rows);
    for (const [x, y, good, size] of [[6, 26, Good.Log, 8], [7, 26, Good.Stone, 6], [26, 6, Good.Log, 3]] as const) {
      map.stackGood[at(map, x, y)] = good;
      map.stackSize[at(map, x, y)] = size;
    }
    const sim = createSim(map, { villagers: 3, monsters: 0 });
    standAt(sim, 2, 30.5, 30.5);
    const slot = finishedHut(sim, 4, 4);
    expect(workplaces(sim)).toEqual([slot, slot, -1]);
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: { x0: 20, y0: 20, x1: 21, y1: 20 } });
    applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 26, y0: 10, x1: 26, y1: 10 } });
    applyCommand(sim, { kind: 'place', building: Building.House, x: 9, y: 22 });
    const foragers = new Set<number>();
    const jobless = new Set<number>();
    while (!isNight(sim.tick)) {
      step(sim);
      for (const id of [0, 1]) foragers.add(sim.villagers.task[id]!);
      jobless.add(sim.villagers.task[2]!);
    }
    expect([...foragers]).toEqual([NO_TASK]);
    expect(jobless.has(SUPPLY)).toBe(true);
    expect(sim.tally.delivered).toBeGreaterThan(0);
  });

  it('still stocks its home', () => {
    const sim = createSim(mapFrom(open(40)), { villagers: 2, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 4, y: 30 })).toMatchObject({ ok: true });
    finishBuilding(sim, sim.orders.siteOf[at(sim.map, 4, 30)]!);
    finishedHut(sim, 30, 4);
    expect(workplaces(sim).every((workplace) => workplace >= 0)).toBe(true);
    let stocked = false;
    for (let tick = 0; tick < 200 && !stocked; tick++) {
      step(sim);
      stocked = sim.villagers.task[0] === STOCK && sim.villagers.task[1] === STOCK;
    }
    expect(stocked).toBe(true);
  });
});
