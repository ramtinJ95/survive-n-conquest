import { Color, type DirectionalLight, type Fog, type HemisphereLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SEASONS, TICKS_PER_DAY } from '../sim/calendar';
import { isNight } from '../sim/daylight';
import { generateMap } from '../sim/mapgen';
import { createWorld } from './world';

const DAY = TICKS_PER_DAY;
const HOUR = DAY / 24;
const YEAR = SEASONS.length * 3 * DAY;
/** The game opens at 08:00, so the first midnight is 16 hours in. */
const FIRST_MIDNIGHT = 16 * HOUR;
/** The tick of an hour on the middle day of a season. Day 2 is the middle day of the first spring. */
const midSeason = (season: number, hour: number) => FIRST_MIDNIGHT + season * 3 * DAY + hour * HOUR;

const { scene, show } = createWorld(generateMap(7, 48));
const sky = scene.getObjectByName('sky') as HemisphereLight;
const light = scene.getObjectByName('sun') as DirectionalLight;

/** The direction that the sun or the moon shines from. */
function lightFrom(tick: number): Vector3 {
  show(tick);
  return light.position.clone().sub(light.target.position).normalize();
}

/** The light that falls on flat, open ground. */
function groundLight(tick: number): Color {
  const lift = lightFrom(tick).y;
  return sky.color.clone().multiplyScalar(sky.intensity).add(light.color.clone().multiplyScalar(light.intensity * lift));
}

const brightness = (tick: number) => {
  const { r, g, b } = groundLight(tick);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('the light of the world', () => {
  it.each(SEASONS.map((season, index) => [season, index] as const))(
    'is warm at noon and cold, dark, and still there at midnight in %s',
    (_season, index) => {
      const noon = groundLight(midSeason(index, 12));
      const midnight = groundLight(midSeason(index, 0));
      expect(noon.r).toBeGreaterThan(noon.b);
      expect(midnight.b).toBeGreaterThan(2 * midnight.r);
      const share = brightness(midSeason(index, 0)) / brightness(midSeason(index, 12));
      expect(share).toBeGreaterThan(0.08);
      expect(share).toBeLessThan(0.25);
    },
  );

  it.each(SEASONS.map((season, index) => [season, index] as const))(
    'only brightens from midnight to noon and only dims from noon to midnight in %s',
    (_season, index) => {
      for (let tick = midSeason(index, 0) + 1; tick <= midSeason(index, 24); tick++) {
        const change = brightness(tick) - brightness(tick - 1);
        const rising = tick <= midSeason(index, 12);
        expect(rising ? change : -change, `tick ${tick}`).toBeGreaterThan(-1e-9);
      }
    },
  );

  it('shines from the east in the morning, from the south at noon, and from the west in the evening', () => {
    expect(lightFrom(midSeason(0, 7)).x).toBeGreaterThan(0.5);
    const noon = lightFrom(midSeason(0, 12));
    expect(noon.x).toBeCloseTo(0, 5);
    expect(noon.z).toBeGreaterThan(0.5);
    expect(lightFrom(midSeason(0, 17)).x).toBeLessThan(-0.5);
  });

  it('stands highest at a summer noon and lowest at a winter noon', () => {
    const [spring, summer, autumn, winter] = SEASONS.map((_, index) => lightFrom(midSeason(index, 12)).y);
    expect(summer).toBeGreaterThan(spring!);
    expect(spring).toBeGreaterThan(autumn!);
    expect(autumn).toBeGreaterThan(winter!);
  });

  it('is dark on a winter evening and morning that are light in summer', () => {
    for (const hour of [5.5, 18.5]) {
      expect(isNight(midSeason(1, hour))).toBe(false);
      expect(isNight(midSeason(3, hour))).toBe(true);
      expect(brightness(midSeason(3, hour)) / brightness(midSeason(1, hour))).toBeLessThan(0.4);
    }
  });

  it('always falls from above, and never jumps while it shines', () => {
    const largestStep = brightness(midSeason(0, 12)) / 100;
    let before = lightFrom(0);
    let lit = brightness(0);
    for (let tick = 1; tick <= YEAR + DAY; tick++) {
      const now = lightFrom(tick);
      const next = brightness(tick);
      expect(now.y, `tick ${tick}`).toBeGreaterThan(0.15);
      expect(Math.abs(next - lit), `tick ${tick}`).toBeLessThan(largestStep);
      if (now.angleTo(before) > 0.02) expect(light.intensity, `tick ${tick}`).toBeLessThan(0.02);
      before = now;
      lit = next;
    }
  });

  it('fades the far land into the color behind the map', () => {
    for (const hour of [0, 5, 12, 19]) {
      show(midSeason(2, hour));
      expect((scene.fog as Fog).color).toEqual(scene.background);
    }
  });

  it('puts a dark sky behind the map at night and a light one by day', () => {
    const backdrop = (tick: number) => {
      show(tick);
      return (scene.background as Color).getHSL({ h: 0, s: 0, l: 0 }).l;
    };
    expect(backdrop(midSeason(0, 0))).toBeLessThan(0.1);
    expect(backdrop(midSeason(0, 12))).toBeGreaterThan(0.5);
  });
});
