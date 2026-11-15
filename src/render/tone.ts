import { CustomToneMapping, ShaderChunk, type WebGLRenderer } from 'three';

const UNMAPPED = 'vec3 CustomToneMapping( vec3 color ) { return color; }';

/**
 * Light above `knee` rolls off toward white and never clips, so sand, snow,
 * and blossom keep their facets under a strong sun. Every color below the
 * knee is drawn as it is, which the night needs: the tone maps that three.js
 * ships also darken the darkest colors.
 */
const ROLLED_OFF = `vec3 CustomToneMapping( vec3 color ) {
	const float knee = 0.74;
	color *= toneMappingExposure;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < knee ) return color;
	float room = 1.0 - knee;
	float rolled = 1.0 - room * room / ( peak + room - knee );
	color *= rolled / peak;
	float paled = 1.0 - 1.0 / ( 0.15 * ( peak - rolled ) + 1.0 );
	return mix( color, vec3( rolled ), paled );
}`;

export function tone(renderer: WebGLRenderer): void {
  if (!ShaderChunk.tonemapping_pars_fragment.includes(ROLLED_OFF)) {
    if (!ShaderChunk.tonemapping_pars_fragment.includes(UNMAPPED)) {
      throw new Error('three.js changed the tone mapping shader that the highlight roll-off replaces');
    }
    ShaderChunk.tonemapping_pars_fragment = ShaderChunk.tonemapping_pars_fragment.replace(UNMAPPED, ROLLED_OFF);
  }
  renderer.toneMapping = CustomToneMapping;
}
