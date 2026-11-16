import { TICKS_PER_DAY, dateAt } from '../sim/calendar';
import { type Sex, nameOf } from '../sim/names';
import { VillagerState } from '../sim/villagerState';
import type { SimFrame } from '../frame';
import { formatTime } from './clock';
import './news.css';

/** What befell a settler between two frames, with the words that say it. */
const EVENTS = [
  { kind: 'hungry', verb: 'went hungry' },
  { kind: 'starved', verb: 'starved' },
  { kind: 'ate', verb: 'ate again' },
] as const;
type EventKind = (typeof EVENTS)[number]['kind'];

/** A line shows for this long, in milliseconds of wall time, so it can be read at 8×. */
export const LINE_MS = 30_000;
/** At most this many lines show. A later line waits until one of them has shown for `LINE_MS`. */
export const MOST_LINES = 5;
/** Events of a kind within this many ticks of a line's first join that line, as the settlers who reach the camp over a dusk. */
const JOIN_TICKS = TICKS_PER_DAY / 24;
/** A line names this many settlers at most and counts the rest. */
const NAMED = 8;

type Seen = Pick<SimFrame, 'tick' | 'states' | 'missedMeals' | 'names' | 'sexes'>;

export interface NewsLine {
  readonly kind: EventKind;
  /** The tick of the line's first event. */
  readonly tick: number;
  readonly ids: number[];
  text: string;
  /** When the line last changed while it showed, or when it first showed, in milliseconds of wall time. */
  changedAt: number;
  /** Whether the line has shown yet. A line waits while `MOST_LINES` older ones show. */
  shown: boolean;
}

/** What befell a settler between the frame before and this one, or null when nothing did. */
function eventOf(before: Seen, after: Seen, id: number): EventKind | null {
  if (before.states[id] !== VillagerState.Dead && after.states[id] === VillagerState.Dead) return 'starved';
  if (after.states[id] === VillagerState.Dead) return null;
  if (before.missedMeals[id] === 0 && after.missedMeals[id]! > 0) return 'hungry';
  if (before.missedMeals[id]! > 0 && after.missedMeals[id] === 0) return 'ate';
  return null;
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
  return `Day ${day}, ${formatTime(minuteOfDay)}. ${listNames(names)} ${verb}.`;
}

/**
 * The settlement's news: who went hungry, who starved, and who ate again,
 * found by comparing each frame with the one before. The events of a kind
 * close together in time make one line.
 */
export function createNews() {
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
      for (const { kind } of EVENTS) {
        const ids: number[] = [];
        for (let id = 0; id < frame.states.length; id++) if (eventOf(before, frame, id) === kind) ids.push(id);
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

/** The log that tells the player who went hungry, who starved, and who ate again, by name. */
export function mountNews(root: HTMLElement) {
  const panel = document.createElement('section');
  panel.className = 'news';
  panel.setAttribute('role', 'log');
  panel.setAttribute('aria-label', 'Settlement news');
  panel.hidden = true;
  root.append(panel);
  const news = createNews();

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
