import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Object3D,
} from 'three';
import { Good, STACK_LIMIT } from '../sim/goods';
import { heightAt, type TileMap } from '../sim/map';

/** Logs read as pale cut wood and stone as a cool grey, so neither passes for a settler, a monster, rock, or an order mark. */
export const LOG_COLOR = 0xd9b77e;
export const STONE_COLOR = 0xc9d1db;
const FIRST_BLOCKS = 256;

/** One unit of each good, centered on the origin. A log stands along y until it is turned. */
export const logGeometry = () => new CylinderGeometry(0.15, 0.15, 0.9, 6);
export const stoneGeometry = () => new BoxGeometry(0.36, 0.36, 0.36);

interface Pile {
  mesh: InstancedMesh;
  /** The first of the `STACK_LIMIT` instances that each tile with this good owns, by tile. */
  readonly blocks: Map<number, number>;
  readonly free: number[];
  /** Where unit `i` of a stack lies on its tile, relative to the tile center on the ground. */
  readonly place: (unit: number, pose: Object3D) => void;
}

function pileMesh(name: string, geometry: BufferGeometry, material: MeshLambertMaterial, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  return mesh;
}

function createPile(name: string, geometry: BufferGeometry, color: number, place: Pile['place']): Pile {
  const material = new MeshLambertMaterial({ color, flatShading: true });
  return { mesh: pileMesh(name, geometry, material, FIRST_BLOCKS * STACK_LIMIT), blocks: new Map(), free: [], place };
}

const placeLog = (unit: number, pose: Object3D) => {
  const layer = Math.floor(unit / 2);
  const side = unit % 2 === 0 ? -0.18 : 0.18;
  const across = layer % 2 === 1;
  pose.position.set(across ? side : 0, 0.15 + layer * 0.28, across ? 0 : side);
  pose.rotation.set(across ? Math.PI / 2 : 0, 0, across ? 0 : Math.PI / 2);
};

const placeStone = (unit: number, pose: Object3D) => {
  const layer = Math.floor(unit / 4);
  const corner = unit % 4;
  pose.position.set(corner % 2 === 0 ? -0.2 : 0.2, 0.18 + layer * 0.36, corner < 2 ? -0.2 : 0.2);
  pose.rotation.set(0, (unit * 0.7) % 1, 0);
};

/**
 * Draws the goods on the ground as readable primitives: up to 8 logs or 8
 * stones on a tile, one instance each. Each tile that holds goods owns a block
 * of 8 instances of its good's mesh, and `refresh` rewrites that block from the
 * map's stack. A mesh that runs out of blocks is replaced by one twice its size
 * inside `group`.
 */
export function createGoods(map: TileMap) {
  const half = map.size / 2;
  const piles: Partial<Record<Good, Pile>> = {
    [Good.Log]: createPile('logs', logGeometry(), LOG_COLOR, placeLog),
    [Good.Stone]: createPile('stone', stoneGeometry(), STONE_COLOR, placeStone),
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
    const mesh = pileMesh(old.name, old.geometry, old.material as MeshLambertMaterial, old.instanceMatrix.count * 2);
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
    const pile = piles[good];
    if (!pile || size === 0) return;
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
