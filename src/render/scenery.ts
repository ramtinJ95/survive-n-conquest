import {
  type BufferGeometry,
  Color,
  DoubleSide,
  type IUniform,
  InstancedMesh,
  Matrix4,
  Object3D,
  type Vector3,
  type Vector4,
} from 'three';
import { TileKind, heightAt, type TileMap } from '../sim/map';
import { fractalNoise, hashUnit } from '../sim/noise';
import { type CoverKind, TREE_KINDS, TREE_TOPS, type TreeKind, boulderShape, coverShapes, treeShapes } from './plants';
import { type Motion, goneInWinter, movedShadow, seasonalMaterial, sway } from './seasonal';

const BOULDERS_PER_ROCK_TILE = 0.1;
/** A tree is this many times the size of its shape, at most and at least. */
const GROWTH = { min: 0.85, max: 1.6 };
/** No tree stands taller than this, in meters. */
export const TALLEST_TREE = Math.max(...Object.values(TREE_TOPS)) * GROWTH.max;
/** Pines take over from broadleaf trees between these heights, in meters. */
const PINE_LINE = { from: 2, to: 13 };
/** Groves of one kind of broadleaf tree are about this many meters across. */
const GROVE_SPAN = 24;
/** The name of the mesh of each kind of tree. */
export const TREE_MESHES: Readonly<Record<TreeKind, string>> = { pine: 'pines', oak: 'oaks', blossom: 'blossoms', birch: 'birches' };
/** Meters that the top of a tree swings in the strongest gust, for each meter of its shape's height, squared. */
const TREE_BEND = 0.008;

/** How the small things on open ground are drawn: the name of the mesh, the bend in the wind, whether they cast shadows, and whether they last the winter. */
const COVER: Readonly<Record<CoverKind, { readonly mesh: string; readonly bend: number; readonly shadow: boolean; readonly hardy: boolean }>> = {
  tuft: { mesh: 'grass tufts', bend: 0.5, shadow: false, hardy: true },
  flowers: { mesh: 'flowers', bend: 0.6, shadow: false, hardy: false },
  bush: { mesh: 'bushes', bend: 0.04, shadow: true, hardy: true },
  pebbles: { mesh: 'pebbles', bend: 0, shadow: false, hardy: true },
  reeds: { mesh: 'reeds', bend: 0.22, shadow: false, hardy: true },
};

/** How a kind of ground cover moves: with the wind, and into the ground for the winter if it is not hardy. */
function coverMotion(kind: CoverKind, clock: IUniform<number>): Motion | undefined {
  const { bend, hardy } = COVER[kind];
  const wind = bend > 0 ? sway(clock, bend) : undefined;
  if (hardy) return wind;
  if (!wind) throw new Error(`${kind} must sway to leave in winter`);
  return goneInWinter(wind);
}
/** No flower is yellow, orange, red, white, or violet: those are the colors of the settlers, the monsters, the stone, and the marks of the orders. */
const PETALS = [0xf48fb1, 0xff8f86, 0x6f8fff, 0xf48fb1].map((hex) => new Color(hex));
/** Nothing grows this close to the middle of the camp, in meters, where the settlers stand at night. */
const CAMP_CLEARING = 4;

interface Placement {
  tile: number;
  x: number;
  y: number;
  z: number;
  turn: number;
  width: number;
  height: number;
  tint: Color;
}

/** What makes a thing on a tile leave when the tile changes. */
type Stands = (map: TileMap, tile: number) => boolean;
const TREE_STANDS: Stands = (map, tile) => map.trees[tile] === 1;
const BOULDER_STANDS: Stands = (map, tile) => map.kinds[tile] === TileKind.Rock;
const COVER_STANDS: Stands = (map, tile) => map.kinds[tile] === TileKind.Grass && map.stackSize[tile] === 0;

/** Where a tile's tree, boulder, or ground cover stands, so that it can leave when the tile changes. */
interface Standing {
  readonly mesh: InstancedMesh;
  readonly instance: number;
  readonly matrix: Matrix4;
  readonly stands: Stands;
}

interface Drawn {
  readonly name: string;
  readonly geometry: BufferGeometry;
  readonly placements: Placement[];
  readonly stands: Stands;
  readonly motion?: Motion;
  readonly shadow: boolean;
  readonly bothSides?: boolean;
}

function instanced(drawn: Drawn, seasonMix: IUniform<Vector4>, standing: Map<number, Standing>): InstancedMesh {
  const { name, geometry, placements, stands, motion, shadow, bothSides } = drawn;
  const mesh = new InstancedMesh(geometry, seasonalMaterial(seasonMix, bothSides ? { side: DoubleSide } : {}, motion), placements.length);
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  if (motion && shadow) mesh.customDepthMaterial = movedShadow(motion);
  const pose = new Object3D();
  placements.forEach((placement, i) => {
    pose.position.set(placement.x, placement.y, placement.z);
    pose.rotation.set(0, placement.turn, 0);
    pose.scale.set(placement.width, placement.height, placement.width);
    pose.updateMatrix();
    mesh.setMatrixAt(i, pose.matrix);
    standing.set(placement.tile, { mesh, instance: i, matrix: pose.matrix.clone(), stands });
    mesh.setColorAt(i, placement.tint);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

const roll = (map: TileMap, salt: number, x: number, y: number) => hashUnit(map.seed ^ salt, x, y);

/** A shade from a roll: darker or lighter, and a little warmer or cooler. */
function shade(light: number, warm: number): Color {
  const value = 0.84 + 0.3 * light;
  const shift = 0.07 * (warm - 0.5);
  return new Color(value * (1 + shift), value, value * (1 - shift));
}

/** Which broadleaf tree grows on a tile. Each kind keeps to its own groves, and a few stray into the others. */
function broadleafOn(map: TileMap, x: number, y: number): TreeKind {
  const grove = fractalNoise(map.seed ^ 0x51ed, x / GROVE_SPAN, y / GROVE_SPAN, 2);
  const stray = roll(map, 11, x, y);
  if (grove > 0.22) return stray < 0.8 ? 'blossom' : 'oak';
  if (grove < -0.26) return stray < 0.75 ? 'birch' : 'oak';
  return stray < 0.05 ? 'blossom' : stray < 0.1 ? 'birch' : 'oak';
}

/** Where the tree on a tile stands, at what size, and of which kind, or null when the tile holds no tree. */
function treeOn(map: TileMap, tile: number): (Placement & { kind: TreeKind }) | null {
  if (map.trees[tile] === 0) return null;
  const { size } = map;
  const x = tile % size;
  const y = Math.floor(tile / size);
  const px = x + 0.1 + 0.8 * roll(map, 1, x, y);
  const py = y + 0.1 + 0.8 * roll(map, 2, x, y);
  const ground = heightAt(map, px, py);
  const grown = GROWTH.min + (GROWTH.max - GROWTH.min) * roll(map, 6, x, y);
  const pineShare = (ground - PINE_LINE.from) / (PINE_LINE.to - PINE_LINE.from);
  return {
    tile,
    x: px - size / 2,
    y: ground - 0.1,
    z: py - size / 2,
    turn: roll(map, 3, x, y) * Math.PI * 2,
    width: grown * (0.85 + 0.3 * roll(map, 8, x, y)),
    height: grown,
    tint: shade(roll(map, 4, x, y), roll(map, 12, x, y)),
    kind: roll(map, 7, x, y) < pineShare ? 'pine' : broadleafOn(map, x, y),
  };
}

/** Writes the world position of the top of the tree on a tile into `out`, or returns null when the tile holds no tree. */
export function treeTop(map: TileMap, tile: number, out: Vector3): Vector3 | null {
  const tree = treeOn(map, tile);
  return tree && out.set(tree.x, tree.y + tree.height * TREE_TOPS[tree.kind], tree.z);
}

/** What grows or lies on an open tile, or null for bare grass. Shores grow reeds, forest edges bushes, and rock sheds pebbles. */
function coverOn(map: TileMap, x: number, y: number): CoverKind | null {
  const { size, kinds } = map;
  let forest = false;
  let rock = false;
  let water = false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const kind = kinds[ny * size + nx];
    forest ||= kind === TileKind.Forest;
    rock ||= kind === TileKind.Rock;
    water ||= kind === TileKind.Water;
  }
  const chance = roll(map, 21, x, y);
  if (water) return chance < 0.4 ? 'reeds' : null;
  if (chance < (forest ? 0.14 : 0.012)) return 'bush';
  if (chance > (rock ? 0.72 : 0.992)) return 'pebbles';
  const bloom = fractalNoise(map.seed ^ 0x7f10, x / 14, y / 14, 2);
  if (bloom > 0.18 && roll(map, 22, x, y) < 0.42) return 'flowers';
  return roll(map, 23, x, y) < 0.34 ? 'tuft' : null;
}

/**
 * Trees on forest tiles, boulders on rock tiles, and grass, flowers, bushes,
 * pebbles, and reeds on open ground, one instanced mesh for each shape. The
 * seed decides where each one stands, so a map always looks the same.
 * `seasonMix` blends the colors that each shape has in each season, and the
 * plants move in the wind with `clock`, the clock of the game in ticks.
 * Nothing but the trees stands in anyone's way. `refresh` hides a tile's tree
 * once the map holds no tree there, its boulder once the tile is no longer
 * rock, and its ground cover once the tile is no longer grass or holds goods.
 */
export function createScenery(map: TileMap, seasonMix: IUniform<Vector4>, clock: IUniform<number>, camp: number) {
  const { size, kinds } = map;
  const half = size / 2;
  const trees = Object.fromEntries(TREE_KINDS.map((kind) => [kind, [] as Placement[]])) as Record<TreeKind, Placement[]>;
  const cover = Object.fromEntries(Object.keys(COVER).map((kind) => [kind, [] as Placement[]])) as Record<CoverKind, Placement[]>;
  const boulders: Placement[] = [];
  const campX = (camp % size) + 0.5;
  const campY = Math.floor(camp / size) + 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tile = y * size + x;
      const kind = kinds[tile];
      if (kind === TileKind.Forest) {
        const tree = treeOn(map, tile);
        if (tree) trees[tree.kind].push(tree);
        continue;
      }
      const px = x + 0.1 + 0.8 * roll(map, 1, x, y);
      const py = y + 0.1 + 0.8 * roll(map, 2, x, y);
      const turn = roll(map, 3, x, y) * Math.PI * 2;
      if (kind === TileKind.Rock && roll(map, 5, x, y) < BOULDERS_PER_ROCK_TILE) {
        const girth = 0.6 + 1.1 * roll(map, 6, x, y);
        boulders.push({
          tile,
          x: px - half,
          y: heightAt(map, px, py) + 0.1 * girth,
          z: py - half,
          turn,
          width: girth,
          height: girth * (0.55 + 0.4 * roll(map, 8, x, y)),
          tint: shade(roll(map, 4, x, y), 0.5),
        });
      } else if (kind === TileKind.Grass && Math.hypot(x + 0.5 - campX, y + 0.5 - campY) > CAMP_CLEARING) {
        const grows = coverOn(map, x, y);
        if (!grows) continue;
        const grown = 0.7 + 0.8 * roll(map, 6, x, y);
        cover[grows].push({
          tile,
          x: px - half,
          y: heightAt(map, px, py) - 0.03,
          z: py - half,
          turn,
          width: grown,
          height: grown * (0.8 + 0.4 * roll(map, 8, x, y)),
          tint: grows === 'flowers' ? PETALS[Math.floor(roll(map, 24, x, y) * PETALS.length)]! : shade(roll(map, 4, x, y), roll(map, 12, x, y)),
        });
      }
    }
  }

  const standing = new Map<number, Standing>();
  const wind = sway(clock, TREE_BEND);
  const treeGeometry = treeShapes();
  const coverGeometry = coverShapes();
  const meshes = [
    ...TREE_KINDS.map((kind) =>
      instanced({ name: TREE_MESHES[kind], geometry: treeGeometry[kind], placements: trees[kind], stands: TREE_STANDS, motion: wind, shadow: true }, seasonMix, standing),
    ),
    instanced({ name: 'boulders', geometry: boulderShape(), placements: boulders, stands: BOULDER_STANDS, shadow: true }, seasonMix, standing),
    ...(Object.keys(COVER) as CoverKind[]).map((kind) =>
      instanced(
        {
          name: COVER[kind].mesh,
          geometry: coverGeometry[kind],
          placements: cover[kind],
          stands: COVER_STANDS,
          motion: coverMotion(kind, clock),
          shadow: COVER[kind].shadow,
          bothSides: true,
        },
        seasonMix,
        standing,
      ),
    ),
  ];
  const hidden = new Matrix4().makeScale(0, 0, 0);

  const refresh = (tile: number) => {
    const found = standing.get(tile);
    if (!found) return;
    const { mesh, instance, matrix, stands } = found;
    mesh.setMatrixAt(instance, stands(map, tile) ? matrix : hidden);
    mesh.instanceMatrix.needsUpdate = true;
  };

  return { meshes, refresh };
}
