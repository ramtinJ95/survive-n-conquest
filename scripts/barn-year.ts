// The first year on seed 7 with a barn beside the forager's hut, against a barn far from it: `bun scripts/barn-year.ts [run ...]`.
import { BUILDINGS, type Building } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_SECOND, dateAt, seasonAt } from '../src/sim/calendar';
import { isNight } from '../src/sim/daylight';
import { FIRST_YEAR_BARNS, FIRST_YEAR_SEED, barnYearCommands, firstYearCommands } from '../src/sim/firstYear';
import { FORAGE_WORK_TICKS } from '../src/sim/foraging';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState } from '../src/sim/orders';
import { SETTLERS, type Command, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE, StoreKind, storeKind } from '../src/sim/stores';
import { VillagerState } from '../src/sim/villagerState';

const RUNS: Readonly<Record<string, { readonly title: string; readonly commands: () => Command[] }>> = {
  hut: { title: "the hut of #27 and its four Chop orders, no barn", commands: firstYearCommands },
  beside: { title: `a barn beside the hut, at (${FIRST_YEAR_BARNS.beside.x}, ${FIRST_YEAR_BARNS.beside.y})`, commands: () => barnYearCommands(FIRST_YEAR_BARNS.beside) },
  far: { title: `a barn far from the hut, at (${FIRST_YEAR_BARNS.far.x}, ${FIRST_YEAR_BARNS.far.y})`, commands: () => barnYearCommands(FIRST_YEAR_BARNS.far) },
  housesBeside: { title: 'a house for each household and a barn beside the hut', commands: () => barnYearCommands(FIRST_YEAR_BARNS.beside, true) },
  housesFar: { title: 'a house for each household and a barn far from the hut', commands: () => barnYearCommands(FIRST_YEAR_BARNS.far, true) },
};

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);

/** The food in the finished buildings that are stores of a kind: the barns for `Common`, the houses for `Home`. */
function foodIn(sim: Sim, kind: StoreKind): number {
  let food = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) food += sim.stores.food[slot]!;
  return food;
}

function play(name: string): void {
  const run = RUNS[name];
  if (!run) throw new Error(`no run named ${name}; the runs are ${Object.keys(RUNS).join(', ')}`);
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  for (const command of run.commands()) {
    const outcome = applyCommand(sim, command);
    if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
  }
  const finished = new Map<number, string>();
  const missed: string[] = [];
  const deaths: string[] = [];
  const rows: string[] = [];
  const missedBefore = Uint8Array.from(sim.villagers.missedMeals);
  while (!sim.over && dateAt(sim.tick).day <= DAYS_PER_YEAR) {
    if (isDusk(sim.tick)) {
      const { day } = dateAt(sim.tick);
      rows.push(`| ${day} | ${seasonAt(sim.tick)} | ${foodIn(sim, StoreKind.Common)} | ${sim.stores.food[CAMP_STORE]} | ${foodIn(sim, StoreKind.Home)} | ${sim.living} |`);
    }
    step(sim);
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] === SiteState.Built && !finished.has(slot)) finished.set(slot, `${BUILDINGS[sites.kind[slot] as Building].name} ${clock(sim.tick - 1)}`);
    }
    for (let id = 0; id < missedBefore.length; id++) {
      const now = sim.villagers.missedMeals[id]!;
      if (now > missedBefore[id]!) missed.push(`${nameOfId(sim, id)} ${clock(sim.tick - 1)}`);
      if (sim.villagers.state[id] === VillagerState.Dead && missedBefore[id] !== 255) {
        deaths.push(`${nameOfId(sim, id)} ${clock(sim.tick - 1)}`);
        missedBefore[id] = 255;
        continue;
      }
      if (missedBefore[id] !== 255) missedBefore[id] = now;
    }
  }
  const { tally } = sim;
  console.log(`## ${run.title}`);
  console.log(`seed ${FIRST_YEAR_SEED}, ${FORAGE_WORK_TICKS / TICKS_PER_SECOND} s of work for one unit, ${sim.living} of ${SETTLERS.villagers} alive${sim.over ? `, died out at ${clock(sim.tick - 1)}` : ' at the end of the year'}`);
  console.log(`finished: ${[...finished.values()].join(', ')}`);
  console.log('');
  console.log('| Dusk | Season | Barn | Camp | Homes | Living |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const row of rows) console.log(row);
  console.log('');
  console.log(
    `picked ${tally.foraged}, foragers put into a store ${tally.foragedIn}, carried from the ground ${tally.fromGround}, ` +
      `carried from a barn to the camp ${tally.toCamp}, carried home ${tally.carriedHome}, meals ${tally.meals}, missed ${tally.missed}`,
  );
  console.log(`missed meals: ${missed.join(', ') || 'none'}`);
  console.log(`deaths: ${deaths.join(', ') || 'none'}`);
  console.log('');
}

for (const name of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(RUNS)) play(name);
