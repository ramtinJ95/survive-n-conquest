import { describe, expect, it } from 'vitest';
import { campTile, underCamp } from '../sim/camp';
import { generateMap } from '../sim/mapgen';
import { CAMP_LAYOUT } from './camp';

describe('the camp', () => {
  it('stands every tent, the fire, and the stores on a tile that takes no order', () => {
    const map = generateMap(7, 96);
    const camp = campTile(map);
    const x = (camp % map.size) + 0.5;
    const y = Math.floor(camp / map.size) + 0.5;
    for (const part of CAMP_LAYOUT) {
      const tile = Math.floor(y + part.z) * map.size + Math.floor(x + part.x);
      expect(underCamp(map, camp, tile), `${part.shape} at ${part.x.toFixed(2)}, ${part.z.toFixed(2)}`).toBe(true);
    }
  });
});
