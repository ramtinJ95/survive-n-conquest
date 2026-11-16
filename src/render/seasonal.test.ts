import { type BufferAttribute, Color, type InstancedMesh, type Mesh, type PointLight, ShaderLib, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { SEASONS, TICKS_PER_DAY } from '../sim/calendar';
import { generateMap } from '../sim/mapgen';
import { SEASON_COLORS, daily, seasonMixAt } from './seasonal';
import { primitiveShapes } from './shapes';
import { createWorld } from './world';

const DAY = TICKS_PER_DAY;
const HOUR = DAY / 24;
/** The game opens at 08:00, so the first midnight is 16 hours in. */
const FIRST_MIDNIGHT = 16 * HOUR;
/** The tick of an hour on a day of the first year. */
const at = (day: number, hour: number) => FIRST_MIDNIGHT + (day - 2) * DAY + hour * HOUR;
const [SPRING, SUMMER, AUTUMN, WINTER] = [1, 4, 7, 10].map((day) => at(day, 12)) as [number, number, number, number];

const { scene, show } = createWorld(generateMap(7, 48), primitiveShapes());

/** What three.js hands a material to compile. */
function compiled(mesh: Mesh) {
  const shader = {
    uniforms: {} as Record<string, { value: Vector4 }>,
    vertexShader: ShaderLib.lambert.vertexShader,
    fragmentShader: ShaderLib.lambert.fragmentShader,
  };
  (mesh.material as { onBeforeCompile(shader: unknown, renderer: unknown): void }).onBeforeCompile(shader, null);
  return shader;
}

/** The mean color that a mesh is drawn in at a tick, before the light falls on it. */
function drawn(name: string, tick: number): Color {
  show(tick);
  const mesh = scene.getObjectByName(name) as Mesh;
  const mix = compiled(mesh).uniforms.seasonMix!.value;
  const mean = new Color(0, 0, 0);
  const color = new Color();
  SEASON_COLORS.forEach((attribute, season) => {
    const colors = mesh.geometry.getAttribute(attribute) as BufferAttribute;
    for (let vertex = 0; vertex < colors.count; vertex++) {
      mean.add(color.fromBufferAttribute(colors, vertex).multiplyScalar(mix.getComponent(season) / colors.count));
    }
  });
  return mean;
}

const spread = ({ r, g, b }: Color) => Math.max(r, g, b) - Math.min(r, g, b);

describe('the colors of the seasons', () => {
  it('reach the shader of the terrain, the water, and every tree, boulder, and plant', () => {
    for (const name of ['terrain', 'water', 'sea bed', 'pines', 'oaks', 'blossoms', 'birches', 'boulders', 'grass tufts', 'flowers', 'bushes', 'pebbles', 'reeds']) {
      const { vertexShader } = compiled(scene.getObjectByName(name) as Mesh);
      for (const attribute of SEASON_COLORS) expect(vertexShader, name).toContain(`* ${attribute}`);
    }
  });

  it('turn the ground green in spring and summer, brown in autumn, and white in winter', () => {
    const [spring, summer, autumn, winter] = [SPRING, SUMMER, AUTUMN, WINTER].map((tick) => drawn('terrain', tick));
    for (const green of [spring!, summer!]) {
      expect(green.g).toBeGreaterThan(green.r);
      expect(green.g).toBeGreaterThan(2 * green.b);
    }
    expect(spring!.g).toBeGreaterThan(1.2 * summer!.g);
    expect(autumn!.r).toBeGreaterThan(autumn!.g);
    expect(autumn!.g).toBeGreaterThan(1.5 * autumn!.b);
    expect(Math.min(winter!.r, winter!.g, winter!.b)).toBeGreaterThan(0.4);
    expect(spread(winter!)).toBeLessThan(0.15);
  });

  it.each(['oaks', 'blossoms', 'birches'])('turn the %s orange in autumn and pale in winter, and leave the pines green', (name) => {
    const leaves = drawn(name, AUTUMN);
    expect(leaves.r).toBeGreaterThan(1.3 * leaves.g);
    expect(leaves.g).toBeGreaterThan(1.5 * leaves.b);
    expect(spread(drawn(name, WINTER))).toBeLessThan(0.1);
    const summerLeaves = drawn(name, SUMMER);
    expect(summerLeaves.g).toBeGreaterThan(1.5 * summerLeaves.r);
    const pines = drawn('pines', AUTUMN);
    expect(pines.g).toBeGreaterThan(1.3 * pines.r);
  });

  it('blossom on the blossom trees in spring only, and never on the oaks', () => {
    const top = (tick: number, name = 'blossoms') => {
      show(tick);
      const trees = scene.getObjectByName(name) as InstancedMesh;
      const mix = compiled(trees).uniforms.seasonMix!.value;
      const last = trees.geometry.getAttribute('position').count - 1;
      const color = new Color(0, 0, 0);
      SEASON_COLORS.forEach((attribute, season) => {
        const colors = trees.geometry.getAttribute(attribute) as BufferAttribute;
        color.add(new Color().fromBufferAttribute(colors, last).multiplyScalar(mix.getComponent(season)));
      });
      return color;
    };
    expect(top(SPRING).r).toBeGreaterThan(top(SPRING).g);
    expect(top(SUMMER).g).toBeGreaterThan(top(SUMMER).r);
    expect(top(SPRING, 'oaks').g).toBeGreaterThan(top(SPRING, 'oaks').r);
  });
});

describe('seasonMixAt', () => {
  const mix = (tick: number) => seasonMixAt(tick, new Vector4()).toArray();

  it.each(SEASONS.map((season, index) => [season, index] as const))(
    'shows %s alone from its first midnight to noon of its last day',
    (_season, index) => {
      const alone = [0, 0, 0, 0];
      alone[index] = 1;
      const firstDay = 1 + index * 3;
      const ticks = [at(firstDay, 12), at(firstDay + 1, 0), at(firstDay + 1, 18), at(firstDay + 2, 12)];
      if (index > 0) ticks.push(at(firstDay, 0));
      for (const tick of ticks) expect(mix(tick), `tick ${tick}`).toEqual(alone);
    },
  );

  it('turns to the next season over the last afternoon and evening', () => {
    expect(mix(at(3, 18))).toEqual([0.5, 0.5, 0, 0]);
    expect(mix(at(12, 18))).toEqual([0.5, 0, 0, 0.5]);
    const early = mix(at(9, 14));
    const late = mix(at(9, 22));
    expect(early[2]).toBeGreaterThan(0.8);
    expect(late[3]).toBeGreaterThan(0.8);
    for (let tick = at(9, 12); tick <= at(10, 0); tick++) {
      const [spring, summer, autumn, winter] = mix(tick);
      expect([spring, summer]).toEqual([0, 0]);
      expect(autumn! + winter!).toBeCloseTo(1, 10);
    }
  });
});

describe('daily', () => {
  it('gives the nearest rate that makes whole turns in a day', () => {
    for (const rate of [0.13, 0.31, 0.9, 2.3]) {
      const turns = (daily(rate) * DAY) / (2 * Math.PI);
      expect(turns).toBeCloseTo(Math.round(turns), 9);
      expect(Math.abs(daily(rate) - rate)).toBeLessThan(Math.PI / DAY);
    }
  });
});

describe('the motion of the world', () => {
  const world = createWorld(generateMap(7, 64), primitiveShapes());
  const fireAt = (time: number) => {
    world.show(Math.floor(time), time);
    const flame = world.scene.getObjectByName('flame') as Mesh;
    const smoke = world.scene.getObjectByName('smoke') as InstancedMesh;
    const light = world.scene.getObjectByName('firelight') as PointLight;
    return [...flame.scale.toArray(), flame.rotation.y, light.intensity, ...smoke.instanceMatrix.array];
  };

  it('is the same at the same time on the next day, and another an hour later', () => {
    const noon = fireAt(at(2, 12) + 0.25);
    expect(fireAt(at(3, 12) + 0.25)).toEqual(noon);
    expect(fireAt(at(2, 13) + 0.25)).not.toEqual(noon);
  });
});
