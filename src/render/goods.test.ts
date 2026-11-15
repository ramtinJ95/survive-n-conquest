import { type InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Good } from '../sim/goods';
import { generateMap } from '../sim/mapgen';
import { createGoods } from './goods';

const SIZE = 64;

/** The tile under each instance that is drawn, one entry per instance. */
function drawnTiles(mesh: InstancedMesh): number[] {
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const tiles: number[] = [];
  for (let instance = 0; instance < mesh.count; instance++) {
    mesh.getMatrixAt(instance, matrix);
    if (scale.setFromMatrixScale(matrix).x === 0) continue;
    position.setFromMatrixPosition(matrix);
    tiles.push(Math.floor(position.z + SIZE / 2) * SIZE + Math.floor(position.x + SIZE / 2));
  }
  return tiles.sort((a, b) => a - b);
}

const pile = (goods: ReturnType<typeof createGoods>, name: string) => goods.group.getObjectByName(name) as InstancedMesh;

describe('goods on the ground', () => {
  it('draws one log or stone for each unit of a stack, on its tile, and nothing once the stack is gone', () => {
    const map = generateMap(7, SIZE);
    const goods = createGoods(map);
    map.stackGood[100] = Good.Log;
    map.stackSize[100] = 2;
    map.stackGood[200] = Good.Stone;
    map.stackSize[200] = 8;
    goods.refresh(100);
    goods.refresh(200);
    expect(drawnTiles(pile(goods, 'logs'))).toEqual([100, 100]);
    expect(drawnTiles(pile(goods, 'stone'))).toEqual(Array(8).fill(200));

    map.stackSize[200] = 3;
    goods.refresh(200);
    expect(drawnTiles(pile(goods, 'stone'))).toEqual(Array(3).fill(200));
    map.stackGood[100] = Good.None;
    map.stackSize[100] = 0;
    goods.refresh(100);
    expect(drawnTiles(pile(goods, 'logs'))).toEqual([]);
  });

  it('keeps every stack when more tiles hold goods than its first mesh has room for', () => {
    const map = generateMap(7, SIZE);
    const goods = createGoods(map);
    const tiles = Array.from({ length: 600 }, (_, i) => i * 3);
    for (const tile of tiles) {
      map.stackGood[tile] = Good.Stone;
      map.stackSize[tile] = 1;
      goods.refresh(tile);
    }
    expect(goods.group.children.filter((child) => child.name === 'stone')).toHaveLength(1);
    expect(drawnTiles(pile(goods, 'stone'))).toEqual(tiles);
  });
});
