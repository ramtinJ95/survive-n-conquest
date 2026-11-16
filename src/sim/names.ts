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
