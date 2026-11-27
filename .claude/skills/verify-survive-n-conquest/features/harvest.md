# Harvest

A sown field tile grows at each dawn and is ripe at the fifth dawn after its sowing: a tile sown on day 1 is ripe at the dawn of day 6, and one sown on day 2 at the dawn of day 7. The mark layer draws the crop as it stands at the last dawn. A sown tile shows its three rows of green shoots, and the shadow of the rows on the soil grows by a tenth of a row's third at each dawn, so a player reads how far the crop has come. A ripe tile shows wide golden rows, and a cut one thin rows of pale stubble. The marks are drawn after the light, so the colors hold by night. From the dawn at which a tile is ripe, a farmer walks to the nearest ripe tile in its farm's 20 tiles and cuts it in 200 ticks of work, which puts 4 food on the tile. The farmer carries the food that lies on the fields in reach to the nearest barn or the camp with room, 1 unit a walk, before it cuts another tile, and the settlers without a job carry it in too. No farmer cuts while no store has room. The news says at the dawn of day 6 that the first crop of the year is ripe, once a year. A farmer with nothing to cut reads why: the crop is growing, no store has room, or nothing is sown until spring. This scenario plays a field from its sowing to its food in the barn, with the orders and the stops of `scripts/harvest.ts`. `src/sim/fields.test.ts` and `src/sim/harvest.test.ts` prove the rules, `src/ui/selection.test.ts` the farmer's words, and `src/ui/news.test.ts` the news line.

## Sub-features

- `harvest-orders` gives the farm, the field, the barn, and the Chop and Quarry orders for their goods through the toolbar.
- `harvest-growth` reads each field tile's state at each midnight and each noon from day 1 to day 6 against the rules, and the shadow of a sown tile growing with the dawns since its sowing.
- `harvest-ripe` reads the tiles sown on day 1 ripe at the dawn of day 6, none ripe at the midnight before, and the news line of the first ripe crop.
- `harvest-cut` reads a farmer cutting the crop, the farm's `Doing`, a farmer carrying cut food to the barn, and the cut tiles' stubble beside the ripe and the sown ones.
- `harvest-idle` reads a farmer's `Idle, the crop is growing` in summer.
- `harvest-night` takes the farm's places away on the night of day 6, so the tiles of day 2 stand ripe through day 7 and the midnight of day 8, gives them back, and reads the ripe field by night.
- `harvest-barn` reads the barn's food at the dawn, as it fills, and once the whole field is cut, against the rules.

## How to get to it (user POV)

- Open the game at `?seed=7`. The forest's edge lies a few tiles east of the camp.
- Press O and click open ground at the forest's edge east of the camp. Press I and drag a field over the grass north of the camp. Press B and click a barn site between the field and the camp. Press C and click trees, and M on a rock tile, for the farm's 8 logs and the barn's 16 logs and 6 stone.
- Run at 8×. The farm stands on day 1 and its farmers sow the field on days 1 and 2. Watch the rows' shadow grow at each dawn.
- At the dawn of day 6, 3 minutes in at 8×, the news says that the first crop of the year is ripe and the first rows turn gold. The farmers cut them and carry the food to the barn with the settlers without a job. Click the barn to read its food.
- Click a farmer to read what it does, and the farm to read what its farmers do. Use `Fewer places` on the farm's panel to keep a ripe field standing.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run harvest`, which runs doctor itself.
- One page opens at 960 by 540 on `?seed=7&food=56` with the settlers, recorded, and `clock: 'paused'`, so it stands at tick 0, 08:00 on day 1, and the orders land there. The camp's 56 food last the dusks of days 1 to 7, so nobody goes hungry before the harvest feeds them.
- Before it opens the page, the scenario runs `scripts/harvest.ts` with every stop of `HARVEST_STOPS`, which gives the scenario's orders and plays them in `src/sim`, and `scripts/aim.ts` at `HARVEST_VIEW` for the field's tiles, the farm's and the barn's roofs, and each farmer where the rules stand it at a stop.

- **Take the view.** It takes `HARVEST_VIEW`, `FORAGE_VIEW`'s 23 m zoom and turn looking at (131, 127). The field, the farm, the barn, the trees, and the rock tile all show, and the field and the barn's door lie left of and below the `Winter readiness` panel of autumn.
- **Give the orders.** It gives `harvest.ts`'s orders in their order: a farm on (136, 127), the field from (130, 121) to (135, 124), a barn on (132, 126), Chop on the 12 trees of `FIRST_YEAR_LOG_TREES` and `FIRST_YEAR_BARN_TREES`, and Quarry on (122, 115). The barn's middle lies nearer every field tile than the camp's center, so the harvest goes into the barn. `the orders of harvest.ts go through the toolbar` reads the status line after each.
- **Watch it grow.** It reaches 12:00 and 16:00 on day 1, then each midnight and each noon of days 2 to 5, and the midnight that opens day 6. At each stop `expectCrop` reads the 11 by 11 pixel box around each field tile's center: gold rows read ripe, rows of shoots sown, stubble with no shoots cut, and soil with none of them bare. Every tile reads as `harvest.ts` has it, at a midnight all but the two tiles under scenery, by day at least 20 of 24 with none read as another state, and the mean shadow of the sown tiles grows with the dawns since their sowing. At 12:00 on day 4 it clicks a farmer, which reads `Idle, the crop is growing`, and takes `harvest-farmer-growing.png`.
- **The dawn of day 6.** At 03:30 it clicks the barn, whose panel reads `Food 0 of 120`, and the clip starts. At 03:40 `the news says that the first crop of the year is ripe` needs `Day 6, 03:36. The first crop of the year is ripe.` and the rules' first ripening at 03:36, and `expectCrop` reads the 10 tiles of day 1 ripe. At 06:40 the barn's panel reads the rules' 8 units, and the clip ends.
- **Cut and carry.** At 07:50 it clicks the farmer the rules have at work on a ripe tile, which reads `Cutting the crop`, and the farm, whose `Doing` reads `Cutting the crop`. At 11:50 it clicks the farmer that carries cut food from the middle of the field, which reads `Carrying food to a barn` and `Carries 1 food`. At 12:00 `expectCrop` reads sown, ripe, and cut tiles.
- **A ripe field by night.** At 21:00 on day 6 it presses `Fewer places` twice on the farm's panel, which reads `Places 0 of 2`. The 14 tiles of day 2 ripen at the dawn of day 7 and stand: `expectCrop` reads them ripe at 12:00 on day 7 and at the midnight that opens day 8. At 00:30 on day 8 it presses `More places` twice, which reads `Places 2 of 2`, and the farm hires the nearest settlers without a job.
- **The barn.** At 12:00 on day 8 `expectCrop` reads the rest being cut, and at the midnight that opens day 9 every tile cut. The barn's panel reads the rules' 88 units: 96 cut from 24 tiles, less the camp's meals.
- **Clip.** `harvest-clip.gif` runs from 03:30 on day 6, before the dawn at which the first tiles ripen, to 06:40, when the barn holds 8 units. It drops the repeated frames and plays each remaining frame at 8 a second. Its crop of `HARVEST_CLIP` keeps the clock panel, the news line, the field, the barn, and the barn's panel, and leaves out the toolbar.
- **Proof.** Run `$V run harvest`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The tiles, the roofs, and the farmers' spots come from `aim.ts` at run time, so they follow a change to the camera's opening view or its input rates. A change to the rules moves the stops, and `harvest.ts` follows it, but the stops of `HARVEST_STOPS` are chosen from its output: at `cutting` both farmers work a tile, and at `carrying` a farmer holds food on the field.
- A farmer beside the barn's door is clicked through to the barn's pick box, so the carrying stop takes a farmer in the middle of the field.
- The scenery draws a stone over the field tile (130, 123), whose box reads about 15 shoot pixels when sown, and tufts and a stone over (130, 121), whose box reads 55% soil at night when bare. A check may read them as unclear, never as another state. Stones read as dark as the rows' shadow, so the shadow tells nothing of a bare tile.
- By day the settlers without a job carry the cut food and stand on the field, and the sacks on a cut tile hide its stubble, so the checks by day accept a tile read as unclear and need 20 of 24 to match. At a midnight every settler sits at the camp.
- From the first day of autumn the `Winter readiness` panel opens below the order status line. `HARVEST_VIEW` keeps the field clear of it, and the barn's ground spot below it.
- The farm's `Fewer places` frees the farmer that came last, then the other. The settlers it hires back are the nearest settlers without a job at that tick, and `harvest.ts` names them.
