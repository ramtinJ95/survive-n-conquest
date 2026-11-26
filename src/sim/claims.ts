/** What an order claims a tile for. It lives outside `orders.ts` so that `goods.ts`, which `buildings.ts` loads, loads without a cycle. */
/** A field lasts until the player cancels it, and carries the state of its crop in `fields.ts`. */
export const Claim = { None: 0, Chop: 1, Quarry: 2, Stockpile: 3, Site: 4, Field: 5 } as const;
export type Claim = (typeof Claim)[keyof typeof Claim];
