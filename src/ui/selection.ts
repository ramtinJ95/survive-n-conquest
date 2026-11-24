import type { PerspectiveCamera } from 'three';
import { type Selection, pickSelection } from '../render/pickSelection';
import type { MarkPlace, createSelectionMark } from '../render/selectionMark';
import { AnimalState } from '../sim/animals';
import { BUILDING } from '../sim/building';
import { BUILDINGS, Building, type BuildingName, Job, jobAt, kindOf, siteMidX, siteMidY, withinReach } from '../sim/buildings';
import { SEASONS, TICKS_PER_DAY, seasonIndexAt, tickOfDay, tickOfSeason } from '../sim/calendar';
import { isNight } from '../sim/daylight';
import { CAMP_RADIUS, underCamp } from '../sim/camp';
import { CARRYING } from '../sim/carrying';
import { EATING } from '../sim/eating';
import { FORAGING } from '../sim/foraging';
import { GATHERING } from '../sim/gathering';
import { Good } from '../sim/goods';
import { NO_HOME } from '../sim/households';
import { FETCHING_KILL, HUNTING } from '../sim/hunting';
import { TileKind, type TileMap, tileAt } from '../sim/map';
import { Sex, nameOf } from '../sim/names';
import { type Orders, SiteState } from '../sim/orders';
import type { Command } from '../sim/sim';
import { STOCKING } from '../sim/stocking';
import {
  BARN_FOOD_LIMIT,
  CAMP_FIREWOOD_LIMIT,
  CAMP_STORE,
  HOUSE_FIREWOOD_LIMIT,
  HOUSE_FOOD_LIMIT,
  StoreKind,
  TAILOR_CLOTHING_LIMIT,
  WOODSHED_FIREWOOD_LIMIT,
  limitOf,
  storeKind,
} from '../sim/stores';
import { SUPPLYING } from '../sim/supplying';
import { TASK_KINDS, type TaskKind } from '../sim/tasks';
import { WORK_AGE } from '../sim/sim';
import { Cause, VillagerState } from '../sim/villagerState';
import { Stop, WORKSHOP } from '../sim/workshops';
import { WEARING } from '../sim/wearing';
import type { SimFrame } from '../frame';
import { BUILDING_WORDS, JOB_WORDS, capital, neededGoods } from './buildings';
import { listNames } from './news';
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
    | 'tick'
    | 'villagers'
    | 'carried'
    | 'states'
    | 'tasks'
    | 'taskTiles'
    | 'destinations'
    | 'names'
    | 'sexes'
    | 'households'
    | 'children'
    | 'mothers'
    | 'fathers'
    | 'homes'
    | 'couples'
    | 'workplaces'
    | 'hired'
    | 'missedMeals'
    | 'coldNights'
    | 'stockGoods'
    | 'worn'
    | 'causes'
    | 'ages'
    | 'storeFood'
    | 'campFoodLimit'
    | 'storeInbound'
    | 'storeFirewood'
    | 'storeClothing'
    | 'workshopStops'
    | 'firesLastNight'
    | 'animals'
    | 'animalStates'
  >;
}

type VillagerSelection = Extract<Selection, { kind: 'villager' }>;
type BuildingSelection = Extract<Selection, { kind: 'building' }>;
type CampSelection = Extract<Selection, { kind: 'camp' }>;

/**
 * The selection each panel kind shows. A building has one panel for its kind
 * as a site and one for it finished, by its kind and its state in the sites
 * table, so a kind added to `BUILDINGS` needs both here.
 */
type PanelSelections = { readonly villager: VillagerSelection; readonly camp: CampSelection } & {
  readonly [N in BuildingName]: BuildingSelection;
} & { readonly [N in BuildingName as `${N}Site`]: BuildingSelection };

export type PanelKind = keyof PanelSelections;

/** A button beside a row's value. A row with buttons is a control, such as the filled places of a workplace. */
interface Button<S> {
  readonly text: string;
  /** The button's accessible name. */
  readonly name: string;
  /** True while a press would change nothing, as at either end of a range. */
  readonly disabled?: (facts: Facts, selection: S) => boolean;
  /** The command a press sends to the simulation. */
  readonly press: (facts: Facts, selection: S) => Command;
}

interface Row<S> {
  readonly label: string;
  readonly read: (facts: Facts, selection: S) => string;
  /** Whether the row shows. A row without it always does. */
  readonly shows?: (facts: Facts) => boolean;
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
    readonly buttons?: readonly { readonly text: string; readonly name: string; readonly disabled: boolean; readonly press: () => Command }[];
  }[];
}

const task = (kind: TaskKind) => TASK_KINDS.indexOf(kind) + 1;
const GATHER = task(GATHERING);
const CARRY = task(CARRYING);
const SUPPLY = task(SUPPLYING);
const BUILD = task(BUILDING);
const STOCK = task(STOCKING);
const EAT = task(EATING);
const FORAGE = task(FORAGING);
const FETCH_KILL = task(FETCHING_KILL);
const HUNT = task(HUNTING);
const WORK = task(WORKSHOP);
const WEAR = task(WEARING);
const WINTER = SEASONS.indexOf('Winter');

/**
 * The winter nights whose dawn the simulation has run, in a frame at `tick`:
 * it copies last night's fires as it runs a dawn's tick, so a frame at that
 * tick still holds the night before's.
 */
function winterNightsEnded(tick: number): number {
  const ran = tick - 1;
  if (seasonIndexAt(ran) !== WINTER) return 0;
  const beforeDawn = isNight(ran) && tickOfDay(ran) < TICKS_PER_DAY / 2;
  return Math.max(0, Math.floor(tickOfSeason(ran) / TICKS_PER_DAY) - Number(beforeDawn));
}

const GOOD_NAMES: Readonly<Record<Good, string>> = { [Good.None]: 'goods', [Good.Log]: 'a log', [Good.Stone]: 'stone', [Good.Food]: 'food', [Good.Firewood]: 'firewood', [Good.Hide]: 'a hide', [Good.Clothing]: 'clothing' };

/** What the worker at each kind of workshop does, in words: on its way to a unit of input, carrying it in, on its way to a batch that waits, and at work on a batch, and what it says, idle, of each reason it stopped. */
interface WorkshopWords {
  readonly fetching: string;
  readonly carrying: string;
  readonly going: string;
  readonly working: string;
  readonly stops: Readonly<Record<Stop, string>>;
}

const WORKSHOP_WORDS: Readonly<Partial<Record<Building, WorkshopWords>>> = {
  [Building.Woodshed]: {
    fetching: 'Walking to a stockpile for a log',
    carrying: 'Carrying a log to the woodshed',
    going: 'Walking to the woodshed to split a log',
    working: 'Splitting a log',
    stops: {
      [Stop.Working]: 'Looking for a log',
      [Stop.Full]: 'Idle, the woodshed is full',
      [Stop.NoInput]: `Idle, no log in a stockpile within ${BUILDINGS[Building.Woodshed].reach} tiles of the woodshed`,
      [Stop.ForSites]: 'Idle, the building sites need the logs',
      [Stop.NotStocked]: 'Idle, no log carried to a stockpile yet',
    },
  },
  [Building.Tailor]: {
    fetching: 'Walking to a stockpile for a hide',
    carrying: "Carrying a hide to the tailor's hut",
    going: "Walking to the tailor's hut to make clothing",
    working: 'Making clothing',
    stops: {
      [Stop.Working]: 'Looking for a hide',
      [Stop.Full]: "Idle, the tailor's hut is full",
      [Stop.NoInput]: `Idle, no hide in a stockpile within ${BUILDINGS[Building.Tailor].reach} tiles of the tailor's hut`,
      [Stop.ForSites]: 'Idle, the building sites need the hides',
      [Stop.NotStocked]: 'Idle, no hide carried to a stockpile yet',
    },
  },
};

/** The words of the workshop in `slot`. */
const workshopWords = ({ orders }: Facts, slot: number): WorkshopWords => WORKSHOP_WORDS[orders.sites.kind[slot] as Building]!;

/** The word for the kind of the site or building on a tile, such as the anchor a task goes to. */
function siteNoun({ orders }: Facts, tile: number): string {
  const slot = tile < 0 ? -1 : orders.siteOf[tile]!;
  return slot < 0 ? 'building' : BUILDING_WORDS[orders.sites.kind[slot] as Building].noun;
}

/** What a villager holding a task does, by the task's column value, while it walks to its work or works it. */
const TASK_WORDS: Readonly<Record<number, (facts: Facts, id: number, working: boolean) => string>> = {
  [GATHER]: ({ map, frame }, id, working) => {
    const rock = map.kinds[frame.taskTiles[id]!] === TileKind.Rock;
    if (rock) return working ? 'Quarrying stone' : 'Walking to the rock';
    return working ? 'Chopping a tree' : 'Walking to a tree';
  },
  [CARRY]: (facts, id) => {
    const food = facts.frame.carried[id] === Good.Food || facts.map.stackGood[facts.frame.taskTiles[id]!] === Good.Food;
    return fetching(facts, id, food ? `to ${storeAt(facts, facts.frame.destinations[id]!)}` : 'to the stockpile', 'to pick up');
  },
  [SUPPLY]: (facts, id) => {
    const site = siteNoun(facts, facts.frame.destinations[id]!);
    return fetching(facts, id, `to a ${site} site`, 'to fetch', ` for a ${site} site`);
  },
  [BUILD]: (facts, id, working) => {
    const site = siteNoun(facts, facts.frame.taskTiles[id]!);
    return working ? `Building a ${site}` : `Walking to a ${site} site`;
  },
  [EAT]: ({ frame, camp }, id, working) => {
    if (working) return 'Eating';
    return frame.taskTiles[id] === camp ? 'Walking to the camp to eat' : 'Walking home to eat';
  },
  [STOCK]: (facts, id) => {
    const { frame, camp } = facts;
    const good = frame.stockGoods[id] as Good;
    const from = good === Good.Firewood && frame.taskTiles[id] !== camp ? 'a woodshed' : storeAt(facts, frame.taskTiles[id]!);
    if (frame.carried[id] === Good.None) return `Walking to ${from} for ${GOOD_NAMES[good]}`;
    return `Carrying ${GOOD_NAMES[good]} ${frame.destinations[id] === camp ? 'to the camp' : 'home'}`;
  },
  [WEAR]: (_facts, _id, working) => (working ? 'Putting on clothing' : "Walking to the tailor's hut for clothing"),
  [FORAGE]: (facts, id, working) => {
    if (facts.frame.carried[id] === Good.Food) return `Carrying food to ${storeAt(facts, facts.frame.destinations[id]!)}`;
    return working ? 'Foraging' : 'Walking to a tree to forage';
  },
  [FETCH_KILL]: (facts, id) => {
    if (facts.frame.carried[id] === Good.Food) return `Carrying food to ${storeAt(facts, facts.frame.destinations[id]!)}`;
    return 'Walking to a kill to pick up food';
  },
  [HUNT]: (_facts, _id, working) => (working ? 'Aiming at a deer' : 'Stalking a deer'),
  [WORK]: (facts, id, working) => {
    const { frame } = facts;
    const words = workshopWords(facts, frame.workplaces[id]!);
    if (frame.carried[id] !== Good.None) return words.carrying;
    if (frame.taskTiles[id]! >= 0) return words.fetching;
    return working ? words.working : words.going;
  },
};

/** The common store a carrier goes to on a tile: the camp at the camp center, and a barn at any tile beside one. */
function storeAt({ camp }: Facts, tile: number): string {
  return tile === camp ? 'the camp' : 'a barn';
}

/** Whether some common store, the camp or a finished barn, takes one more unit, counting the units on their way. */
function roomInAStore({ orders, frame }: Facts): boolean {
  for (let store = 0; store < frame.storeFood.length; store++) {
    if (storeKind(orders, store) !== StoreKind.Common) continue;
    if (frame.storeFood[store]! + frame.storeInbound[store]! < limitOf(orders, frame.campFoodLimit, store, Good.Food)) return true;
  }
  return false;
}

/** Whether an animal lives within the reach of the workplace in `slot`. */
function preyInReach({ orders, frame }: Facts, slot: number): boolean {
  for (let row = 0; row < frame.animalStates.length; row++) {
    if (frame.animalStates[row] !== AnimalState.Gone && withinReach(orders.sites, slot, frame.animals[row * 2]!, frame.animals[row * 2 + 1]!)) return true;
  }
  return false;
}

function fetching({ map, frame }: Facts, id: number, to: string, fetch: string, purpose = ''): string {
  const carried = frame.carried[id] as Good;
  if (carried !== Good.None) return `Carrying ${GOOD_NAMES[carried]} ${to}`;
  return `Walking ${fetch} ${GOOD_NAMES[map.stackGood[frame.taskTiles[id]!] as Good]}${purpose}`;
}

/** The job of a villager: the job of the kind of its workplace, or `Job.None` when it has no place. */
function jobOf({ orders, frame }: Facts, id: number): Job {
  return jobAt(orders.sites, frame.workplaces[id]!);
}

/** Why a worker at a workshop is idle, as its workshop's last look for work found. */
function workshopIdle(facts: Facts, id: number): string {
  const slot = facts.frame.workplaces[id]!;
  return workshopWords(facts, slot).stops[facts.frame.workshopStops[slot] as Stop];
}

/** What a villager with no task does by day, by its job: a forager or a hunter says why it is not out at its work. */
const IDLE_WORDS: Readonly<Record<Job, (facts: Facts, id: number) => string>> = {
  [Job.None]: () => 'Idle',
  [Job.Forager]: (facts) => {
    const { frame } = facts;
    if (seasonIndexAt(frame.tick) === WINTER) return 'Idle, nothing grows until spring';
    if (!roomInAStore(facts)) return 'Idle, waiting for room in a store';
    return 'Looking for forage';
  },
  [Job.Hunter]: (facts, id) => {
    if (!roomInAStore(facts)) return 'Idle, waiting for room in a store';
    if (!preyInReach(facts, facts.frame.workplaces[id]!)) return `Idle, no deer within ${BUILDINGS[Building.Lodge].reach} tiles of the lodge`;
    return 'Looking for deer';
  },
  [Job.Woodcutter]: (facts, id) => workshopIdle(facts, id),
  [Job.Tailor]: (facts, id) => workshopIdle(facts, id),
};

/** What a villager does by night, or once dead, by its state, whatever task it holds. */
const STATE_WORDS: Partial<Readonly<Record<VillagerState, string>>> = {
  [VillagerState.GoingToCamp]: 'Walking to the camp',
  [VillagerState.Settling]: 'Resting at the camp',
  [VillagerState.GoingIn]: 'Walking home',
  [VillagerState.Inside]: 'At home',
};

const CAUSE_WORDS: Readonly<Record<Exclude<Cause, typeof Cause.None>, string>> = {
  [Cause.Hunger]: 'hunger',
  [Cause.Cold]: 'cold',
  [Cause.OldAge]: 'old age',
};

/** What a villager is doing, in words. A dead one says what it died of, and at what age. */
function doing(facts: Facts, id: number): string {
  const { frame } = facts;
  const state = frame.states[id]! as VillagerState;
  if (state === VillagerState.Dead) return `Died of ${CAUSE_WORDS[frame.causes[id] as Exclude<Cause, typeof Cause.None>]} at ${frame.ages[id]}`;
  const words = STATE_WORDS[state];
  if (words) return words;
  const task = TASK_WORDS[frame.tasks[id]!];
  if (!task || (state !== VillagerState.Walking && state !== VillagerState.Working)) {
    if (!isChild(facts, id)) return IDLE_WORDS[jobOf(facts, id)](facts, id);
    return frame.homes[frame.households[id]!] === NO_HOME ? 'Playing at the camp' : 'Playing by the house';
  }
  return task(facts, id, state === VillagerState.Working);
}

function missedMeals({ frame }: Facts, id: number): string {
  const missed = frame.missedMeals[id]!;
  if (missed === 0) return 'None';
  return frame.states[id] === VillagerState.Dead ? String(missed) : `${missed}, hungry`;
}

/** A settler's cold nights, and beside them whether it wears clothing, which a dead settler's is gone with. */
function coldNights({ frame }: Facts, id: number): string {
  const nights = frame.coldNights[id]!;
  if (frame.states[id] === VillagerState.Dead) return nights === 0 ? 'None' : String(nights);
  const cold = nights === 0 ? 'None' : `${nights}, cold`;
  return frame.worn[id] === Good.Clothing ? `${cold}, clothed` : cold;
}

const CARRIED_WORDS: Readonly<Record<Good, string>> = {
  [Good.None]: 'Nothing',
  [Good.Log]: '1 log',
  [Good.Stone]: '1 stone',
  [Good.Food]: '1 food',
  [Good.Firewood]: '1 firewood',
  [Good.Hide]: '1 hide',
  [Good.Clothing]: '1 piece of clothing',
};

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
const CHILD_SEX_WORDS: Readonly<Record<Sex, string>> = { [Sex.Woman]: 'Girl', [Sex.Man]: 'Boy' };
const BORN_WORDS: Readonly<Record<Sex, string>> = { [Sex.Woman]: 'daughter', [Sex.Man]: 'son' };

const isChild = ({ frame }: Facts, id: number) => frame.children[id] === 1;

const nameOfSettler = ({ frame }: Facts, id: number) => nameOf(frame.sexes[id] as Sex, frame.names[id]!);

/** A settler's name, and for one born in the game whose daughter or son it is, as `Tova, daughter of Ulvar and Ysa`. */
function titleOf(facts: Facts, id: number): string {
  const { frame } = facts;
  const mother = frame.mothers[id]!;
  const father = frame.fathers[id]!;
  if (mother < 0 || father < 0) return nameOfSettler(facts, id);
  return `${nameOfSettler(facts, id)}, ${BORN_WORDS[frame.sexes[id] as Sex]} of ${nameOfSettler(facts, father)} and ${nameOfSettler(facts, mother)}`;
}

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * A household in words: its couple by name, then its other living members
 * and its dead by count, as `Ulvar and Ysa, 3 children, 1 died`. A couple of
 * one names its one.
 */
function householdLine(facts: Facts, household: number): string {
  const { frame } = facts;
  const man = frame.couples[household * 2]!;
  const woman = frame.couples[household * 2 + 1]!;
  const couple = [man, woman].filter((id) => id >= 0).map((id) => nameOfSettler(facts, id));
  let children = 0;
  let died = 0;
  frame.households.forEach((of, id) => {
    if (of !== household) return;
    if (frame.states[id] === VillagerState.Dead) died++;
    else if (id !== man && id !== woman) children++;
  });
  const parts = [couple.join(' and ')];
  if (children > 0) parts.push(counted(children, 'child', 'children'));
  if (died > 0) parts.push(`${died} died`);
  return parts.join(', ');
}

function livingIn(facts: Facts, slot: number): string {
  const household = facts.frame.homes.indexOf(slot);
  return household < 0 ? 'Nobody' : householdLine(facts, household);
}

/** The names of the workers at a workplace in the order they came, or Nobody. */
function workersAt(facts: Facts, slot: number): string {
  const { workplaces, hired } = facts.frame;
  const ids = [...workplaces.keys()].filter((id) => workplaces[id] === slot).sort((a, b) => hired[a]! - hired[b]!);
  return ids.length === 0 ? 'Nobody' : listNames(ids.map((id) => nameOfSettler(facts, id)));
}

/** The panel of a site of a building kind: what has arrived of each good it needs, its work, and its builders. */
function sitePanel(building: Building): Panel<BuildingSelection> {
  const goods = neededGoods(BUILDINGS[building]);
  return {
    title: `${BUILDING_WORDS[building].title} site`,
    rows: [
      ...goods.map(({ label, needs }, index) => ({
        label,
        read: ({ map, orders }: Facts, { slot }: BuildingSelection) => `${siteProgress(map, orders, slot).arrived[index]}/${needs}`,
      })),
      {
        label: 'Work',
        read: ({ map, orders }, { slot }) => {
          const { percent } = siteProgress(map, orders, slot);
          return percent === null ? 'Waiting for materials' : `${percent}%`;
        },
      },
      { label: 'Builders', read: (facts, { anchor }) => String(builders(facts, anchor)) },
    ],
  };
}

/** What the worker at a workshop does, in the words of its own panel, or that nobody works there. */
function workAt(facts: Facts, slot: number): string {
  const id = facts.frame.workplaces.indexOf(slot);
  return id < 0 ? 'Nobody works here' : doing(facts, id);
}

/**
 * The panel of a finished workplace: what it does, who works there, and the
 * control that sets how many of its places are filled, then its own `rows`.
 */
function workplacePanel(building: Building, note: string, rows: readonly Row<BuildingSelection>[] = []): Panel<BuildingSelection> {
  const { places, job } = BUILDINGS[building];
  const wanted = ({ orders }: Facts, slot: number) => orders.sites.places[slot]!;
  return {
    title: BUILDING_WORDS[building].title,
    note,
    rows: [
      { label: places === 1 ? JOB_WORDS[job].title : capital(JOB_WORDS[job].many), read: (facts, { slot }) => workersAt(facts, slot) },
      {
        label: 'Places',
        read: (facts, { slot }) => `${wanted(facts, slot)} of ${places}`,
        buttons: [
          {
            text: '−',
            name: 'Fewer places',
            disabled: (facts, { slot }) => wanted(facts, slot) <= 0,
            press: (facts, { slot }) => ({ kind: 'setPlaces', slot, places: wanted(facts, slot) - 1 }),
          },
          {
            text: '+',
            name: 'More places',
            disabled: (facts, { slot }) => wanted(facts, slot) >= places,
            press: (facts, { slot }) => ({ kind: 'setPlaces', slot, places: wanted(facts, slot) + 1 }),
          },
        ],
      },
      ...rows,
    ],
  };
}

/** Every panel. A row or a control added here shows in the panel of its kind. */
export const PANELS: Panels = {
  villager: {
    title: (facts, { id }) => titleOf(facts, id),
    rows: [
      { label: 'Doing', read: (facts, { id }) => doing(facts, id) },
      { label: 'Carries', read: ({ frame }, { id }) => CARRIED_WORDS[frame.carried[id] as Good] },
      { label: 'Job', read: (facts, { id }) => (isChild(facts, id) ? `Child, works at ${WORK_AGE}` : JOB_WORDS[jobOf(facts, id)].title) },
      {
        label: 'Sex and age',
        read: (facts, { id }) => `${(isChild(facts, id) ? CHILD_SEX_WORDS : SEX_WORDS)[facts.frame.sexes[id] as Sex]}, ${facts.frame.ages[id]}`,
      },
      { label: 'Household', read: (facts, { id }) => householdLine(facts, facts.frame.households[id]!) },
      {
        label: 'Home',
        read: ({ frame }, { id }) => (frame.homes[frame.households[id]!] === NO_HOME ? 'None, sleeps at the camp' : 'A house'),
      },
      { label: 'Missed meals', read: (facts, { id }) => missedMeals(facts, id) },
      { label: 'Cold nights', read: (facts, { id }) => coldNights(facts, id) },
    ],
  },
  houseSite: sitePanel(Building.House),
  house: {
    title: 'House',
    note: 'A finished house.',
    rows: [
      { label: 'Household', read: (facts, { slot }) => livingIn(facts, slot) },
      { label: 'Food', read: ({ frame }, { slot }) => `${frame.storeFood[slot]} of ${HOUSE_FOOD_LIMIT}` },
      { label: 'Firewood', read: ({ frame }, { slot }) => `${frame.storeFirewood[slot]} of ${HOUSE_FIREWOOD_LIMIT}` },
      {
        label: 'Fire last night',
        shows: ({ frame }) => seasonIndexAt(frame.tick) === WINTER,
        read: ({ frame }, { slot }) => {
          if (winterNightsEnded(frame.tick) === 0) return 'No winter night yet';
          return frame.firesLastNight[slot] === 1 ? 'Burned' : 'Did not burn';
        },
      },
    ],
  },
  hutSite: sitePanel(Building.Hut),
  hut: workplacePanel(
    Building.Hut,
    `Its foragers pick food in the forest within ${BUILDINGS[Building.Hut].reach} tiles and carry it to the nearest store with room.`,
  ),
  barnSite: sitePanel(Building.Barn),
  barn: {
    title: 'Barn',
    note: 'A finished barn. Food in it keeps.',
    rows: [{ label: 'Food', read: ({ frame }, { slot }) => `${frame.storeFood[slot]} of ${BARN_FOOD_LIMIT}` }],
  },
  lodgeSite: sitePanel(Building.Lodge),
  lodge: workplacePanel(
    Building.Lodge,
    `Its hunters hunt deer within ${BUILDINGS[Building.Lodge].reach} tiles and carry the food to the nearest store with room.`,
  ),
  woodshedSite: sitePanel(Building.Woodshed),
  woodshed: workplacePanel(
    Building.Woodshed,
    `Its woodcutter carries logs from the stockpiles within ${BUILDINGS[Building.Woodshed].reach} tiles and splits each into 2 firewood.`,
    [
      { label: 'Firewood', read: ({ frame }, { slot }) => `${frame.storeFirewood[slot]} of ${WOODSHED_FIREWOOD_LIMIT}` },
      { label: 'Doing', read: (facts, { slot }) => workAt(facts, slot) },
    ],
  ),
  tailorSite: sitePanel(Building.Tailor),
  tailor: workplacePanel(
    Building.Tailor,
    `Its tailor carries hides from the stockpiles within ${BUILDINGS[Building.Tailor].reach} tiles and makes 1 piece of clothing from each 2.`,
    [
      { label: 'Clothing', read: ({ frame }, { slot }) => `${frame.storeClothing[slot]} of ${TAILOR_CLOTHING_LIMIT}` },
      { label: 'Doing', read: (facts, { slot }) => workAt(facts, slot) },
    ],
  ),
  camp: {
    title: 'Camp',
    rows: [
      { label: 'Settlers here', read: (facts) => String(settlersAtCamp(facts)) },
      { label: 'Food', read: ({ frame }) => `${frame.storeFood[CAMP_STORE]} of ${frame.campFoodLimit}` },
      { label: 'Firewood', read: ({ frame }) => `${frame.storeFirewood[CAMP_STORE]} of ${CAMP_FIREWOOD_LIMIT}` },
    ],
  },
};

function show<K extends PanelKind>(panels: Panels, kind: K, selection: PanelSelections[K], facts: Facts): PanelText {
  const panel: Panel<PanelSelections[K]> = panels[kind];
  return {
    kind,
    title: typeof panel.title === 'string' ? panel.title : panel.title(facts, selection),
    ...(panel.note === undefined ? {} : { note: panel.note }),
    rows: panel.rows.filter(({ shows }) => shows?.(facts) ?? true).map(({ label, read, buttons }) => ({
      label,
      value: read(facts, selection),
      ...(buttons && {
        buttons: buttons.map(({ text, name, disabled, press }) => ({
          text,
          name,
          disabled: disabled?.(facts, selection) ?? false,
          press: () => press(facts, selection),
        })),
      }),
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
    case 'building': {
      const { name } = kindOf(facts.orders.sites, selection.slot);
      return show(panels, facts.orders.sites.state[selection.slot] === SiteState.Built ? name : `${name}Site`, selection, facts);
    }
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
  /** Sends a command that a control's button gives to the simulation. */
  readonly send: (command: Command) => void;
  readonly panels?: Panels;
}

/**
 * Lets the player select a settler, a building, or the camp with a click while
 * no order tool is active, rings it on the map, and says in a panel what it is
 * and what it is doing. A click on bare ground, the close button, or Escape
 * clears the selection.
 */
export function mountSelection(root: HTMLElement, { map, orders, camp, canvas, camera, mark, mainButtonPans, send, panels = PANELS }: SelectionSetup) {
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
  let shown: string | null = null;
  let values: HTMLElement[] = [];
  let controls: HTMLButtonElement[][] = [];
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
    const layout = [text.kind, ...text.rows.map(({ label }) => label)].join('|');
    if (layout !== shown) {
      shown = layout;
      values = text.rows.map(() => document.createElement('span'));
      controls = text.rows.map(({ buttons = [] }, row) =>
        buttons.map(({ text: face, name: accessible }, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = face;
          button.setAttribute('aria-label', accessible);
          button.addEventListener('mousedown', (event) => event.preventDefault());
          button.addEventListener('click', () => {
            const pressed = text?.rows[row]?.buttons?.[index];
            if (pressed && !pressed.disabled) send(pressed.press());
          });
          return button;
        }),
      );
      list.replaceChildren(
        ...text.rows.flatMap(({ label }, row) => {
          const name = document.createElement('dt');
          name.textContent = label;
          const value = document.createElement('dd');
          value.append(values[row]!, ...controls[row]!);
          return [name, value];
        }),
      );
      list.hidden = text.rows.length === 0;
      note.hidden = text.note === undefined;
    }
    setText(title, text.title);
    setText(note, text.note ?? '');
    text.rows.forEach(({ value, buttons = [] }, row) => {
      setText(values[row]!, value);
      buttons.forEach(({ disabled }, index) => (controls[row]![index]!.disabled = disabled));
    });
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
