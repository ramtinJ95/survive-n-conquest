/** What an order claims a tile for. It lives outside `orders.ts` so that `goods.ts`, which `buildings.ts` loads, loads without a cycle. */
export const Claim = { None: 0, Chop: 1, Quarry: 2, Stockpile: 3, Site: 4 } as const;
export type Claim = (typeof Claim)[keyof typeof Claim];
