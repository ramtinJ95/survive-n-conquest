import { BUILDINGS, Building, needOf } from '../sim/buildings';
import { TICKS_PER_DAY, dateAt } from '../sim/calendar';
import { isNight } from '../sim/daylight';
import { type Sex, nameOf } from '../sim/names';
import type { Orders } from '../sim/orders';
import { Cause, VillagerState } from '../sim/villagerState';
import { Stop } from '../sim/workshops';
import type { SimFrame } from '../frame';
import { BUILDING_WORDS, JOB_WORDS } from './buildings';
import { formatTime } from './clock';
import './news.css';

type Seen = Pick<SimFrame, 'tick' | 'children' | 'states' | 'causes' | 'missedMeals' | 'coldNights' | 'names' | 'sexes' | 'mothers' | 'fathers' | 'households' | 'couples' | 'workplaces' | 'workshopStops' | 'workshopWorked'>;

/** Something that can befall a settler between two frames, and the words that say it of the settlers it befell. */
interface NewsEvent {
  readonly kind: string;
  /** Whether it befell settler `id` between the frame `before` and the frame `after`, with the kinds of the buildings in `orders`. */
  readonly befell: (before: Seen, after: Seen, id: number, orders: Orders) => boolean;
  /** What the settlers named in a line did, for a line that names `count` of them. */
  readonly verb: (count: number) => string;
}

const alive = (frame: Seen, id: number) => frame.states[id] !== VillagerState.Dead;
/** Whether the settler died of `cause` between the two frames. */
const diedOf = (cause: Cause) => (before: Seen, after: Seen, id: number) => alive(before, id) && !alive(after, id) && after.causes[id] === cause;

/** The kinds of building with places to work in, each with its own lines of who took a place and who left one. */
const WORKPLACES = (Object.values(Building) as Building[]).filter((building) => BUILDINGS[building].places > 0);

/** The kinds of workshop, each with its own line at dusk for a worker that did none of its work that day for lack of its input. */
const WORKSHOPS = (Object.values(Building) as Building[]).filter((building) => BUILDINGS[building].recipe !== null);

/** The reasons a lack of input can stop a workshop's worker. */
type IdleStop = typeof Stop.ForSites | typeof Stop.NotStocked | typeof Stop.NoInput;

/**
 * What a workshop's worker made none of, and why, for each reason a lack of input stops it, kept short enough that
 * a line naming eight settlers and counting 1,493 more takes no more rows than the longest line before them.
 */
const IDLE_DAY_WORDS: Readonly<Partial<Record<Building, { readonly none: string } & Readonly<Record<IdleStop, string>>>>> = {
  [Building.Woodshed]: { none: 'split no firewood', [Stop.ForSites]: 'sites need the logs', [Stop.NotStocked]: 'no log carried yet', [Stop.NoInput]: 'no log in reach' },
  [Building.Tailor]: { none: 'made no clothing', [Stop.ForSites]: 'sites need the hides', [Stop.NotStocked]: 'no hide carried yet', [Stop.NoInput]: 'no hide in reach' },
};

/** The reasons a lack of input can stop a workshop's worker: the sites only for an input some kind of building needs. */
const idleReasons = (building: Building): readonly IdleStop[] => {
  const input = BUILDINGS[building].recipe!.input;
  return Object.values(BUILDINGS).some((kind) => needOf(kind, input) > 0) ? [Stop.ForSites, Stop.NotStocked, Stop.NoInput] : [Stop.NotStocked, Stop.NoInput];
};

/** Whether the night began between the two frames, so the day's work is over. */
const duskFell = (before: Seen, after: Seen) => !isNight(before.tick) && isNight(after.tick);

/** The kind of line that says who was born and to whom. Its words name each child with its parents. */
const BORN = 'born';
/** The kind of line that says who formed a household. It befalls the woman of each new couple, and its words name each couple. */
const FORMED = 'formed';

/** Whether woman `id` formed a household between the two frames, as the woman of its couple. */
const formed = (before: Seen, after: Seen, id: number) =>
  alive(after, id) && id < before.households.length && before.households[id] !== after.households[id] && after.couples[after.households[id]! * 2 + 1] === id;

/** Every kind of news, in the order a frame's lines are made. */
const EVENTS: readonly NewsEvent[] = [
  { kind: BORN, befell: (before, _after, id) => id >= before.states.length, verb: () => 'was born' },
  { kind: FORMED, befell: formed, verb: () => 'formed a household' },
  { kind: 'hungry', befell: (before, after, id) => alive(after, id) && before.missedMeals[id] === 0 && after.missedMeals[id]! > 0, verb: () => 'went hungry' },
  { kind: 'starved', befell: diedOf(Cause.Hunger), verb: () => 'starved' },
  { kind: 'ate', befell: (before, after, id) => alive(after, id) && before.missedMeals[id]! > 0 && after.missedMeals[id] === 0, verb: () => 'ate again' },
  { kind: 'cold', befell: (before, after, id) => alive(after, id) && after.coldNights[id]! > before.coldNights[id]!, verb: () => 'had a cold night' },
  { kind: 'froze', befell: diedOf(Cause.Cold), verb: () => 'froze' },
  { kind: 'old age', befell: diedOf(Cause.OldAge), verb: () => 'died of old age' },
  { kind: 'started work', befell: (before, after, id) => alive(after, id) && before.children[id] === 1 && after.children[id] === 0, verb: () => 'started to work' },
  ...WORKPLACES.flatMap((building): NewsEvent[] => {
    const job = JOB_WORDS[BUILDINGS[building].job];
    const at = (frame: Seen, id: number, orders: Orders) => frame.workplaces[id]! >= 0 && orders.sites.kind[frame.workplaces[id]!] === building;
    return [
      {
        kind: `left ${BUILDING_WORDS[building].noun}`,
        befell: (before, after, id, orders) => alive(after, id) && before.workplaces[id] !== after.workplaces[id] && at(before, id, orders),
        verb: () => `left the ${BUILDING_WORDS[building].noun}`,
      },
      {
        kind: `took a place at ${BUILDING_WORDS[building].noun}`,
        befell: (before, after, id, orders) => alive(after, id) && before.workplaces[id] !== after.workplaces[id] && at(after, id, orders),
        verb: (count) => `became ${count === 1 ? job.one : job.many}`,
      },
    ];
  }),
  ...WORKSHOPS.flatMap((building) =>
    idleReasons(building).map((stop): NewsEvent => {
      const words = IDLE_DAY_WORDS[building]!;
      return {
        kind: `no work at ${BUILDING_WORDS[building].noun}, ${words[stop]}`,
        befell: (before, after, id, orders) => {
          const slot = after.workplaces[id]!;
          return duskFell(before, after) && alive(after, id) && slot >= 0 && orders.sites.kind[slot] === building && after.workshopWorked[slot] === 0 && after.workshopStops[slot] === stop;
        },
        verb: () => `${words.none}: ${words[stop]}`,
      };
    }),
  ),
];

/** A line shows for this long, in milliseconds of wall time, so it can be read at 8×. */
export const LINE_MS = 30_000;
/** At most this many lines show. A later line waits until one of them has shown for `LINE_MS`. */
export const MOST_LINES = 4;
/** Events of a kind within this many ticks of a line's first join that line, as the settlers who reach the camp over a dusk. */
const JOIN_TICKS = TICKS_PER_DAY / 24;
/** A line names this many settlers at most and counts the rest. */
const NAMED = 8;
/** A line of births names this many children with their parents at most and counts the rest, so it takes no more rows than the longest line before it. */
const NAMED_BIRTHS = 2;
/** A line of new households names this many couples at most and counts the rest, as a line of births does. */
const NAMED_COUPLES = 2;

export interface NewsLine {
  readonly kind: string;
  /** The tick of the line's first event. */
  readonly tick: number;
  readonly ids: number[];
  text: string;
  /** When the line last changed while it showed, or when it first showed, in milliseconds of wall time. */
  changedAt: number;
  /** Whether the line has shown yet. A line waits while `MOST_LINES` older ones show. */
  shown: boolean;
}

/** "Merek", "Merek and Elsi", up to eight names, or "Merek, Elsi, ... Dorran and 1,493 others". */
export function listNames(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  const shown = names.length > NAMED ? names.slice(0, NAMED - 1) : names.slice(0, -1);
  const last = names.length > NAMED ? `${(names.length - shown.length).toLocaleString('en-US')} others` : names.at(-1)!;
  return `${shown.join(', ')} and ${last}`;
}

/** Every kind of line the news can show. */
export const NEWS_KINDS: readonly string[] = EVENTS.map(({ kind }) => kind);

/**
 * "Tova was born to Ulvar and Ysa", "Tova was born to Ulvar and Ysa, and Bodo
 * to Merek and Elsi", or, past `NAMED_BIRTHS` children, the first of them so
 * and "and 3 others", from each child's name and its parents' names.
 */
function birthWords(names: readonly string[], parents: readonly string[]): string {
  const named = names.length > NAMED_BIRTHS ? NAMED_BIRTHS : names.length;
  const each = names.slice(0, named).map((name, at) => (at === 0 ? `${name} was born to ${parents[at]}` : `${name} to ${parents[at]}`));
  if (names.length > named) each.push(`${(names.length - named).toLocaleString('en-US')} others`);
  return each.length === 1 ? each[0]! : `${each.slice(0, -1).join(', ')}, and ${each.at(-1)!}`;
}

/**
 * "Merek and Elsi formed a household", "Merek and Elsi formed a household, and
 * so did Ulvar and Ysa", or, past `NAMED_COUPLES` couples, the first of them
 * so and "and 3 other couples", from each couple's names.
 */
function formedWords(couples: readonly string[]): string {
  const first = `${couples[0]} formed a household`;
  if (couples.length === 1) return first;
  const rest = couples.length - NAMED_COUPLES;
  const counted = rest > 0 ? ` and ${rest.toLocaleString('en-US')} other ${rest === 1 ? 'couple' : 'couples'}` : '';
  return `${first}, and so did ${couples[1]}${counted}`;
}

/**
 * The words of a line of `kind` whose first event came at `tick`, naming the
 * settlers in `names`, and for a line of births each child's parents in
 * `parents`. A line of new households names its couples in `names`, each as
 * "Merek and Elsi", the man first.
 */
export function lineWords(kind: string, tick: number, names: readonly string[], parents: readonly string[] = []): string {
  const { day, minuteOfDay } = dateAt(tick);
  const { verb } = EVENTS.find((event) => event.kind === kind)!;
  const words = kind === BORN ? birthWords(names, parents) : kind === FORMED ? formedWords(names) : `${listNames(names)} ${verb(names.length)}`;
  return `Day ${day}, ${formatTime(minuteOfDay)}. ${words}.`;
}

function lineText(frame: Seen, line: Pick<NewsLine, 'kind' | 'tick' | 'ids'>): string {
  const name = (id: number) => nameOf(frame.sexes[id] as Sex, frame.names[id]!);
  const parents = line.kind === BORN ? line.ids.map((id) => `${name(frame.fathers[id]!)} and ${name(frame.mothers[id]!)}`) : [];
  const couple = (woman: number) => `${name(frame.couples[frame.households[woman]! * 2]!)} and ${name(woman)}`;
  return lineWords(line.kind, line.tick, line.ids.map(line.kind === FORMED ? couple : name), parents);
}

/**
 * The settlement's news: who was born and to whom, who formed a household, who went hungry, who starved, who ate again, who had
 * a cold night, who froze, who died of old age, who started to work, who took a place at a
 * workplace, who left one, and, at dusk, the worker at a workshop that did none of its work that day for lack of its input and why, found by comparing each
 * frame with the one before, with the kinds of the buildings in `orders`.
 * The events of a kind close together in time make one line.
 */
export function createNews(orders: Orders) {
  let last: Seen | null = null;
  let lines: NewsLine[] = [];

  return {
    /** Takes in a frame at wall time `now`, in milliseconds, and returns whether the lines changed. */
    hear(frame: Seen, now: number): boolean {
      const before = last;
      last = frame;
      if (!before) return false;
      const tick = Math.max(frame.tick - 1, 0);
      let changed = false;
      for (const { kind, befell } of EVENTS) {
        const ids: number[] = [];
        for (let id = 0; id < frame.states.length; id++) if (befell(before, frame, id, orders)) ids.push(id);
        if (ids.length === 0) continue;
        const joined = lines.findLast((line) => line.kind === kind && tick - line.tick < JOIN_TICKS);
        const line = joined ?? { kind, tick, ids: [], text: '', changedAt: now, shown: lines.length < MOST_LINES };
        line.ids.push(...ids);
        line.ids.sort((a, b) => a - b);
        line.text = lineText(frame, line);
        if (line.shown) {
          line.changedAt = now;
          changed = true;
        }
        if (!joined) lines.push(line);
      }
      return changed;
    },
    /** Drops the lines that have shown long enough, shows the waiting lines that now have room, and returns whether the shown lines changed. */
    prune(now: number): boolean {
      const kept = lines.filter((line) => !line.shown || now - line.changedAt < LINE_MS);
      let changed = kept.length !== lines.length;
      lines = kept;
      for (const line of lines.slice(0, MOST_LINES)) {
        if (line.shown) continue;
        line.shown = true;
        line.changedAt = now;
        changed = true;
      }
      return changed;
    },
    /** The lines that show, oldest first. */
    lines: (): readonly NewsLine[] => lines.filter((line) => line.shown),
  };
}

/** The log that tells the player who was born and to whom, who formed a household, who went hungry, who starved, who ate again, who had a cold night, who froze, who died of old age, who started to work, and who took or left a place at a workplace, by name. */
export function mountNews(root: HTMLElement, orders: Orders) {
  const panel = document.createElement('section');
  panel.className = 'news';
  panel.setAttribute('role', 'log');
  panel.setAttribute('aria-label', 'Settlement news');
  panel.hidden = true;
  root.append(panel);
  const news = createNews(orders);

  const show = () => {
    panel.replaceChildren(
      ...news.lines().map(({ text }) => {
        const line = document.createElement('p');
        line.textContent = text;
        return line;
      }),
    );
    panel.hidden = news.lines().length === 0;
  };
  // The clock stops when the settlement dies out, so the lines go on a timer of their own.
  setInterval(() => {
    if (news.prune(performance.now())) show();
  }, 1000);

  return {
    /** Takes in a frame from the worker. */
    heard(data: SimFrame) {
      if (news.hear(data, performance.now())) show();
    },
  };
}
