// Every kind of selection panel, from the game's own `PANELS`, so a check can fill a copy of each with its longest readings.
// Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/panelRows.ts
// It prints each kind's title when it is fixed, its note, its rows with their buttons, and, for a site, what it needs of
// each good. It also prints the names a woman and a man can have, the most settlers a game holds, the swarm's, and the
// most builders a site takes. `words` holds every reading of a row that the game builds from its word tables, with each
// part a word can name filled from the table of that part. `born` holds the words of a child's title.
import { GROWN_AGE } from '../../../../src/sim/aging';
import { MAX_BUILDERS } from '../../../../src/sim/building';
import { BUILDINGS, Building } from '../../../../src/sim/buildings';
import { NAMES, Sex } from '../../../../src/sim/names';
import { BENCHMARK_POPULATION } from '../../../../src/sim/sim';
import { BUILDING_WORDS, JOB_WORDS, capital, neededGoods } from '../../../../src/ui/buildings';
import {
  ANY_SITE,
  BORN_WORDS,
  CARRIED_WORDS,
  CAUSE_WORDS,
  DOING_WORDS,
  type DoingParts,
  type DoingWords,
  GOOD_NAMES,
  PANELS,
  ROW_WORDS,
  SEX_WORDS,
  STATE_WORDS,
  STORE_WORDS,
  WORKSHOP_WORDS,
  YOUNG_SEX_WORDS,
} from '../../../../src/ui/selection';
import { Good } from '../../../../src/sim/goods';

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

/** The oldest ages a panel shows, which the game counts at run time: a settler dies of old age by 80. */
const OLDEST = ['79', '80'];

const PARTS: { readonly [K in keyof DoingParts]: readonly string[] } = {
  good: Object.entries(GOOD_NAMES).filter(([good]) => Number(good) !== Good.None).map(([, word]) => word),
  store: Object.values(STORE_WORDS),
  site: [...Object.values(BUILDING_WORDS).map(({ noun }) => noun), ANY_SITE],
  cause: Object.values(CAUSE_WORDS),
  age: OLDEST,
};

/** Every combination of the parts, so that each word built from parts reads with every part its table holds. */
const combinations = (Object.keys(PARTS) as (keyof DoingParts)[]).reduce<DoingParts[]>(
  (all, part) => all.flatMap((parts) => PARTS[part].map((word) => ({ ...parts, [part]: word }))),
  [{} as DoingParts],
);

const unique = (words: readonly string[]) => [...new Set(words)];
const spelled = (table: DoingWords) => unique(Object.values(table).flatMap((word) => (typeof word === 'string' ? [word] : combinations.map(word))));
const values = (table: object) => Object.values(table).filter((word): word is string => typeof word === 'string');
const workshopWords = (building: Building) => {
  const { stops, ...doing } = WORKSHOP_WORDS[building]!;
  return [...values(doing), ...values(stops)];
};

const night = values(STATE_WORDS);
const anyone = [...spelled(DOING_WORDS.anyone), ...night];
const workshops = Object.keys(WORKSHOP_WORDS).map(Number) as Building[];
const words: Record<string, Record<string, string[]>> = {
  villager: {
    Doing: unique([...Object.values(DOING_WORDS).flatMap(spelled), ...night, ...workshops.flatMap(workshopWords)]),
    Carries: values(CARRIED_WORDS),
    Job: [ROW_WORDS.job.child, ...Object.values(JOB_WORDS).map(({ title }) => title)],
    'Sex and age': [...values(SEX_WORDS).flatMap((sex) => OLDEST.map((age) => `${sex}, ${age}`)), ...values(YOUNG_SEX_WORDS).map((sex) => `${sex}, ${GROWN_AGE - 1}`)],
    Home: values(ROW_WORDS.home),
    'Missed meals': values(ROW_WORDS.count),
    'Cold nights': values(ROW_WORDS.count),
  },
  house: { 'Fire last night': values(ROW_WORDS.fire), Household: values(ROW_WORDS.people) },
  farm: { Doing: [...spelled(DOING_WORDS.farmer), ...anyone, ROW_WORDS.doing.nobody] },
  site: { Work: values(ROW_WORDS.work) },
  ...Object.fromEntries(workshops.map((building) => [BUILDINGS[building].name, { Doing: [...workshopWords(building), ...anyone, ROW_WORDS.doing.nobody] }])),
};
for (const { name, places, job } of Object.values(BUILDINGS)) {
  if (!places) continue;
  const workers = places === 1 ? JOB_WORDS[job].title : capital(JOB_WORDS[job].many);
  words[name] = { ...words[name], [workers]: values(ROW_WORDS.people) };
}

console.log(
  JSON.stringify({
    women: NAMES[Sex.Woman],
    men: NAMES[Sex.Man],
    mostSettlers: BENCHMARK_POPULATION.villagers,
    mostBuilders: MAX_BUILDERS,
    kinds,
    words,
    born: values(BORN_WORDS),
  }),
);
