import { defineConfig } from 'vite';

// The converted models live in the private assets repository, cloned at game-assets/. Only its public/ folder is
// served and copied into dist, so the clone's .git folder and readme never are.
export default defineConfig({ publicDir: 'game-assets/public' });
