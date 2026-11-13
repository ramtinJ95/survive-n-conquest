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
- Wait with `still(page)` before every screenshot. The camera eases into place.
- Pause the clock before you compare screenshots. `open` presses Space to pause it unless you pass `clock: 'running'`. A paused game still shows the time it paused at, which differs by a few game minutes between page loads.

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
- [Clock and speed controls](./clock.md) covers the time of day and the date advancing in a Web Worker, pausing, and the four speeds by pointer and keyboard. It also says how to reach a chosen time.
