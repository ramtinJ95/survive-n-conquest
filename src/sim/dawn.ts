import { dieOfOldAge } from './aging';
import { bearChildren } from './births';
import type { Sim } from './sim';
import { breakDay } from './villagers';

/** The steps of a dawn, in the order the stage 5 brief gives. A later step joins the list at its place in that order. */
export const DAWN: readonly ((sim: Sim) => void)[] = [breakDay, dieOfOldAge, bearChildren];
