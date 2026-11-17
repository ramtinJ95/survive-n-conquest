import { type BufferGeometry, DynamicDrawUsage, Group, InstancedMesh, type Material, Matrix4, Object3D, Vector3 } from 'three';
import { Good, STACK_LIMIT, type Unit } from '../sim/goods';
import { heightAt, type TileMap } from '../sim/map';
import { type Shapes, clothingShape, firewoodShape, foodShape, hideShape, shapeMaterial } from './shapes';

const FIRST_BLOCKS = 256;
/** A unit rests this share of its own height above the unit under it, so a stack settles a little. */
const SETTLED = 0.85;

interface Pile {
  mesh: InstancedMesh;
  /** The first of the `STACK_LIMIT` instances that each tile with this good owns, by tile. */
  readonly blocks: Map<number, number>;
  readonly free: number[];
  /** Where unit `i` of a stack lies on its tile, relative to the tile center on the ground. */
  readonly place: (unit: number, pose: Object3D) => void;
}

function pileMesh(name: string, geometry: BufferGeometry, material: Material, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  return mesh;
}

function createPile(name: string, geometry: BufferGeometry, place: (size: Vector3) => Pile['place']): Pile {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new Vector3());
  return { mesh: pileMesh(name, geometry, shapeMaterial(), FIRST_BLOCKS * STACK_LIMIT), blocks: new Map(), free: [], place: place(size) };
}

const placeLogs = (size: Vector3) => (unit: number, pose: Object3D) => {
  const layer = Math.floor(unit / 2);
  const side = (unit % 2 === 0 ? -0.4 : 0.4) * size.z;
  const across = layer % 2 === 1;
  pose.position.set(across ? side : 0, layer * size.y * SETTLED, across ? 0 : side);
  pose.rotation.set(0, across ? Math.PI / 2 : 0, 0);
};

const placeFood = (size: Vector3) => (unit: number, pose: Object3D) => {
  const layer = Math.floor(unit / 4);
  const corner = unit % 4;
  pose.position.set((corner % 2 === 0 ? -0.55 : 0.55) * size.x, layer * size.y * SETTLED, (corner < 2 ? -0.55 : 0.55) * size.z);
  pose.rotation.set(0, unit * 0.7, 0);
};

const placeStones = (size: Vector3) => (unit: number, pose: Object3D) => {
  const layer = Math.floor(unit / 4);
  const corner = unit % 4;
  const reach = 0.5 * Math.max(size.x, size.z);
  pose.position.set(corner % 2 === 0 ? -reach : reach, layer * size.y * SETTLED, corner < 2 ? -reach : reach);
  pose.rotation.set(0, unit * 2.4, 0);
};

/**
 * Draws the goods on the ground: up to 8 logs, stones, sacks of food, bundles of firewood, hides, or pieces of clothing on a tile, one
 * instance each. Each tile that holds goods owns a block of 8 instances of its
 * good's mesh, and `refresh` rewrites that block from the map's stack. A mesh
 * that runs out of blocks is replaced by one twice its size inside `group`.
 */
export function createGoods(map: TileMap, shapes: Shapes) {
  const half = map.size / 2;
  const piles: Readonly<Record<Unit, Pile>> = {
    [Good.Log]: createPile('logs', shapes.log, placeLogs),
    [Good.Stone]: createPile('stone', shapes.stone, placeStones),
    [Good.Food]: createPile('food', foodShape(), placeFood),
    [Good.Firewood]: createPile('firewood', firewoodShape(), placeFood),
    [Good.Hide]: createPile('hides', hideShape(), placeStones),
    [Good.Clothing]: createPile('clothing', clothingShape(), placeStones),
  };
  const group = new Group();
  group.name = 'goods';
  for (const pile of Object.values(piles)) group.add(pile.mesh);
  const pose = new Object3D();
  const hidden = new Matrix4().makeScale(0, 0, 0);

  const blockFor = (pile: Pile, tile: number): number => {
    const owned = pile.blocks.get(tile);
    if (owned !== undefined) return owned;
    let block = pile.free.pop();
    if (block === undefined) {
      block = pile.mesh.count;
      if (block + STACK_LIMIT > pile.mesh.instanceMatrix.count) grow(pile);
      pile.mesh.count = block + STACK_LIMIT;
    }
    pile.blocks.set(tile, block);
    return block;
  };

  const grow = (pile: Pile) => {
    const old = pile.mesh;
    const mesh = pileMesh(old.name, old.geometry, old.material as Material, old.instanceMatrix.count * 2);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    mesh.count = old.count;
    group.remove(old);
    group.add(mesh);
    old.dispose();
    pile.mesh = mesh;
  };

  const release = (pile: Pile, tile: number) => {
    const block = pile.blocks.get(tile);
    if (block === undefined) return;
    for (let unit = 0; unit < STACK_LIMIT; unit++) pile.mesh.setMatrixAt(block + unit, hidden);
    pile.mesh.instanceMatrix.needsUpdate = true;
    pile.blocks.delete(tile);
    pile.free.push(block);
  };

  /** Draws the stack on a tile as the map holds it now. */
  const refresh = (tile: number) => {
    const good = map.stackGood[tile]! as Good;
    const size = map.stackSize[tile]!;
    for (const [kind, pile] of Object.entries(piles)) {
      if (Number(kind) !== good || size === 0) release(pile, tile);
    }
    if (good === Good.None || size === 0) return;
    const pile = piles[good];
    const block = blockFor(pile, tile);
    const x = (tile % map.size) + 0.5;
    const y = Math.floor(tile / map.size) + 0.5;
    const ground = heightAt(map, x, y);
    for (let unit = 0; unit < STACK_LIMIT; unit++) {
      if (unit >= size) {
        pile.mesh.setMatrixAt(block + unit, hidden);
        continue;
      }
      pile.place(unit, pose);
      pose.position.x += x - half;
      pose.position.y += ground;
      pose.position.z += y - half;
      pose.updateMatrix();
      pile.mesh.setMatrixAt(block + unit, pose.matrix);
    }
    pile.mesh.instanceMatrix.needsUpdate = true;
  };

  return { group, refresh };
}
