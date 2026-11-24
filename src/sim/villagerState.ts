/**
 * What a villager is doing. By day it is idle near the camp, or walks its route
 * to a task and works it there. A villager whose task just ended waits where it
 * stands until it next looks for work, so it does not wander off between two
 * tasks at the same place. By night a villager whose household has a home is
 * going in: it stands until its think tick, plans its route to a door of the
 * house, walks it, and is inside until dawn, standing on the door tile. One
 * whose household has none walks the flow field to the camp center, then out
 * to its spot, where it stays until dawn. A dead villager is on the map no more.
 */
export const VillagerState = { Idle: 0, Walking: 1, Working: 2, GoingToCamp: 3, Settling: 4, Waiting: 5, GoingIn: 6, Inside: 7, Dead: 8 } as const;
export type VillagerState = (typeof VillagerState)[keyof typeof VillagerState];

/** What a villager died of. A living villager's is `None`. */
export const Cause = { None: 0, Hunger: 1, Cold: 2, OldAge: 3 } as const;
export type Cause = (typeof Cause)[keyof typeof Cause];

/** A villager column value for no task. Any other value is one more than the kind's index in `TASK_KINDS`. */
export const NO_TASK = 0;

/** An idle villager looks for work on one tick in this many, the tick of its group. Villager `id` is in group `id % THINK_GROUPS`. */
export const THINK_GROUPS = 10;

/**
 * The rows of the villagers table, and of every column kept for each villager.
 * A row is never used twice, so this limits everyone who ever lives on the map.
 */
export const VILLAGER_ROWS = 4096;
