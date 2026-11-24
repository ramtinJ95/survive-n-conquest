// The lines the news can show, written by the game's own news module, so a check can fill the log with its longest.
// Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/newsLines.ts '<names>' <day>
// With no arguments it prints the names a settler can have and the most lines the log shows. With the names, widest
// first, it prints one line of every kind at 23:59 on that day: one naming the 8 widest settlers, and one naming 1,500,
// as the swarm does, which names the 7 widest and counts the rest. A line of births gives each child the second and
// third widest names as its parents.
import { MINUTES_PER_DAY, OPENING_MINUTE, TICKS_PER_DAY } from '../../../../src/sim/calendar';
import { NAMES } from '../../../../src/sim/names';
import { MOST_LINES, NEWS_KINDS, lineWords } from '../../../../src/ui/news';

const [namesText, dayText] = process.argv.slice(2);
if (!namesText) {
  console.log(JSON.stringify({ names: [...new Set(NAMES.flat())], mostLines: MOST_LINES }));
} else {
  const widest: string[] = JSON.parse(namesText);
  const tick = (Number(dayText) - 1) * TICKS_PER_DAY + Math.ceil(((MINUTES_PER_DAY - 1 - OPENING_MINUTE) * TICKS_PER_DAY) / MINUTES_PER_DAY);
  const swarm = [...widest.slice(0, 7), ...Array.from({ length: 1493 }, () => widest[7]!)];
  const parents = (names: readonly string[]) => names.map(() => `${widest[1]} and ${widest[2]}`);
  const line = (kind: string, names: readonly string[]) => lineWords(kind, tick, names, parents(names));
  console.log(JSON.stringify(NEWS_KINDS.flatMap((kind) => [line(kind, widest.slice(0, 8)), line(kind, swarm)])));
}
