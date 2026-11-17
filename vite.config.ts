import { defineConfig } from 'vitest/config';

// The converted models live in the private assets repository, cloned at game-assets/. Only its public/ folder is
// served and copied into dist, so the clone's .git folder and readme never are.
export default defineConfig({
  publicDir: 'game-assets/public',
  // The simulation tests that run whole days take about 2 s alone, and more than vitest's default 5 s when the
  // review loop's 2 CPU check runs all test files at once. A deer test timed out there at a73bba1.
  test: { testTimeout: 30_000 },
});
