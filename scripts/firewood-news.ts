// Whether the news line at dusk for a workshop that did no work keeps any other line waiting: `bun scripts/firewood-news.ts`.
// For #40's three years, three firewood years, and seed 7 with no orders, it hears a frame after every tick at the wall
// time of 8x and of 1x, as the page does, and counts the lines of hunger, cold, and jobs that had to wait for a place
// among the 4 that show, and how many of those waited while a workshop's line showed.
import { frameOf } from '../src/frame';
import { createNews, MOST_LINES } from '../src/ui/news';
import { HIDES_LAYOUT, NOTHING_FOR_WARMTH, WOOD_LAYOUT, playWinterYear, winterYearCommands } from '../src/sim/firstYear';
import { PLANS, clock, ordersOf } from './firewood-years';
import { applyCommand, createSim, SETTLERS, step, type Sim } from '../src/sim/sim';
import { generateMap } from '../src/sim/mapgen';
const years: [string, () => { sim: Sim; step: () => void }][] = [
  ['wood', () => playWinterYear(winterYearCommands({ houses: 4, layout: WOOD_LAYOUT, tailor: 'at start' }))],
  ['hides', () => playWinterYear(winterYearCommands({ houses: 2, layout: HIDES_LAYOUT, tailor: 'after lodge' }))],
  ['nothing', () => playWinterYear(NOTHING_FOR_WARMTH)],
  ...(['near-houses-late-shed', 'west-houses-late-shed', 'near-houses-shed-at-start'] as const).map((n): [string, () => { sim: Sim; step: () => void }] => [n, () => {
    const sim = createSim(generateMap(7), SETTLERS); const pending = ordersOf(PLANS[n]!);
    return { sim, step: () => { for (let i = 0; i < pending.length;) { if (pending[i]!.when.ready(sim)) for (const c of pending.splice(i, 1)[0]!.give(sim)) applyCommand(sim, c); else i++; } step(sim); } };
  }]),
  ['no orders', () => { const sim = createSim(generateMap(7), SETTLERS); return { sim, step: () => step(sim) }; }],
];
for (const msPerTick of [12.5, 100]) for (const [name, make] of years) {
  const { sim, step: go } = make();
  const news = createNews(sim.orders);
  news.hear(frameOf(sim).frame, 0);
  const seen = new Map<object, { kind: string; made: number; shown: number; idleShowing: number }>();
  let idleLines = 0, maxWaitTicks = 0, waitedBy = '';
  while (!sim.over && sim.tick < 3000 * 12 + 1200) {
    go();
    const now = sim.tick * msPerTick;
    news.hear(frameOf(sim).frame, now); news.prune(now);
    const shown = news.lines();
    for (const l of shown) if (!seen.has(l)) {
      const idleShowing = shown.filter((o) => o !== l && o.kind.startsWith('no work')).length;
      seen.set(l, { kind: l.kind, made: l.tick, shown: sim.tick, idleShowing });
      if (l.kind.startsWith('no work')) idleLines++;
      else if (sim.tick - l.tick > maxWaitTicks) { maxWaitTicks = sim.tick - l.tick; waitedBy = `${l.kind} made ${clock(l.tick)} shown ${clock(sim.tick)} with ${idleShowing} idle-day lines showing`; }
    }
  }
  const waited = [...seen.values()].filter((v) => !v.kind.startsWith('no work') && v.shown - v.made > 1);
  console.log(`${msPerTick === 12.5 ? '8x' : '1x'} ${name}: idle-day lines ${idleLines}; hunger/cold/job lines ${[...seen.values()].filter((v) => !v.kind.startsWith('no work')).length}, of them waited ${waited.length}${waited.length ? ` (longest: ${waitedBy})` : ''}; waited with an idle-day line showing ${waited.filter((v) => v.idleShowing > 0).length}; max lines ${MOST_LINES}`);
}
