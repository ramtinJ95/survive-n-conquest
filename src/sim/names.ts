import { hashUnit } from './noise';

export const Sex = { Woman: 0, Man: 1 } as const;
export type Sex = (typeof Sex)[keyof typeof Sex];

/** The first names a villager can have, the women's list then the men's, indexed by `Sex`. */
export const NAMES: readonly [readonly string[], readonly string[]] = [
  [
    'Mira', 'Tova', 'Elsi', 'Runa', 'Nella', 'Ilka', 'Sarra', 'Vela', 'Brina', 'Adra', 'Kaili', 'Wenna',
    'Oda', 'Fenna', 'Mareth', 'Ysa', 'Tilde', 'Penna', 'Alis', 'Selka', 'Imke', 'Bera', 'Lova', 'Hanne',
  ],
  [
    'Edrik', 'Tamo', 'Osk', 'Joren', 'Kerro', 'Dorran', 'Faro', 'Wend', 'Pell', 'Lassek', 'Rasmo', 'Sten',
    'Varo', 'Hallen', 'Esker', 'Tavin', 'Arvel', 'Bodo', 'Ulvar', 'Jorrin', 'Davin', 'Merek', 'Tobin', 'Haldor',
  ],
];

/** The villager's first name, from its sex and its `name` column. */
export function nameOf(sex: Sex, name: number): string {
  return NAMES[sex][name]!;
}

const CHILD_NAME_SALT = 0x3c5d_19a7;

/**
 * The name the seed gives villager `id` of `sex` as it enters a household:
 * an index into `NAMES[sex]` drawn by the seed and the id, or the next one
 * after it that `taken` does not hold. Bit `i` of `taken` is set when a living
 * member of the household bears name `i` of that sex.
 */
export function freeName(seed: number, id: number, sex: Sex, taken: number): number {
  const names = NAMES[sex].length;
  const first = Math.floor(hashUnit(seed ^ CHILD_NAME_SALT, id, sex) * names);
  for (let step = 0; step < names; step++) {
    const name = (first + step) % names;
    if ((taken & (1 << name)) === 0) return name;
  }
  return first;
}
