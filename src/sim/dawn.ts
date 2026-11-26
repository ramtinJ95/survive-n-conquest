import { dieOfOldAge, startWork } from './aging';
import { bearChildren } from './births';
import { ripenFields } from './fields';
import { pairSettlers } from './pairing';
import type { Sim } from './sim';
import { breakDay } from './villagers';

/** The steps of a dawn, in the order the stage 5 brief gives. A later step joins the list at its place in that order. */
export const DAWN: readonly ((sim: Sim) => void)[] = [
  breakDay,
  dieOfOldAge,
  startWork,
  pairSettlers,
  bearChildren,
  ripenFields,
];
