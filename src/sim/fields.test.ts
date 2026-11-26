import { describe, expect, it } from 'vitest';
import { finishBuilding } from './building';
import { BUILDINGS, Building } from './buildings';
import { TICKS_PER_DAY, dateAt, seasonAt } from './calendar';
import { isNight } from './daylight';
import { FieldState, NOT_SOWN, SOWING, SOW_WORK_TICKS, fieldState } from './fields';
import { FIRST_YEAR_SEED, firstSpringCommands } from './firstYear';
import { Good, putDown } from './goods';
import { TileKind } from './map';
import { generateMap } from './mapgen';
import { Claim, type TileArea } from './orders';
import { SETTLERS, type Sim, applyCommand, createSim, step } from './sim';
import { TASK_KINDS } from './tasks';
import { TILE_CHANGE_STRIDE, takeTileChanges } from './tileChanges';
import { at, mapFrom } from './testMaps';
import { VillagerState } from './villagerState';

const SOW = TASK_KINDS.indexOf(SOWING) + 1;
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

/** A farm anchored on (x, y), finished at once, which takes the nearest settlers without a job as its farmers. Returns its slot. */
function finishedFarm(sim: Sim, x: number, y: number): number {
  expect(applyCommand(sim, { kind: 'place', building: Building.Farm, x, y })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, x, y)]!;
  finishBuilding(sim, slot);
  return slot;
}

/** Every tile a farmer took to sow, in the order taken, and the tick at which each tile counts as sown. */
function watchSowing(sim: Sim) {
  const taken: number[] = [];
  const sownAt = new Map<number, number>();
  const held = new Int32Array(sim.villagers.count);
  return {
    taken,
    sownAt,
    each: () => {
      for (let id = 0; id < sim.villagers.count; id++) {
        const task = sim.villagers.task[id]!;
        if (task === SOW && held[id] !== SOW) taken.push(sim.villagers.taskTile[id]!);
        held[id] = task;
      }
      for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) {
        if (!sownAt.has(tile) && fieldState(sim.fields, tile) === FieldState.Sown) sownAt.set(tile, sim.tick);
      }
    },
  };
}

describe('the field mark', () => {
  it('takes only grass with no claim, no goods, and not under the camp, and says so when nothing takes it', () => {
    const map = mapFrom([
      '..~#fT_.....',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
      '............',
    ]);
    const sim = createSim(map, { villagers: 0, monsters: 0 });
    putDown(sim, at(map, 7, 0), Good.Log, 1);
    applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: square(8, 0) });
    applyCommand(sim, { kind: 'place', building: Building.Hut, x: 9, y: 0 });
    expect(field(sim, square(0, 0, 11, 0))).toEqual({ ok: true, order: 'field', tiles: 3 });
    const claims = Array.from({ length: 12 }, (_, x) => sim.orders.claims[at(map, x, 0)]);
    expect(claims).toEqual([Claim.Field, Claim.Field, 0, 0, 0, 0, 0, 0, Claim.Stockpile, Claim.Site, Claim.Site, Claim.Field]);
    expect(field(sim, square(2, 0, 10, 0))).toEqual({ ok: false, order: 'field', refusal: 'no-grass' });

    const camp = sim.camp;
    const cx = camp % map.size;
    const cy = Math.floor(camp / map.size);
    expect(field(sim, square(cx, cy))).toEqual({ ok: false, order: 'field', refusal: 'no-grass' });
    expect(field(sim, square(cx - 3, cy, cx + 3, cy))).toMatchObject({ ok: true, tiles: 2 });
    expect(sim.orders.claims[at(map, cx - 2, cy)]).toBe(Claim.None);
    expect(sim.orders.claims[at(map, cx - 3, cy)]).toBe(Claim.Field);
  });

  it('keeps its tiles walkable, and refuses a building site and a stockpile on them', () => {
    const sim = createSim(grass(12), { villagers: 0, monsters: 0 });
    field(sim, square(1, 1, 4, 2));
    expect(sim.flow.next[at(sim.map, 2, 2)]).not.toBe(-1);
    expect(applyCommand(sim, { kind: 'place', building: Building.Farm, x: 4, y: 2 })).toEqual({ ok: false, order: 'farm', refusal: 'field' });
    expect(applyCommand(sim, { kind: 'place', building: Building.House, x: 2, y: 3 })).toEqual({ ok: false, order: 'house', refusal: 'field' });
    expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: square(1, 1, 4, 2) })).toEqual({ ok: false, order: 'stockpile', refusal: 'no-open-ground' });
    expect(applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: square(1, 1, 5, 2) })).toEqual({ ok: true, order: 'stockpile', tiles: 2 });
  });

  it('is removed by Cancel on a bare tile and on a sown one, and the sown tile loses its crop', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0 });
    finishedFarm(sim, 16, 16);
    field(sim, square(19, 16, 20, 16));
    const sown = at(sim.map, 19, 16);
    const bare = at(sim.map, 20, 16);
    runUntil(sim, () => fieldState(sim.fields, sown) === FieldState.Sown, TICKS_PER_DAY);
    takeTileChanges(sim);
    expect(fieldState(sim.fields, bare)).toBe(FieldState.Bare);

    expect(applyCommand(sim, { kind: 'markArea', order: 'cancel', area: square(19, 16, 20, 16) })).toEqual({ ok: true, order: 'cancel', tiles: 2 });
    expect(sim.orders.claims[sown]).toBe(Claim.None);
    expect(sim.orders.claims[bare]).toBe(Claim.None);
    expect(sim.fields.sownAt[sown]).toBe(NOT_SOWN);
    expect(sim.fields.progress[bare]).toBe(0);
    expect(sim.villagers.task[0]).not.toBe(SOW);
    const changes = takeTileChanges(sim);
    expect(Array.from(changes)).toEqual([sown, TileKind.Grass, 0, Good.None, 0, NOT_SOWN]);

    expect(field(sim, square(19, 16))).toMatchObject({ ok: true, tiles: 1 });
    expect(fieldState(sim.fields, sown)).toBe(FieldState.Bare);
  });
});

describe('a farmer', () => {
  it('sows a bare field tile in 150 ticks of work at it, and the tile counts as sown from the step of its last work tick', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0 });
    finishedFarm(sim, 16, 16);
    field(sim, square(19, 16));
    const tile = at(sim.map, 19, 16);
    let firstWork = -1;
    const changes: number[] = [];
    runUntil(sim, () => fieldState(sim.fields, tile) === FieldState.Sown, TICKS_PER_DAY, () => {
      if (firstWork < 0 && sim.villagers.state[0] === VillagerState.Working) firstWork = sim.tick - 1;
      const groups = takeTileChanges(sim);
      for (let i = 0; i < groups.length; i += TILE_CHANGE_STRIDE) if (groups[i] === tile) changes.push(groups[i + 5]!);
    });
    const lastWork = firstWork + SOW_WORK_TICKS - 1;
    expect(sim.tick - 1).toBe(lastWork);
    expect(sim.fields.sownAt[tile]).toBe(lastWork);
    expect(changes).toEqual([lastWork]);
    expect(sim.tally.sown).toBe(1);
    expect(SOW_WORK_TICKS).toBe(150);
  });

  it('sows the nearest bare tile first, one after another, and none beyond its farm’s reach', () => {
    const sim = createSim(grass(60), { villagers: 1, monsters: 0 });
    const slot = finishedFarm(sim, 20, 30);
    const { reach } = BUILDINGS[Building.Farm];
    // The farm's middle is (21, 31). A tile at x = 41 has its center 20.5 tiles away, one at x = 40 19.5.
    field(sim, square(36, 31, 41, 31));
    const beyond = at(sim.map, 41, 31);
    expect(reach).toBe(20);
    expect(sim.orders.sites.kind[slot]).toBe(Building.Farm);
    const watch = watchSowing(sim);
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, watch.each);
    expect(watch.taken).toEqual([36, 37, 38, 39, 40].map((x) => at(sim.map, x, 31)));
    expect(fieldState(sim.fields, beyond)).toBe(FieldState.Bare);
    expect(sim.fields.taker[beyond]).toBe(-1);
  });

  it('never sows a tile another farmer sows, so two farmers and one tile sow it once', () => {
    const sim = createSim(grass(30), { villagers: 2, monsters: 0 });
    finishedFarm(sim, 16, 16);
    expect([sim.villagers.workplace[0], sim.villagers.workplace[1]]).toEqual([0, 0]);
    field(sim, square(19, 16));
    const tile = at(sim.map, 19, 16);
    const takers = new Set<number>();
    runUntil(sim, () => fieldState(sim.fields, tile) === FieldState.Sown, TICKS_PER_DAY, () => {
      for (let id = 0; id < 2; id++) if (sim.villagers.task[id] === SOW) takers.add(id);
    });
    expect(takers.size).toBe(1);
    expect(sim.tally.sown).toBe(1);
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    expect(sim.tally.sown).toBe(1);
  });

  it('sows a tile in the reach of two farms whichever farmer takes it', () => {
    const sim = createSim(grass(40), { villagers: 2, monsters: 0 });
    const west = finishedFarm(sim, 8, 28);
    applyCommand(sim, { kind: 'setPlaces', slot: west, places: 1 });
    const east = finishedFarm(sim, 28, 28);
    expect([sim.villagers.workplace[0], sim.villagers.workplace[1]].sort()).toEqual([west, east].sort());
    field(sim, square(18, 30, 19, 30));
    const workplaces = new Set<number>();
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, () => {
      for (let id = 0; id < 2; id++) if (sim.villagers.task[id] === SOW) workplaces.add(sim.villagers.workplace[id]!);
    });
    expect(sim.tally.sown).toBe(2);
    expect(workplaces).toEqual(new Set([west, east]));
  });

  it('keeps the work on a half-sown tile through the night, and finishes it at dawn', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0 });
    finishedFarm(sim, 16, 16);
    runUntil(sim, () => isNight(sim.tick + 80), TICKS_PER_DAY);
    field(sim, square(18, 16));
    const tile = at(sim.map, 18, 16);
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY);
    const done = sim.fields.progress[tile]!;
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(SOW_WORK_TICKS);
    expect(fieldState(sim.fields, tile)).toBe(FieldState.Bare);
    let firstWork = -1;
    runUntil(sim, () => fieldState(sim.fields, tile) === FieldState.Sown, TICKS_PER_DAY, () => {
      if (firstWork < 0 && sim.villagers.state[0] === VillagerState.Working) firstWork = sim.tick - 1;
    });
    expect(sim.fields.sownAt[tile]! - firstWork + 1).toBe(SOW_WORK_TICKS - done);
  });

  it('sows in spring and nothing in summer', () => {
    const sim = createSim(grass(30), { villagers: 1, monsters: 0, campFood: 100 });
    finishedFarm(sim, 16, 16);
    runUntil(sim, () => seasonAt(sim.tick) === 'Summer' && !isNight(sim.tick), 4 * TICKS_PER_DAY);
    field(sim, square(18, 14, 20, 18));
    const tasks = new Set<number>();
    runUntil(sim, () => seasonAt(sim.tick) === 'Autumn', 3 * TICKS_PER_DAY, () => tasks.add(sim.villagers.task[0]!));
    expect(sim.tally.sown).toBe(0);
    expect(tasks.has(SOW)).toBe(false);
  });

  it('does none of the work of a settler without a job', () => {
    const sim = createSim(mapFrom(Array.from({ length: 30 }, (_, y) => (y === 5 ? '....TTTT......................' : '.'.repeat(30)))), { villagers: 1, monsters: 0 });
    finishedFarm(sim, 16, 16);
    applyCommand(sim, { kind: 'markArea', order: 'chop', area: square(0, 5, 29, 5) });
    const tasks = new Set<number>();
    runUntil(sim, () => isNight(sim.tick), TICKS_PER_DAY, () => tasks.add(sim.villagers.task[0]!));
    expect(sim.tally.felled).toBe(0);
    expect([...tasks].filter((task) => task !== 0)).toEqual([]);
  });
});

describe('the first spring on seed 7', () => {
  it('stands the farm on day 1 and sows the 24 tiles of its field by the end of day 2', () => {
    const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
    for (const command of firstSpringCommands()) expect(applyCommand(sim, command)).toMatchObject({ ok: true });
    const sown: number[] = [0, 0, 0];
    while (seasonAt(sim.tick) === 'Spring') {
      const day = dateAt(sim.tick).day;
      const before = sim.tally.sown;
      step(sim);
      sown[day - 1]! += sim.tally.sown - before;
    }
    expect(sown).toEqual([10, 14, 0]);
  });
});
