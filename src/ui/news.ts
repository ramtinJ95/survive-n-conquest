import { BUILDINGS, Building } from '../sim/buildings';
import { TICKS_PER_DAY, dateAt } from '../sim/calendar';
import { type Sex, nameOf } from '../sim/names';
import { COLD, HUNGER } from '../sim/needs';
import type { Orders } from '../sim/orders';
import { VillagerState } from '../sim/villagerState';
import type { SimFrame } from '../frame';
import { BUILDING_WORDS, JOB_WORDS } from './buildings';
import { formatTime } from './clock';
import './news.css';

type Seen = Pick<SimFrame, 'tick' | 'states' | 'missedMeals' | 'coldNights' | 'names' | 'sexes' | 'workplaces'>;

/** Something that can befall a settler between two frames, and the words that say it of the settlers it befell. */
interface NewsEvent {
  readonly kind: string;
  /** Whether it befell settler `id` between the frame `before` and the frame `after`, with the kinds of the buildings in `orders`. */
  readonly befell: (before: Seen, after: Seen, id: number, orders: Orders) => boolean;
  /** What the settlers named in a line did, for a line that names `count` of them. */
  readonly verb: (count: number) => string;
}

const alive = (frame: Seen, id: number) => frame.states[id] !== VillagerState.Dead;
const died = (before: Seen, after: Seen, id: number) => alive(before, id) && !alive(after, id);

/** The kinds of building with places to work in, each with its own lines of who took a place and who left one. */
const WORKPLACES = (Object.values(Building) as Building[]).filter((building) => BUILDINGS[building].places > 0);

/** Every kind of news, in the order a frame's lines are made. */
const EVENTS: readonly NewsEvent[] = [
  { kind: 'hungry', befell: (before, after, id) => alive(after, id) && before.missedMeals[id] === 0 && after.missedMeals[id]! > 0, verb: () => 'went hungry' },
  { kind: 'starved', befell: (before, after, id) => died(before, after, id) && after.missedMeals[id]! >= HUNGER.diesAt, verb: () => 'starved' },
  { kind: 'ate', befell: (before, after, id) => alive(after, id) && before.missedMeals[id]! > 0 && after.missedMeals[id] === 0, verb: () => 'ate again' },
  { kind: 'cold', befell: (before, after, id) => alive(after, id) && after.coldNights[id]! > before.coldNights[id]!, verb: () => 'had a cold night' },
  { kind: 'froze', befell: (before, after, id) => died(before, after, id) && after.coldNights[id]! >= COLD.diesAt, verb: () => 'froze' },
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
];

/** A line shows for this long, in milliseconds of wall time, so it can be read at 8×. */
export const LINE_MS = 30_000;
/** At most this many lines show. A later line waits until one of them has shown for `LINE_MS`. */
export const MOST_LINES = 5;
/** Events of a kind within this many ticks of a line's first join that line, as the settlers who reach the camp over a dusk. */
const JOIN_TICKS = TICKS_PER_DAY / 24;
/** A line names this many settlers at most and counts the rest. */
const NAMED = 8;

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

function lineText(frame: Seen, line: Pick<NewsLine, 'kind' | 'tick' | 'ids'>): string {
  const { day, minuteOfDay } = dateAt(line.tick);
  const names = line.ids.map((id) => nameOf(frame.sexes[id] as Sex, frame.names[id]!));
  const { verb } = EVENTS.find(({ kind }) => kind === line.kind)!;
  return `Day ${day}, ${formatTime(minuteOfDay)}. ${listNames(names)} ${verb(names.length)}.`;
}

/**
 * The settlement's news: who went hungry, who starved, who ate again, who had
 * a cold night, who froze, who took a place at a workplace, and who left one, found by comparing each
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

/** The log that tells the player who went hungry, who starved, who ate again, who had a cold night, who froze, and who took or left a place at a workplace, by name. */
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
