// Every kind of selection panel, from the game's own `PANELS`, so a check can fill a copy of each with its longest readings.
// Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/panelRows.ts
// It prints each kind's title when it is fixed, its note, its rows with their buttons, and, for a site, what it needs of
// each good. It also prints the names a woman and a man can have, the most settlers a game holds, the swarm's, and the
// most builders a site takes.
import { MAX_BUILDERS } from '../../../../src/sim/building';
import { BUILDINGS } from '../../../../src/sim/buildings';
import { NAMES, Sex } from '../../../../src/sim/names';
import { BENCHMARK_POPULATION } from '../../../../src/sim/sim';
import { neededGoods } from '../../../../src/ui/buildings';
import { PANELS } from '../../../../src/ui/selection';

const needs = (kind: string) => {
  const building = Object.values(BUILDINGS).find(({ name }) => `${name}Site` === kind);
  return building ? Object.fromEntries(neededGoods(building).map(({ label, needs }) => [label, needs])) : null;
};

const kinds = Object.entries(PANELS).map(([kind, panel]) => ({
  kind,
  title: typeof panel.title === 'string' ? panel.title : null,
  note: panel.note ?? null,
  rows: panel.rows.map(({ label, buttons = [] }) => ({ label, buttons: buttons.map(({ text, name }) => ({ text, name })) })),
  needs: needs(kind),
}));

console.log(JSON.stringify({ women: NAMES[Sex.Woman], men: NAMES[Sex.Man], mostSettlers: BENCHMARK_POPULATION.villagers, mostBuilders: MAX_BUILDERS, kinds }));
