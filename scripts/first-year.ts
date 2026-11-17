// The first year on seed 7 with one forager's hut, against the same seed with no orders: `bun scripts/first-year.ts`.
import { Building, BUILDINGS, Job } from '../src/sim/buildings';
import { DAYS_PER_YEAR, dateAt, seasonAt } from '../src/sim/calendar';
import { isNight } from '../src/sim/daylight';
import { FIRST_YEAR_HUT, FIRST_YEAR_SEED, firstYearCommands } from '../src/sim/firstYear';
import { FORAGING } from '../src/sim/foraging';
import { Good } from '../src/sim/goods';
import { jobOf } from '../src/sim/jobs';
import { TileKind } from '../src/sim/map';
import { generateMap } from '../src/sim/mapgen';
import { type Sex, nameOf } from '../src/sim/names';
import { SiteState } from '../src/sim/orders';
import { SETTLERS, type Sim, applyCommand, createSim, step } from '../src/sim/sim';
import { STOCKING } from '../src/sim/stocking';
import { CAMP_STORE, StoreKind, storeKind } from '../src/sim/stores';
import { TASK_KINDS } from '../src/sim/tasks';
import { NO_TASK, VillagerState } from '../src/sim/villagerState';

const FORAGE = TASK_KINDS.indexOf(FORAGING) + 1;
const STOCK = TASK_KINDS.indexOf(STOCKING) + 1;

const clock = (tick: number) => {
  const { day, minuteOfDay } = dateAt(tick);
  return `day ${day} ${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
};
const nameOfId = (sim: Sim, id: number) => nameOf(sim.villagers.sex[id] as Sex, sim.villagers.name[id]!);
const isDusk = (tick: number) => isNight(tick) && !isNight(tick - 1);

function homeFood(sim: Sim): number {
  let food = 0;
  for (let slot = 0; slot < sim.orders.sites.used; slot++) if (storeKind(sim.orders, slot) === StoreKind.Home) food += sim.stores.held[Good.Food - 1]![slot]!;
  return food;
}

/** Forest tiles with a tree that a walk from the camp reaches, within the reach of the middle of a hut anchored on (x, y). */
function treesInReach(sim: Sim, x: number, y: number): number {
  const { size } = sim.map;
  const { side, reach } = BUILDINGS[Building.Hut];
  const mx = x + side / 2;
  const my = y + side / 2;
  let trees = 0;
  for (let tile = 0; tile < size * size; tile++) {
    const dx = (tile % size) + 0.5 - mx;
    const dy = Math.floor(tile / size) + 0.5 - my;
    if (dx * dx + dy * dy > reach * reach) continue;
    if (sim.map.kinds[tile] === TileKind.Forest && sim.map.trees[tile] === 1 && sim.flow.next[tile] !== -1) trees++;
  }
  return trees;
}

interface Year {
  readonly sim: Sim;
  readonly lines: string[];
  readonly deaths: string[];
}

/**
 * Runs the first year of the game's own map and settlers, `generateMap(7)`
 * and `SETTLERS` as `src/main.ts` makes them, with the first year's commands
 * or with none, until the year ends or the settlement dies out.
 */
function play(withOrders: boolean): Year {
  const sim = createSim(generateMap(FIRST_YEAR_SEED), SETTLERS);
  const lines: string[] = [];
  const deaths: string[] = [];
  const villagers = sim.villagers.state.length;
  if (withOrders) {
    const { size } = sim.map;
    const { x, y } = FIRST_YEAR_HUT;
    const mx = x + BUILDINGS[Building.Hut].side / 2;
    const my = y + BUILDINGS[Building.Hut].side / 2;
    const campX = (sim.flow.goal % size) + 0.5;
    const campY = Math.floor(sim.flow.goal / size) + 0.5;
    lines.push(`hut anchored on (${x}, ${y}), its middle ${Math.hypot(mx - campX, my - campY).toFixed(1)} tiles from the camp center, ${treesInReach(sim, x, y)} trees in its reach`);
    for (const command of firstYearCommands()) {
      const outcome = applyCommand(sim, command);
      if (!outcome?.ok) throw new Error(`refused: ${JSON.stringify(command)} ${JSON.stringify(outcome)}`);
    }
  }
  const hut = withOrders ? sim.orders.siteOf[FIRST_YEAR_HUT.y * sim.map.size + FIRST_YEAR_HUT.x]! : -1;
  let finished = -1;
  const workplace = Int16Array.from(sim.villagers.workplace);
  const dead = new Uint8Array(villagers);
  const daylight = Array.from({ length: villagers }, () => ({ ticks: 0, stocking: 0, foraging: 0, idle: 0, other: 0 }));
  const foragedByDay: number[] = [];
  let foragedBefore = 0;
  let dayOf = dateAt(sim.tick).day;
  while (!sim.over && dateAt(sim.tick).day <= DAYS_PER_YEAR) {
    if (isDusk(sim.tick)) {
      const held = Array.from(sim.villagers.workplace, (place, id) => [place, id] as const)
        .filter(([place, id]) => place >= 0 && sim.villagers.state[id] !== VillagerState.Dead)
        .map(([, id]) => `${nameOfId(sim, id)} ${sim.villagers.carried[id] === Good.Food ? 1 : 0}`);
      lines.push(
        `dusk of ${clock(sim.tick)} (${seasonAt(sim.tick)}): camp ${sim.stores.held[Good.Food - 1]![CAMP_STORE]}, homes ${homeFood(sim)}, ` +
          `${sim.living} living` +
          (withOrders ? `; units in foragers' hands: ${held.join(', ') || 'no foragers'}` : ''),
      );
    }
    const day = !isNight(sim.tick);
    step(sim);
    if (finished < 0 && hut >= 0 && sim.orders.sites.state[hut] === SiteState.Built) {
      finished = sim.tick - 1;
      lines.push(`hut finished on tick ${finished}, ${clock(finished)}`);
    }
    for (let id = 0; id < villagers; id++) {
      const place = sim.villagers.workplace[id]!;
      if (place !== workplace[id] && sim.villagers.state[id] !== VillagerState.Dead) {
        lines.push(place >= 0 ? `${clock(sim.tick - 1)}: ${nameOfId(sim, id)} takes a place at the hut` : `${clock(sim.tick - 1)}: ${nameOfId(sim, id)} leaves the hut`);
      }
      workplace[id] = place;
      if (sim.villagers.state[id] === VillagerState.Dead && !dead[id]) {
        dead[id] = 1;
        deaths.push(`${nameOfId(sim, id)} ${clock(sim.tick - 1)}`);
      }
      if (!day || jobOf(sim, id) !== Job.Forager) continue;
      const counts = daylight[id]!;
      const task = sim.villagers.task[id];
      counts.ticks++;
      if (task === STOCK) counts.stocking++;
      else if (task === FORAGE) counts.foraging++;
      else if (task === NO_TASK) counts.idle++;
      else counts.other++;
    }
    const today = dateAt(sim.tick).day;
    if (today !== dayOf) {
      foragedByDay.push(sim.tally.foraged - foragedBefore);
      foragedBefore = sim.tally.foraged;
      dayOf = today;
    }
  }
  if (withOrders) {
    lines.push(`units foraged by day: ${foragedByDay.map((units, i) => `day ${i + 1} ${units}`).join(', ')}`);
    lines.push(`units foraged in the year: ${sim.tally.foraged}, put into the camp: ${sim.tally.foragedIn}, meals eaten ${sim.tally.meals}, missed ${sim.tally.missed}`);
    const percent = (part: number, whole: number) => `${((part / Math.max(whole, 1)) * 100).toFixed(1)}%`;
    for (let id = 0; id < villagers; id++) {
      const counts = daylight[id]!;
      if (counts.ticks === 0) continue;
      lines.push(
        `${nameOfId(sim, id)} as a forager: ${counts.ticks} daylight ticks, stocking ${percent(counts.stocking, counts.ticks)}, ` +
          `foraging ${percent(counts.foraging, counts.ticks)}, idle ${percent(counts.idle, counts.ticks)}` +
          (counts.other > 0 ? `, other ${percent(counts.other, counts.ticks)}` : ''),
      );
    }
  }
  lines.push(sim.over ? `the settlement died out at ${clock(sim.tick - 1)}` : `${sim.living} of ${villagers} alive at the end of the year`);
  return { sim, lines, deaths };
}

const withHut = play(true);
console.log(`seed ${FIRST_YEAR_SEED}, ${withHut.sim.map.size} map, ${SETTLERS.villagers} settlers, a forager's hut and its four log trees ordered at the start`);
for (const line of withHut.lines) console.log(`  ${line}`);
console.log(`  deaths: ${withHut.deaths.join(', ') || 'none'}`);
const without = play(false);
console.log(`seed ${FIRST_YEAR_SEED} with no orders`);
for (const line of without.lines) console.log(`  ${line}`);
console.log(`  deaths: ${without.deaths.join(', ') || 'none'}`);
