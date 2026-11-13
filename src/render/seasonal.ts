import {
  type IUniform,
  MathUtils,
  MeshLambertMaterial,
  type MeshLambertMaterialParameters,
  ShaderChunk,
  type Vector4,
} from 'three';
import { SEASONS, TICKS_PER_DAY, TICKS_PER_SEASON, seasonIndexAt, tickOfSeason } from '../sim/calendar';

/**
 * The vertex attribute that holds the colors of each season, in `SEASONS`
 * order. Three.js reads the first one as the plain vertex color.
 */
export const SEASON_COLORS = ['color', 'colorSummer', 'colorAutumn', 'colorWinter'] as const;

/** The land takes the colors of the next season over this many ticks, up to the midnight that starts it. */
const TURN_TICKS = TICKS_PER_DAY / 2;

const DECLARED = `attribute vec3 ${SEASON_COLORS.slice(1).join(';\nattribute vec3 ')};\nuniform vec4 seasonMix;`;
const PLAIN = 'vColor.rgb *= color;';
const BLENDED = `vColor.rgb *= ${SEASON_COLORS.map((name, season) => `seasonMix.${'xyzw'[season]} * ${name}`).join(' + ')};`;

function blendSeasons(vertexShader: string): string {
  const blended = vertexShader
    .replace('#include <color_pars_vertex>', `#include <color_pars_vertex>\n${DECLARED}`)
    .replace('#include <color_vertex>', ShaderChunk.color_vertex.replace(PLAIN, BLENDED));
  if (!blended.includes(DECLARED) || !blended.includes(BLENDED)) {
    throw new Error('three.js changed the vertex color shader that the season blend replaces');
  }
  return blended;
}

/**
 * A flat-shaded material that draws the blend of the four `SEASON_COLORS`
 * attributes of its geometry. `mix` holds the weight of each season.
 */
export function seasonalMaterial(
  mix: IUniform<Vector4>,
  parameters: MeshLambertMaterialParameters = {},
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true, ...parameters });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.seasonMix = mix;
    shader.vertexShader = blendSeasons(shader.vertexShader);
  };
  return material;
}

/**
 * Writes the weight of each season's look at a tick, in `SEASONS` order. A
 * season keeps its own look until noon of its last day, and the next season's
 * look is complete at the midnight that starts it.
 */
export function seasonMixAt(tick: number, mix: Vector4): Vector4 {
  const season = seasonIndexAt(tick);
  const turned = MathUtils.smoothstep(tickOfSeason(tick), TICKS_PER_SEASON - TURN_TICKS, TICKS_PER_SEASON);
  return mix
    .set(0, 0, 0, 0)
    .setComponent(season, 1 - turned)
    .setComponent((season + 1) % SEASONS.length, turned);
}
