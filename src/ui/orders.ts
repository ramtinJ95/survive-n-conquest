import type { PerspectiveCamera } from 'three';
import { ORDER_COLORS, type OrderMarks, Preview } from '../render/orderMarks';
import { createPicker, type PickedTile } from '../render/pick';
import { BUILDINGS, Building, type BuildingName, footprintStart } from '../sim/buildings';
import type { TileMap } from '../sim/map';
import {
  MAX_SITES,
  MAX_SITE_RISE,
  type AreaOrder,
  type OrderCommand,
  type OrderOutcome,
  type Orders,
  type Refusal,
  areaEffect,
  siteRefusal,
  siteTileProblem,
} from '../sim/orders';
import type { SimFrame } from '../frame';
import { BUILDING_WORDS, capital } from './buildings';
import './orders.css';

interface ToolLook {
  /** The button's accessible name. */
  readonly label: string;
  /** The words on the button, when they are shorter than its name. */
  readonly face?: string;
  /** `event.code` values that pick the tool. The first one is shown on the button. */
  readonly codes: readonly string[];
  readonly key: string;
  readonly hint: string;
  readonly icon: string;
}

/** A tool that marks the tiles a drag covers, or one that places a building with a click. */
export type Tool = (ToolLook & { readonly id: AreaOrder }) | (ToolLook & { readonly id: BuildingName; readonly building: Building });

export const TOOLS: readonly Tool[] = [
  {
    id: 'chop',
    label: 'Chop',
    codes: ['KeyC'],
    key: 'C',
    hint: 'Drag over trees to mark them for felling.',
    icon: '<path d="M6 21 17 5"/><path d="M13 4.5c2-1.8 5-1.3 6.5.8-1.4.4-2.6 1.2-3.3 2.6L13.5 6"/>',
  },
  {
    id: 'quarry',
    label: 'Quarry',
    codes: ['KeyM'],
    key: 'M',
    hint: 'Drag over rock to mark it for quarrying.',
    icon: '<path d="M7 20 15 8"/><path d="M5 8.5C8.5 4.5 15 3.5 20 6.5"/><path d="M11 5.3 13.5 9"/>',
  },
  {
    id: 'stockpile',
    label: 'Stockpile',
    codes: ['KeyP'],
    key: 'P',
    hint: 'Drag over open ground to make a stockpile zone.',
    icon: '<rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="5" width="7" height="7" rx="1"/>',
  },
  {
    id: 'house',
    building: Building.House,
    label: 'House',
    codes: ['KeyH'],
    key: 'H',
    hint: 'Click to place a house site on 3 by 3 tiles of open, level ground.',
    icon: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10.5 20v-5h3v5"/>',
  },
  {
    id: 'hut',
    building: Building.Hut,
    label: "Forager's hut",
    face: 'Hut',
    codes: ['KeyG'],
    key: 'G',
    hint: "Click to place a forager's hut on 2 by 2 tiles of open, level ground.",
    icon: '<path d="M4.5 13h15L12 3.5z"/><path d="M7 13v7h10v-7"/><path d="M10.5 20v-3.5h3V20"/>',
  },
  {
    id: 'barn',
    building: Building.Barn,
    label: 'Barn',
    codes: ['KeyB'],
    key: 'B',
    hint: 'Click to place a barn site on 3 by 3 tiles of open, level ground. A finished barn stores food.',
    icon: '<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9v11h13V9"/><path d="M9 20v-6h6v6"/><path d="m9 14 6 6m0-6-6 6"/>',
  },
  {
    id: 'lodge',
    building: Building.Lodge,
    label: "Hunter's lodge",
    face: 'Lodge',
    codes: ['KeyL'],
    key: 'L',
    hint: "Click to place a hunter's lodge on 2 by 2 tiles of open, level ground. Its hunters hunt deer.",
    icon: '<path d="M4 9.5 20 6v4.5L4 13z"/><path d="M5.5 12.8V20h13v-9.5"/><path d="M10 20v-4h3v4"/>',
  },
  {
    id: 'woodshed',
    building: Building.Woodshed,
    label: 'Woodshed',
    face: 'Shed',
    codes: ['KeyK'],
    key: 'K',
    hint: 'Click to place a woodshed on 2 by 2 tiles of open, level ground. Its woodcutter splits logs into firewood.',
    icon: '<path d="M3.5 7 20.5 9.5"/><path d="M5 7.2V20M19 9.3V20"/><circle cx="9" cy="17.5" r="2"/><circle cx="14" cy="17.5" r="2"/><circle cx="11.5" cy="13.5" r="2"/>',
  },
  {
    id: 'tailor',
    building: Building.Tailor,
    label: "Tailor's hut",
    face: 'Tailor',
    codes: ['KeyT'],
    key: 'T',
    hint: "Click to place a tailor's hut on 2 by 2 tiles of open, level ground. Its tailor makes clothing from hides.",
    icon: '<path d="M8 4 4 7.5l2 3 2-1.2V20h8V9.3l2 1.2 2-3L16 4"/><path d="M10 4a2 2 0 0 0 4 0"/>',
  },
  {
    id: 'field',
    label: 'Field',
    codes: ['KeyI'],
    key: 'I',
    hint: 'Drag over grass to mark a field. Farmers sow it in spring.',
    icon: '<path d="M4 18h16"/><path d="M6 18v-5M10 18v-6M14 18v-6M18 18v-5"/><path d="M6 13c0-2 1.5-3 3-3M14 12c0-2 1.5-3 3-3"/>',
  },
  {
    id: 'farm',
    building: Building.Farm,
    label: 'Farm',
    codes: ['KeyO'],
    key: 'O',
    hint: `Click to place a farm on 2 by 2 tiles of open, level ground. Its farmers sow the fields within ${BUILDINGS[Building.Farm].reach} tiles in spring.`,
    icon: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v10h12V10"/><path d="M10.5 20v-4.5h3V20"/><path d="M3 20h18"/>',
  },
  {
    id: 'cancel',
    label: 'Cancel',
    codes: ['Delete', 'Backspace'],
    key: 'Del',
    hint: 'Drag over marks, stockpiles, fields, and building sites to remove them.',
    icon: '<circle cx="12" cy="12" r="8"/><path d="m6.5 17.5 11-11"/>',
  },
];

/** The building a tool places with a click, or null for a tool that marks an area. */
const placing = (tool: Tool | null): Building | null => (tool && 'building' in tool ? tool.building : null);

/** What a refusal says about the building being placed, `noun`, and the kind of building already in its way, if any. */
interface RefusedSite {
  readonly noun: string;
  readonly side: number;
  readonly blocker: Building | null;
}

const TILE_COUNTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const REFUSALS: Readonly<Record<Refusal, (site: RefusedSite) => string>> = {
  'no-trees': () => 'No unmarked trees stand there.',
  'no-rock': () => 'No unmarked rock lies there.',
  'no-open-ground': () => 'No open ground there can join a stockpile.',
  'no-grass': () => 'No unmarked grass free of goods there can join a field.',
  'nothing-to-cancel': () => 'Nothing there to cancel.',
  'off-map': () => 'The site runs off the edge of the map.',
  water: ({ noun }) => `A ${noun} cannot stand in water.`,
  rock: ({ noun }) => `A ${noun} cannot stand on rock. Quarry it first.`,
  trees: () => 'Trees stand in the way. Chop them first.',
  camp: () => 'The camp stands in the way.',
  site: ({ noun, blocker }) => {
    const other = blocker === null ? 'site' : BUILDING_WORDS[blocker].noun;
    return other === noun ? `Another ${noun} stands in the way.` : `${capital(`a ${other}`)} stands in the way.`;
  },
  stockpile: () => 'A stockpile stands in the way.',
  field: () => 'A field lies in the way. Cancel it first.',
  goods: () => 'Goods lie on the site.',
  uneven: ({ side }) => `The ground is too steep. Its ${TILE_COUNTS[side * side] ?? side * side} tiles may differ by ${MAX_SITE_RISE} m at most.`,
  divides: ({ noun }) => `The ${noun} would cut land off from the camp.`,
  full: () => `The map holds ${MAX_SITES} buildings and sites at most.`,
};

/** Refusals that belong to the whole site rather than to some of its tiles. */
const WHOLE_SITE: ReadonlySet<Refusal> = new Set(['off-map', 'uneven', 'divides', 'full']);

/** The kind of the first site or building found on the footprint of a `building` anchored on (x, y), or null. */
function blockerOn(map: TileMap, orders: Orders, building: Building, x: number, y: number): Building | null {
  const { side } = BUILDINGS[building];
  const x0 = footprintStart(x, side);
  const y0 = footprintStart(y, side);
  for (let ty = Math.max(y0, 0); ty < Math.min(y0 + side, map.size); ty++) {
    for (let tx = Math.max(x0, 0); tx < Math.min(x0 + side, map.size); tx++) {
      const slot = orders.siteOf[ty * map.size + tx]!;
      if (slot >= 0) return orders.sites.kind[slot] as Building;
    }
  }
  return null;
}

/** Why a `building` anchored on (x, y) is refused, in words, after `Cannot build here.` */
function refusedWords(map: TileMap, orders: Orders, building: Building, x: number, y: number, refusal: Refusal): string {
  const words = { noun: BUILDING_WORDS[building].noun, side: BUILDINGS[building].side, blocker: blockerOn(map, orders, building, x, y) };
  return `Cannot build here. ${REFUSALS[refusal](words)}`;
}

/** What the preview of a building tool draws on each tile of the footprint under the pointer, and what it says. */
export interface SitePreview {
  readonly footprint: { readonly x0: number; readonly y0: number; readonly side: number };
  readonly tiles: readonly number[];
  readonly kinds: readonly Preview[];
  readonly line: string;
  readonly refused: boolean;
}

/** The preview of a `building` anchored on the tile (x, y), by the simulation's own rules on the main thread's copy of the orders. */
export function sitePreview(map: TileMap, orders: Orders, building: Building, x: number, y: number): SitePreview {
  const { side } = BUILDINGS[building];
  const x0 = footprintStart(x, side);
  const y0 = footprintStart(y, side);
  const refusal = siteRefusal(map, orders, building, x, y);
  const tiles: number[] = [];
  const kinds: Preview[] = [];
  for (let ty = y0; ty < y0 + side; ty++) {
    for (let tx = x0; tx < x0 + side; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.size || ty >= map.size) continue;
      const tile = ty * map.size + tx;
      const problem = siteTileProblem(map, orders, tile);
      tiles.push(tile);
      kinds.push(refusal === null ? Preview.Fits : problem || WHOLE_SITE.has(refusal) ? Preview.Blocks : Preview.Refused);
    }
  }
  const line = refusal ? refusedWords(map, orders, building, x, y, refusal) : `Click to place the ${BUILDING_WORDS[building].noun} site here.`;
  return { footprint: { x0, y0, side }, tiles, kinds, line, refused: refusal !== null };
}

/** The order a press of the main button sends, from the tile it went down on to the tile it came up on, or null when it sends none. */
export function orderFor(tool: Tool, from: PickedTile, to: PickedTile): OrderCommand | null {
  if ('building' in tool) return to.onMap ? { kind: 'place', building: tool.building, x: to.x, y: to.y } : null;
  return { kind: 'markArea', order: tool.id, area: { x0: from.x, y0: from.y, x1: to.x, y1: to.y } };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const DONE: Readonly<Record<OrderOutcome['order'], (tiles: number) => string>> = {
  chop: (tiles) => `${plural(tiles, 'tree', 'trees')} marked for felling.`,
  quarry: (tiles) => `${plural(tiles, 'rock tile', 'rock tiles')} marked for quarrying.`,
  stockpile: (tiles) => `${plural(tiles, 'tile joins', 'tiles join')} the stockpile zone.`,
  house: () => `${BUILDING_WORDS[Building.House].title} site placed.`,
  hut: () => `${BUILDING_WORDS[Building.Hut].title} site placed.`,
  barn: () => `${BUILDING_WORDS[Building.Barn].title} site placed.`,
  lodge: () => `${BUILDING_WORDS[Building.Lodge].title} site placed.`,
  woodshed: () => `${BUILDING_WORDS[Building.Woodshed].title} site placed.`,
  tailor: () => `${BUILDING_WORDS[Building.Tailor].title} site placed.`,
  farm: () => `${BUILDING_WORDS[Building.Farm].title} site placed.`,
  field: (tiles) => `${plural(tiles, 'tile joins', 'tiles join')} the field.`,
  cancel: (tiles) => `Orders removed from ${plural(tiles, 'tile', 'tiles')}.`,
};

/** What the status line says of an order's outcome. A refused place command is read on the orders as they were when it was refused. */
export function outcomeWords(map: TileMap, orders: Orders, result: OrderOutcome, sent: OrderCommand | null): string {
  if (result.ok) return DONE[result.order](result.tiles);
  if (sent?.kind === 'place') return refusedWords(map, orders, sent.building, sent.x, sent.y, result.refusal);
  return REFUSALS[result.refusal]({ noun: 'site', side: 0, blocker: null });
}

const PENDING: Readonly<Record<AreaOrder, (tiles: number) => string>> = {
  chop: (tiles) => `Release to mark ${plural(tiles, 'tree', 'trees')}.`,
  quarry: (tiles) => `Release to mark ${plural(tiles, 'rock tile', 'rock tiles')}.`,
  stockpile: (tiles) => `Release to add ${plural(tiles, 'tile', 'tiles')} to the stockpile.`,
  field: (tiles) => `Release to add ${plural(tiles, 'tile', 'tiles')} to the field.`,
  cancel: (tiles) => `Release to clear ${plural(tiles, 'tile', 'tiles')}.`,
};

const OUTCOME_MS = 3500;

function toolButton(tool: Tool): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'order-tool';
  node.setAttribute('aria-pressed', 'false');
  node.setAttribute('aria-label', tool.label);
  node.setAttribute('aria-keyshortcuts', tool.codes.join(' '));
  node.title = `${tool.label} (${tool.key})`;
  node.style.setProperty('--tool-color', ORDER_COLORS[tool.id]);
  node.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true">${tool.icon}</svg>` +
    `<span class="order-tool-label">${tool.face ?? tool.label}</span><kbd>${tool.key}</kbd>`;
  // A pointer press must not keep focus, or the next Space would press this button again instead of pausing.
  node.addEventListener('mousedown', (event) => event.preventDefault());
  return node;
}

export const ROVING_KEYS: Readonly<Record<string, (at: number, count: number) => number>> = {
  ArrowDown: (at, count) => (at + 1) % count,
  ArrowUp: (at, count) => (at + count - 1) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

/**
 * Makes the toolbar one stop in the Tab order. The arrow keys, Home, and End move
 * between its buttons, and do not reach the camera while they do.
 */
function rove(toolbar: HTMLElement, items: readonly HTMLButtonElement[]) {
  const focus = (next: number) => {
    items.forEach((item, index) => (item.tabIndex = index === next ? 0 : -1));
    items[next]!.focus();
  };
  items.forEach((item, index) => (item.tabIndex = index === 0 ? 0 : -1));
  toolbar.addEventListener('keydown', (event) => {
    const move = ROVING_KEYS[event.code];
    const at = items.indexOf(event.target as HTMLButtonElement);
    if (!move || at < 0) return;
    event.preventDefault();
    event.stopPropagation();
    focus(move(at, items.length));
  });
}

interface Gesture {
  readonly pointer: number;
  readonly tool: Tool;
  readonly from: PickedTile;
  to: PickedTile;
}

/**
 * The orders toolbar, its status line, and the pointer work of each tool. The
 * worker owns the orders, and `orders` is the main thread's copy of them, so
 * that a preview runs the simulation's own rules before the player commits.
 */
export function mountOrders(
  root: HTMLElement,
  worker: Worker,
  {
    map,
    orders,
    canvas,
    camera,
    marks,
  }: { map: TileMap; orders: Orders; canvas: HTMLCanvasElement; camera: PerspectiveCamera; marks: OrderMarks },
) {
  const pick = createPicker(map, camera);
  const toolbar = document.createElement('div');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-orientation', 'vertical');
  toolbar.className = 'orders';
  toolbar.setAttribute('aria-label', 'Orders');
  const status = document.createElement('p');
  status.className = 'order-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Order');
  status.hidden = true;
  const buttons = new Map(TOOLS.map((tool) => [tool.id, toolButton(tool)]));
  toolbar.append(...buttons.values());
  rove(toolbar, [...buttons.values()]);
  root.append(toolbar, status);

  let tool: Tool | null = null;
  let gesture: Gesture | null = null;
  let hovered: PickedTile | null = null;
  /** Where the pointer rests over the map, so that the tile under it follows the camera. */
  let pointerAt: { x: number; y: number } | null = null;
  /** The tile a building was just placed on. Its preview stays hidden until the pointer moves on, so the new site shows. */
  let placed: PickedTile | null = null;
  /** The last order sent, so the status line can say why a building was refused where it was aimed. */
  let sent: OrderCommand | null = null;
  let outcome: { text: string; refused: boolean; until: number } | null = null;
  let outcomeTimer = 0;
  const tiles: number[] = [];
  const kinds: Preview[] = [];

  const say = (text: string, refused = false) => {
    status.hidden = text === '';
    status.textContent = text;
    status.toggleAttribute('data-refused', refused);
  };

  const sameTile = (a: PickedTile | null, b: PickedTile) => a?.x === b.x && a.y === b.y && a.onMap === b.onMap;
  const area = (from: PickedTile, to: PickedTile) => ({ x0: from.x, y0: from.y, x1: to.x, y1: to.y });

  /** Draws what the active tool would do where the pointer is, and says it in the status line. */
  const preview = () => {
    tiles.length = 0;
    kinds.length = 0;
    let line = tool?.hint ?? '';
    let refused = false;
    const drag = gesture && placing(gesture.tool) === null ? gesture : null;
    const color = tool ? ORDER_COLORS[tool.id] : ORDER_COLORS.chop;
    const building = placing(tool);
    const site = building !== null && hovered?.onMap && !sameTile(placed, hovered) ? sitePreview(map, orders, building, hovered.x, hovered.y) : null;
    if (tool && !('building' in tool) && (drag || hovered)) {
      const corners = drag ? area(drag.from, drag.to) : area(hovered!, hovered!);
      const kind = tool.id === 'cancel' ? Preview.Remove : Preview.Mark;
      const count = areaEffect(map, orders, tool.id, corners, (tile) => {
        tiles.push(tile);
        kinds.push(kind);
      });
      if (drag) line = PENDING[tool.id](count);
      marks.showArea(corners, color);
    } else if (site) {
      tiles.push(...site.tiles);
      kinds.push(...site.kinds);
      line = site.line;
      refused = site.refused;
      marks.showArea(null, color);
    } else {
      marks.showArea(null, color);
    }
    marks.showGhost(site && site.footprint, !site?.refused);
    marks.showPreview(tiles, kinds, color);
    if (outcome && performance.now() < outcome.until && !drag) say(outcome.text, outcome.refused);
    else say(line, refused);
  };

  const choose = (next: Tool | null) => {
    tool = next;
    gesture = null;
    for (const [id, node] of buttons) node.setAttribute('aria-pressed', String(id === next?.id));
    canvas.toggleAttribute('data-order-tool', next !== null);
    toolbar.toggleAttribute('data-active', next !== null);
    outcome = null;
    preview();
  };
  const toggle = (next: Tool) => choose(tool === next ? null : next);
  for (const candidate of TOOLS) buttons.get(candidate.id)!.addEventListener('click', () => toggle(candidate));

  const send = (command: OrderCommand) => {
    sent = command;
    worker.postMessage(command);
  };

  const pickAt = (x: number, y: number) => pick(x, y, canvas.clientWidth, canvas.clientHeight);

  /** Finds the tile under the pointer again, and redraws the preview when it changed. */
  const track = (x: number, y: number) => {
    const at = pickAt(x, y);
    if (gesture) {
      if (sameTile(gesture.to, at)) return;
      gesture.to = at;
    } else if (sameTile(hovered, at)) {
      return;
    }
    hovered = at;
    placed = null;
    preview();
  };

  canvas.addEventListener('pointermove', (event) => {
    pointerAt = { x: event.clientX, y: event.clientY };
    if (tool) track(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointerleave', () => {
    pointerAt = null;
    if (gesture) return;
    hovered = null;
    preview();
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (!tool || event.button !== 0) return;
    hovered = pickAt(event.clientX, event.clientY);
    gesture = { pointer: event.pointerId, tool, from: hovered, to: hovered };
    preview();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    const pressed = gesture;
    gesture = null;
    if (!tool || pressed?.pointer !== event.pointerId || pressed.tool !== tool) return;
    const at = pickAt(event.clientX, event.clientY);
    const order = orderFor(tool, pressed.from, at);
    if (order) send(order);
    hovered = at;
    preview();
  });
  canvas.addEventListener('pointercancel', () => {
    gesture = null;
    preview();
  });

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') {
      if (!gesture && !tool) return;
      // Marks the key as spent, so that the same Escape does not also clear the selection.
      event.preventDefault();
      if (gesture) {
        gesture = null;
        preview();
      } else {
        choose(null);
      }
      return;
    }
    const next = TOOLS.find((candidate) => candidate.codes.includes(event.code));
    if (!next) return;
    event.preventDefault();
    toggle(next);
  });

  /** Takes in a frame from the worker, after the world has applied its changes to `orders`. */
  const heard = (data: SimFrame) => {
    const changed = data.orders.claims.length > 0 || data.orders.sites.length > 0;
    if (data.outcome) {
      const result: OrderOutcome = data.outcome;
      if (result.ok && sent?.kind === 'place') placed = hovered;
      const text = outcomeWords(map, orders, result, sent);
      outcome = { text, refused: !result.ok, until: performance.now() + OUTCOME_MS };
      window.clearTimeout(outcomeTimer);
      outcomeTimer = window.setTimeout(preview, OUTCOME_MS);
    }
    if (changed || data.outcome) preview();
  };

  return {
    /** True while no tool is active, so that a drag with the main button moves the camera. */
    mainButtonPans: () => tool === null,
    heard,
    /** Keeps the tile under a resting pointer up to date while the camera moves. Call once a frame. */
    follow: () => {
      if (tool && pointerAt) track(pointerAt.x, pointerAt.y);
    },
  };
}
