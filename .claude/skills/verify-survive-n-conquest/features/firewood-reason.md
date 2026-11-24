# Firewood reason

While building sites still lack logs, carriers take every felled log to a site before it reaches a stockpile, so a woodshed's woodcutter has no log to split. The woodshed's panel says so in its `Doing` row, `Idle, the building sites need the logs`, and at dusk the news says that the woodcutter split no firewood that day and why. The scenario gives #40's year "wood" of `bun scripts/winter-year.ts wood` through the toolbar and reads the news at the dusk of day 2 and the woodshed's panel at noon on day 3.

## Sub-features

- `firewood-reason-news` reads the line `Day 2, 19:11. Ulvar split no firewood: sites need the logs.` in the news at the dusk of day 2, the day the woodshed stands.
- `firewood-reason-woodshed-panel` reads the woodshed's panel at 12:00 on day 3: `Firewood 0 of 40` and `Doing Idle, the building sites need the logs`.

## How to get to it (user POV)

- Open the game at `?seed=7`. With the clock paused at 08:00, give the orders of the year "wood": #30's hut, barn, and lodge, four houses west of the camp, the stockpile and the woodshed east of it, and their trees and rocks.
- Run the clock. The woodshed stands in the afternoon of day 2. Watch the news at dusk, and select the woodshed the next day.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run firewood-reason`, which runs doctor itself.
- The page opens at 960 by 540 on `?seed=7`, not recorded, with `clock: 'paused'`.

- **Give the orders.** `takeForageView` takes `HIDES_YEAR_VIEW`. The scenario gives `WOOD_YEAR_ORDERS` one by one and reads each status line against `WOOD_YEAR_SAID`.
- **The news at dusk.** `reach` stops at 19:00 on day 2, and `runUntil` steps a minute at a time to 20:00, reading the news for `IDLE_DAY_LINE`. It takes `firewood-reason-news.png` at the stop that shows it.
- **The panel.** At 12:00 on day 3 it clicks the woodshed at the points of `WOOD_YEAR_SHED` until the panel reads `Woodshed`, and takes `firewood-reason-woodshed-panel.png`.
- **Proof.** Run `$V run firewood-reason`. Run it from a checkout of the build before a change to the reason, with this scenario copied in, for the before picture from the same scene, seed, camera, and minute.

## Gotchas

- Every pixel comes from `scripts/aim.ts` at `HIDES_YEAR_VIEW` with the tiles of `winterYearCommands({ houses: 4, layout: WOOD_LAYOUT, tailor: 'at start' })`. A change to the camera, the map of seed 7, or those commands moves them.
- A line of the news shows for 30 s of wall time, so the scenario reads it at the stop it appears, not later.
- On a build before the change the panel reads `Idle, no log in a stockpile within 30 tiles of the woodshed` and the news has no such line, so both checks fail there. That is the before picture.
