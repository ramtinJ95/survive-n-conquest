# survive-n-conquest verification map

This directory is the maintained source for verifying what a player sees and does in survive-n-conquest. Read this index before you drive the game, then use the matching feature file as the recipe.

## Baseline preconditions

- The checkout under test has run `bun install`, and its working tree holds the change you are proving.
- Headless Chromium and Playwright's ffmpeg are installed, and `ffmpeg` and `bun` are on `PATH`. In a Nexus pylon, `.nexus/setup` installs them.
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
- The game opens with 8 settlers at the camp. `swarm=on` opens it with 1500 villagers and 3000 monsters, and `swarm=off` with no units. Units hold still while the clock is paused, so screenshots from one paused page compare cleanly. Two page loads pause at different ticks, so a comparison across page loads opens both with `swarm=off`, or stops both with `reach` at the same time.
- Each scenario opens the game the way its checks need. `window` and `clock`, and the clip of `camera`, open with the settlers. `terrain`, `seasons`, and the checks of `camera` open with `swarm=off`. `swarm` and `daylight` open with `swarm=on`, because their checks count villager and monster pixels. `settlers`, `gathering`, and `hauling` open with the settlers, and compare them with `swarm=off`. `building` opens both its pages with the settlers, because they supply and build the house. `look` opens with the settlers for the same reason, and its last page with `swarm=on`. `households` opens its first page with the settlers, who build two houses, and compares it with a page of settlers and no orders and a page with `swarm=off`. `selecting` opens every page with the settlers, because it selects them, their work, and their house. `hunger` opens with the settlers on seed 7 and gives no orders. `look` and `selecting` open their pages that run to winter with `?food=200`, because the 24 food of a new game run out and the settlers die at the dusk of day 6. The page of `orders` that runs the clock opens with `swarm=off`, because the settlers would work its marks.
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
- [Settlers](./settlers.md) covers the 8 settlers at the camp that a new game opens with, who wander near it by day, walk to it at dusk, and stay there until dawn.
- [Gathering](./gathering.md) covers the settlers felling marked trees into logs and quarrying marked rock into stone until a rock tile is spent, and dropping the work at dusk and taking it up at dawn.
- [Hauling](./hauling.md) covers the settlers carrying logs from the ground to a stockpile one unit at a time, the Stockpiles panel that shows the totals, goods left where they lie when no stockpile has room, and carriers putting their units down at dusk and carrying them on after dawn.
- [Building](./building.md) covers the settlers carrying 12 logs and 6 stone to a placed house from the ground and from a stockpile, sharing its building work, the label over the site that shows what has arrived and how far the work is at every zoom by day and by night, and the finished house that the settlers walk around.
- [Households](./households.md) covers the 8 settlers as 4 households, the finished house that becomes a household's home, the members who walk home at dusk and go inside while the households without a house walk to the camp, and everyone coming out at dawn.
- [Hunger](./hunger.md) covers the camp's 24 food, the settlers eating at dusk from their household's store, the hungry and the dead named in the `Settlement news` log, a hungry settler's panel, and the dialog when the settlement has died out, which stops the clock and offers a new map.
- [Look](./look.md) covers the models of the camp, the goods, the site in its scaffold, and the house, the settlers' shape and motion, the island with its trees and ground cover, the wind, the waves, the smoke, and the firelight, and how the settlement reads near and far, at noon and at midnight, in spring and in winter.
- [Selecting](./selecting.md) covers selecting a settler, a house site, a house, or the camp with no tool active, the mark that rings the selected thing, the panel that reads what it is and what it does while the clock runs and while it is paused, and clearing the selection.
- [Frames](./frames.md) covers the time a frame takes on a real GPU, for a settlement at work and for the swarm.
- [Orders to the land](./orders.md) covers the toolbar of Chop, Quarry, Stockpile, House, and Cancel, the marks they leave on the map, the preview and refusal of a house site, and the camera controls that stay free while a tool is active.
- [Swarm](./swarm.md) covers the 1500 villagers and 3000 monsters that `swarm=on` puts on the map, which move with the clock and hold still while it is paused, and the bare map of `swarm=off`.
- [Clock and speed controls](./clock.md) covers the time of day and the date advancing in a Web Worker, pausing, and the four speeds by pointer and keyboard. It also says how to reach a chosen time.
- [Daylight](./daylight.md) covers the sun, the sky, and the shadows following the clock through a day, and the night that stays light enough to play in.
- [Seasons](./seasons.md) covers the colors of the ground and the trees in each season, and the nights that are short in summer and long in winter.
