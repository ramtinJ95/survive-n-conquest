export const DEFAULT_SEED = 7;

const MAX_SEED = 0xffffffff;

/**
 * Turns the text a player typed into a seed. A whole number that fits in 32 bits is
 * the seed itself. Any other text is hashed, so a word works as a seed too.
 */
export function parseSeed(text: string | null): number {
  const typed = text?.trim() ?? '';
  if (typed === '') return DEFAULT_SEED;
  if (/^\d+$/.test(typed) && Number(typed) <= MAX_SEED) return Number(typed);
  let hash = 0x811c9dc5;
  for (let i = 0; i < typed.length; i++) {
    hash = Math.imul(hash ^ typed.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}
