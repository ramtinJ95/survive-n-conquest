import type { PerspectiveCamera } from 'three';
import { type Selection, pickSelection } from '../render/pickSelection';
import type { MarkPlace, createSelectionMark } from '../render/selectionMark';
import { BUILDING } from '../sim/building';
import { BUILDINGS, Building, kindOf, siteMidX, siteMidY } from '../sim/buildings';
import { CAMP_RADIUS, underCamp } from '../sim/camp';
import { CARRYING } from '../sim/carrying';
import { GATHERING } from '../sim/gathering';
import { Good } from '../sim/goods';
import { NO_HOME } from '../sim/households';
import { TileKind, type TileMap, tileAt } from '../sim/map';
import { Sex, nameOf } from '../sim/names';
import { type Orders, SiteState } from '../sim/orders';
import { STOCKING } from '../sim/stocking';
import { CAMP_STORE, HOUSE_FOOD_LIMIT } from '../sim/stores';
import { SUPPLYING } from '../sim/supplying';
import { TASK_KINDS, type TaskKind } from '../sim/tasks';
import { VillagerState } from '../sim/villagerState';
import type { SimFrame } from '../frame';
import { siteProgress } from './sites';
import './selection.css';

export type { Selection };

/** What the panels read: the main thread's copies of the map and the orders, and the newest frame from the worker. */
export interface Facts {
  readonly map: TileMap;
  readonly orders: Orders;
  readonly camp: number;
  readonly frame: Pick<
    SimFrame,
    'villagers' | 'carried' | 'states' | 'tasks' | 'taskTiles' | 'names' | 'sexes' | 'households' | 'homes' | 'missedMeals' | 'storeFood' | 'campFoodLimit'
  >;
}

type VillagerSelection = Extract<Selection, { kind: 'villager' }>;
type BuildingSelection = Extract<Selection, { kind: 'building' }>;
type CampSelection = Extract<Selection, { kind: 'camp' }>;

/** The selection each panel kind shows. A building is a site or a house by its state in the sites table. */
interface PanelSelections {
  readonly villager: VillagerSelection;
  readonly site: BuildingSelection;
  readonly house: BuildingSelection;
  readonly camp: CampSelection;
}

export type PanelKind = keyof PanelSelections;

/** A button beside a row's value. A row with buttons is a control, such as the filled places of a workplace. */
interface Button<S> {
  readonly text: string;
  /** The button's accessible name. */
  readonly name: string;
  readonly press: (facts: Facts, selection: S) => void;
}

interface Row<S> {
  readonly label: string;
  readonly read: (facts: Facts, selection: S) => string;
  readonly buttons?: readonly Button<S>[];
}

interface Panel<S> {
  readonly title: string | ((facts: Facts, selection: S) => string);
  readonly note?: string;
  readonly rows: readonly Row<S>[];
}

/** Every panel kind's title, note, rows, and controls. */
export type Panels = { readonly [K in PanelKind]: Panel<PanelSelections[K]> };

export interface PanelText {
  readonly kind: PanelKind;
  readonly title: string;
  readonly note?: string;
  readonly rows: readonly {
    readonly label: string;
    readonly value: string;
    readonly buttons?: readonly { readonly text: string; readonly name: string; readonly press: () => void }[];
  }[];
}

const task = (kind: TaskKind) => TASK_KINDS.indexOf(kind) + 1;
const GATHER = task(GATHERING);
const CARRY = task(CARRYING);
const SUPPLY = task(SUPPLYING);
const BUILD = task(BUILDING);
const STOCK = task(STOCKING);

const GOOD_NAMES: Readonly<Record<Good, string>> = { [Good.None]: 'goods', [Good.Log]: 'a log', [Good.Stone]: 'stone', [Good.Food]: 'food' };

/** What a villager holding a task does, by the task's column value, while it walks to its work or works it. */
const TASK_WORDS: Readonly<Record<number, (facts: Facts, id: number, working: boolean) => string>> = {
  [GATHER]: ({ map, frame }, id, working) => {
    const rock = map.kinds[frame.taskTiles[id]!] === TileKind.Rock;
    if (rock) return working ? 'Quarrying stone' : 'Walking to the rock';
    return working ? 'Chopping a tree' : 'Walking to a tree';
  },
  [CARRY]: (facts, id) => fetching(facts, id, 'to the stockpile', 'to pick up'),
  [SUPPLY]: (facts, id) => fetching(facts, id, 'to a house site', 'to fetch', ' for a house site'),
  [BUILD]: (_, __, working) => (working ? 'Building a house' : 'Walking to a house site'),
  [STOCK]: ({ frame }, id) => (frame.carried[id] === Good.Food ? 'Carrying food home' : 'Walking to the camp for food'),
};

function fetching({ map, frame }: Facts, id: number, to: string, fetch: string, purpose = ''): string {
  const carried = frame.carried[id] as Good;
  if (carried !== Good.None) return `Carrying ${GOOD_NAMES[carried]} ${to}`;
  return `Walking ${fetch} ${GOOD_NAMES[map.stackGood[frame.taskTiles[id]!] as Good]}${purpose}`;
}

/** What a villager does by night, or once dead, by its state, whatever task it holds. */
const STATE_WORDS: Partial<Readonly<Record<VillagerState, string>>> = {
  [VillagerState.GoingToCamp]: 'Walking to the camp',
  [VillagerState.Settling]: 'Resting at the camp',
  [VillagerState.GoingIn]: 'Walking home',
  [VillagerState.Inside]: 'At home',
  [VillagerState.Dead]: 'Died of hunger',
};

/** What a villager is doing, in words. */
function doing(facts: Facts, id: number): string {
  const state = facts.frame.states[id]! as VillagerState;
  const words = STATE_WORDS[state];
  if (words) return words;
  const task = TASK_WORDS[facts.frame.tasks[id]!];
  if (!task || (state !== VillagerState.Walking && state !== VillagerState.Working)) return 'Idle';
  return task(facts, id, state === VillagerState.Working);
}

function missedMeals({ frame }: Facts, id: number): string {
  const missed = frame.missedMeals[id]!;
  if (missed === 0) return 'None';
  return frame.states[id] === VillagerState.Dead ? String(missed) : `${missed}, hungry`;
}

const CARRIED_WORDS: Readonly<Record<Good, string>> = { [Good.None]: 'Nothing', [Good.Log]: '1 log', [Good.Stone]: '1 stone', [Good.Food]: '1 food' };

const builders = ({ frame }: Facts, anchor: number) => {
  let count = 0;
  for (let id = 0; id < frame.tasks.length; id++) {
    if (frame.tasks[id] === BUILD && frame.taskTiles[id] === anchor) count++;
  }
  return count;
};

const settlersAtCamp = ({ map, camp, frame }: Facts) => {
  let count = 0;
  for (let id = 0; id * 2 < frame.villagers.length; id++) {
    const away = frame.states[id] === VillagerState.Inside || frame.states[id] === VillagerState.Dead;
    if (!away && underCamp(map, camp, tileAt(map, frame.villagers[id * 2]!, frame.villagers[id * 2 + 1]!))) count++;
  }
  return count;
};

const SEX_WORDS: Readonly<Record<Sex, string>> = { [Sex.Woman]: 'Woman', [Sex.Man]: 'Man' };

const nameOfSettler = ({ frame }: Facts, id: number) => nameOf(frame.sexes[id] as Sex, frame.names[id]!);

/** The names of a household's members in id order, leaving out villager `except`. A dead member is named as one. */
function members(facts: Facts, household: number, except = -1): string {
  const names: string[] = [];
  facts.frame.households.forEach((of, id) => {
    if (of !== household || id === except) return;
    const died = facts.frame.states[id] === VillagerState.Dead;
    names.push(died ? `${nameOfSettler(facts, id)} (died)` : nameOfSettler(facts, id));
  });
  return names.join(' and ');
}

function householdOf(facts: Facts, id: number): string {
  const household = facts.frame.households[id]!;
  const others = members(facts, household, id);
  return others ? `Household ${household + 1}, with ${others}` : `Household ${household + 1}`;
}

function livingIn(facts: Facts, slot: number): string {
  const household = facts.frame.homes.indexOf(slot);
  return household < 0 ? 'Nobody' : `Household ${household + 1}: ${members(facts, household)}`;
}

/** Every panel. A row or a control added here shows in the panel of its kind. */
const PANELS: Panels = {
  villager: {
    title: (facts, { id }) => nameOfSettler(facts, id),
    rows: [
      { label: 'Doing', read: (facts, { id }) => doing(facts, id) },
      { label: 'Carries', read: ({ frame }, { id }) => CARRIED_WORDS[frame.carried[id] as Good] },
      { label: 'Sex', read: ({ frame }, { id }) => SEX_WORDS[frame.sexes[id] as Sex] },
      { label: 'Household', read: (facts, { id }) => householdOf(facts, id) },
      {
        label: 'Home',
        read: ({ frame }, { id }) => (frame.homes[frame.households[id]!] === NO_HOME ? 'None, sleeps at the camp' : 'A house'),
      },
      { label: 'Missed meals', read: (facts, { id }) => missedMeals(facts, id) },
    ],
  },
  site: {
    title: 'House site',
    rows: [
      { label: 'Logs', read: ({ map, orders }, { slot }) => `${siteProgress(map, orders, slot).arrived[0]}/${BUILDINGS[Building.House].needs[Good.Log - 1]}` },
      { label: 'Stone', read: ({ map, orders }, { slot }) => `${siteProgress(map, orders, slot).arrived[1]}/${BUILDINGS[Building.House].needs[Good.Stone - 1]}` },
      {
        label: 'Work',
        read: ({ map, orders }, { slot }) => {
          const { percent } = siteProgress(map, orders, slot);
          return percent === null ? 'Waiting for materials' : `${percent}%`;
        },
      },
      { label: 'Builders', read: (facts, { anchor }) => String(builders(facts, anchor)) },
    ],
  },
  house: {
    title: 'House',
    note: 'A finished house.',
    rows: [
      { label: 'Household', read: (facts, { slot }) => livingIn(facts, slot) },
      { label: 'Food', read: ({ frame }, { slot }) => `${frame.storeFood[slot]} of ${HOUSE_FOOD_LIMIT}` },
    ],
  },
  camp: {
    title: 'Camp',
    rows: [
      { label: 'Settlers here', read: (facts) => String(settlersAtCamp(facts)) },
      { label: 'Food', read: ({ frame }) => `${frame.storeFood[CAMP_STORE]} of ${frame.campFoodLimit}` },
    ],
  },
};

function show<K extends PanelKind>(panels: Panels, kind: K, selection: PanelSelections[K], facts: Facts): PanelText {
  const panel: Panel<PanelSelections[K]> = panels[kind];
  return {
    kind,
    title: typeof panel.title === 'string' ? panel.title : panel.title(facts, selection),
    ...(panel.note === undefined ? {} : { note: panel.note }),
    rows: panel.rows.map(({ label, read, buttons }) => ({
      label,
      value: read(facts, selection),
      ...(buttons && { buttons: buttons.map(({ text, name, press }) => ({ text, name, press: () => press(facts, selection) })) }),
    })),
  };
}

/** The selection while what it names still stands, or null: a site cancelled or its slot taken by a site elsewhere clears it. */
export function keepSelection(selection: Selection | null, orders: Orders): Selection | null {
  if (selection?.kind !== 'building') return selection;
  const { state, x, y } = orders.sites;
  const standing = state[selection.slot] !== SiteState.Free;
  return standing && y[selection.slot]! * orders.size + x[selection.slot]! === selection.anchor ? selection : null;
}

/** What the panel of a standing selection says. */
export function readPanel(selection: Selection, facts: Facts, panels: Panels = PANELS): PanelText {
  switch (selection.kind) {
    case 'villager':
      return show(panels, 'villager', selection, facts);
    case 'building':
      return show(panels, facts.orders.sites.state[selection.slot] === SiteState.Built ? 'house' : 'site', selection, facts);
    case 'camp':
      return show(panels, 'camp', selection, facts);
  }
}

/** The ring around a building clears the corners of its footprint by this much, in tiles. */
const MARK_CLEARANCE = 0.18;

/** Where the mark of a standing selection goes on the map, or null while a selected settler is inside its house or once it died. */
export function markPlace(selection: Selection, { map, orders, camp, frame }: Facts): MarkPlace | null {
  switch (selection.kind) {
    case 'villager':
      if (frame.states[selection.id] === VillagerState.Inside || frame.states[selection.id] === VillagerState.Dead) return null;
      return { x: frame.villagers[selection.id * 2]!, y: frame.villagers[selection.id * 2 + 1]!, radius: 0.55 };
    case 'building': {
      const { sites } = orders;
      return { x: siteMidX(sites, selection.slot), y: siteMidY(sites, selection.slot), radius: kindOf(sites, selection.slot).side / Math.SQRT2 + MARK_CLEARANCE };
    }
    case 'camp':
      return { x: (camp % map.size) + 0.5, y: Math.floor(camp / map.size) + 0.5, radius: CAMP_RADIUS + 0.3 };
  }
}

/** The most a press may travel, in pixels, and still count as a click rather than a drag of the camera. */
const CLICK_TRAVEL_PX = 5;

const setText = (node: HTMLElement, text: string) => {
  if (node.textContent !== text) node.textContent = text;
};

interface SelectionSetup {
  readonly map: TileMap;
  readonly orders: Orders;
  readonly camp: number;
  readonly canvas: HTMLCanvasElement;
  readonly camera: PerspectiveCamera;
  readonly mark: ReturnType<typeof createSelectionMark>;
  /** True while no order tool is active. Only then does a click select. */
  readonly mainButtonPans: () => boolean;
  readonly panels?: Panels;
}

/**
 * Lets the player select a settler, a building, or the camp with a click while
 * no order tool is active, rings it on the map, and says in a panel what it is
 * and what it is doing. A click on bare ground, the close button, or Escape
 * clears the selection.
 */
export function mountSelection(root: HTMLElement, { map, orders, camp, canvas, camera, mark, mainButtonPans, panels = PANELS }: SelectionSetup) {
  const panel = document.createElement('section');
  panel.className = 'selection';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Selection');
  panel.hidden = true;
  const title = document.createElement('h2');
  const note = document.createElement('p');
  const list = document.createElement('dl');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Close selection');
  close.textContent = '×';
  panel.append(close, title, note, list);
  root.append(panel);

  let selection: Selection | null = null;
  let frame: SimFrame | null = null;
  let shown: PanelKind | null = null;
  let values: HTMLElement[] = [];
  let text: PanelText | null = null;

  const facts = (): Facts | null => (frame ? { map, orders, camp, frame } : null);

  const refresh = () => {
    selection = keepSelection(selection, orders);
    const known = facts();
    if (!selection || !known) {
      panel.hidden = true;
      return;
    }
    text = readPanel(selection, known, panels);
    if (text.kind !== shown) {
      shown = text.kind;
      values = text.rows.map(() => document.createElement('span'));
      list.replaceChildren(
        ...text.rows.flatMap(({ label, buttons = [] }, row) => {
          const name = document.createElement('dt');
          name.textContent = label;
          const value = document.createElement('dd');
          value.append(
            values[row]!,
            ...buttons.map(({ text: face, name: accessible }, index) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = face;
              button.setAttribute('aria-label', accessible);
              button.addEventListener('mousedown', (event) => event.preventDefault());
              button.addEventListener('click', () => {
                text?.rows[row]?.buttons?.[index]?.press();
                refresh();
              });
              return button;
            }),
          );
          return [name, value];
        }),
      );
      list.hidden = text.rows.length === 0;
      note.hidden = text.note === undefined;
    }
    setText(title, text.title);
    setText(note, text.note ?? '');
    text.rows.forEach(({ value }, index) => setText(values[index]!, value));
    panel.hidden = false;
  };

  const select = (next: Selection | null) => {
    selection = next;
    refresh();
  };

  // A pointer press must not keep focus, or the next Space would press the button instead of pausing.
  close.addEventListener('mousedown', (event) => event.preventDefault());
  close.addEventListener('click', () => select(null));

  let press: { pointer: number; x: number; y: number; travel: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    press = event.button === 0 && mainButtonPans() ? { pointer: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 } : null;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (press?.pointer !== event.pointerId) return;
    press.travel += Math.hypot(event.clientX - press.x, event.clientY - press.y);
    press.x = event.clientX;
    press.y = event.clientY;
  });
  canvas.addEventListener('pointerup', (event) => {
    const pressed = press;
    press = null;
    if (event.button !== 0 || pressed?.pointer !== event.pointerId || !mainButtonPans() || !frame) return;
    const travel = pressed.travel + Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
    if (travel > CLICK_TRAVEL_PX) return;
    const scene = { map, orders, camp, villagers: frame.villagers, states: frame.states };
    select(pickSelection(scene, camera, event.clientX, event.clientY, canvas.clientWidth, canvas.clientHeight));
  });
  canvas.addEventListener('pointercancel', () => {
    press = null;
  });

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape' || event.defaultPrevented || event.repeat || !mainButtonPans() || !selection) return;
    select(null);
  });

  return {
    /** Takes in a frame from the worker, after the world has applied its tile and order changes. */
    heard(data: SimFrame) {
      frame = data;
      refresh();
    },
    /** Moves the mark onto the selection, as a settler walks. Call once a frame, after the camera moved and before the scene renders. */
    follow() {
      const known = facts();
      mark.show(selection && known ? markPlace(selection, known) : null, camera, canvas.clientHeight);
    },
  };
}
