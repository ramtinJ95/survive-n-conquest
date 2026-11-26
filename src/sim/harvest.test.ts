import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { Building } from './buildings';
import { TICKS_PER_DAY, dateAt } from './calendar';
import { isDawn, isNight } from './daylight';
import { CUT_WORK_TICKS, FOOD_PER_TILE, FieldState, fieldState } from './fields';
import { Good, putDown } from './goods';
import { CUTTING, FETCHING_CROP } from './harvest';
import { TileKind } from './map';
import { type TileArea } from './orders';
import { type Population, type Sim, applyCommand, createSim, step } from './sim';
import { CAMP_FOOD_LIMIT, CAMP_STORE } from './stores';
import { TASK_KINDS } from './tasks';
import { TILE_CHANGE_STRIDE, takeTileChanges } from './tileChanges';
import { at, mapFrom } from './testMaps';
import { NO_TASK, VillagerState } from './villagerState';

const CUT = TASK_KINDS.indexOf(CUTTING) + 1;
const FETCH = TASK_KINDS.indexOf(FETCHING_CROP) + 1;
const FOOD = Good.Food - 1;
const square = (x0: number, y0: number, x1 = x0, y1 = y0): TileArea => ({ x0, y0, x1, y1 });
const field = (sim: Sim, area: TileArea) => applyCommand(sim, { kind: 'markArea', order: 'field', area });

/** Open grass, `size` tiles a side. */
const grass = (size: number) => mapFrom(Array.from({ length: size }, () => '.'.repeat(size)));

function runUntil(sim: Sim, done: () => boolean, limit: number, each: () => void = () => {}): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
    each();
  }
}

/** A building anchored on (x, y), finished at once. A farm takes the nearest settlers without a job as its farmers. Returns its slot. */
function finished(sim: Sim, building: Building, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

/** Runs to the first tick of `day`'s dawn. */
function toDawnOf(sim: Sim, day: number, each?: () => void): void {
  runUntil(sim, () => dateAt(sim.tick).day === day && isDawn(sim.tick), (day + 1) * TICKS_PER_DAY, each);
}

/** Runs to the dusk of the day the clock is in. */
const toDusk = (sim: Sim, each?: () => void) => runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, each);

/** A field in the reach of a farm, all sown in the first spring, with the clock at the dawn at which the tiles are ripe, day 6. */
function ripeField(population: Population, farm: readonly [number, number], area: TileArea, size = 30): Sim {
  const sim = createSim(grass(size), { animals: false, ...population });
  finished(sim, Building.Farm, farm[0], farm[1]);
  field(sim, area);
  const tiles = (area.x1 - area.x0 + 1) * (area.y1 - area.y0 + 1);
  runUntil(sim, () => sim.tally.sown === tiles, TICKS_PER_DAY);
  expect(dateAt(sim.tick).day).toBe(1);
  toDawnOf(sim, 6);
  return sim;
}

function lyingOnTiles(sim: Sim, tiles: readonly number[]): number {
  return tiles.reduce((sum, tile) => sum + (sim.map.stackGood[tile] === Good.Food ? sim.map.stackSize[tile]! : 0), 0);
}

describe('a farmer at the harvest', () => {
  it('cuts a ripe tile in 200 ticks of work at it, which puts 4 food on the tile, reads cut, and reports the cut as a tile change', () => {
    const sim = ripeField({ villagers: 1, monsters: 0 }, [16, 16], square(19, 16));
    const tile = at(sim.map, 19, 16);
    const sownAt = sim.fields.sownAt[tile]!;
    expect(fieldState(sim.fields, tile, sim.tick)).toBe(FieldState.Ripe);
    takeTileChanges(sim);
    let firstWork = -1;
    const changes: number[][] = [];
    runUntil(sim, () => fieldState(sim.fields, tile, sim.tick) === FieldState.Cut, TICKS_PER_DAY, () => {
      if (firstWork < 0 && sim.villagers.task[0] === CUT && sim.villagers.state[0] === VillagerState.Working) firstWork = sim.tick - 1;
      const groups = takeTileChanges(sim);
      for (let i = 0; i < groups.length; i += TILE_CHANGE_STRIDE) if (groups[i] === tile) changes.push(Array.from(groups.subarray(i, i + TILE_CHANGE_STRIDE)));
    });
    const lastWork = firstWork + CUT_WORK_TICKS - 1;
    expect(CUT_WORK_TICKS).toBe(200);
    expect(sim.tick - 1).toBe(lastWork);
    expect(sim.fields.cutAt[tile]).toBe(lastWork);
    expect([sim.map.stackGood[tile], sim.map.stackSize[tile]]).toEqual([Good.Food, 4]);
    expect(changes).toEqual([[tile, TileKind.Grass, 0, Good.Food, 4, sownAt, lastWork]]);
    expect(sim.tally).toMatchObject({ cut: 1, reaped: 4 });
    expect(FOOD_PER_TILE).toBe(4);
  });

  it('carries in all the food it cut, 1 unit a walk, to the nearest store with room, before it cuts another tile', () => {
    const sim = ripeField({ villagers: 1, monsters: 0 }, [26, 26], square(30, 30, 31, 30), 40);
    const barn = finished(sim, Building.Barn, 33, 27);
    const tiles = [at(sim.map, 30, 30), at(sim.map, 31, 30)];
    let events = '';
    let { cut, reapedIn } = sim.tally;
    toDusk(sim, () => {
      events += 'C'.repeat(sim.tally.cut - cut) + 'I'.repeat(sim.tally.reapedIn - reapedIn);
      ({ cut, reapedIn } = sim.tally);
    });
    expect(events).toBe('CIIIICIIII');
    expect(sim.stores.held[FOOD]![barn]).toBe(8);
    expect(lyingOnTiles(sim, tiles)).toBe(0);
  });

  it('cuts a ripe tile once when two farmers could, as only one takes it', () => {
    const sim = ripeField({ villagers: 2, monsters: 0 }, [16, 16], square(19, 16));
    expect([sim.villagers.workplace[0], sim.villagers.workplace[1]]).toEqual([0, 0]);
    const cutters = new Set<number>();
    toDusk(sim, () => {
      for (let id = 0; id < 2; id++) if (sim.villagers.task[id] === CUT) cutters.add(id);
    });
    expect(cutters.size).toBe(1);
    expect(sim.tally).toMatchObject({ cut: 1, reaped: 4, reapedIn: 4 });
  });

  it('cuts the nearest ripe tile first, one after another, and none beyond its farm’s reach', () => {
    const sim = createSim(grass(60), { villagers: 2, monsters: 0, animals: false });
    // The west farm's middle is (21, 31). A tile at x = 41 has its center 20.5 tiles away, one at x = 40 19.5, and the tile at
    // (36, 46) lies in the square of the reach and 21.9 tiles away. The east farm sows both.
    const west = finished(sim, Building.Farm, 20, 30);
    applyCommand(sim, { kind: 'setPlaces', slot: west, places: 1 });
    const east = finished(sim, Building.Farm, 44, 30);
    applyCommand(sim, { kind: 'setPlaces', slot: east, places: 1 });
    field(sim, square(36, 31, 41, 31));
    field(sim, square(36, 46));
    const beyond = at(sim.map, 41, 31);
    const corner = at(sim.map, 36, 46);
    runUntil(sim, () => sim.fields.sownAt[beyond] !== -1 && sim.fields.sownAt[corner] !== -1, TICKS_PER_DAY);
    applyCommand(sim, { kind: 'setPlaces', slot: east, places: 0 });
    const farmer = sim.villagers.workplace[0] === west ? 0 : 1;
    runUntil(sim, () => sim.tally.sown === 7, TICKS_PER_DAY);
    toDawnOf(sim, 6);
    expect([fieldState(sim.fields, beyond, sim.tick), fieldState(sim.fields, corner, sim.tick)]).toEqual([FieldState.Ripe, FieldState.Ripe]);
    const taken: number[] = [];
    let held: number = NO_TASK;
    runUntil(sim, () => dateAt(sim.tick).day === 9, 4 * TICKS_PER_DAY, () => {
      const task = sim.villagers.task[farmer]!;
      // Dusk ends a cut that is half done, and the farmer takes the same tile again the next morning.
      if (task === CUT && held !== CUT && !taken.includes(sim.villagers.taskTile[farmer]!)) taken.push(sim.villagers.taskTile[farmer]!);
      held = task;
    });
    expect(taken).toEqual([36, 37, 38, 39, 40].map((x) => at(sim.map, x, 31)));
    expect([fieldState(sim.fields, beyond, sim.tick), fieldState(sim.fields, corner, sim.tick)]).toEqual([FieldState.Ripe, FieldState.Ripe]);
    expect(sim.tally.cut).toBe(5);
  });

  it('cuts nothing while no barn and no camp has room for food, and cuts once a barn stands', () => {
    const sim = ripeField({ villagers: 1, monsters: 0 }, [16, 16], square(19, 16));
    const tile = at(sim.map, 19, 16);
    const camp = sim.stores.held[FOOD]!;
    const full = () => {
      camp[CAMP_STORE] = CAMP_FOOD_LIMIT;
    };
    full();
    const tasks = new Set<number>();
    runUntil(sim, () => dateAt(sim.tick).minuteOfDay >= 12 * 60, TICKS_PER_DAY, () => {
      full();
      tasks.add(sim.villagers.task[0]!);
    });
    expect([...tasks]).toEqual([NO_TASK]);
    expect(fieldState(sim.fields, tile, sim.tick)).toBe(FieldState.Ripe);
    expect(sim.tally.cut).toBe(0);

    const barn = finished(sim, Building.Barn, 22, 14);
    toDusk(sim, full);
    expect(fieldState(sim.fields, tile, sim.tick)).toBe(FieldState.Cut);
    expect(sim.stores.held[FOOD]![barn]).toBe(4);
  });

  it('is idle in summer before the dawn at which its tiles are ripe, and carries no food that lies off the fields', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0, animals: false });
    finished(sim, Building.Farm, 16, 16);
    field(sim, square(19, 16, 20, 16));
    runUntil(sim, () => sim.tally.sown === 2, TICKS_PER_DAY);
    toDawnOf(sim, 4);
    const ground = at(sim.map, 10, 10);
    expect(putDown(sim, ground, Good.Food, 3)).toBe(true);
    const tasks = new Set<number>();
    runUntil(sim, () => dateAt(sim.tick).day === 6 && isDawn(sim.tick), 2 * TICKS_PER_DAY, () => {
      if (!isNight(sim.tick)) tasks.add(sim.villagers.task[0]!);
    });
    expect([...tasks]).toEqual([NO_TASK]);
    expect(sim.tally.fromGround).toBe(0);
    expect(sim.tally.cut).toBe(0);
  });
});

describe('the cut food', () => {
  it('is carried in by settlers without a job too, counted as carried from the fields', () => {
    const sim = ripeField({ villagers: 3, monsters: 0 }, [16, 16], square(19, 14, 21, 15));
    const farm = sim.orders.siteOf[at(sim.map, 16, 16)]!;
    applyCommand(sim, { kind: 'setPlaces', slot: farm, places: 1 });
    expect(sim.villagers.workplace.subarray(0, 3).filter((slot) => slot === farm).length).toBe(1);
    const tiles = [19, 20, 21].flatMap((x) => [at(sim.map, x, 14), at(sim.map, x, 15)]);
    toDusk(sim);
    toDawnOf(sim, 7);
    toDusk(sim);
    expect(sim.tally.cut).toBe(6);
    expect(sim.tally.fromFields).toBeGreaterThan(0);
    expect(sim.tally.reapedIn + sim.tally.fromFields).toBe(24);
    expect(sim.tally.fromGround).toBe(sim.tally.fromFields);
    expect(lyingOnTiles(sim, tiles)).toBe(0);
  });

  it('left on the ground is gone at the second dawn after the cut, counted as spoiled on the fields', () => {
    const sim = ripeField({ villagers: 1, monsters: 0 }, [16, 16], square(19, 16));
    const tile = at(sim.map, 19, 16);
    runUntil(sim, () => sim.tally.cut === 1, TICKS_PER_DAY);
    expect(dateAt(sim.tick).day).toBe(6);
    const full = () => {
      sim.stores.held[FOOD]![CAMP_STORE] = CAMP_FOOD_LIMIT;
    };
    full();
    toDawnOf(sim, 7, full);
    expect(sim.map.stackSize[tile]).toBe(4);
    expect(sim.tally.spoiledOnFields).toBe(0);
    runUntil(sim, () => dateAt(sim.tick).day === 8 && isDawn(sim.tick - 1), 2 * TICKS_PER_DAY, full);
    expect(sim.map.stackSize[tile]).toBe(0);
    expect(sim.tally).toMatchObject({ spoiled: 4, spoiledOnFields: 4, reapedIn: 0 });
  });
});
