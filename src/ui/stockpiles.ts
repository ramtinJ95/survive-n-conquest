import { Good } from '../sim/goods';
import type { TileMap } from '../sim/map';
import { Claim } from '../sim/orders';
import type { SimFrame } from '../worker';
import './stockpiles.css';

const SHOWN: readonly { readonly good: Good; readonly label: string }[] = [
  { good: Good.Log, label: 'Logs' },
  { good: Good.Stone, label: 'Stone' },
];

/** The units of each good on the stockpile tiles of a map. */
export function stockpileTotals(map: TileMap, claims: Uint8Array): Record<Good, number> {
  const totals: Record<Good, number> = { [Good.None]: 0, [Good.Log]: 0, [Good.Stone]: 0 };
  for (let tile = 0; tile < claims.length; tile++) {
    if (claims[tile] === Claim.Stockpile) totals[map.stackGood[tile] as Good] += map.stackSize[tile]!;
  }
  return totals;
}

/** The panel that shows how much of each good the stockpiles hold, from the main thread's copy of the map and the claims. */
export function mountStockpiles(root: HTMLElement, map: TileMap, claims: Uint8Array) {
  const panel = document.createElement('section');
  panel.className = 'stockpiles';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-label', 'Stockpiles');
  const title = document.createElement('p');
  title.className = 'stockpiles-title';
  title.textContent = 'Stockpiles';
  const list = document.createElement('dl');
  const values = SHOWN.map(({ label }) => {
    const name = document.createElement('dt');
    name.textContent = label;
    const value = document.createElement('dd');
    list.append(name, value);
    return value;
  });
  panel.append(title, list);
  root.append(panel);

  const show = () => {
    const totals = stockpileTotals(map, claims);
    SHOWN.forEach(({ good }, index) => {
      const text = String(totals[good]);
      if (values[index]!.textContent !== text) values[index]!.textContent = text;
    });
  };
  show();

  return {
    /** Takes in a frame from the worker, after the world has applied its tile and order changes. */
    heard(data: SimFrame) {
      if (data.tiles.length > 0 || data.orders.claims.length > 0) show();
    },
  };
}
