import { type PerspectiveCamera, Vector3 } from 'three';
import { arrived } from '../sim/building';
import { BUILDINGS, Building } from '../sim/buildings';
import { Good } from '../sim/goods';
import type { TileMap } from '../sim/map';
import { MAX_SITES, type Orders, SiteState } from '../sim/orders';
import type { SimFrame } from '../frame';
import './sites.css';

/** The label hangs this far above the highest of a site's nine tiles, clear of the frame at its full height. */
const ANCHOR_HEIGHT = 2.8;

const SHOWN: readonly { readonly good: Good; readonly label: string }[] = [
  { good: Good.Log, label: 'Logs' },
  { good: Good.Stone, label: 'Stone' },
];

export interface SiteProgress {
  /** Units arrived of each good in `SHOWN` order. */
  readonly arrived: readonly number[];
  /** Whole percent of the building work done, or null while the site still waits for a unit. */
  readonly percent: number | null;
}

/** What has arrived at a site and how far its building work is, from the main thread's copy of the map and the orders. */
export function siteProgress(map: TileMap, orders: Orders, slot: number): SiteProgress {
  const units = SHOWN.map(({ good }) => arrived(map, orders, slot, good));
  const supplied = SHOWN.every(({ good }, index) => units[index]! >= BUILDINGS[Building.House].needs[good - 1]!);
  const percent = supplied ? Math.floor((orders.sites.work[slot]! * 100) / BUILDINGS[Building.House].workTicks) : null;
  return { arrived: units, percent };
}

interface Label {
  readonly node: HTMLElement;
  readonly anchor: Vector3;
  readonly values: readonly HTMLElement[];
  readonly bar: HTMLElement;
  readonly fill: HTMLElement;
  readonly percent: HTMLElement;
  readonly waiting: HTMLElement;
}

function createLabel(map: TileMap, orders: Orders, slot: number): Label {
  const node = document.createElement('section');
  node.className = 'site-label';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-label', 'House site');
  const list = document.createElement('dl');
  const values = SHOWN.map(({ good, label }) => {
    const name = document.createElement('dt');
    name.textContent = label;
    const value = document.createElement('dd');
    value.dataset.needs = String(BUILDINGS[Building.House].needs[good - 1]);
    list.append(name, value);
    return value;
  });
  const work = document.createElement('p');
  work.className = 'site-work';
  const bar = document.createElement('span');
  bar.className = 'site-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Building work');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('span');
  bar.append(fill);
  const percent = document.createElement('span');
  percent.className = 'site-percent';
  const waiting = document.createElement('span');
  waiting.textContent = 'Waiting for materials';
  work.append(bar, percent, waiting);
  node.append(list, work);

  const { size, sites } = orders;
  const cx = sites.x[slot]!;
  const cy = sites.y[slot]!;
  let highest = -Infinity;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) highest = Math.max(highest, map.heights[y * size + x]!);
  }
  const anchor = new Vector3(cx + 0.5 - size / 2, highest + ANCHOR_HEIGHT, cy + 0.5 - size / 2);
  return { node, anchor, values, bar, fill, percent, waiting };
}

const setText = (node: HTMLElement, text: string) => {
  if (node.textContent !== text) node.textContent = text;
};

function showProgress(label: Label, { arrived: units, percent }: SiteProgress): void {
  label.values.forEach((value, index) => setText(value, `${units[index]}/${value.dataset.needs}`));
  const supplied = percent !== null;
  label.bar.hidden = !supplied;
  label.percent.hidden = !supplied;
  label.waiting.hidden = supplied;
  if (!supplied) return;
  setText(label.percent, `${percent}%`);
  label.bar.setAttribute('aria-valuenow', String(percent));
  label.fill.style.width = `${percent}%`;
}

/**
 * A label over each unfinished house site: the logs and the stone that have
 * arrived of what the house needs, and the building work as a bar, or that the
 * site waits for materials. Each label keeps its pixel size at every zoom and
 * follows its site across the screen.
 */
export function mountSiteLabels(root: HTMLElement, map: TileMap, orders: Orders, camera: PerspectiveCamera) {
  const layer = document.createElement('div');
  layer.className = 'site-labels';
  root.prepend(layer);
  const labels = new Map<number, Label>();
  const projected = new Vector3();

  const show = () => {
    for (let slot = 0; slot < MAX_SITES; slot++) {
      let label = labels.get(slot);
      if (orders.sites.state[slot] !== SiteState.Site) {
        if (!label) continue;
        label.node.remove();
        labels.delete(slot);
        continue;
      }
      if (!label) {
        label = createLabel(map, orders, slot);
        labels.set(slot, label);
        layer.append(label.node);
      }
      showProgress(label, siteProgress(map, orders, slot));
    }
  };

  return {
    /** Takes in a frame from the worker, after the world has applied its tile and order changes. */
    heard(data: SimFrame) {
      if (data.tiles.length > 0 || data.orders.sites.length > 0) show();
    },
    /** Moves each label over its site. Call once a frame, after the scene has rendered, so that the camera's matrices are current. */
    follow() {
      const width = layer.clientWidth;
      const height = layer.clientHeight;
      for (const label of labels.values()) {
        projected.copy(label.anchor).project(camera);
        const onScreen = Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1;
        label.node.hidden = !onScreen;
        if (!onScreen) continue;
        const x = ((projected.x + 1) / 2) * width;
        const y = ((1 - projected.y) / 2) * height;
        label.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    },
  };
}
