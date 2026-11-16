import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from './calendar';
import { isDawn, isNight } from './daylight';
import { Good, putDown } from './goods';
import { type Sim, applyCommand, createSim, step } from './sim';
import { at, mapFrom } from './testMaps';

const open = (size: number) => Array.from({ length: size }, () => '.'.repeat(size));

function runUntil(sim: Sim, done: () => boolean, limit: number): void {
  const end = sim.tick + limit;
  while (!done()) {
    if (sim.tick >= end) throw new Error(`not done by tick ${end}`);
    step(sim);
  }
}

/** Runs through the next tick of the turn of the light, the first of a night or of a day. */
function through(sim: Sim, turn: (tick: number) => boolean): void {
  step(sim);
  runUntil(sim, () => turn(sim.tick - 1), TICKS_PER_DAY);
}
const dusk = (sim: Sim) => through(sim, (tick) => isNight(tick) && !isNight(tick - 1));
const dawn = (sim: Sim) => through(sim, isDawn);

/** Units of food on the map's tiles. */
function foodOnGround(sim: Sim): number {
  let units = 0;
  for (let tile = 0; tile < sim.map.size * sim.map.size; tile++) if (sim.map.stackGood[tile] === Good.Food) units += sim.map.stackSize[tile]!;
  return units;
}

describe('food on open ground', () => {
  it('lies through the first dawn after it was put down and is gone at the second', () => {
    const sim = createSim(mapFrom(open(20)), { villagers: 0, monsters: 0 });
    dusk(sim);
    expect(putDown(sim, at(sim.map, 3, 3), Good.Food, 1)).toBe(true);
    dawn(sim);
    expect(sim.map.stackSize[at(sim.map, 3, 3)]).toBe(1);
    dawn(sim);
    expect(sim.map.stackSize[at(sim.map, 3, 3)]).toBe(0);
    expect(sim.map.stackGood[at(sim.map, 3, 3)]).toBe(Good.None);
  });

  it('is never put on a stockpile tile', () => {
    const sim = createSim(mapFrom(open(20)), { villagers: 0, monsters: 0 });
    applyCommand(sim, { kind: 'markArea', order: 'stockpile', area: { x0: 2, y0: 2, x1: 4, y1: 4 } });
    expect(putDown(sim, at(sim.map, 3, 3), Good.Food, 1)).toBe(true);
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) expect(sim.map.stackSize[at(sim.map, x, y)], `${x}, ${y}`).toBe(0);
    expect(foodOnGround(sim)).toBe(1);
  });

  it('put down on two days lies in two stacks, each gone on its own day', () => {
    const sim = createSim(mapFrom(open(20)), { villagers: 0, monsters: 0 });
    const tile = at(sim.map, 10, 3);
    expect(putDown(sim, tile, Good.Food, 1)).toBe(true);
    dawn(sim);
    expect(putDown(sim, tile, Good.Food, 1)).toBe(true);
    expect(sim.map.stackSize[tile]).toBe(1);
    expect(foodOnGround(sim)).toBe(2);
    dawn(sim);
    expect([sim.map.stackSize[tile], foodOnGround(sim)]).toEqual([0, 1]);
    dawn(sim);
    expect(foodOnGround(sim)).toBe(0);
  });
});
