// The pairings of the `pairing` scenario's pages, from the game's own modules under `bun`, so a check can compare the
// page with the rules. Run from the checkout root:
// bun .claude/skills/verify-survive-n-conquest/scripts/pairing.ts '<settlers>' <food> <dawns> [<day> <hh:mm>]
// It plays seed 7 with the `settlers` setting and the camp's starting food, `-` for the default, and gives the orders
// that `births` gives through the page at 08:00 on day 1. With a day and a minute it holds the fourth house's order,
// worked out at 08:00 on day 1 as the page clicks it, back until that minute. For each of the first `<dawns>` dawns
// it prints the minute the page stops at after it, the couples that formed a household there with their ages, the
// households they left, and the house each lives in, the same of the couples that formed there in a household that was
// there before, the single settlers left after it, and every household's house slot and living members. It prints the minute each house was finished.
import { ageAt } from '../../../../src/sim/aging';
import { Building } from '../../../../src/sim/buildings';
import { dateAt } from '../../../../src/sim/calendar';
import { isDawn } from '../../../../src/sim/daylight';
import { generateMap } from '../../../../src/sim/mapgen';
import { type Sex, nameOf } from '../../../../src/sim/names';
import { SiteState } from '../../../../src/sim/orders';
import { houseOf } from '../../../../src/sim/households';
import { isSingle } from '../../../../src/sim/pairing';
import { type Command, applyCommand, createSim, parseSettlers, populationFor, step } from '../../../../src/sim/sim';
import { tickAt } from '../../../../scripts/firewood-years';
import { PLANS, ordersOf } from '../../../../scripts/firewood-years';

const [settlers, food, dawnsText, lateDay, lateTime] = process.argv.slice(2);
const stated = parseSettlers(settlers ?? null);
if (!stated) throw new Error(`the settlers setting "${settlers}" does not parse`);
const sim = createSim(generateMap(7), populationFor(null, food === '-' ? null : (food ?? null), null, stated));
const pending = ordersOf(PLANS['near-houses-at-minutes']!).filter((order) => !order.label.startsWith('woodshed'));
const lateAt = lateDay === undefined ? null : tickAt(Number(lateDay), lateTime!);
let late: Command[] = [];
const pad = (value: number) => String(value).padStart(2, '0');
const clock = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
const name = (id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const houses: { slot: number; finished: string }[] = [];
const dawns: unknown[] = [];
while (dawns.length < Number(dawnsText) && !sim.over) {
  for (let i = 0; i < pending.length; ) {
    if (!pending[i]!.when.ready(sim)) i++;
    else {
      const order = pending.splice(i, 1)[0]!;
      if (lateAt !== null && order.label === 'house 4') late = order.give(sim);
      else for (const command of order.give(sim)) applyCommand(sim, command);
    }
  }
  if (lateAt !== null && sim.tick === lateAt) for (const command of late) applyCommand(sim, command);
  const dawn = isDawn(sim.tick);
  const tick = sim.tick;
  const was = sim.villagers.household.slice(0, sim.villagers.count);
  const formed = sim.households.count;
  const couples = Array.from({ length: formed }, (_, h) => `${sim.households.man[h]},${sim.households.woman[h]}`);
  step(sim);
  const { sites } = sim.orders;
  for (let slot = 0; slot < sites.used; slot++) {
    if (sites.kind[slot] !== Building.House || sites.state[slot] !== SiteState.Built || houses.some((house) => house.slot === slot)) continue;
    const { day, minuteOfDay } = dateAt(tick);
    houses.push({ slot, finished: `day ${day} ${clock(minuteOfDay)}` });
  }
  if (!dawn) continue;
  const { villagers, households } = sim;
  const { day, minuteOfDay } = dateAt(tick);
  dawns.push({
    dawn: sim.dawns,
    news: `Day ${day}, ${clock(minuteOfDay)}`,
    stop: { day, time: clock(minuteOfDay + 1) },
    pairings: Array.from({ length: households.count - formed }, (_, at) => {
      const h = formed + at;
      const man = households.man[h]!;
      const woman = households.woman[h]!;
      return {
        household: h + 1,
        slot: households.home[h],
        woman: { id: woman, name: name(woman), age: ageAt(villagers, woman, tick), left: was[woman]! + 1, livesIn: houseOf(households, villagers, woman) },
        man: { id: man, name: name(man), age: ageAt(villagers, man, tick), left: was[man]! + 1, livesIn: houseOf(households, villagers, man) },
      };
    }),
    pairedAgain: couples.flatMap((couple, h) => {
      const man = households.man[h]!;
      const woman = households.woman[h]!;
      if (couple === `${man},${woman}`) return [];
      return [{
        household: h + 1,
        slot: households.home[h],
        woman: { id: woman, name: name(woman), age: ageAt(villagers, woman, tick), left: was[woman]! + 1, livesIn: houseOf(households, villagers, woman) },
        man: { id: man, name: name(man), age: ageAt(villagers, man, tick), left: was[man]! + 1, livesIn: houseOf(households, villagers, man) },
      }];
    }),
    singles: Array.from({ length: villagers.count }, (_, id) => id)
      .filter((id) => isSingle(sim, id))
      .map((id) => ({ id, name: name(id), age: ageAt(villagers, id, tick), household: villagers.household[id]! + 1 })),
    households: Array.from({ length: households.count }, (_, h) => ({
      household: h + 1,
      couple: `${name(households.man[h]!)} and ${name(households.woman[h]!)}`,
      slot: households.home[h],
      living: households.living[h],
    })),
  });
}
console.log(JSON.stringify({ houses, dawns }));
