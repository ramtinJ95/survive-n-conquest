# Firewood year

On seed 7 a player can bring all 8 settlers through the first winter fed and warm under the rules of stage 4. They order #30's hut, barn, and lodge, 4.2's stockpile, and four houses on the places nearest the camp at the start, and the woodshed only once no building site lacks a log. The scenario gives the year "near houses, late woodshed" of `bun scripts/firewood-years.ts near-houses-at-minutes` through the toolbar at the same game minutes as the script. It reads the winter readiness reading on day 10 and the Stockpiles panel after the last winter night, against the numbers `src/sim` gives for the same commands at the same ticks.

## Sub-features

- `firewood-year-orders` gives the year's 53 orders at 08:00 on day 1 and its woodshed and 9 trees at 06:17 on day 5, each read in the order status line.
- `firewood-year-day-10` reads the reading at 12:00 on day 10 as `4 of 4`, `2 of 4`, `0 of 8`, `0`, with no camp fire row, and at 17:00 as `4 of 4` houses with firewood.
- `firewood-year-end` reads the Stockpiles panel at 05:00 on day 13, after the dawn that ends the last winter night: 5 settlers with a job, 3 with none, 33 barn and camp food, and 16 food in homes, with the reading gone.

## How to get to it (user POV)

- Open the game at `?seed=7`. With the clock paused at 08:00, place the forager's hut, the barn, and the hunter's lodge of #30, mark their trees and rocks, draw the stockpile east of the camp, and place four houses beside the camp, marking 6 trees and a rock for each.
- Run the clock. Watch the site labels. Once no site lacks a log, on day 5 at about 06:17, place the woodshed beside the camp and mark 9 more trees.
- Run into winter, and read the winter readiness reading on day 10 and the Stockpiles panel after the last winter night.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run firewood-year`, which runs doctor itself.
- The page opens at 960 by 540 on `?seed=7`, not recorded, with `clock: 'paused'`.

- **Give the orders.** `takeForageView` takes `HIDES_YEAR_VIEW`. The scenario gives `FIREWOOD_YEAR_START` one by one, each with its key and a click or a one-tile drag, and reads each status line against `FIREWOOD_YEAR_SAID`.
- **The woodshed.** `reach` stops at 06:17 on day 5, and the scenario gives `FIREWOOD_YEAR_SHED` the same way.
- **Day 10.** At 12:00 it reads the reading and takes `firewood-year-day-10.png`. At 17:00 it reads the reading again.
- **The year's end.** At 05:00 on day 13 it reads the Stockpiles panel and the reading, and takes `firewood-year-end.png`.
- **Proof.** Run `$V run firewood-year`. The evidence folder holds the two screenshots and `result.json`.

## Gotchas

- Every pixel comes from `scripts/aim.ts` at `HIDES_YEAR_VIEW` with the tiles that `scripts/firewood-years.ts` prints for the year, and a change to the camera, the map of seed 7, or the nearest-place rule moves them.
- The woodshed's trees are the 9 standing unmarked trees nearest the camp at 06:17 on day 5, as `src/sim` finds them at that tick. An order given at another minute marks other trees.
- `firewood-years.ts`'s `tickAt` gives the first tick of a minute, the tick at which `reach` stops. The script's year with the woodshed on the event "no site lacks a log" gives it one tick earlier, at 06:16, and ends the same.
- The reading reads `2 of 4` at noon on day 10 because the last 4 firewood reach two houses that afternoon. It reads `4 of 4` by 17:00.
