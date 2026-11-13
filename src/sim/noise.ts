// Everything here uses integer math, +, -, *, / and Math.sqrt only. Those give the
// same bits on every engine. Math.sin and friends do not, and a map must not
// depend on the browser that generated it.

/** A well-mixed unsigned 32-bit hash of a lattice point. */
export function hash(seed: number, x: number, y: number): number {
  let h = seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

/** The hash as a fraction in [0, 1). */
export function hashUnit(seed: number, x: number, y: number): number {
  return hash(seed, x, y) / 0x100000000;
}

const UNIT = 1 / Math.sqrt(5);
const GRADIENTS = Float64Array.from(
  [1, 2, 2, 1, 2, -1, 1, -2, -1, -2, -2, -1, -2, 1, -1, 2],
  (component) => component * UNIT,
);

function corner(seed: number, x: number, y: number, dx: number, dy: number): number {
  const gradient = (hash(seed, x, y) & 7) * 2;
  return GRADIENTS[gradient]! * dx + GRADIENTS[gradient + 1]! * dy;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth gradient noise in about [-1, 1], with one feature per unit of distance. */
export function gradientNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const dx = x - x0;
  const dy = y - y0;
  const u = fade(dx);
  const top = mix(corner(seed, x0, y0, dx, dy), corner(seed, x0 + 1, y0, dx - 1, dy), u);
  const bottom = mix(
    corner(seed, x0, y0 + 1, dx, dy - 1),
    corner(seed, x0 + 1, y0 + 1, dx - 1, dy - 1),
    u,
  );
  return mix(top, bottom, fade(dy)) * Math.SQRT2;
}

/** Layers of gradient noise, each twice as fine and half as strong as the last, in about [-1, 1]. */
export function fractalNoise(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let total = 0;
  let strength = 1;
  let scale = 1;
  for (let octave = 0; octave < octaves; octave++) {
    sum += strength * gradientNoise(seed + Math.imul(octave, 0x632be5ab), x * scale, y * scale);
    total += strength;
    strength *= 0.5;
    scale *= 2;
  }
  return sum / total;
}
