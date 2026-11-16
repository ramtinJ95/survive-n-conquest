import type { PerspectiveCamera } from 'three';
import { ORDER_COLORS, type OrderMarks, Preview } from '../render/orderMarks';
import { createPicker, type PickedTile } from '../render/pick';
import { Building } from '../sim/buildings';
import type { TileMap } from '../sim/map';
import {
  MAX_SITES,
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
import './orders.css';

type ToolId = AreaOrder | 'house';

interface Tool {
  readonly id: ToolId;
  readonly label: string;
  /** `event.code` values that pick the tool. The first one is shown on the button. */
  readonly codes: readonly string[];
  readonly key: string;
  readonly hint: string;
  readonly icon: string;
}

const TOOLS: readonly Tool[] = [
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
    label: 'House',
    codes: ['KeyH'],
    key: 'H',
    hint: 'Click to place a house site on 3 by 3 tiles of open, level ground.',
    icon: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10.5 20v-5h3v5"/>',
  },
  {
    id: 'cancel',
    label: 'Cancel',
    codes: ['Delete', 'Backspace'],
    key: 'Del',
    hint: 'Drag over marks, stockpiles, and house sites to remove them.',
    icon: '<circle cx="12" cy="12" r="8"/><path d="m6.5 17.5 11-11"/>',
  },
];

const REFUSALS: Readonly<Record<Refusal, string>> = {
  'no-trees': 'No unmarked trees stand there.',
  'no-rock': 'No unmarked rock lies there.',
  'no-open-ground': 'No open ground there can join a stockpile.',
  'nothing-to-cancel': 'Nothing there to cancel.',
  'off-map': 'The site runs off the edge of the map.',
  water: 'A house cannot stand in water.',
  rock: 'A house cannot stand on rock. Quarry it first.',
  trees: 'Trees stand in the way. Chop them first.',
  camp: 'The camp stands in the way.',
  site: 'Another house stands in the way.',
  stockpile: 'A stockpile stands in the way.',
  goods: 'Goods lie on the site.',
  uneven: 'The ground is too steep. Its nine tiles may differ by 1.5 m at most.',
  divides: 'The house would cut land off from the camp.',
  full: `The map holds ${MAX_SITES} houses and sites at most.`,
};

/** Refusals that belong to the whole site rather than to some of its tiles. */
const WHOLE_SITE: ReadonlySet<Refusal> = new Set(['off-map', 'uneven', 'divides', 'full']);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const DONE: Readonly<Record<OrderOutcome['order'], (tiles: number) => string>> = {
  chop: (tiles) => `${plural(tiles, 'tree', 'trees')} marked for felling.`,
  quarry: (tiles) => `${plural(tiles, 'rock tile', 'rock tiles')} marked for quarrying.`,
  stockpile: (tiles) => `${plural(tiles, 'tile joins', 'tiles join')} the stockpile zone.`,
  house: () => 'House site placed.',
  hut: () => "Forager's hut site placed.",
  cancel: (tiles) => `Orders removed from ${plural(tiles, 'tile', 'tiles')}.`,
};

const PENDING: Readonly<Record<AreaOrder, (tiles: number) => string>> = {
  chop: (tiles) => `Release to mark ${plural(tiles, 'tree', 'trees')}.`,
  quarry: (tiles) => `Release to mark ${plural(tiles, 'rock tile', 'rock tiles')}.`,
  stockpile: (tiles) => `Release to add ${plural(tiles, 'tile', 'tiles')} to the stockpile.`,
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
    `<span class="order-tool-label">${tool.label}</span><kbd>${tool.key}</kbd>`;
  // A pointer press must not keep focus, or the next Space would press this button again instead of pausing.
  node.addEventListener('mousedown', (event) => event.preventDefault());
  return node;
}

/** A press of the main button on the map with a tool: a drag for an area tool, a click for House. */
const ROVING_KEYS: Readonly<Record<string, (at: number, count: number) => number>> = {
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
  /** The tile a house was just placed on. Its preview stays hidden until the pointer moves on, so the new site shows. */
  let placed: PickedTile | null = null;
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
    const drag = gesture && gesture.tool.id !== 'house' ? gesture : null;
    const color = tool ? ORDER_COLORS[tool.id] : ORDER_COLORS.chop;
    if (tool && tool.id !== 'house' && (drag || hovered)) {
      const corners = drag ? area(drag.from, drag.to) : area(hovered!, hovered!);
      const kind = tool.id === 'cancel' ? Preview.Remove : Preview.Mark;
      const count = areaEffect(map, orders, tool.id, corners, (tile) => {
        tiles.push(tile);
        kinds.push(kind);
      });
      if (drag) line = PENDING[tool.id](count);
      marks.showArea(corners, color);
    } else if (tool?.id === 'house' && hovered?.onMap && !sameTile(placed, hovered)) {
      const refusal = siteRefusal(map, orders, Building.House, hovered.x, hovered.y);
      for (let y = hovered.y - 1; y <= hovered.y + 1; y++) {
        for (let x = hovered.x - 1; x <= hovered.x + 1; x++) {
          if (x < 0 || y < 0 || x >= map.size || y >= map.size) continue;
          const tile = y * map.size + x;
          const problem = siteTileProblem(map, orders, tile);
          tiles.push(tile);
          kinds.push(
            refusal === null ? Preview.Fits : problem || WHOLE_SITE.has(refusal) ? Preview.Blocks : Preview.Refused,
          );
        }
      }
      line = refusal ? `Cannot build here. ${REFUSALS[refusal]}` : 'Click to place the house site here.';
      refused = refusal !== null;
      marks.showArea(null, color);
      marks.showGhost(hovered, refusal === null);
    } else {
      marks.showArea(null, color);
    }
    if (!(tool?.id === 'house' && hovered?.onMap && !sameTile(placed, hovered))) marks.showGhost(null, false);
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

  const send = (command: OrderCommand) => worker.postMessage(command);

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
    if (tool.id === 'house') {
      if (at.onMap) send({ kind: 'place', building: Building.House, x: at.x, y: at.y });
    } else {
      send({ kind: 'markArea', order: tool.id, area: area(pressed.from, at) });
    }
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
      if (result.ok && result.order === 'house') placed = hovered;
      const text = result.ok
        ? DONE[result.order](result.tiles)
        : `${result.order === 'house' ? 'Cannot build here. ' : ''}${REFUSALS[result.refusal]}`;
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
