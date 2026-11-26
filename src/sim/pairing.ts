import { GROWN_AGE, ageAt } from './aging';
import { MAX_HOUSEHOLDS, NO_VILLAGER, pair, partnerOf } from './households';
import { Sex } from './names';
import type { Sim } from './sim';
import { VILLAGER_ROWS, VillagerState } from './villagerState';
import type { Villagers } from './villagers';

/** A living villager's age in whole years runs below this, as no life span passes 99. */
const AGES = 128;
/** Scratch for a dawn's pairing: at `sex * AGES + age`, the lowest id of the single settlers of that sex and age, or -1. */
const firstOfAge = new Int32Array(2 * AGES);
/** Scratch for a dawn's pairing: the next higher id of the same sex and age as each single settler, or -1. */
const nextOfAge = new Int32Array(VILLAGER_ROWS);

/**
 * Whether villager `id` is single at this tick: alive, `GROWN_AGE` or older,
 * and with no living partner. One whose partner died is single again.
 */
export function isSingle(sim: Sim, id: number): boolean {
  const { villagers, households } = sim;
  if (villagers.state[id] === VillagerState.Dead || ageAt(villagers, id, sim.tick) < GROWN_AGE) return false;
  const partner = partnerOf(households, villagers, id);
  return partner === NO_VILLAGER || villagers.state[partner] === VillagerState.Dead;
}

/** Whether villagers `a` and `b` can pair: a man and a woman, neither the other's parent, who share no parent. */
export function canPair(villagers: Villagers, a: number, b: number): boolean {
  const { sex, mother, father } = villagers;
  if (sex[a] === sex[b]) return false;
  if (mother[a] === b || father[a] === b || mother[b] === a || father[b] === a) return false;
  return !(mother[a]! >= 0 && mother[a] === mother[b]) && !(father[a]! >= 0 && father[a] === father[b]);
}

/** Whether villager `id` holds a place in its household's couple whose partner died. Only a single settler is asked. */
const widowed = (sim: Sim, id: number) => partnerOf(sim.households, sim.villagers, id) !== NO_VILLAGER;

/**
 * Takes the first man of age `age` that woman `woman` can pair with, in id
 * order, out of his list, and returns him, or -1 when there is none. With
 * `widowersOnly` it takes only a man whose partner died, whose pairing needs
 * no new household.
 */
function takeManOfAge(sim: Sim, woman: number, age: number, widowersOnly: boolean): number {
  const at = Sex.Man * AGES + age;
  let before = -1;
  for (let man = firstOfAge[at]!; man >= 0; before = man, man = nextOfAge[man]!) {
    if (!canPair(sim.villagers, woman, man) || (widowersOnly && !widowed(sim, man))) continue;
    if (before < 0) firstOfAge[at] = nextOfAge[man]!;
    else nextOfAge[before] = nextOfAge[man]!;
    return man;
  }
  return -1;
}

/** The single man nearest woman `woman` of age `age` in age whom she can pair with, the older when two are as near, then the lower id, taken out of his list, or -1. With `widowersOnly` only a man whose partner died counts. */
function takeNearestMan(sim: Sim, woman: number, age: number, widowersOnly: boolean): number {
  for (let apart = 0; age + apart < AGES || age - apart >= GROWN_AGE; apart++) {
    const older = age + apart < AGES ? takeManOfAge(sim, woman, age + apart, widowersOnly) : -1;
    if (older >= 0) return older;
    const younger = apart > 0 && age - apart >= GROWN_AGE ? takeManOfAge(sim, woman, age - apart, widowersOnly) : -1;
    if (younger >= 0) return younger;
  }
  return -1;
}

/**
 * The pairings of a dawn, step 4 of its order. The single women go from the
 * oldest to the youngest, by the lower id at one age, and each takes the
 * single man she can pair with nearest her in age, the older when two are as
 * near, then the lower id. `pair` puts the two in one household. While the
 * household table is full, a woman who never had a partner takes only a man
 * whose partner died, so every pairing of the dawn has a household to go to.
 */
export function pairSettlers(sim: Sim): void {
  const { villagers, households } = sim;
  firstOfAge.fill(-1);
  for (let id = villagers.count - 1; id >= 0; id--) {
    if (!isSingle(sim, id)) continue;
    const at = villagers.sex[id]! * AGES + ageAt(villagers, id, sim.tick);
    nextOfAge[id] = firstOfAge[at]!;
    firstOfAge[at] = id;
  }
  for (let age = AGES - 1; age >= GROWN_AGE; age--) {
    for (let woman = firstOfAge[Sex.Woman * AGES + age]!; woman >= 0; woman = nextOfAge[woman]!) {
      const widow = widowed(sim, woman);
      const man = takeNearestMan(sim, woman, age, !widow && households.count >= MAX_HOUSEHOLDS);
      if (man < 0) continue;
      const count = households.count;
      sim.tally.widowedPaired += Number(widow) + Number(widowed(sim, man));
      pair(households, villagers, man, woman, sim.dawns);
      sim.tally.paired += households.count - count;
    }
  }
}
