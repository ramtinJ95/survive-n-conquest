import { ageAt, lifeSpan } from './aging';
import { nearestDoor } from './buildings';
import { NO_HOME, addMember } from './households';
import { Sex, freeName } from './names';
import { hashUnit } from './noise';
import type { Sim } from './sim';
import { VillagerState } from './villagerState';
import { addVillager } from './villagers';

/** A household draws for a birth only after it has seen more than this many dawns since it formed, and as many since its last birth. */
export const BIRTH_GAP = 6;
/** A household that qualifies at a dawn has a child with this chance. */
export const BIRTH_CHANCE = 1 / 4;
/** No child is born into a house in which this many people live. */
export const FULL_HOUSE = 5;
/** A woman bears children from the first of these ages until she is the second. */
export const BEARING_AGES = [16, 40] as const;

const BIRTH_SALT = 0x6b1d_42f3;
const SEX_SALT = 0x51c3_8e0d;

/** The draw of household `h` at the dawn `dawn`, a count of `Sim.dawns`, in [0, 1). It is a stream of its own, keyed by the seed, the household, and the dawn. */
export function birthDraw(seed: number, h: number, dawn: number): number {
  return hashUnit(seed ^ BIRTH_SALT, h, dawn);
}

/** The sex the seed gives villager `id` at its birth, a girl or a boy with the same chance. */
export function sexAtBirth(seed: number, id: number): Sex {
  return hashUnit(seed ^ SEX_SALT, id, 0) < 0.5 ? Sex.Woman : Sex.Man;
}

/** Marks each household one of whose living members has a missed meal or a cold night, and the names its living members bear. */
function survey(sim: Sim): void {
  const { villagers, households } = sim;
  households.wanting.fill(0, 0, households.count);
  households.names.fill(0, 0, households.count * 2);
  for (let id = 0; id < villagers.count; id++) {
    if (villagers.state[id] === VillagerState.Dead) continue;
    const h = villagers.household[id]!;
    if (villagers.missedMeals[id]! > 0 || villagers.coldNights[id]! > 0) households.wanting[h] = 1;
    households.names[h * 2 + villagers.sex[id]!]! |= 1 << villagers.name[id]!;
  }
}

/**
 * Whether household `h` qualifies for a birth at this dawn: it has a house in
 * which fewer than `FULL_HOUSE` people live, both of its couple are alive, the
 * woman is of `BEARING_AGES`, none of its members is wanting, and it has seen
 * more than `BIRTH_GAP` dawns since it formed and since its last birth. It
 * reads the survey of the dawn.
 */
export function qualifies(sim: Sim, h: number): boolean {
  const { households, villagers } = sim;
  if (households.home[h] === NO_HOME || households.living[h]! >= FULL_HOUSE) return false;
  const man = households.man[h]!;
  const woman = households.woman[h]!;
  if (man < 0 || woman < 0 || villagers.state[man] === VillagerState.Dead || villagers.state[woman] === VillagerState.Dead) return false;
  const age = ageAt(villagers, woman, sim.tick);
  if (age < BEARING_AGES[0] || age >= BEARING_AGES[1]) return false;
  return households.wanting[h] === 0 && sim.dawns - households.lastBirth[h]! > BIRTH_GAP;
}

/**
 * A child of household `h` enters the table: its sex, its name, and its span
 * drawn by the seed, born now, a child of the couple. It stands at the door of
 * the house nearest its mother. Returns its id, or -1 when the table is full.
 */
function bear(sim: Sim, h: number): number {
  const { villagers, households, map, seed } = sim;
  const id = villagers.count;
  const sex = sexAtBirth(seed, id);
  const mother = households.woman[h]!;
  const name = freeName(seed, id, sex, households.names[h * 2 + sex]!);
  const born = { sex, household: h, name, born: sim.tick, span: lifeSpan(seed, id), child: true, mother, father: households.man[h]! };
  if (addVillager(villagers, map, sim.flow, born) < 0) return -1;
  households.names[h * 2 + sex]! |= 1 << name;
  addMember(households, villagers, h, id);
  households.lastBirth[h] = sim.dawns;
  sim.living += 1;
  sim.tally.births += 1;
  const door = nearestDoor(sim, households.home[h]!, villagers.x[mother]!, villagers.y[mother]!);
  if (door >= 0) {
    villagers.x[id] = villagers.targetX[id] = (door % map.size) + 0.5;
    villagers.y[id] = villagers.targetY[id] = Math.floor(door / map.size) + 0.5;
  }
  return id;
}

/**
 * The births of a dawn, step 5 of its order: each household that qualifies,
 * the lowest number first, has a child when its draw falls under
 * `BIRTH_CHANCE`. No child is born while `Sim.mostLiving` live, or once the
 * villagers table is full.
 */
export function bearChildren(sim: Sim): void {
  survey(sim);
  for (let h = 0; h < sim.households.count; h++) {
    if (!qualifies(sim, h) || birthDraw(sim.seed, h, sim.dawns) >= BIRTH_CHANCE) continue;
    if (sim.living >= sim.mostLiving || bear(sim, h) < 0) return;
  }
}
