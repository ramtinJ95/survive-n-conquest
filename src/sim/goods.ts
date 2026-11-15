export const Good = { None: 0, Log: 1, Stone: 2 } as const;
export type Good = (typeof Good)[keyof typeof Good];

/** A tile holds up to this many units of one good. */
export const STACK_LIMIT = 8;
