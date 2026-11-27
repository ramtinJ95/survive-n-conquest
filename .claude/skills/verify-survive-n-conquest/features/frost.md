# Frost

Each year has one frost. It falls at the dusk of day 9, the last day of autumn, or at the dusk of day 8 in 1 year of 4, drawn from the seed and the year: on seed 7 the first year's frost falls at 19:12 on day 9. At the dawn of that day, while a crop stands, the news says `Day 9, 04:48. A frost comes tonight.` At the dusk every sown and every ripe tile that is not cut loses its crop, and the news says how many, `Day 9, 19:12. The frost killed the crop on 14 tiles.`, once a year and only when a tile was lost. Food already cut is not hurt. The mark layer draws a killed tile as dark withered rows, half a row's third wide, with no shadow, and the marks are drawn after the light, so it reads the same by night. From the frost to the first dawn of spring the ground is frozen, and a farmer with nothing to carry reads `Idle, the ground is frozen`. At the first dawn of spring a killed tile and a cut tile are bare again, and the farmers sow them. This scenario plays `harvest`'s field to a frost that finds it half cut, through the winter with `cold`'s two warm houses, to the field sown again in the next spring, with the orders and the stops of `scripts/frost.ts`. `src/sim/frost.test.ts` proves the rules, `src/ui/selection.test.ts` the farmer's words, and `src/ui/news.test.ts` the news lines.

## Sub-features

- `frost-orders` gives the farm, the field, the barn, the woodshed, two houses, the stockpile, and the Chop and Quarry drags for their goods and the winter's firewood through the toolbar.
- `frost-growth` reads each field tile's state at the noons of days 3, 4, and 6 and the midnights that open days 3, 5, and 6, so every sown stage but the first by day is read beside the killed tiles later. The field sown again on days 13 and 14 gives the first stage by day and a bare tile at midnight.
- `frost-warning` reads the news line at the dawn of the day of the frost.
- `frost-half-cut` takes the farm's places away on the night of day 6, so at the dusk of the frost the 10 tiles of day 1 are cut and the 14 of day 2 stand ripe, and reads the field tile by tile.
- `frost-killed` reads the news line that counts the tiles lost against the rules, and the killed tiles beside the cut ones after the dusk, at the midnight that opens day 10, at noon on day 10, and at the midnight that opens day 13.
- `frost-look` checks that the mean color of a killed tile's box lies at least 20 from that of a bare, a ripe, and a cut tile and of each sown stage, by day and at midnight.
- `frost-frozen` reads a farmer's `Idle, the ground is frozen` on a winter day.
- `frost-spring` reads every tile bare after the first dawn of spring, some sown again by noon on day 13 and at the midnight that opens day 14, and all by noon on day 14.

## How to get to it (user POV)

- Open the game at `?seed=7&food=100`. The forest's edge lies a few tiles east of the camp.
- Press O and click open ground at the forest's edge east of the camp. Press I and drag a field over the grass north of the camp. Press B and click a barn site between the field and the camp. Press K and click a woodshed site west of the field, H and click two house sites west of the camp, and P and drag a stockpile south of it. Press C and drag over the forest, and M over the rock north-west of the camp.
- Run at 8×. The farmers sow the field on days 1 and 2, and its first rows ripen at the dawn of day 6. On the night of day 6 click the farm and press `Fewer places` twice, so the rest of the field stands ripe.
- At the dawn of day 9, 4 minutes 55 seconds in at 8×, the news warns of the frost. At its dusk, 5 minutes 18 seconds in, the ripe rows wither and the news counts the tiles lost. Press `More places` twice, and click a farmer on a winter day to read why it is idle.
- Run to the first dawn of spring on day 13: the withered rows and the stubble are gone, and the farmers sow the field again.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run frost`, which runs doctor itself.
- One page opens at 960 by 540 on `?seed=7&food=100` with the settlers, recorded, and `clock: 'paused'`, so it stands at tick 0, 08:00 on day 1, and the orders land there. The camp's 100 food feed the settlers until the harvest comes into the barn, and nobody misses a meal through day 14.
- Before it opens the page, the scenario runs `scripts/frost.ts` with every stop of `FROST_STOPS`, which gives the scenario's orders and plays them in `src/sim`, and `scripts/aim.ts` at `FROST_ORDER_VIEW` for each order's tiles and at `FROST_VIEW` for the field's tiles, the farm's roof, and each farmer where the rules stand it at a stop.

- **Give the orders.** It takes `FROST_ORDER_VIEW`, 61 m above `HARVEST_VIEW`'s look-at point at the same turn, where every order's tiles show. It gives `frost.ts`'s orders in their order: a farm on (136, 127), the field from (130, 121) to (135, 124), a barn on (132, 126), a woodshed on (126, 123), houses on (121, 122) and (121, 127), a stockpile from (127, 130) to (129, 132), Chop from (137, 114) to (149, 140), and Quarry from (121, 113) to (123, 115). `the orders of frost.ts go through the toolbar` reads the status line after each against the tiles `frost.ts` marked: 24 field tiles, 9 stockpile tiles, 54 trees, and 5 rock tiles. It takes `frost-orders.png`, then wheels `FROST_CLOSER` in to `FROST_VIEW`, within a pixel of `HARVEST_VIEW`.
- **Watch it grow.** At each growth stop `expectCrop` reads the 11 by 11 pixel box around each field tile's center, as `harvest` reads it, with one more state: dark withered rows with no shoots, gold, or stubble read killed. Every tile reads as `frost.ts` has it, at a midnight all but the two tiles under scenery, by day at least 20 of 24 with none read as another state.
- **Take the farmers away.** At 21:00 on day 6 it presses `Fewer places` twice on the farm's panel, which reads `Places 0 of 2`. At the midnight that opens day 8 the tiles of day 2 read ripe beside the cut ones.
- **The warning.** At 04:50 on day 9 `the news warns of the frost` needs `Day 9, 04:48. A frost comes tonight.`, the rules' frost at day 9 19:12, its dawn at 04:48, and crops standing. It takes `frost-warning.png`.
- **The dusk of the frost.** At 18:40 the clip starts and `expectCrop` reads the field half cut, 10 cut and 14 ripe. `reach` runs the clock at 1× to 19:20, and the clip ends. `the news counts the tiles the frost killed` needs `Day 9, 19:12. The frost killed the crop on 14 tiles.`, the 14 the rules had standing at 18:40, killed, and in the tally. `expectCrop` reads 14 killed and 10 cut.
- **The killed field.** At 20:00 it presses `More places` twice, which reads `Places 2 of 2`. `expectCrop` reads the killed and the cut tiles at the midnight that opens day 10 (`frost-killed-midnight.png`), at noon on day 10 (`frost-killed-day.png`), and at the midnight that opens day 13.
- **Frozen.** At 12:00 on day 11 it clicks a farmer where the rules stand it, which reads `Idle, the ground is frozen`, and takes `frost-farmer-frozen.png`.
- **Spring.** At 05:00 on day 13, after the first dawn of spring at 04:48, `expectCrop` reads every tile bare (`frost-spring-bare.png`). At noon on day 13 and at the midnight that opens day 14 it reads the tiles the farmers have sown again beside the bare ones, and at noon on day 14 the whole field sown (`frost-sown-again.png`).
- **The look.** `a killed tile reads apart from a bare, a sown, a ripe, and a cut one` takes the mean color of the boxes of the tiles read in each state, and of the sown tiles at each stage, by day and at midnight, and needs the killed tiles' mean at least `STAGE_MARGIN`, 20 in 8-bit RGB, from each other.
- **Clip.** `frost-clip.gif` runs from 18:40 to 19:20 on day 9 at 1×, through the dusk of the frost: the light falls, the ripe rows wither beside the stubble, and the news line comes. It drops the repeated frames and plays each remaining frame at 8 a second. Its crop of `FROST_CLIP` keeps the clock panel, the news line, the field, and the barn, and leaves out the toolbar.
- **Proof.** Run `$V run frost`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The tiles, the roofs, and the farmers' spots come from `aim.ts` at run time, so they follow a change to the camera's opening view or its input rates. A change to the rules moves the stops, and `frost.ts` follows it, but the stops of `FROST_STOPS` are chosen from its output: at `frozen` a farmer stands clear of the panels and carries nothing.
- Until the woodshed stands at 14:30 on day 2, the label of the woodshed's site covers the west of the field, and its dark panel reads within `ORDER_TOLERANCE` of the withered rows, so a box under a label reads killed. The field is first read at the midnight that opens day 3, when no label covers it.
- The scenery draws stones over the field tiles (130, 121) and (130, 123), as `harvest`'s gotchas say. A check may read them as unclear, never as another state.
- The news shows a line for 30 seconds of wall time, so the scenario reads it at the first stop after its minute, before any screenshot.
- The farm hires back the nearest settlers without a job. The two who come back at 20:00 on day 9 sleep at the camp and freeze at the dusk of day 12, and the farm then hires two of the settlers in the houses, who sow in spring. `frost.ts` names the farmers at each stop.
- Two farmers sow about 54 tiles in spring on this layout and cut about 44 of them by the frost, as `frost.ts` played fields of 48, 72, and 96 tiles, so a field too large for them leaves a fifth of its crop standing. The scenario takes the farmers away instead, to leave half the field.
