// The births of the `births` scenario's pages, from the game's own modules under `bun`, so a check can compare the page
// with the rules. Run from the checkout root: bun .claude/skills/verify-survive-n-conquest/scripts/births.ts '<settlers>' <food> <dawns>
// It plays seed 7 with the `settlers` setting and the camp's starting food, `-` for the default, and gives the orders
// that `firewood-year` gives through the page at 08:00 on day 1, `near-houses-at-minutes` without its woodshed. For each
// of the first `<dawns>` dawns it prints the minute the page stops at after it, each household's house slot, living
// members, members with a missed meal or a cold night, the woman's age, and whether its draw falls under the chance,
// the children born there with their names and sexes, and the children who started to work there.
import { ageAt } from '../../../../src/sim/aging';
import { BIRTH_CHANCE, birthDraw } from '../../../../src/sim/births';
import { dateAt } from '../../../../src/sim/calendar';
import { isDawn } from '../../../../src/sim/daylight';
import { generateMap } from '../../../../src/sim/mapgen';
import { type Sex, nameOf } from '../../../../src/sim/names';
import { applyCommand, createSim, parseSettlers, populationFor, step } from '../../../../src/sim/sim';
import { VillagerState } from '../../../../src/sim/villagerState';
import { PLANS, ordersOf } from '../../../../scripts/firewood-years';

const [settlers, food, dawnsText] = process.argv.slice(2);
const stated = parseSettlers(settlers ?? null);
if (!stated) throw new Error(`the settlers setting "${settlers}" does not parse`);
const sim = createSim(generateMap(7), populationFor(null, food === '-' ? null : (food ?? null), null, stated));
const pending = ordersOf(PLANS['near-houses-at-minutes']!).filter((order) => !order.label.startsWith('woodshed'));
const dawns: unknown[] = [];
const pad = (value: number) => String(value).padStart(2, '0');
while (dawns.length < Number(dawnsText) && !sim.over) {
  for (let i = 0; i < pending.length; ) {
    if (!pending[i]!.when.ready(sim)) i++;
    else for (const command of pending.splice(i, 1)[0]!.give(sim)) applyCommand(sim, command);
  }
  const dawn = isDawn(sim.tick);
  const tick = sim.tick;
  const before = sim.villagers.count;
  const children = sim.villagers.child.slice(0, before);
  step(sim);
  if (!dawn) continue;
  const { villagers, households } = sim;
  const { day, minuteOfDay } = dateAt(tick);
  const stop = minuteOfDay + 1;
  dawns.push({
    dawn: sim.dawns,
    tick,
    news: `Day ${day}, ${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`,
    stop: { day, time: `${pad(Math.floor(stop / 60))}:${pad(stop % 60)}` },
    households: Array.from({ length: households.count }, (_, h) => {
      let wanting = 0;
      for (let id = 0; id < villagers.count; id++) {
        if (villagers.household[id] !== h || villagers.state[id] === VillagerState.Dead) continue;
        if (villagers.missedMeals[id]! > 0 || villagers.coldNights[id]! > 0) wanting++;
      }
      return {
        household: h + 1,
        slot: households.home[h],
        living: households.living[h],
        wanting,
        woman: ageAt(villagers, households.woman[h]!, tick),
        lucky: birthDraw(sim.seed, h, sim.dawns) < BIRTH_CHANCE,
      };
    }),
    born: Array.from({ length: villagers.count - before }, (_, at) => {
      const id = before + at;
      return { id, household: villagers.household[id]! + 1, name: nameOf(villagers.sex[id] as Sex, villagers.name[id]!), girl: villagers.sex[id] === 0 };
    }),
    started: Array.from(children.keys())
      .filter((id) => children[id] === 1 && villagers.child[id] === 0)
      .map((id) => ({ id, household: villagers.household[id]! + 1, name: nameOf(villagers.sex[id] as Sex, villagers.name[id]!), girl: villagers.sex[id] === 0 })),
  });
}
console.log(JSON.stringify(dawns));
