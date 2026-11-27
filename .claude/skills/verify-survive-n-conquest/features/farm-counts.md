# Farm counts

A farm's panel counts the field tiles in its reach by state and says what its year brought in and what it lost. `Fields` names each state that holds a tile, in the order bare, sown, ripe, cut, killed, as `4 bare, 20 sown` or `10 cut, 14 killed`, and reads `None` while no field tile lies in the farm's reach. `This year` reads the food the farm's farmers cut in the calendar year and the tiles of their sowing that the frost killed, as `40 food cut, 14 tiles lost`. From the first tick of the second year `Last year` reads the year before in the same form, and it holds after the first dawn of spring turns the killed tiles bare. The food counts for the farm of the farmer who cut it, and the loss for the farm of the farmer who sowed it, so where two farms' reaches overlap each counts its own. This scenario plays the `frost` scenario's settlement, with its orders and its presses of the farm's places, into its second year, with the stops of `scripts/farmCounts.ts`. `src/sim/workplaceYears.test.ts` proves the counts of the year, and `src/ui/selection.test.ts` the panel's readings.

## Sub-features

- `farm-counts-orders` gives `frost`'s farm, field, barn, woodshed, two houses, stockpile, and Chop and Quarry drags through the toolbar.
- `farm-counts-year-1` reads the farm's panel in spring, at the first ripe dawn, in the middle of the harvest, on the night `frost` takes the farmers away, after the frost, and the morning after it.
- `farm-counts-new-year` reads this year turned into last year at the first tick of year 2, a minute after the last minute of year 1, while the field still reads cut and killed.
- `farm-counts-year-2` reads last year after the first dawn of spring, before the first ripe dawn of year 2, at its end, and the morning after year 2's early frost, with last year's row beside this year's, and checks the panel covers no other panel at 960 by 540.

## How to get to it (user POV)

- Give the orders of `frost.md`'s "How to get to it" on `?seed=7&food=100`, and run at 8×.
- Click the farm at any time to read its panel. On the night of day 6 press `Fewer places` twice, and after the frost at the dusk of day 9 `More places` twice, as `frost` does.
- Run on into year 2, which opens 7 minutes 18 seconds in at 8×. Its harvest starts at the dawn of day 18, 10 minutes 31 seconds in, and its early frost falls at the dusk of day 20, 12 minutes 10 seconds in.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run farm-counts`, which runs doctor itself.
- One page opens at 960 by 540 on `?seed=7&food=100` with the settlers, recorded, and `clock: 'paused'`, so the orders land at tick 0.
- Before it opens the page, the scenario runs `scripts/farmCounts.ts` with every stop of `FARM_COUNTS_STOPS`, and `scripts/aim.ts` at `FROST_ORDER_VIEW` for the orders and at `FROST_VIEW` for the farm's roof.

- **Give the orders.** As `frost` gives them, from `FROST_ORDER_VIEW`, then the wheel brings the camera in to `FROST_VIEW`.
- **Read the panel.** At each stop it clicks the farm's roof, unless the farm's panel is already open, and needs `Fields`, `This year`, and, from year 2, `Last year` to read as the rules have them. The scenario writes the expected words itself from `farmCounts.ts`'s counts and does not take them from the game's word tables. The rules' counts of the year are the settlement's tallies, `tally.reaped` since the year's first tick and `fields.lostThisYear`, which count the one farm's year apart from its own table. In year 1 it also needs no `Last year` row.
- **Places.** At 21:00 on day 6 it presses `Fewer places` twice and needs `Places 0 of 2`, and at 20:00 on day 9 `More places` twice and needs `Places 2 of 2`.
- **The clip.** The farm's panel stays open from 03:00 on day 18 to noon on day 20, while the clock runs at 8× through year 2's harvest.
- **Layout.** At the morning after year 2's frost, with all three rows, `apart` needs the panel clear of the clock, the toolbar, the Stockpiles panel, the camera controls, the news log, the status line, and the `Winter readiness` panel.
- **Screenshots.** `farm-counts-spring.png` at noon on day 2, `farm-counts-harvest.png` at 14:00 on day 6, `farm-counts-after-frost.png` at 08:00 on day 10, and `farm-counts-year2.png` at 08:00 on day 21, each at 960 by 540 with the panel open.
- **Clip.** `farm-counts-clip.gif` runs from 03:00 on day 18 to noon on day 20 at 8×: the `Fields` row moves from `24 sown` through ripe to `24 cut`, and `This year` grows from `0 food cut` to `96 food cut`, beside `Last year 40 food cut, 14 tiles lost`. Its crop keeps the clock panel and the farm's panel. It drops the repeated frames and keeps at most 100, so it stays under 4 MB for the stage's demo set.
- **Proof.** Run `$V run farm-counts`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The stops come from `farmCounts.ts`'s output. A change to the rules moves the counts, and the script follows it, but the stops are chosen from it: `midHarvest` must fall while some tiles stand ripe and some are cut, and `harvested2` after the last cut of year 2.
- The farm's panel stays open while the clock runs to a stop, so `expectPanel` reads it without a click when it is open.
- The farmers of year 2 are not those of year 1. The two hired back at 20:00 on day 9 sleep at the camp and freeze at the dusk of day 12, as `frost.md` says, and the farm hires two settlers from the houses.
