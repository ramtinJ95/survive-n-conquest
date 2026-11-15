import { ConeGeometry, CylinderGeometry, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAMP_RADIUS } from '../sim/camp';
import { heightAt, type TileMap } from '../sim/map';
import { type ShapeName, type Shapes, colored, shapeMaterial } from './shapes';

/** The camp floor is a disc of the map's own soil, as wide as the land the camp keeps free of orders, and this thick. */
const FLOOR = { color: 0x86623f, radius: CAMP_RADIUS + 0.5, thickness: 0.3 };

/**
 * What stands on the camp floor: meters east and south of the camp center, and
 * the turn in radians. The fire burns where the settlers gather for the night,
 * and each tent stands behind a gap between two of their spots, door to the fire.
 */
const LAYOUT: readonly { readonly shape: ShapeName; readonly x: number; readonly z: number; readonly turn: number }[] = [
  { shape: 'fire', x: 0, z: 0, turn: 0 },
  { shape: 'pot', x: 0, z: 0, turn: 0.6 },
  ...[1.38, 3.77, 5.25].map((angle) => ({
    shape: 'tent' as const,
    x: Math.cos(angle) * 1.9,
    z: Math.sin(angle) * 1.9,
    turn: -angle,
  })),
];

/** The flame is the one thing in the settlement that the sun does not light, so the camp shows in the dark. */
const FLAME = { outer: 0xff7a1a, inner: 0xffd35a, radius: 0.2, height: 0.5, base: 0.08, flicker: 0.9, sway: 0.18 };

function flameGeometry() {
  const { outer, inner, radius, height } = FLAME;
  return mergeGeometries([
    colored(new ConeGeometry(radius, height, 5).translate(0, height / 2, 0), outer),
    colored(new ConeGeometry(radius * 0.55, height * 0.7, 5).translate(0, height * 0.35 + 0.02, radius * 0.5), inner),
    colored(new ConeGeometry(radius * 0.55, height * 0.7, 5).translate(0, height * 0.35 + 0.02, -radius * 0.5), inner),
  ]);
}

/**
 * The camp on its tile: the floor, the fire with the pot over it, and the
 * tents as one mesh, and the flame of the fire. `show` moves the flame with
 * the tick, so it holds still while the clock is paused.
 */
export function createCamp(map: TileMap, tile: number, shapes: Shapes) {
  const x = (tile % map.size) + 0.5;
  const y = Math.floor(tile / map.size) + 0.5;
  const placed = new Matrix4();
  const camp = new Mesh(
    mergeGeometries([
      colored(new CylinderGeometry(FLOOR.radius, FLOOR.radius, FLOOR.thickness, 16), FLOOR.color),
      ...LAYOUT.map(({ shape, x, z, turn }) =>
        shapes[shape].clone().applyMatrix4(placed.makeRotationY(turn).setPosition(x, FLOOR.thickness / 2, z)),
      ),
    ]),
    shapeMaterial(),
  );
  camp.name = 'camp';
  camp.position.set(x - map.size / 2, heightAt(map, x, y), y - map.size / 2);
  camp.castShadow = true;
  camp.receiveShadow = true;

  const flame = new Mesh(flameGeometry(), new MeshBasicMaterial({ vertexColors: true }));
  flame.name = 'flame';
  flame.position.set(0, FLOOR.thickness / 2 + FLAME.base, 0);
  camp.add(flame);

  const show = (tick: number) => {
    const beat = Math.sin(tick * FLAME.flicker);
    flame.scale.set(1 - 0.5 * FLAME.sway * beat, 1 + FLAME.sway * beat, 1 - 0.5 * FLAME.sway * beat);
    flame.rotation.y = tick * 0.35;
  };
  show(0);

  return { mesh: camp, show };
}
