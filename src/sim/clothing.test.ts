import { describe, expect, it } from 'vitest';
import { ANIMALS, AnimalKind, AnimalState, addAnimal } from './animals';
import { finishBuilding } from './building';
import { BUILDINGS, Building, Job } from './buildings';
import { TICKS_PER_DAY, TICKS_PER_SECOND } from './calendar';
import { Claim } from './claims';
import { isNight } from './daylight';
import { GOODS, Good, GoodKind, putDown } from './goods';
import { FETCHING_KILL, shotHits } from './hunting';
import { jobOf } from './jobs';
import { tileAt } from './map';
import { type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_STORE, TAILOR_CLOTHING_LIMIT } from './stores';
import { TASK_KINDS } from './tasks';
import { at, mapFrom } from './testMaps';
import { VillagerState } from './villagerState';
import { Stop, WORKSHOP } from './workshops';

const WORK = TASK_KINDS.indexOf(WORKSHOP) + 1;
const FETCH = TASK_KINDS.indexOf(FETCHING_KILL) + 1;
const SEW_TICKS = 60 * TICKS_PER_SECOND;

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

/** A stockpile on the one tile (x, y) holding `hides` hides. */
function hidePile(sim: Sim, x: number, y: number, hides: number): void {
  expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: x, y0: y, x1: x, y1: y } })).toMatchObject({ ok: true });
  if (hides > 0) expect(putDown(sim, at(sim.map, x, y), Good.Hide, hides)).toBe(true);
}

const hidesOn = (sim: Sim, x: number, y: number) => (sim.map.stackGood[at(sim.map, x, y)] === Good.Hide ? sim.map.stackSize[at(sim.map, x, y)]! : 0);
const clothing = (sim: Sim, slot: number) => sim.stores.held[Good.Clothing - 1]![slot]!;
const tailorAt = (sim: Sim, slot: number) => sim.villagers.workplace.indexOf(slot);
/** Whether the villager stands at its workshop's door at work on a batch, with empty hands and no unit to fetch: "Making clothing". */
const sewing = (sim: Sim, id: number) =>
  sim.villagers.task[id] === WORK &&
  sim.villagers.state[id] === VillagerState.Working &&
  sim.villagers.carried[id] === Good.None &&
  sim.villagers.taskTile[id] === -1;

function onGround(sim: Sim, good: Good): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === good) units += sim.map.stackSize[tile]!;
  return units;
}

/** Runs the simulation until it is `ticks` before the next dusk. */
function runToBeforeDusk(sim: Sim, ticks: number): void {
  runUntil(sim, () => !isNight(sim.tick) && isNight(sim.tick + ticks), TICKS_PER_DAY);
}

/** A deer at (x, y) that grazes where it stands until something frightens it. */
function deerAt(sim: Sim, x: number, y: number): number {
  const deer = addAnimal(sim.animals, AnimalKind.Deer, x, y);
  sim.animals.until[deer] = 1_000_000;
  return deer;
}

/** Makes the next shot hit. */
function nextShotHits(sim: Sim): void {
  while (!shotHits(sim.seed, sim.animals.shots)) sim.animals.shots++;
}

describe('a hide', () => {
  it('is a stockpiled good that keeps on the ground, and clothing a stored good', () => {
    expect(GOODS[Good.Hide]).toEqual({ kind: GoodKind.Stockpiled, keepsDawns: 0 });
    expect(GOODS[Good.Clothing]).toEqual({ kind: GoodKind.Stored, keepsDawns: 0 });
  });

  it('lands on the tile east of the kill, the first beside it that a walk reaches, and the 6 food stay on the kill tile', () => {
    const sim = createSim(openMap(38), { villagers: 1, monsters: 0 });
    finished(sim, Building.Lodge, 4, 4);
    const deer = deerAt(sim, 30.5, 30.5);
    nextShotHits(sim);
    runUntil(sim, () => sim.animals.state[deer] === AnimalState.Gone, 600);
    expect([sim.map.stackGood[at(sim.map, 30, 30)], sim.map.stackSize[at(sim.map, 30, 30)]]).toEqual([Good.Food, ANIMALS[AnimalKind.Deer].food]);
    expect([sim.map.stackGood[at(sim.map, 31, 30)], sim.map.stackSize[at(sim.map, 31, 30)]]).toEqual([Good.Hide, 1]);
    expect([onGround(sim, Good.Food), onGround(sim, Good.Hide), sim.tally.kills, sim.tally.hunted, sim.tally.hides]).toEqual([6, 1, 1, 6, 1]);
  });

  it('lands on the next tile with room when the kill tile is east of a full stack, and the food still lands as it did', () => {
    const sim = createSim(openMap(38), { villagers: 1, monsters: 0 });
    finished(sim, Building.Lodge, 4, 4);
    expect(putDown(sim, at(sim.map, 31, 30), Good.Food, 8)).toBe(true);
    const deer = deerAt(sim, 30.5, 30.5);
    nextShotHits(sim);
    runUntil(sim, () => sim.animals.state[deer] === AnimalState.Gone, 600);
    expect(sim.map.stackSize[at(sim.map, 30, 30)]).toBe(6);
    expect([sim.map.stackGood[at(sim.map, 29, 30)], sim.map.stackSize[at(sim.map, 29, 30)]]).toEqual([Good.Hide, 1]);
  });

  it('leaves the hunter carrying only its kill food, and with no stockpile nobody takes the hide', () => {
    const sim = createSim(openMap(38), { villagers: 1, monsters: 0 });
    finished(sim, Building.Lodge, 4, 4);
    const deer = deerAt(sim, 30.5, 30.5);
    nextShotHits(sim);
    runUntil(sim, () => sim.animals.state[deer] === AnimalState.Gone, 600);
    const carried = new Set<number>();
    runUntil(sim, () => sim.hunting.kill[0] === -1, 2 * TICKS_PER_DAY, () => {
      if (sim.villagers.task[0] === FETCH) carried.add(sim.villagers.carried[0]!);
    });
    expect([...carried].sort()).toEqual([Good.None, Good.Food]);
    expect([sim.tally.huntedIn > 0, sim.map.stackGood[at(sim.map, 31, 30)], sim.map.stackSize[at(sim.map, 31, 30)]]).toEqual([true, Good.Hide, 1]);
  });

  it('is carried by a settler without a job to a stockpile, and never into the camp, a barn, or a house', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    const barn = finished(sim, Building.Barn, 36, 26);
    const house = finished(sim, Building.House, 26, 36);
    expect(putDown(sim, at(sim.map, 40, 40), Good.Hide, 1)).toBe(true);
    runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 4, TICKS_PER_DAY);
    expect(hidesOn(sim, 40, 40)).toBe(1);
    hidePile(sim, 44, 44, 0);
    runUntil(sim, () => hidesOn(sim, 44, 44) === 1, TICKS_PER_DAY / 2);
    expect([hidesOn(sim, 40, 40), sim.tally.stocked, sim.goods.stockedUnits[Good.Hide - 1]]).toEqual([0, 1, 1]);
    for (const store of [CAMP_STORE, barn, house]) expect(sim.stores.held[Good.Hide - 1]![store]).toBe(0);
  });
});

describe("a tailor's hut", () => {
  it('is a workplace with one place, 8 logs and 30 seconds to build, and a store of 8 pieces of clothing made 1 from 2 hides in 60 seconds', () => {
    const { side, needs, workTicks, places, job, reach, recipe } = BUILDINGS[Building.Tailor];
    expect({ side, needs, workTicks, places, job, reach, recipe }).toEqual({
      side: 2,
      needs: { [Good.Log]: 8 },
      workTicks: 30 * TICKS_PER_SECOND,
      places: 1,
      job: Job.Tailor,
      reach: 30,
      recipe: { input: Good.Hide, inputs: 2, output: Good.Clothing, outputs: 1, workTicks: SEW_TICKS },
    });
    expect(TAILOR_CLOTHING_LIMIT).toBe(8);
  });

  it('hires a villager without a job as its tailor once it is finished', () => {
    const sim = createSim(openMap(), { villagers: 2, monsters: 0 });
    const hut = finished(sim, Building.Tailor, 36, 32);
    const tailor = tailorAt(sim, hut);
    expect(tailor).toBeGreaterThanOrEqual(0);
    expect([jobOf(sim, tailor), jobOf(sim, 1 - tailor)]).toEqual([Job.Tailor, Job.None]);
  });

  it('carries 2 hides from the nearest stockpile in reach, one at a time, works them 60 seconds, and 1 piece of clothing lands in the hut', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    hidePile(sim, 44, 32, 3);
    hidePile(sim, 40, 36, 3);
    const hut = finished(sim, Building.Tailor, 36, 32);
    const tailor = tailorAt(sim, hut);
    let work = 0;
    let pickups = 0;
    let held = Good.None as number;
    const inputs: number[] = [];
    runUntil(sim, () => clothing(sim, hut) > 0, TICKS_PER_DAY / 2, () => {
      if (sewing(sim, tailor)) work++;
      if (held === Good.None && sim.villagers.carried[tailor] === Good.Hide) pickups++;
      held = sim.villagers.carried[tailor]!;
      if (inputs.at(-1) !== sim.workshops.input[hut]) inputs.push(sim.workshops.input[hut]!);
    });
    expect([clothing(sim, hut), hidesOn(sim, 40, 36), hidesOn(sim, 44, 32)]).toEqual([1, 1, 3]);
    expect([pickups, work, inputs]).toEqual([2, SEW_TICKS, [0, 1, 2, 0]]);
    expect([sim.tally.batches, sim.tally.made]).toEqual([1, 1]);
  });

  it('works at half the rate while its tailor is hungry, and walks at full speed', () => {
    const run = (hungry: boolean) => {
      const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
      hidePile(sim, 40, 36, 2);
      const hut = finished(sim, Building.Tailor, 36, 32);
      const tailor = tailorAt(sim, hut);
      if (hungry) sim.villagers.missedMeals[tailor] = 1;
      let work = 0;
      let walk = 0;
      runUntil(sim, () => clothing(sim, hut) > 0, TICKS_PER_DAY / 2, () => {
        if (sewing(sim, tailor)) work++;
        if (sim.villagers.state[tailor] === VillagerState.Walking) walk++;
      });
      return { work, walk };
    };
    const fed = run(false);
    const hungry = run(true);
    expect([fed.work, hungry.work]).toEqual([SEW_TICKS, 2 * SEW_TICKS]);
    expect(Math.abs(hungry.walk - fed.walk)).toBeLessThanOrEqual(2);
  });

  it('never takes a hide that lies off a stockpile, and says it has none in reach', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    expect(putDown(sim, at(sim.map, 40, 36), Good.Hide, 2)).toBe(true);
    const hut = finished(sim, Building.Tailor, 36, 32);
    runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 3, TICKS_PER_DAY);
    expect([clothing(sim, hut), hidesOn(sim, 40, 36), sim.workshops.stopped[hut]]).toEqual([0, 2, Stop.NoInput]);
  });

  it('takes hides from a stockpile 30 tiles from its middle, and none from one beyond', () => {
    const run = (x: number) => {
      const sim = createSim(openMap(80), { villagers: 1, monsters: 0 });
      const hut = finished(sim, Building.Tailor, 10, 60);
      hidePile(sim, x, 60, 2);
      runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 2, TICKS_PER_DAY);
      return { clothing: clothing(sim, hut), stopped: sim.workshops.stopped[hut], hides: hidesOn(sim, x, 60) };
    };
    expect(run(40)).toEqual({ clothing: 1, stopped: Stop.NoInput, hides: 0 });
    expect(run(42)).toEqual({ clothing: 0, stopped: Stop.NoInput, hides: 2 });
  });

  it('takes no hide a building site could want, so it never says the sites need them', () => {
    const sim = createSim(openMap(), { villagers: 2, monsters: 0 });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 26, y: 26 })).toMatchObject({ ok: true });
    hidePile(sim, 40, 36, 2);
    const hut = finished(sim, Building.Tailor, 36, 32);
    const stops = new Set<number>();
    runUntil(sim, () => clothing(sim, hut) === 1, TICKS_PER_DAY / 2, () => stops.add(sim.workshops.stopped[hut]!));
    expect(stops.has(Stop.ForSites)).toBe(false);
  });

  it('stops once the hut holds 8 pieces of clothing, and says it is full', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    hidePile(sim, 40, 36, 6);
    const hut = finished(sim, Building.Tailor, 36, 32);
    sim.stores.held[Good.Clothing - 1]![hut] = TAILOR_CLOTHING_LIMIT - 1;
    runUntil(sim, () => sim.workshops.stopped[hut] === Stop.Full, TICKS_PER_DAY / 2);
    runUntil(sim, () => sim.tick >= TICKS_PER_DAY / 2, TICKS_PER_DAY);
    expect([clothing(sim, hut), hidesOn(sim, 40, 36), sim.workshops.input[hut], sim.workshops.stopped[hut]]).toEqual([TAILOR_CLOTHING_LIMIT, 4, 0, Stop.Full]);
  });

  it('says it has no hide in reach once the stockpiles in reach are empty, with 1 hide kept in the hut toward the next piece', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    hidePile(sim, 40, 36, 3);
    const hut = finished(sim, Building.Tailor, 36, 32);
    runUntil(sim, () => sim.workshops.stopped[hut] === Stop.NoInput, TICKS_PER_DAY / 2);
    expect([clothing(sim, hut), hidesOn(sim, 40, 36), sim.workshops.input[hut]]).toEqual([1, 0, 1]);
  });

  it('puts a hide in its hands down at dusk, and a settler without a job carries it to a stockpile the next morning', () => {
    const sim = createSim(openMap(), { villagers: 2, monsters: 0 });
    const hut = finished(sim, Building.Tailor, 36, 32);
    const tailor = tailorAt(sim, hut);
    hidePile(sim, 60, 32, 0);
    runToBeforeDusk(sim, 22 * TICKS_PER_SECOND);
    expect(putDown(sim, at(sim.map, 60, 32), Good.Hide, 1)).toBe(true);
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    expect(sim.villagers.carried[tailor]).toBe(Good.Hide);
    step(sim);
    const where = tileAt(sim.map, sim.villagers.x[tailor]!, sim.villagers.y[tailor]!);
    expect([sim.villagers.carried[tailor], sim.map.stackGood[where], sim.map.stackSize[where]]).toEqual([Good.None, Good.Hide, 1]);
    expect(sim.orders.claims[where]).toBe(Claim.None);
    const stocked = sim.tally.stocked;
    runUntil(sim, () => sim.tally.stocked > stocked, TICKS_PER_DAY);
    expect(sim.map.stackSize[where]).toBe(0);
  });

  it('keeps 1 of 2 hides in the hut over the night, and fetches the second the next morning', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    const hut = finished(sim, Building.Tailor, 36, 32);
    hidePile(sim, 38, 35, 0);
    runToBeforeDusk(sim, 20 * TICKS_PER_SECOND);
    expect(putDown(sim, at(sim.map, 38, 35), Good.Hide, 1)).toBe(true);
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    expect([sim.workshops.input[hut], onGround(sim, Good.Hide)]).toEqual([1, 0]);
    runUntil(sim, () => !isNight(sim.tick), TICKS_PER_DAY);
    expect(sim.workshops.input[hut]).toBe(1);
    expect(putDown(sim, at(sim.map, 38, 35), Good.Hide, 1)).toBe(true);
    runUntil(sim, () => clothing(sim, hut) === 1, TICKS_PER_DAY / 2);
    expect(sim.workshops.input[hut]).toBe(0);
  });

  it('keeps the work on a batch half made at dusk and finishes it the next morning, in 60 seconds of work in all', () => {
    const sim = createSim(openMap(), { villagers: 1, monsters: 0 });
    const hut = finished(sim, Building.Tailor, 36, 32);
    const tailor = tailorAt(sim, hut);
    hidePile(sim, 38, 35, 0);
    runToBeforeDusk(sim, 40 * TICKS_PER_SECOND);
    expect(putDown(sim, at(sim.map, 38, 35), Good.Hide, 2)).toBe(true);
    let work = 0;
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, () => {
      if (sewing(sim, tailor)) work++;
    });
    expect(work).toBeGreaterThan(0);
    expect(work).toBeLessThan(SEW_TICKS);
    const progress = sim.workshops.progress[hut]!;
    expect(progress).toBeGreaterThan(0);
    runUntil(sim, () => !isNight(sim.tick), TICKS_PER_DAY);
    expect([clothing(sim, hut), sim.workshops.input[hut], sim.workshops.progress[hut]]).toEqual([0, 2, progress]);
    runUntil(sim, () => clothing(sim, hut) > 0, TICKS_PER_DAY / 2, () => {
      if (sewing(sim, tailor)) work++;
    });
    expect([clothing(sim, hut), work]).toEqual([1, SEW_TICKS]);
  });
});
