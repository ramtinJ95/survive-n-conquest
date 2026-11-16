import { Job, jobAt } from '../sim/buildings';
import { Good } from '../sim/goods';
import type { TileMap } from '../sim/map';
import { Claim, type Orders } from '../sim/orders';
import { StoreKind, storeKind } from '../sim/stores';
import { VillagerState } from '../sim/villagerState';
import type { SimFrame } from '../frame';
import './stockpiles.css';

const SHOWN: readonly { readonly good: Good; readonly label: string }[] = [
  { good: Good.Log, label: 'Logs' },
  { good: Good.Stone, label: 'Stone' },
];

const FOOD_SHOWN: readonly { readonly kind: StoreKind; readonly label: string }[] = [
  { kind: StoreKind.Common, label: 'Barn and camp food' },
  { kind: StoreKind.Home, label: 'Food in homes' },
];

const JOBS_SHOWN: readonly { readonly label: string }[] = [{ label: 'Settlers with a job' }, { label: 'Settlers with no job' }];

/** The food in the stores of each kind, from the food in each store by store id. */
export function foodTotals(orders: Orders, storeFood: Uint16Array): Record<StoreKind, number> {
  const totals: Record<StoreKind, number> = { [StoreKind.None]: 0, [StoreKind.Common]: 0, [StoreKind.Home]: 0 };
  for (let store = 0; store < storeFood.length; store++) totals[storeKind(orders, store)] += storeFood[store]!;
  return totals;
}

/** How many living settlers hold a job and how many hold none, from each villager's state and workplace. */
export function jobCounts(orders: Orders, states: Uint8Array, workplaces: Int16Array): { readonly withJob: number; readonly withoutJob: number } {
  let withJob = 0;
  let withoutJob = 0;
  for (let id = 0; id < states.length; id++) {
    if (states[id] === VillagerState.Dead) continue;
    if (jobAt(orders.sites, workplaces[id]!) === Job.None) withoutJob++;
    else withJob++;
  }
  return { withJob, withoutJob };
}

/** The units of each good on the stockpile tiles of a map. A stockpile takes no food, so food lying on one is not counted. */
export function stockpileTotals(map: TileMap, claims: Uint8Array): Record<Good, number> {
  const totals: Record<Good, number> = { [Good.None]: 0, [Good.Log]: 0, [Good.Stone]: 0, [Good.Food]: 0 };
  for (let tile = 0; tile < claims.length; tile++) {
    if (claims[tile] === Claim.Stockpile && map.stackGood[tile] !== Good.Food) totals[map.stackGood[tile] as Good] += map.stackSize[tile]!;
  }
  return totals;
}

/**
 * The panel that shows how much of each good the stockpiles hold, from the
 * main thread's copy of the map and the orders. From the newest frame it shows
 * the food in barns and at the camp as one total, the food in homes as another,
 * and the settlers with and without a job.
 */
export function mountStockpiles(root: HTMLElement, map: TileMap, orders: Orders) {
  const panel = document.createElement('section');
  panel.className = 'stockpiles';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-label', 'Stockpiles');
  const title = document.createElement('p');
  title.className = 'stockpiles-title';
  title.textContent = 'Stockpiles';
  const list = document.createElement('dl');
  const row = ({ label }: { readonly label: string }) => {
    const name = document.createElement('dt');
    name.textContent = label;
    const value = document.createElement('dd');
    list.append(name, value);
    return value;
  };
  const values = SHOWN.map(row);
  const foodValues = FOOD_SHOWN.map(row);
  const [withJob, withoutJob] = JOBS_SHOWN.map(row);
  panel.append(title, list);
  root.append(panel);

  const setText = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const show = () => {
    const totals = stockpileTotals(map, orders.claims);
    SHOWN.forEach(({ good }, index) => setText(values[index]!, String(totals[good])));
  };
  show();
  const showFood = (storeFood: Uint16Array) => {
    const totals = foodTotals(orders, storeFood);
    FOOD_SHOWN.forEach(({ kind }, index) => setText(foodValues[index]!, String(totals[kind])));
  };

  const showJobs = ({ states, workplaces }: SimFrame) => {
    const counts = jobCounts(orders, states, workplaces);
    setText(withJob!, String(counts.withJob));
    setText(withoutJob!, String(counts.withoutJob));
  };

  return {
    /** Takes in a frame from the worker, after the world has applied its tile and order changes. */
    heard(data: SimFrame) {
      if (data.tiles.length > 0 || data.orders.claims.length > 0) show();
      showFood(data.storeFood);
      showJobs(data);
    },
  };
}
