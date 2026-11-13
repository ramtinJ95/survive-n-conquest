# survive-n-conquest verification map

This directory is the maintained source for verifying what a player sees and does in survive-n-conquest. Read this index before you drive the game, then use the matching feature file as the recipe.

## Baseline preconditions

- The checkout under test has run `bun install`, and its working tree holds the change you are proving.
- Headless Chromium is installed, and `ffmpeg` and `bun` are on `PATH`.
- The game runs from a production build that `verify.mjs launch` or `verify.mjs run` started on a free port.
- `verify.mjs doctor` passes every check.
- Never drive an instance that this verification run did not start.

## Driving conventions

- Run every command from the checkout root, with `V=.claude/skills/verify-survive-n-conquest/scripts/verify.mjs`.
- Each feature has one scenario in the `SCENARIOS` table of `verify.mjs`. The scenario name matches the feature file name.
- Locate the world by `canvas#world`. Locate interface elements by ARIA role and accessible name once they exist.
- Drive through the page only: viewport size, pointer, and keyboard.
- Start every scenario from a fresh page load. The game keeps no saved state yet.
- Choose the map with the `seed` URL parameter, through `open(viewport, { search: '?seed=7' })`.
- The game opens with 1500 villagers and 3000 monsters on the map. They hold still while the clock is paused, so screenshots from one paused page compare cleanly. Two page loads pause at different ticks, so a comparison across page loads opens both with `swarm=off`.
- Wait with `still(page)` before every screenshot. The camera eases into place.
- Pin the time before you compare screenshots, because the light and the colors of the map follow the clock. `open` runs every page to 12:00 on day 1 and pauses it there unless you pass another `clock`. `reach(page, { day, time })` pins any other time. Two pages pinned to the same time can still differ by up to 2 game minutes.
- A check that reads the colors of the land opens the page with `swarm=off`. Villager yellow reads as an autumn leaf, and monster red over snow reads as blossom.

## Proof and skip reporting

- Capture the user action and the resulting state. Each scenario records a GIF clip of the action and screenshots of the states before and after it.
- Pair each screenshot with the pixel or layout checks from `result.json` that cover it.
- Record the build revision from `result.json` with every artifact. A revision that ends in `-dirty-<hash>` was built from uncommitted changes, and the hash names those changes.
- Report a scenario that cannot run with the command and the failing doctor check.
- Do not report a feature as verified through a different scenario.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the player-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every player entry point.
3. `Driving it with verify.mjs` starts with `Preconditions:` and uses labeled bullets that pair each player action with the scenario step and the observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Window](./window.md) covers opening the game to a map that fills the window, and refilling the window after a resize.
- [Terrain](./terrain.md) covers the seeded map of hills, water, forest, and rock, and choosing the seed.
- [Camera](./camera.md) covers panning, turning, tilting, and zooming by keyboard and mouse, and the limits that keep the camera on the map and above the ground.
- [Swarm](./swarm.md) covers the 1500 villagers and 3000 monsters that move with the clock, hold still while it is paused, and leave the map with `swarm=off`.
- [Clock and speed controls](./clock.md) covers the time of day and the date advancing in a Web Worker, pausing, and the four speeds by pointer and keyboard. It also says how to reach a chosen time.
- [Daylight](./daylight.md) covers the sun, the sky, and the shadows following the clock through a day, and the night that stays light enough to play in.
- [Seasons](./seasons.md) covers the colors of the ground and the trees in each season, and the nights that are short in summer and long in winter.
