# Readiness

From the first tick of autumn, day 7, to the last winter dusk, on day 12, a panel with the role `status` and the name `Winter readiness` says how ready the settlement is for the cold nights still to come. Its title reads `Winter readiness, 3 cold nights to come`: 3 through autumn and on day 10 until its dusk, then 2, then 1. Its rows are `Households in a house` (households with a house out of the households with a living member), `Houses with firewood` (finished houses that hold 2 firewood for each cold night to come, so 6 before the winter, out of all finished houses), `Settlers in clothing` (out of the living settlers), and `Cold tonight`, the settlers that would have a cold night if a winter night fell now, by the rule that judges a night at dusk, from each settler's home, the firewood there or at the camp, and its clothing. While a household sleeps at the camp a fifth row, `Camp fire`, reads `Lights, n firewood` when the camp holds the 4 its fire burns, or `Out, n of 4 firewood`. The panel is hidden the rest of the year. It sits below the order status line and left of the toolbar, in the style of the Stockpiles panel. In winter a house's panel has a `Fire last night` row under its `Firewood`: `No winter night yet` on day 10 and until the dawn of day 11, then `Burned` or `Did not burn` for the night that ended at the last dawn. Outside winter the row is not there. `src/sim/readiness.test.ts` proves the counts, the nights to come, and that the settlers counted cold are those the next winter dusk gives a cold night, `src/ui/readiness.test.ts` and `src/ui/selection.test.ts` the words, `src/sim/firstYear.test.ts` the reading against each winter night of three first years, and `bun scripts/winter-year.ts` prints the reading on each day of autumn of those years.

## Sub-features

- `readiness-hidden` reads the panel hidden at 08:30 on day 1 and at 20:00 on day 6.
- `readiness-autumn` reads the panel at 00:30 on day 7 with 3 cold nights to come and its four rows, and at 08:30 on day 7 with one house stocked: `1 of 4`, `1 of 1`, `0 of 8`, `6`, and the camp's fire lit.
- `readiness-last-house` places the second house at 08:30 on day 7 with the clock paused and follows it: `1 of 1` while it is a site, `2 of 4` housed and `1 of 2` with firewood once it stands, `Cold tonight` from 6 to 4 once it holds 2, and `2 of 2` once it holds 6.
- `readiness-winter` reads the house's `Fire last night` as `No winter night yet` at 12:00 on day 10, `Cold tonight` as 4 at 17:00 on day 10 against the 4 the news names cold at that dusk, the title's 2 cold nights after it, and `Burned` at 08:00 on day 11.
- `readiness-layout` measures the panel, with its camp fire row, against the clock, the toolbar, the Stockpiles panel, the camera hint, the order status line, the news, the open house panel, and the tallest box the selection panel can take, at 960 by 540, 960 by 600, and 1280 by 720.
- `readiness-wood-and-hides` gives the year "wood and hides" of `bun scripts/winter-year.ts hides` through the toolbar and reads the panel at 07:30 on day 7: `0 of 4`, `0 of 0`, `0 of 8` or `1 of 8`, `8`, and `Out, 0 of 4 firewood`.

## How to get to it (user POV)

- Open the game at `?seed=7&food=200`. Mark trees, rock, and a stockpile, and place a woodshed and a house, as in `cold`.
- Run at 8× to the first day of autumn. The panel appears at midnight below the clock's line, left of the toolbar.
- Place a second house, select it once it stands, and watch the panel's numbers change as its household carries firewood home.
- Run into winter. Select a house in the morning after the first winter night to read whether its fire burned.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run readiness`, which runs doctor itself.
- The first page opens at 960 by 540 on `?seed=7&food=200` with the settlers, recorded, and `clock: 'paused'`. The second opens at 960 by 540 on `?seed=7`, not recorded.

- **Give the orders.** `takeForageView` takes `COLD_ORDER_VIEW` and `reach` stops at 08:30. It gives the cold scenario's Chop, Quarry, and Stockpile drags, the woodshed, and the first house of `COLD_ORDERS`. `at day 1 08:30 the orders mark ...` reads the status line after each and the clock, which has not moved, and `... in spring the reading of readiness is hidden` reads the panel. The wheel then brings the camera to the near view.
- **Read the panel come.** `reach` stops at 20:00 on day 6 and at 00:30 on day 7. The checks read the panel hidden, then shown with its title and its four rows.
- **The first day of autumn.** At 08:30 on day 7 it reads the panel and takes `readiness-autumn.png`. It places the second house at `READY_SECOND_HOUSE` from the near view with the clock paused.
- **Follow the last house.** It stops at each time of `READY_STOPS.follow`, clicks the second house in `COLD_SPOTS`, and reads its panel and the reading, until the reading counts `2 of 2`. The two follow checks need the order of the readings in the sub-feature above. It takes `readiness-stocked.png`.
- **The clip.** `readiness-last-house.gif` runs from the first follow stop, 13:00, to the last, cropped by `READY_CLIP` to the left 800 pixels at a width of 560, with 40 colors, `decimate`, and `speed: 4`: repeated frames are dropped and one frame in four of the rest is kept, so it plays far faster than the game, and fits the stage's 4 MB for a clip. The clock in each frame says its game time.
- **Winter.** At 12:00 on day 10 it reads the house's panel. From 17:00 it runs at 1× to 18:20 reading the news, as `cold` does, and stops at 18:30. At 08:00 on day 11 it selects the house and takes `readiness-house-winter-morning.png`.
- **Layout.** At each of `READY_SIZES` it reads the boxes of `uiBoxes`, presses P to show the order status line, measures a copy of the news log with its 5 longest lines, and stretches the selection panel to the height its `max-height` allows to measure the tallest selection panel. The check needs the reading inside the page and clear of every other box.
- **The year "wood and hides".** On the second page `takeForageView` takes `HIDES_YEAR_VIEW` and `reach` stops at 08:30 on day 1. It gives `HIDES_YEAR_ORDERS` one by one, each with its key and a click or a one-tile drag, and reads each status line against `HIDES_YEAR_SAID`. At 08:30 on day 4 it places `HIDES_YEAR_TAILOR`. At 07:30 on day 7 it reads the panel and takes `readiness-wood-and-hides-autumn.png`.
- **Proof.** Run `$V run readiness`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- Every pixel comes from `scripts/aim.ts`, with the commands in the comments above `COLD_SEARCH` and `HIDES_YEAR_VIEW`. A change to the camera's opening view, its input rates, or the map of seed 7 moves them.
- In `src/sim` runs of the first page's layout with the orders at 08:28 to 08:34 on both days, the second house stood at 13:41 to 13:48 on day 7, held 2 firewood by 15:29 to 15:53 and 6 at 16:09 to 16:33. The follow stops start at 13:00 so the first sees it as a site.
- The orders land at 08:30, not the cold scenario's 08:15, because a slow page load first pauses as late as 08:19, and `reach` fails a stop it overshoots by more than 2 game minutes. On the second page the tailor's hut waits to 08:30 on day 4, because with the orders at 08:32 the lodge was not finished by 12:00 on day 3. With the orders at 08:30 the tailor made its first piece before dawn on day 7, so the check takes `0 of 8` or `1 of 8` in clothing.
- The reading hides with the `hidden` attribute, which takes it out of the accessibility tree, so the scenario finds it with `includeHidden`.
- The selection panel's computed `max-height` reads as an unresolved `calc()`, so the tallest box is measured with the panel stretched, not computed.
- A line of the news shows for 30 s of wall time, so at the layout stop the log is often empty. The check measures a copy of the log that holds 5 lines of `READY_LONGEST_NEWS`, the most lines it shows, each naming all 8 settlers.
- The reading covers the map behind it, as every panel does. At the near view of this scenario it covers part of the first house's roof and, for a moment, the second site's label.
- The year's second house overlaps 3 tiles of 4.4's stockpile square, so its drag says `6 tiles join the stockpile zone`, in the game and in `src/sim`.
- On the second page the orders of a kind say the same status line one after another, so a refused order that leaves the line as it was would not show in the line. The 6 site labels and the reading on day 7 would.
- On a pylon with 6 CPUs a run took about 25 minutes, most of it the waits at 8×.
