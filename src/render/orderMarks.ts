import {
  BackSide,
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Color,
  DataTexture,
  InstancedMesh,
  type Material,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  OctahedronGeometry,
  RGBAFormat,
  type Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { TileMap } from '../sim/map';
import { NOT_CUT, NOT_SOWN, RIPE_DAWNS, bareAgainDay } from '../sim/fields';
import { dawnDayAt } from '../sim/daylight';
import { Claim, type Orders, SiteState } from '../sim/orders';

/**
 * What the pointer would do to a tile, drawn over the marks it has. `Mark` and
 * `Remove` preview a drag, the other three preview a building site.
 */
export const Preview = { None: 0, Mark: 1, Remove: 2, Fits: 3, Blocks: 4, Refused: 5 } as const;
export type Preview = (typeof Preview)[keyof typeof Preview];

/** Every kind of site is marked in one color, and the tools that place them share it. */
const SITE = '#5aa8ff';

/** The color of each order, on the map and on its button. */
export const ORDER_COLORS = {
  chop: '#ff7a1a',
  quarry: '#c77dff',
  stockpile: '#2fd6c4',
  house: SITE,
  hut: SITE,
  barn: SITE,
  lodge: SITE,
  woodshed: SITE,
  tailor: SITE,
  farm: SITE,
  field: '#ffe14d',
  cancel: '#ff4d8d',
  fits: '#7dff8a',
} as const;

const CLAIM_COLORS: Record<Claim, string> = {
  [Claim.None]: '#000000',
  [Claim.Chop]: ORDER_COLORS.chop,
  [Claim.Quarry]: ORDER_COLORS.quarry,
  [Claim.Stockpile]: ORDER_COLORS.stockpile,
  [Claim.Site]: SITE,
  [Claim.Field]: ORDER_COLORS.field,
};

/**
 * A field tile is drawn as tilled soil inside its outline. A sown one adds rows of green shoots across it, with a
 * shadow on the soil that grows by `shadowPerDawn` of a row's third at each dawn. A ripe tile bears wide golden rows,
 * and a cut one thin rows of pale stubble.
 */
const FIELD_LOOK = {
  soil: '#6b4a2b',
  shoots: '#a6d64a',
  shadow: '#3f2a16',
  ripe: '#f0b429',
  stubble: '#d9c58a',
  soilShare: 0.75,
  rows: 3,
  rowWidth: 0.4,
  shadowPerDawn: 0.1,
  ripeWidth: 0.6,
  ripeShadow: 0.3,
  stubbleWidth: 0.15,
};

const PREVIEW_COLORS: Record<Preview, string> = {
  [Preview.None]: '#000000',
  [Preview.Mark]: '#ffffff',
  [Preview.Remove]: ORDER_COLORS.cancel,
  [Preview.Fits]: ORDER_COLORS.fits,
  [Preview.Blocks]: ORDER_COLORS.cancel,
  [Preview.Refused]: '#ff9d8a',
};

/** The crop texture stores a day index one up, so that 0 means no crop. */
const CROP_DAY_OFFSET = 1;

const linear = (hex: string) => new Color(hex);

const VERTEX_DECLARED = 'varying vec2 vTile;\nuniform float ordersSize;';
const VERTEX_TILE = 'vTile = transformed.xz + vec2(ordersSize * 0.5);';

const FRAGMENT_DECLARED = /* glsl */ `
varying vec2 vTile;
uniform float ordersSize;
uniform sampler2D ordersMap;
uniform vec3 claimColors[${Object.keys(CLAIM_COLORS).length}];
uniform vec3 previewColors[${Object.keys(PREVIEW_COLORS).length}];
uniform vec4 ordersArea;
uniform vec3 ordersAreaColor;
uniform vec3 fieldSoil;
uniform vec3 fieldShoots;
uniform vec3 fieldShadow;
uniform vec3 fieldRipe;
uniform vec3 fieldStubble;
uniform sampler2D cropMap;
uniform float cropDay;

float twoBytes(float low, float high) {
  return floor(low * 255.0 + 0.5) + 256.0 * floor(high * 255.0 + 0.5);
}

void drawCrop(inout vec3 color, ivec2 tile, vec2 inTile) {
  vec4 crop = texelFetch(cropMap, tile, 0);
  float sown = twoBytes(crop.r, crop.g);
  float bare = twoBytes(crop.b, crop.a);
  float row = fract(inTile.x * ${FIELD_LOOK.rows.toFixed(1)});
  if (bare > 0.0) {
    if (cropDay < bare && row >= 1.0 - ${FIELD_LOOK.stubbleWidth.toFixed(2)}) color = linearToOutputTexel(vec4(fieldStubble, 1.0)).rgb;
    return;
  }
  if (sown == 0.0) return;
  float grown = clamp(cropDay - (sown - ${CROP_DAY_OFFSET.toFixed(1)}), 0.0, ${RIPE_DAWNS.toFixed(1)});
  bool ripe = grown >= ${RIPE_DAWNS.toFixed(1)};
  float width = ripe ? ${FIELD_LOOK.ripeWidth.toFixed(2)} : ${FIELD_LOOK.rowWidth.toFixed(2)};
  float shadow = ripe ? ${FIELD_LOOK.ripeShadow.toFixed(2)} : grown * ${FIELD_LOOK.shadowPerDawn.toFixed(2)};
  if (row >= 1.0 - width) color = linearToOutputTexel(vec4(ripe ? fieldRipe : fieldShoots, 1.0)).rgb;
  else if (row < shadow) color = linearToOutputTexel(vec4(fieldShadow, 1.0)).rgb;
}

int orderKey(ivec2 tile) {
  int size = int(ordersSize);
  if (tile.x < 0 || tile.y < 0 || tile.x >= size || tile.y >= size) return 0;
  vec4 texel = texelFetch(ordersMap, tile, 0);
  int claim = int(texel.r * 255.0 + 0.5);
  int preview = int(texel.g * 255.0 + 0.5);
  return preview > 0 ? 8 + preview : claim;
}

vec3 orderColor(int key) {
  return linearToOutputTexel(vec4(key >= 8 ? previewColors[key - 8] : claimColors[key], 1.0)).rgb;
}

// The marks are drawn after the light and the fog, so they keep their color at night, on snow, and at the farthest view.
void drawOrders(inout vec3 color) {
  ivec2 tile = ivec2(floor(vTile));
  vec2 inTile = fract(vTile);
  vec2 perPixel = fwidth(vTile);
  float line = clamp(1.6 * max(perPixel.x, perPixel.y), 0.07, 0.3);
  int key = orderKey(tile);
  if (key != 0) {
    float bright = 0.0;
    float dark = 0.0;
    vec4 toEdge = vec4(inTile.x, 1.0 - inTile.x, inTile.y, 1.0 - inTile.y);
    bvec4 open = bvec4(
      orderKey(tile + ivec2(-1, 0)) != key,
      orderKey(tile + ivec2(1, 0)) != key,
      orderKey(tile + ivec2(0, -1)) != key,
      orderKey(tile + ivec2(0, 1)) != key);
    for (int side = 0; side < 4; side++) {
      if (!open[side]) continue;
      bright = max(bright, step(toEdge[side], line));
      dark = max(dark, step(toEdge[side], 2.0 * line));
    }
    vec3 tint = orderColor(key);
    if (key == ${Claim.Field}) {
      color = mix(color, linearToOutputTexel(vec4(fieldSoil, 1.0)).rgb, ${FIELD_LOOK.soilShare.toFixed(2)});
      drawCrop(color, tile, inTile);
    } else {
      color = mix(color, tint, key >= 8 ? 0.82 : 0.45);
    }
    color = mix(color, tint * 0.18, 0.75 * max(dark - bright, 0.0));
    color = mix(color, tint, bright);
  }
  if (ordersArea.z > ordersArea.x) {
    vec2 low = ordersArea.xy;
    vec2 high = ordersArea.zw;
    vec2 outside = max(low - vTile, vTile - high);
    float gap = max(outside.x, outside.y);
    if (gap > -line && gap < 0.0) color = linearToOutputTexel(vec4(ordersAreaColor, 1.0)).rgb;
  }
}
`;

function patchTerrain(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, { value: unknown }>) {
  Object.assign(shader.uniforms, uniforms);
  const vertex = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_DECLARED}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_TILE}`);
  const fragment = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_DECLARED}`)
    .replace('#include <fog_fragment>', '#include <fog_fragment>\ndrawOrders(gl_FragColor.rgb);');
  if (!vertex.includes(VERTEX_TILE) || !fragment.includes('drawOrders(gl_FragColor.rgb);')) {
    throw new Error('three.js changed the terrain shader chunks that the order marks hook into');
  }
  shader.vertexShader = vertex;
  shader.fragmentShader = fragment;
}

/** The ghost of a building the pointer would place: as wide as its footprint, three tiles at its widest, and this tall, in meters. */
const GHOST_SIDE = 3;
const GHOST_HEIGHT = 2.6;
const GHOST_OPACITY = 0.55;
/** A dark copy of the edges, a little larger, keeps the ghost apart from snow and pale marks. */
const GHOST_SHADOW = { scale: 1.06, color: '#1a0d0d' };

/**
 * A see-through building volume over the site under the pointer, drawn over
 * the trees and boulders, so that a site over rock or forest still reads.
 */
function createGhost() {
  const box = new BoxGeometry(GHOST_SIDE, GHOST_HEIGHT, GHOST_SIDE);
  const faces = new MeshBasicMaterial({ transparent: true, opacity: GHOST_OPACITY, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const edges = new LineBasicMaterial({ depthTest: false, fog: false, toneMapped: false });
  const outline = new EdgesGeometry(box);
  const shadow = new LineSegments(outline, new LineBasicMaterial({ color: GHOST_SHADOW.color, depthTest: false, fog: false, toneMapped: false }));
  shadow.scale.setScalar(GHOST_SHADOW.scale);
  const ghost = new Group();
  ghost.name = 'house-ghost';
  ghost.add(shadow, new Mesh(box, faces), new LineSegments(outline, edges));
  ghost.renderOrder = 10;
  ghost.children.forEach((part, order) => {
    part.renderOrder = 10 + order;
  });
  ghost.visible = false;
  return { ghost, faces, edges };
}

const PIN_SIZE = 0.55;
const PIN_FLOAT = 1.1;
const OUTLINE = 1.35;
/** Pins grow with the distance of the view, so that a marked grove still reads at the farthest zoom. */
const PIN_ZOOM = { per: 60, least: 0.8, most: 3.2 };

function pinMaterial(color: string, scale: { value: number }, outline: boolean): Material {
  const material = new MeshBasicMaterial({ color, fog: false, toneMapped: false, ...(outline && { side: BackSide }) });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pinScale = scale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float pinScale;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed *= pinScale${outline ? ` * ${OUTLINE.toFixed(2)}` : ''};`);
  };
  material.customProgramCacheKey = () => `order-pin-${outline}`;
  return material;
}

/**
 * Draws the orders on the map: a tint and an outline on every claimed tile,
 * drawn into the terrain's own shader, and a pin over every tree marked for
 * felling. A field tile is tilled soil, with its crop drawn as it stands at the last dawn. The interface draws its previews through the same layer.
 *
 * `treeTop` gives the top of the tree on a tile, in world coordinates.
 */
export function createOrderMarks(
  map: TileMap,
  terrainMaterial: Material,
  treeTop: (tile: number, out: Vector3) => Vector3 | null,
  zoomTarget: Vector3,
) {
  const { size } = map;
  const texels = new Uint8Array(size * size * 4);
  const texture = new DataTexture(texels, size, size, RGBAFormat);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  const cropTexels = new Uint8Array(size * size * 4);
  const cropTexture = new DataTexture(cropTexels, size, size, RGBAFormat);
  cropTexture.magFilter = NearestFilter;
  cropTexture.minFilter = NearestFilter;
  cropTexture.needsUpdate = true;
  const area = new Vector4(0, 0, -1, -1);
  const areaColor = linear(ORDER_COLORS.chop);
  const previewColors = Object.values(PREVIEW_COLORS).map(linear);
  const uniforms = {
    ordersMap: { value: texture },
    ordersSize: { value: size },
    claimColors: { value: Object.values(CLAIM_COLORS).map(linear) },
    previewColors: { value: previewColors },
    ordersArea: { value: area },
    ordersAreaColor: { value: areaColor },
    fieldSoil: { value: linear(FIELD_LOOK.soil) },
    fieldShoots: { value: linear(FIELD_LOOK.shoots) },
    fieldShadow: { value: linear(FIELD_LOOK.shadow) },
    fieldRipe: { value: linear(FIELD_LOOK.ripe) },
    fieldStubble: { value: linear(FIELD_LOOK.stubble) },
    cropMap: { value: cropTexture },
    cropDay: { value: 0 },
  };
  const before = terrainMaterial.onBeforeCompile;
  terrainMaterial.onBeforeCompile = (shader, renderer) => {
    before.call(terrainMaterial, shader, renderer);
    patchTerrain(shader, uniforms);
  };
  terrainMaterial.customProgramCacheKey = () => 'terrain-with-orders';
  terrainMaterial.needsUpdate = true;

  let trees = 0;
  const { ghost, faces, edges } = createGhost();
  const pose = new Object3D();
  for (let tile = 0; tile < size * size; tile++) if (treeTop(tile, pose.position)) trees++;
  const pinScale = { value: 1 };
  const geometry = new OctahedronGeometry(PIN_SIZE).scale(0.8, 1.5, 0.8);
  const pins = new InstancedMesh(geometry, pinMaterial(ORDER_COLORS.chop, pinScale, false), Math.max(trees, 1));
  const outlines = new InstancedMesh(geometry, pinMaterial('#2a1606', pinScale, true), Math.max(trees, 1));
  outlines.instanceMatrix = pins.instanceMatrix;
  pins.name = 'chop-pins';
  outlines.name = 'chop-pin-outlines';
  for (const mesh of [pins, outlines]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      const zoom = camera.position.distanceTo(zoomTarget) / PIN_ZOOM.per;
      pinScale.value = Math.min(Math.max(zoom, PIN_ZOOM.least), PIN_ZOOM.most);
    };
  }
  const previewed: number[] = [];

  return {
    meshes: [outlines, pins, ghost],

    /** Stands the ghost of a building on a square of tiles from its top left, in green when it fits and red when not, or hides it. */
    showGhost(footprint: { x0: number; y0: number; side: number } | null, fits: boolean) {
      ghost.visible = footprint !== null;
      if (!footprint) return;
      const { x0, y0, side } = footprint;
      let highest = -Infinity;
      for (let y = y0; y < y0 + side; y++) {
        for (let x = x0; x < x0 + side; x++) {
          const tile = Math.min(Math.max(y, 0), size - 1) * size + Math.min(Math.max(x, 0), size - 1);
          highest = Math.max(highest, map.heights[tile]!, 0);
        }
      }
      ghost.scale.set(side / GHOST_SIDE, 1, side / GHOST_SIDE);
      ghost.position.set(x0 + side / 2 - size / 2, highest + GHOST_HEIGHT / 2, y0 + side / 2 - size / 2);
      const color = fits ? ORDER_COLORS.fits : ORDER_COLORS.cancel;
      faces.color.set(color);
      edges.color.set(color);
    },

    /** Copies the claims of every tile into the marks, but none under a finished building, and puts a pin on each tree marked for felling. */
    showOrders(orders: Orders) {
      let count = 0;
      for (let tile = 0; tile < size * size; tile++) {
        const claim = orders.claims[tile]!;
        const built = claim === Claim.Site && orders.sites.state[orders.siteOf[tile]!] === SiteState.Built;
        texels[tile * 4] = built ? Claim.None : claim;
        if (claim === Claim.Chop && treeTop(tile, pose.position)) {
          pose.position.y += PIN_FLOAT;
          pose.updateMatrix();
          pins.setMatrixAt(count++, pose.matrix);
        }
      }
      pins.count = count;
      outlines.count = count;
      pins.instanceMatrix.needsUpdate = true;
      texture.needsUpdate = true;
    },

    /** Draws a field tile's crop from the tick it was sown at and the tick it was cut at, as the simulation stores them. */
    showCrop(tile: number, sownAt: number, cutAt: number) {
      const sown = sownAt === NOT_SOWN ? 0 : dawnDayAt(sownAt) + CROP_DAY_OFFSET;
      const bare = cutAt === NOT_CUT ? 0 : bareAgainDay(cutAt);
      cropTexels[tile * 4] = sown & 0xff;
      cropTexels[tile * 4 + 1] = sown >> 8;
      cropTexels[tile * 4 + 2] = bare & 0xff;
      cropTexels[tile * 4 + 3] = bare >> 8;
      cropTexture.needsUpdate = true;
    },

    /** Grows every crop to the latest dawn at or before `tick`. */
    showCropDay(tick: number) {
      uniforms.cropDay.value = dawnDayAt(tick);
    },

    /** Replaces the preview with `preview` on each of `tiles`. Pass no tiles to clear it. */
    showPreview(tiles: ArrayLike<number>, kinds: ArrayLike<Preview>, markColor: string) {
      for (const tile of previewed) texels[tile * 4 + 1] = Preview.None;
      previewed.length = 0;
      for (let i = 0; i < tiles.length; i++) {
        texels[tiles[i]! * 4 + 1] = kinds[i]!;
        previewed.push(tiles[i]!);
      }
      previewColors[Preview.Mark]!.set(markColor);
      texture.needsUpdate = true;
    },

    /** Outlines a rectangle of tiles, inclusive, or hides the outline when `corners` is null. */
    showArea(corners: { x0: number; y0: number; x1: number; y1: number } | null, color: string) {
      if (!corners) {
        area.set(0, 0, -1, -1);
        return;
      }
      area.set(
        Math.min(corners.x0, corners.x1),
        Math.min(corners.y0, corners.y1),
        Math.max(corners.x0, corners.x1) + 1,
        Math.max(corners.y0, corners.y1) + 1,
      );
      areaColor.set(color);
    },
  };
}

export type OrderMarks = ReturnType<typeof createOrderMarks>;
