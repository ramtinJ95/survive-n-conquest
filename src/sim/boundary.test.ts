import { expect, it } from 'vitest';

const sources = import.meta.glob<string>(['./**/*.ts', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const SPECIFIER = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;

function importsLeavingSim(path: string, source: string): string[] {
  const base = new URL(path, 'file:///sim/');
  return [...source.matchAll(SPECIFIER)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter(
      (specifier) =>
        !specifier.startsWith('.') || !new URL(specifier, base).pathname.startsWith('/sim/'),
    );
}

it('keeps every simulation import inside src/sim', () => {
  const entries = Object.entries(sources);
  expect(entries.length).toBeGreaterThan(0);
  const leaks = entries.flatMap(([path, source]) =>
    importsLeavingSim(path, source).map((specifier) => `${path} imports ${specifier}`),
  );
  expect(leaks).toEqual([]);
});
