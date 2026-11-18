import { describe, expect, it } from 'vitest';
import { Preview } from '../render/orderMarks';
import { Building } from '../sim/buildings';
import { applyOrder, createOrders } from '../sim/orders';
import { at, mapFrom } from '../sim/testMaps';
import { TOOLS, orderFor, outcomeWords, sitePreview } from './orders';

const toolFor = (code: string) => TOOLS.find((tool) => tool.codes.includes(code))!;

/** Open ground with a pond at (12, 2) to (13, 3) and the camp at (14, 14). */
function ground() {
  const rows = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x >= 12 && x <= 13 && y >= 2 && y <= 3 ? '~' : '.')).join(''));
  const map = mapFrom(rows);
  return { map, orders: createOrders(map, at(map, 14, 14)) };
}

describe("the forager's hut tool", () => {
  it('is picked with G, named as a forager\'s hut, and sends a place command for a hut anchored on the tile clicked', () => {
    const hut = toolFor('KeyG');
    expect(hut).toMatchObject({ id: 'hut', label: "Forager's hut", face: 'Hut', key: 'G' });
    expect(hut.hint).toBe("Click to place a forager's hut on 2 by 2 tiles of open, level ground.");
    const tile = { x: 4, y: 5, onMap: true };
    expect(orderFor(hut, tile, tile)).toEqual({ kind: 'place', building: Building.Hut, x: 4, y: 5 });
    expect(orderFor(hut, tile, { x: 0, y: 5, onMap: false })).toBeNull();
    expect(orderFor(toolFor('KeyH'), tile, tile)).toEqual({ kind: 'place', building: Building.House, x: 4, y: 5 });
  });

  it('previews the 2 by 2 tiles right of and below the pointer, and says it fits', () => {
    const { map, orders } = ground();
    const preview = sitePreview(map, orders, Building.Hut, 4, 5);
    expect(preview.footprint).toEqual({ x0: 4, y0: 5, side: 2 });
    expect(preview.tiles).toEqual([at(map, 4, 5), at(map, 5, 5), at(map, 4, 6), at(map, 5, 6)]);
    expect(preview.kinds).toEqual([Preview.Fits, Preview.Fits, Preview.Fits, Preview.Fits]);
    expect(preview).toMatchObject({ line: "Click to place the forager's hut site here.", refused: false });
    expect(sitePreview(map, orders, Building.House, 4, 5)).toMatchObject({ footprint: { x0: 3, y0: 4, side: 3 }, line: 'Click to place the house site here.' });
  });

  it('marks the tiles that refuse a hut and says why in words that name a hut', () => {
    const { map, orders } = ground();
    const wet = sitePreview(map, orders, Building.Hut, 11, 3);
    expect(wet.line).toBe("Cannot build here. A forager's hut cannot stand in water.");
    expect(wet.kinds).toEqual([Preview.Refused, Preview.Blocks, Preview.Refused, Preview.Refused]);
    map.heights[at(map, 5, 6)] = 3;
    expect(sitePreview(map, orders, Building.Hut, 4, 5).line).toBe('Cannot build here. The ground is too steep. Its four tiles may differ by 1.5 m at most.');
    expect(sitePreview(map, orders, Building.House, 4, 5).line).toBe('Cannot build here. The ground is too steep. Its nine tiles may differ by 1.5 m at most.');
  });

  it('names what stands in the way of a building, a house or a hut', () => {
    const { map, orders } = ground();
    expect(applyOrder(map, orders, { kind: 'place', building: Building.House, x: 4, y: 4 })).toMatchObject({ ok: true });
    expect(applyOrder(map, orders, { kind: 'place', building: Building.Hut, x: 8, y: 4 })).toMatchObject({ ok: true });
    expect(sitePreview(map, orders, Building.House, 5, 5).line).toBe('Cannot build here. Another house stands in the way.');
    expect(sitePreview(map, orders, Building.Hut, 5, 5).line).toBe('Cannot build here. A house stands in the way.');
    expect(sitePreview(map, orders, Building.Hut, 7, 4).line).toBe("Cannot build here. Another forager's hut stands in the way.");
    expect(sitePreview(map, orders, Building.House, 7, 9).line).toBe('Click to place the house site here.');
    expect(sitePreview(map, orders, Building.House, 7, 6).line).toBe("Cannot build here. A forager's hut stands in the way.");
  });

  it('says a hut site was placed, and why one was refused where it was aimed', () => {
    const { map, orders } = ground();
    const command = { kind: 'place', building: Building.Hut, x: 4, y: 5 } as const;
    const placed = applyOrder(map, orders, command);
    expect(outcomeWords(map, orders, placed, command)).toBe("Forager's hut site placed.");
    const again = applyOrder(map, orders, command);
    expect(outcomeWords(map, orders, again, command)).toBe("Cannot build here. Another forager's hut stands in the way.");
    const area = { kind: 'markArea', order: 'chop', area: { x0: 0, y0: 0, x1: 1, y1: 1 } } as const;
    expect(outcomeWords(map, orders, applyOrder(map, orders, area), area)).toBe('No unmarked trees stand there.');
  });
});

describe('the woodshed tool', () => {
  it('is picked with K, says what the woodcutter does, places a woodshed site, and says so', () => {
    const shed = toolFor('KeyK');
    expect(shed).toMatchObject({ id: 'woodshed', label: 'Woodshed', key: 'K' });
    expect(shed.hint).toBe('Click to place a woodshed on 2 by 2 tiles of open, level ground. Its woodcutter splits logs into firewood.');
    const tile = { x: 4, y: 5, onMap: true };
    const command = orderFor(shed, tile, tile)!;
    expect(command).toEqual({ kind: 'place', building: Building.Woodshed, x: 4, y: 5 });
    const { map, orders } = ground();
    expect(outcomeWords(map, orders, applyOrder(map, orders, command), command)).toBe('Woodshed site placed.');
    expect(sitePreview(map, orders, Building.Hut, 5, 5).line).toBe('Cannot build here. A woodshed stands in the way.');
  });
});

describe("the tailor's hut tool", () => {
  it("is picked with T, says what the tailor does, places a tailor's hut site, and says so", () => {
    const hut = toolFor('KeyT');
    expect(hut).toMatchObject({ id: 'tailor', label: "Tailor's hut", face: 'Tailor', key: 'T' });
    expect(hut.hint).toBe("Click to place a tailor's hut on 2 by 2 tiles of open, level ground. Its tailor makes clothing from hides.");
    const tile = { x: 4, y: 5, onMap: true };
    const command = orderFor(hut, tile, tile)!;
    expect(command).toEqual({ kind: 'place', building: Building.Tailor, x: 4, y: 5 });
    const { map, orders } = ground();
    expect(outcomeWords(map, orders, applyOrder(map, orders, command), command)).toBe("Tailor's hut site placed.");
    expect(sitePreview(map, orders, Building.Hut, 5, 5).line).toBe("Cannot build here. A tailor's hut stands in the way.");
  });

  it('is the ninth of ten tools, before Cancel, each on its own key', () => {
    expect(TOOLS.map(({ key }) => key)).toEqual(['C', 'M', 'P', 'H', 'G', 'B', 'L', 'K', 'T', 'Del']);
  });
});
