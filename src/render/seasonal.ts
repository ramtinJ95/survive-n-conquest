import {
  type IUniform,
  type Material,
  MathUtils,
  MeshDepthMaterial,
  MeshLambertMaterial,
  type MeshLambertMaterialParameters,
  RGBADepthPacking,
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
 * A motion of a mesh that its vertex shader works out, so thousands of
 * instances move at no cost to the page. `moves` is GLSL that changes
 * `transformed`, the place of a vertex in its shape, and `declares` names the
 * uniforms and attributes that it reads.
 */
export interface Motion {
  readonly uniforms: Readonly<Record<string, IUniform>>;
  readonly declares: string;
  readonly moves: string;
}

/** Makes a material move as `motion` says. Three.js shares one program between the materials of one motion. */
export function moved<M extends Material>(material: M, motion: Motion, before: Material['onBeforeCompile'] = () => {}): M {
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, motion.uniforms);
    const shaped = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${motion.declares}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${motion.moves}`);
    if (!shaped.includes(motion.declares) || !shaped.includes(motion.moves)) {
      throw new Error('three.js changed the vertex shader that a motion is written into');
    }
    shader.vertexShader = shaped;
  };
  material.customProgramCacheKey = () => motion.moves;
  return material;
}

/**
 * The wind in a plant. An instance bends along the wind by `bend` meters for
 * each meter of its shape's height, squared, so the root holds and the top
 * swings. A gust is a function of the clock and of where the plant stands, so
 * gusts cross the land, and a paused clock holds every plant still.
 */
export function sway(clock: IUniform<number>, bend: number): Motion {
  return {
    uniforms: { swayClock: clock, swayBend: { value: bend } },
    declares: 'uniform float swayClock;\nuniform float swayBend;',
    moves: `#ifdef USE_INSTANCING
  {
    mat3 stand = mat3(instanceMatrix);
    vec2 root = instanceMatrix[3].xz;
    float gust = sin(swayClock * 0.13 + root.x * 0.21 + root.y * 0.17) + 0.45 * sin(swayClock * 0.31 + root.x * 0.9 - root.y * 0.6);
    vec3 push = vec3(0.8, 0.0, 0.6) * (gust * swayBend * transformed.y * transformed.y);
    vec3 grown = max(vec3(dot(stand[0], stand[0]), dot(stand[1], stand[1]), dot(stand[2], stand[2])), 1e-6);
    transformed += (transpose(stand) * push) / grown;
  }
#endif`,
  };
}

/** The material that draws the shadow of a mesh that moves as `motion` says, so the shadow moves with it. */
export function movedShadow(motion: Motion): MeshDepthMaterial {
  return moved(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }), motion);
}

/**
 * A flat-shaded material that draws the blend of the four `SEASON_COLORS`
 * attributes of its geometry. `mix` holds the weight of each season, and
 * `motion` moves the mesh.
 */
export function seasonalMaterial(
  mix: IUniform<Vector4>,
  parameters: MeshLambertMaterialParameters = {},
  motion?: Motion,
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true, ...parameters });
  const blend: Material['onBeforeCompile'] = (shader) => {
    shader.uniforms.seasonMix = mix;
    shader.vertexShader = blendSeasons(shader.vertexShader);
  };
  if (motion) return moved(material, motion, blend);
  material.onBeforeCompile = blend;
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
