import { describe, expect, it } from 'vitest';
import { frameOf } from '../frame';
import { AnimalKind, AnimalState } from '../sim/animals';
import { heightAt } from '../sim/map';
import { generateMap } from '../sim/mapgen';
import { NOBODY, createSim, step } from '../sim/sim';
import { createHerds } from './animals';
import { DEER_LOOK, deerShape } from './shapes';

describe('the herds', () => {
  it('draws every living deer on the ground where it stands, and none for a row that holds no deer', () => {
    const sim = createSim(generateMap(7, 64), NOBODY);
    const herds = createHerds(sim.map);
    const deer = herds.meshes[AnimalKind.Deer]!;
    const { frame } = frameOf(sim);
    const living = Array.from(frame.animalStates).filter((state) => state !== AnimalState.Gone).length;
    expect(living).toBeGreaterThan(0);
    herds.show(frame);
    expect(deer.count).toBe(living);
    const half = sim.map.size / 2;
    const matrix = deer.instanceMatrix.array;
    expect([matrix[12], matrix[13], matrix[14]]).toEqual([
      frame.animals[0]! - half,
      heightAt(sim.map, frame.animals[0]!, frame.animals[1]!),
      frame.animals[1]! - half,
    ]);
  });

  it('turns a deer the way it walked', () => {
    const sim = createSim(generateMap(7, 64), NOBODY);
    const herds = createHerds(sim.map);
    herds.show(frameOf(sim).frame);
    while (sim.animals.state[0] !== AnimalState.Walking) step(sim);
    const before = [sim.animals.x[0]!, sim.animals.y[0]!];
    for (let tick = 0; tick < 5 && sim.animals.state[0] === AnimalState.Walking; tick++) step(sim);
    const after = [sim.animals.x[0]!, sim.animals.y[0]!];
    herds.show(frameOf(sim).frame);
    const matrix = herds.meshes[AnimalKind.Deer]!.instanceMatrix.array;
    const forward = [matrix[8]!, matrix[10]!];
    const walked = [after[0]! - before[0]!, after[1]! - before[1]!];
    const length = Math.hypot(walked[0]!, walked[1]!);
    expect(forward[0]!).toBeCloseTo(walked[0]! / length, 3);
    expect(forward[1]!).toBeCloseTo(walked[1]! / length, 3);
  });

  it('is shaped about 1.2 m from nose to tail, longer than it is wide, on legs', () => {
    const shape = deerShape();
    shape.computeBoundingBox();
    const box = shape.boundingBox!;
    expect(box.max.z - box.min.z).toBeGreaterThan(1.1);
    expect(box.max.z - box.min.z).toBeLessThan(1.3);
    expect(box.max.x - box.min.x).toBeLessThan(0.5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeGreaterThan(DEER_LOOK.legs + DEER_LOOK.body.height);
  });
});
