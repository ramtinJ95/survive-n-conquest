import { type BuildingKind, Building, Job } from '../sim/buildings';
import { Good } from '../sim/goods';

/** What the interface calls each kind of building: its name as a title, and as a noun inside a sentence. */
export const BUILDING_WORDS: Readonly<Record<Building, { readonly title: string; readonly noun: string }>> = {
  [Building.House]: { title: 'House', noun: 'house' },
  [Building.Hut]: { title: "Forager's hut", noun: "forager's hut" },
};

/** What the interface calls each job, as a title, and its holders, one and many. */
export const JOB_WORDS: Readonly<Record<Job, { readonly title: string; readonly one: string; readonly many: string }>> = {
  [Job.None]: { title: 'None', one: 'a settler', many: 'settlers' },
  [Job.Forager]: { title: 'Forager', one: 'a forager', many: 'foragers' },
};

/** The words with their first letter in capitals. */
export const capital = (words: string): string => words[0]!.toUpperCase() + words.slice(1);

const GOODS: readonly { readonly good: Good; readonly label: string }[] = [
  { good: Good.Log, label: 'Logs' },
  { good: Good.Stone, label: 'Stone' },
];

/** The goods a kind of building needs, with how many of each, in the order its label and its site's panel show them. */
export function neededGoods(kind: BuildingKind): readonly { readonly good: Good; readonly label: string; readonly needs: number }[] {
  return GOODS.map(({ good, label }) => ({ good, label, needs: kind.needs[good - 1]! })).filter(({ needs }) => needs > 0);
}
