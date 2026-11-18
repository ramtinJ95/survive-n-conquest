// The first year on seed 7 under four sets of commands, with every missed meal, death, and meal eaten by day: `bun scripts/food-year.ts [run ...]`.
import { AnimalKind } from '../src/sim/animals';
import { BUILDINGS, type Building } from '../src/sim/buildings';
import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_SECOND, dateAt, seasonAt, tickOfDay } from '../src/sim/calendar';
import { isDawn, isNight } from '../src/sim/daylight';
import { FIRST_YEAR_BARNS, FIRST_YEAR_SEED, barnYearCommands, firstYearCommands, huntYearCommands } from '../src/sim/firstYear';
import { FORAGE_WORK_TICKS } from '../src/sim/foraging';
import { Good } from '../src/sim/goods';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState } from '../src/sim/orders';
import { SETTLERS, type Command, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { CAMP_STORE, StoreKind, storeKind } from '../src/sim/stores';
import { VillagerState } from '../src/sim/villagerState';

const RUNS: Readonly<Record<string, { readonly title: string; readonly commands: () => Command[] }>> = {
  hut: { title: "#27's hut alone", commands: firstYearCommands },
  beside: { title: "#29's barn beside the hut", commands: () => barnYearCommands(FIRST_YEAR_BARNS.beside) },
  all: { title: "#30's hut, barn, and lodge", commands: () => huntYearCommands({ hut: true }) },
  lodge: { title: "#30's barn and lodge, no hut", commands: () => huntYearCommands({ hut: false }) },
};
const SEASON_ENDS = [3, 6, 9, 12];
const DUSKS = [9, 10, 11, 12];

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);

function foodIn(sim: Sim, kind: StoreKind): number {
  let food = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === kind) food += sim.stores.held[Good.Food - 1]![slot]!;
  return food;
}

function groundFood(sim: Sim): number {
  const { goods, map } = sim;
  let food = 0;
  for (let i = 0; i < goods.spoilingCount; i++) {
    const tile = goods.spoilingTiles[i]!;
    if (map.stackGood[tile] === Good.Food) food += map.stackSize[tile]!;
  }
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
  const byDay: string[] = [];
  const rows: string[] = [];
  const campAtDusk: number[] = [];
  const missedBefore = Uint8Array.from(sim.villagers.missedMeals);
  const row = (when: string) =>
    rows.push(
      `| ${when} | ${seasonAt(sim.tick)} | ${foodIn(sim, StoreKind.Common)} | ${sim.stores.held[Good.Food - 1]![CAMP_STORE]} | ${foodIn(sim, StoreKind.Home)} | ` +
        `${groundFood(sim)} | ${sim.tally.foraged} | ${sim.tally.kills} | ${sim.tally.hunted} | ${sim.animals.living[AnimalKind.Deer]} | ${sim.living} |`,
    );
  while (!sim.over && dateAt(sim.tick).day <= DAYS_PER_YEAR) {
    const { day } = dateAt(sim.tick);
    if (isDusk(sim.tick)) {
      campAtDusk.push(sim.stores.held[Good.Food - 1]![CAMP_STORE]!);
      if (DUSKS.includes(day)) row(`dusk of day ${day}`);
    }
    if (tickOfDay(sim.tick) === TICKS_PER_DAY - 1 && SEASON_ENDS.includes(day)) row(`end of day ${day}`);
    const byDayTick = !isNight(sim.tick) && !isDawn(sim.tick);
    const tick = sim.tick;
    step(sim);
    const { sites } = sim.orders;
    for (let slot = 0; slot < sites.used; slot++) {
      if (sites.state[slot] === SiteState.Built && !finished.has(slot)) finished.set(slot, `${BUILDINGS[sites.kind[slot] as Building].name} ${clock(tick)}`);
    }
    for (let id = 0; id < missedBefore.length; id++) {
      if (missedBefore[id] === 255) continue;
      const now = sim.villagers.missedMeals[id]!;
      if (now > missedBefore[id]!) missed.push(`${nameOfId(sim, id)} ${clock(tick)}`);
      if (sim.villagers.state[id] === VillagerState.Dead) {
        deaths.push(`${nameOfId(sim, id)} ${clock(tick)}`);
        missedBefore[id] = 255;
        continue;
      }
      if (byDayTick && now === 0 && missedBefore[id]! > 0) byDay.push(`${nameOfId(sim, id)} ${clock(tick)} after ${missedBefore[id]} missed`);
      missedBefore[id] = now;
    }
  }
  const { tally } = sim;
  console.log(`## ${run.title}`);
  console.log(
    `seed ${FIRST_YEAR_SEED}, ${FORAGE_WORK_TICKS / TICKS_PER_SECOND} s of work for one unit of forage, ` +
      `${sim.living} of ${SETTLERS.villagers} alive${sim.over ? `, died out at ${clock(sim.tick - 1)}` : ' at the end of the year'}`,
  );
  console.log(`finished: ${[...finished.values()].join(', ')}`);
  console.log('');
  console.log('| When | Season | Barn | Camp | Homes | Ground | Picked | Kills | Hunted | Deer | Living |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const line of rows) console.log(line);
  console.log('');
  console.log(`camp at each dusk: ${campAtDusk.join(' ')}`);
  console.log(
    `picked ${tally.foraged}, kills ${tally.kills} of ${tally.shots} shots, hunted ${tally.hunted}; ` +
      `carried from a barn to the camp ${tally.toCamp}, carried home ${tally.carriedHome}, meals ${tally.meals}, missed ${tally.missed}`,
  );
  console.log(`missed meals: ${missed.join(', ') || 'none'}`);
  console.log(`meals by day, outside dusk and dawn: ${byDay.join(', ') || 'none'}`);
  console.log(`deaths: ${deaths.join(', ') || 'none'}`);
  console.log('');
}

for (const name of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(RUNS)) play(name);
