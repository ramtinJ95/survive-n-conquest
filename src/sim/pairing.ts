import { GROWN_AGE, ageAt } from './aging';
import { NO_VILLAGER, pair } from './households';
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
 * Whether villager `id` is single at this tick: alive, `GROWN_AGE` or older, and
 * never a partner. A settler is partnered when it is one of its household's
 * couple and the other place is held, though its partner died since.
 */
export function isSingle(sim: Sim, id: number): boolean {
  const { villagers, households } = sim;
  if (villagers.state[id] === VillagerState.Dead || ageAt(villagers, id, sim.tick) < GROWN_AGE) return false;
  const h = villagers.household[id]!;
  if (households.man[h] === id) return households.woman[h] === NO_VILLAGER;
  if (households.woman[h] === id) return households.man[h] === NO_VILLAGER;
  return true;
}

/** Whether villagers `a` and `b` can pair: a man and a woman, neither the other's parent, who share no parent. */
export function canPair(villagers: Villagers, a: number, b: number): boolean {
  const { sex, mother, father } = villagers;
  if (sex[a] === sex[b]) return false;
  if (mother[a] === b || father[a] === b || mother[b] === a || father[b] === a) return false;
  return !(mother[a]! >= 0 && mother[a] === mother[b]) && !(father[a]! >= 0 && father[a] === father[b]);
}

/**
 * Takes the first man of age `age` that woman `woman` can pair with, in id
 * order, out of his list, and returns him, or -1 when there is none.
 */
function takeManOfAge(villagers: Villagers, woman: number, age: number): number {
  const at = Sex.Man * AGES + age;
  let before = -1;
  for (let man = firstOfAge[at]!; man >= 0; before = man, man = nextOfAge[man]!) {
    if (!canPair(villagers, woman, man)) continue;
    if (before < 0) firstOfAge[at] = nextOfAge[man]!;
    else nextOfAge[before] = nextOfAge[man]!;
    return man;
  }
  return -1;
}

/** The single man nearest woman `woman` of age `age` in age whom she can pair with, the older when two are as near, then the lower id, taken out of his list, or -1. */
function takeNearestMan(villagers: Villagers, woman: number, age: number): number {
  for (let apart = 0; age + apart < AGES || age - apart >= GROWN_AGE; apart++) {
    const older = age + apart < AGES ? takeManOfAge(villagers, woman, age + apart) : -1;
    if (older >= 0) return older;
    const younger = apart > 0 && age - apart >= GROWN_AGE ? takeManOfAge(villagers, woman, age - apart) : -1;
    if (younger >= 0) return younger;
  }
  return -1;
}

/**
 * The pairings of a dawn, step 4 of its order. The single women go from the
 * oldest to the youngest, by the lower id at one age, and each takes the
 * single man she can pair with nearest her in age, the older when two are as
 * near, then the lower id. The two leave their households and form one of
 * their own, by `pair`. Pairing stops once the household table is full.
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
      const man = takeNearestMan(villagers, woman, age);
      if (man < 0) continue;
      if (pair(households, villagers, man, woman, sim.dawns) < 0) return;
      sim.tally.paired += 1;
    }
  }
}
