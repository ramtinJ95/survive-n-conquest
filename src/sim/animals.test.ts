import { describe, expect, it } from 'vitest';
import { ANIMALS, AnimalKind, AnimalState, MAX_ANIMALS, addAnimal, grazes, moveAnimals, removeAnimal } from './animals';
import { TICKS_PER_DAY } from './calendar';
import { isDawn } from './daylight';
import { TileKind, tileAt } from './map';
import { generateMap } from './mapgen';
import { NOBODY, SETTLERS, type Sim, createSim, step } from './sim';
import { mapFrom } from './testMaps';
import { VillagerState } from './villagerState';

const DEER = ANIMALS[AnimalKind.Deer];

/** An open map of 38 by 38 tiles, too small for a deer of its own, with water in the columns `water` names. */
function openMap(water: readonly number[] = []) {
  return mapFrom(Array.from({ length: 38 }, () => Array.from({ length: 38 }, (_, x) => (water.includes(x) ? '~' : '.')).join('')));
}

/** A simulation of one villager on `openMap`, standing at (vx, vy), and a grazing deer at (dx, dy) that grazes on. */
function deerAndVillager(vx: number, vy: number, dx: number, dy: number, water: readonly number[] = []) {
  const sim = createSim(openMap(water), { villagers: 1, monsters: 0 });
  expect(sim.animals.living[AnimalKind.Deer]).toBe(0);
  sim.villagers.x[0] = vx;
  sim.villagers.y[0] = vy;
  const deer = addAnimal(sim.animals, AnimalKind.Deer, dx, dy);
  sim.animals.until[deer] = 1_000_000;
  return { sim, deer };
}

function living(sim: Sim): number[] {
  return Array.from({ length: MAX_ANIMALS }, (_, row) => row).filter((row) => sim.animals.state[row] !== AnimalState.Gone);
}

describe('deer', () => {
  it('number one for every 1,500 land tiles at the start, each on grass or forest', () => {
    for (const [size, deer] of [
      [256, 38],
      [512, 155],
    ] as const) {
      const sim = createSim(generateMap(7, size), NOBODY);
      expect(sim.animals.wanted[AnimalKind.Deer]).toBe(deer);
      expect(sim.animals.living[AnimalKind.Deer]).toBe(deer);
      const rows = living(sim);
      expect(rows).toEqual(Array.from({ length: deer }, (_, row) => row));
      for (const row of rows) expect(grazes(sim.map, tileAt(sim.map, sim.animals.x[row]!, sim.animals.y[row]!))).toBe(true);
    }
  });

  it('stay on grass and forest inside the map as they wander and run from the settlers for two days', () => {
    const sim = createSim(generateMap(7), SETTLERS);
    const { size } = sim.map;
    const start = Float32Array.from(sim.animals.x);
    let fled = 0;
    for (let tick = 0; tick < 2 * TICKS_PER_DAY; tick++) {
      step(sim);
      for (const row of living(sim)) {
        const x = sim.animals.x[row]!;
        const y = sim.animals.y[row]!;
        expect(x >= 0 && y >= 0 && x < size && y < size).toBe(true);
        const kind = sim.map.kinds[tileAt(sim.map, x, y)];
        expect(kind === TileKind.Grass || kind === TileKind.Forest).toBe(true);
        if (sim.animals.state[row] === AnimalState.Fleeing) fled++;
      }
    }
    expect(fled).toBeGreaterThan(0);
    expect(living(sim).filter((row) => sim.animals.x[row] !== start[row]).length).toBeGreaterThan(30);
  });

  it('walk in from the map edge, one at each dawn, while the map holds fewer than it started with', () => {
    const sim = createSim(generateMap(7), NOBODY);
    const { size } = sim.map;
    removeAnimal(sim.animals, 4);
    removeAnimal(sim.animals, 9);
    expect(sim.animals.living[AnimalKind.Deer]).toBe(36);
    while (!isDawn(sim.tick)) step(sim);
    step(sim);
    expect(sim.animals.living[AnimalKind.Deer]).toBe(37);
    expect(sim.animals.state[4]).not.toBe(AnimalState.Gone);
    expect(sim.animals.state[9]).toBe(AnimalState.Gone);
    const x = Math.floor(sim.animals.x[4]!);
    const y = Math.floor(sim.animals.y[4]!);
    expect(Math.min(x, y, size - 1 - x, size - 1 - y)).toBe(0);
    expect(Math.hypot(sim.animals.targetX[4]! - sim.animals.x[4]!, sim.animals.targetY[4]! - sim.animals.y[4]!)).toBeCloseTo(8 - DEER.walkStep, 4);
    step(sim);
    while (!isDawn(sim.tick)) step(sim);
    step(sim);
    expect(sim.animals.living[AnimalKind.Deer]).toBe(38);
    while (!isDawn(sim.tick)) step(sim);
    step(sim);
    expect(sim.animals.living[AnimalKind.Deer]).toBe(38);
  });

  it('run from a villager 6 tiles away, straight away from it at 3 tiles a second, and not from one 7 tiles away', () => {
    const near = deerAndVillager(26.5, 20.5, 20.5, 20.5);
    moveAnimals(near.sim, false);
    expect(near.sim.animals.state[near.deer]).toBe(AnimalState.Fleeing);
    for (let tick = 1; tick < 10; tick++) moveAnimals(near.sim, false);
    expect(near.sim.animals.x[near.deer]).toBeCloseTo(17.5, 4);
    expect(near.sim.animals.y[near.deer]).toBe(20.5);

    const far = deerAndVillager(27.5, 20.5, 20.5, 20.5);
    for (let tick = 0; tick < 10; tick++) moveAnimals(far.sim, false);
    expect(far.sim.animals.state[far.deer]).toBe(AnimalState.Grazing);
    expect(far.sim.animals.x[far.deer]).toBe(20.5);
  });

  it('run 12 tiles in 4 seconds and then graze, and run again while the villager stays within 6 tiles', () => {
    const { sim, deer } = deerAndVillager(22.5, 20.5, 20.5, 20.5);
    const states: number[] = [];
    for (let tick = 0; tick <= DEER.fleeTicks + 1; tick++) {
      sim.tick = tick;
      moveAnimals(sim, false);
      states.push(sim.animals.state[deer]!);
    }
    expect(states.slice(0, DEER.fleeTicks)).toEqual(new Array(DEER.fleeTicks).fill(AnimalState.Fleeing));
    expect(states[DEER.fleeTicks]).toBe(AnimalState.Grazing);
    expect(sim.animals.x[deer]).toBeCloseTo(20.5 - 12, 3);

    sim.villagers.x[0] = sim.animals.x[deer]! + 5;
    sim.tick += 1;
    moveAnimals(sim, false);
    expect(sim.animals.state[deer]).toBe(AnimalState.Fleeing);
  });

  it('turn along water that blocks a flight, and never enter it', () => {
    const { sim, deer } = deerAndVillager(21.5, 20.5, 16.5, 20.5, [15]);
    for (let tick = 0; tick < 30; tick++) {
      sim.tick = tick;
      moveAnimals(sim, false);
      expect(sim.animals.x[deer]!).toBeGreaterThanOrEqual(16);
    }
    expect(sim.animals.state[deer]).toBe(AnimalState.Fleeing);
    expect(Math.abs(sim.animals.y[deer]! - 20.5)).toBeGreaterThan(4);
  });

  it('take no fright at a villager inside its house or dead', () => {
    for (const state of [VillagerState.Inside, VillagerState.Dead]) {
      const { sim, deer } = deerAndVillager(21.5, 20.5, 20.5, 20.5);
      sim.villagers.state[0] = state;
      for (let tick = 0; tick < 10; tick++) moveAnimals(sim, false);
      expect(sim.animals.state[deer]).toBe(AnimalState.Grazing);
    }
  });

  it('wander the same way from the same seed', () => {
    const play = () => {
      const sim = createSim(generateMap(7), SETTLERS);
      for (let tick = 0; tick < TICKS_PER_DAY; tick++) step(sim);
      return Array.from(sim.animals.x);
    };
    expect(play()).toEqual(play());
  });
});
