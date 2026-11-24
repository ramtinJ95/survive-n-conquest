import { describe, expect, it } from 'vitest';
import { frameOf } from './frame';
import { AnimalKind, AnimalState, MAX_ANIMALS, addAnimal } from './sim/animals';
import { finishBuilding } from './sim/building';
import { Building } from './sim/buildings';
import { FORAGING } from './sim/foraging';
import { type Sim, applyCommand, createSim, step } from './sim/sim';
import { CAMP_STORE } from './sim/stores';
import { TASK_KINDS } from './sim/tasks';
import { at, mapFrom } from './sim/testMaps';

const FORAGE = TASK_KINDS.indexOf(FORAGING) + 1;

/** Four settlers and a finished hut anchored on (10, 10) in open ground with a row of trees, settler 2 nearest it and settler 1 next. */
function settlersAndAHut(): { sim: Sim; slot: number } {
  const rows = Array.from({ length: 32 }, (_, y) => (y === 16 ? '.'.repeat(4) + 'T'.repeat(24) + '.'.repeat(4) : '.'.repeat(32)));
  const sim = createSim(mapFrom(rows), { villagers: 4, monsters: 0 });
  for (const [id, x, y] of [[0, 28.5, 28.5], [1, 11, 15], [2, 14, 11], [3, 27.5, 3.5]] as const) {
    sim.villagers.x[id] = sim.villagers.targetX[id] = x;
    sim.villagers.y[id] = sim.villagers.targetY[id] = y;
  }
  expect(applyCommand(sim, { kind: 'place', building: Building.Hut, x: 10, y: 10 })).toMatchObject({ ok: true });
  const slot = sim.orders.siteOf[at(sim.map, 10, 10)]!;
  finishBuilding(sim, slot);
  return { sim, slot };
}

describe('the frame the worker posts', () => {
  it('says where each settler works and in what order the workers came, and follows a change of places', () => {
    const { sim, slot } = settlersAndAHut();
    const { frame } = frameOf(sim);
    expect(Array.from(frame.workplaces)).toEqual([-1, slot, slot, -1]);
    expect(frame.hired[0]).toBe(0);
    expect(frame.hired[3]).toBe(0);
    expect(frame.hired[2]).toBeLessThan(frame.hired[1]!);

    applyCommand(sim, { kind: 'setPlaces', slot, places: 1 });
    expect(Array.from(frameOf(sim).frame.workplaces)).toEqual([-1, -1, slot, -1]);
  });

  it('counts the food on its way into each store and says where each forager carries it', () => {
    const { sim } = settlersAndAHut();
    while (!sim.villagers.task.includes(FORAGE)) step(sim);
    const forager = sim.villagers.task.indexOf(FORAGE);
    const { frame } = frameOf(sim);
    expect(frame.storeInbound[CAMP_STORE]).toBe(sim.villagers.task.subarray(0, sim.villagers.count).filter((task) => task === FORAGE).length);
    expect(frame.storeInbound[CAMP_STORE]).toBeGreaterThan(0);
    expect(frame.destinations[forager]).toBe(sim.flow.goal);
  });

  it('transfers every column it copies, each buffer once, so the post leaves the simulation its own arrays', () => {
    const { sim } = settlersAndAHut();
    const { frame, transfer } = frameOf(sim);
    const posted = structuredClone(frame, { transfer });
    expect(Array.from(posted.workplaces)).toEqual(Array.from(sim.villagers.workplace.subarray(0, sim.villagers.count)));
    expect(Array.from(posted.hired)).toEqual(Array.from(sim.villagers.hired.subarray(0, sim.villagers.count)));
    expect(frame.workplaces.length).toBe(0);
    expect(frame.hired.length).toBe(0);
    expect(sim.villagers.count).toBe(4);
  });

  it('copies the position, kind, and state of every row of the animal table, living or gone', () => {
    const { sim } = settlersAndAHut();
    const deer = addAnimal(sim.animals, AnimalKind.Deer, 20.5, 6.25);
    const { frame, transfer } = frameOf(sim);
    expect([frame.animals.length, frame.animalKinds.length, frame.animalStates.length]).toEqual([2 * MAX_ANIMALS, MAX_ANIMALS, MAX_ANIMALS]);
    expect([frame.animals[deer * 2], frame.animals[deer * 2 + 1], frame.animalKinds[deer], frame.animalStates[deer]]).toEqual([20.5, 6.25, AnimalKind.Deer, AnimalState.Grazing]);
    expect(frame.animalStates[deer + 1]).toBe(AnimalState.Gone);
    structuredClone(frame, { transfer });
    expect([frame.animals.length, frame.animalKinds.length, frame.animalStates.length]).toEqual([0, 0, 0]);
  });
});
