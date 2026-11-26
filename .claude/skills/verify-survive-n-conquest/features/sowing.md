# Sowing

A field is grass that the player marks for sowing, and a farm is the workplace whose farmers sow it. The player drags a field with the `Field` tool, `I`, over grass, as a stockpile is dragged. Only a tile of grass with no claim, no goods, and not under the camp takes the mark, and the field keeps it until the player cancels it. The player places a farm with the `Farm` tool, `O`, on 2 by 2 tiles of open, level ground, and the settlers build it from 8 logs. Nothing can be built on a field. When the farm stands, the two settlers without a job nearest it take its places and become farmers. In spring, days 1 to 3, a farmer walks to the bare field tile nearest it within 20 tiles of the farm and sows it in 150 ticks of work. A field tile is drawn as tilled soil inside a yellow outline, and a sown tile adds three rows of green shoots across it. The marks are drawn after the light, so the colors hold by night. A farmer with nothing to sow is idle and its panel says why. The farm's panel names its farmers, sets its filled places, and reads what its farmers do. This scenario plays the first spring on seed 7 of `src/sim/firstYear.ts` `firstSpringCommands`, from the orders to the first day of summer. `src/sim/fields.test.ts` proves the rules, and `src/ui/selection.test.ts` proves the farm's and the farmer's panels and the idle words this page never reaches, such as `Idle, no field within 20 tiles of the farm`.

## Sub-features

- `sowing-field-tool` picks the Field tool with I, says how many tiles a held drag adds, marks the grass under the drag on release, and refuses a drag over the forest or the camp.
- `sowing-farm-tool` picks the Farm tool with O, places a farm site with a click, and refuses a farm aimed onto the field with the field's words.
- `sowing-farm` builds the farm and fills its two places with the nearest settlers without a job.
- `sowing-panels` reads the farm's note, its farmers by name in the order they came, `Places 2 of 2`, and what its farmers do, and a farmer's `Job Farmer` and what it does.
- `sowing-sown` draws soil on every field tile and shoots on each tile the rules have sown, by day and by night.
- `sowing-idle` reads `Idle, the fields are sown` on the last day of spring and `Idle, nothing is sown until spring` in summer.
- `sowing-cancel` removes one sown tile with a Cancel click, and the tile looks like grass again.
- `sowing-toolbar` keeps the toolbar of 12 tools inside the page at 960 by 540 and clear of the clock, the camera hint, the Stockpiles panel, and the farm's panel.

## How to get to it (user POV)

- Open the game at `?seed=7`. The forest's edge lies a few tiles east of the camp.
- Press O and click open ground at the forest's edge east of the camp. Press Escape.
- Press I and drag over the grass north of the camp, between it and the farm. Press Escape.
- The camp has no logs. Press C and click the four trees nearest the camp on the forest's edge, so the settlers fell them for the farm's 8 logs.
- Run at 8×. The label over the farm's site goes at about 12:18, and the two new farmers walk to the field.
- Click the farm to read its panel and set its places. Click a farmer to read what it does.
- Watch day 1 and day 2 at 8×. The field turns green row by row from the corner nearest the farm.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run sowing`, which runs doctor itself.
- One page opens at 960 by 540 on `?seed=7` with the settlers, no `food` setting, recorded, and `clock: 'paused'`, so it stands at tick 0, 08:00 on day 1, and the orders land there. The camp's 24 food last the dusks of days 1 to 3, and the page never reaches a death.
- Before it opens the page, the scenario runs `scripts/sowing.ts` with every stop of `SOW_STOPS`, which plays the same orders in `src/sim`, and `scripts/aim.ts` at `FORAGE_VIEW` for the tiles of `SOW_TILES` and for each farmer where the rules stand it at a stop.

- **Take the view.** `takeForageView` takes `FORAGE_VIEW`, the 23 m view east over the camp to the forest's edge that `foraging` takes. The field lies between the camp and the farm in it.
- **Give the orders.** It gives them in the order of `firstSpringCommands`, so the page plays the same ticks as the rules. It presses O over the toolbar and clicks the tile (136, 127). `O picks the Farm tool, and a click on (136, 127) places a farm site` reads the pressed button, the hint, and `Farm site placed.` It presses I and holds a drag from (129, 122) to (134, 125). `I picks the Field tool, and a drag from (129, 122) to (134, 125) marks the field's 24 tiles` reads the hint, `Release to add 24 tiles to the field.` while the button is held, and `24 tiles join the field.` after. It drags over the forest from (137, 123) to (140, 124) and over the camp, and `a Field drag over ... in the forest and over the camp marks nothing and says why` reads `No unmarked grass free of goods there can join a field.` after each. It presses O, moves onto (131, 123), and clicks. `the Farm tool aimed onto the field at (131, 123) is refused with the field's words` reads `Cannot build here. A field lies in the way. Cancel it first.` and counts one farm site after the click. It presses C and clicks each of the four trees of `foraging`. It takes `sowing-orders.png`.
- **See the bare field.** It reaches 12:00 on day 1 and takes `sowing-field-day-bare.png`. `at day 1 12:00 before the farm stands the field is bare` reads the box of 11 by 11 pixels around each field tile's center: no tile shows shoots, and soil fills the boxes. `the field shows its outline, and the grass beside it shows no soil and no shoots` counts the outline's yellow around the field and reads the boxes of 10 grass tiles beside it.
- **Watch it built.** It reaches 12:15, where the clip starts, and `runUntil` steps the paused clock 5 game minutes at a time. `the farm is finished on day 1 between 11:30 and 13:30, as the rules finish it at day 1 12:18` reads the first stop without the label, 12:20.
- **Read the farm.** It clicks the farm's roof. `the farm's panel says what it does and names its two farmers, Ysa and Jorrin as the rules hire them, with both places filled` reads the title, the note, the names in the order of `sowing.ts`, `Places 2 of 2`, and a farmer's words in `Doing`. With the panel open, `the toolbar holds its 12 tools, Field and Farm among them, ...` reads the names and the boxes of the toolbar's buttons against each other, the page, the clock, the camera hint, the Stockpiles panel, and the farm's panel. It takes `sowing-toolbar-960x540.png`.
- **Read the sowing.** It reaches 13:00. `the farm's panel reads what its farmers do` needs `Sowing a field` or `Walking to a field to sow`, and it takes `sowing-farm-panel.png`. It clicks where `sowing.ts` and `aim.ts` put each farmer's tunic until a panel reads `Job Farmer`, and `a farmer's panel reads its job and that it sows` reads its name and its doing. It takes `sowing-farmer-panel.png`. It reaches 16:00 with the farmer selected, and `the followed farmer still sows` reads its panel again.
- **Count the sown tiles.** At the midnight after day 1 it takes `sowing-field-midnight.png`, where shoots must show on exactly the 10 tiles that `sowing.ts` names and on no other, and soil on every tile. At the midnight after day 2 it takes `sowing-field-midnight-sown.png`, and at 12:00 on day 3 `sowing-field-day-sown.png`, where shoots must show on all 24, and the grass beside the field still reads as grass.
- **Read the idle farmers.** At 12:00 on day 3, the last day of spring, `a farmer reads that the fields are sown` needs `Idle, the fields are sown`. At 12:00 on day 4, the first day of summer, `a farmer reads that nothing is sown until spring` needs `Idle, nothing is sown until spring`, and it takes `sowing-farmer-summer.png`.
- **Cancel a tile.** At the midnight after day 4 it takes `sowing-field-night-before-cancel.png` with the 24 tiles sown, presses Delete, and clicks the tile (134, 122). `a Cancel click on the sown tile (134, 122) removes its field, and it looks like the grass again while the other 23 keep their shoots` reads `Orders removed from 1 tile.` and the tile's box in `sowing-field-cancelled.png`.
- **Clip.** `sowing-field.gif` runs from the stop at 12:15 on day 1, with the farm a few minutes from finished, to the stop at 16:00, when 4 tiles are sown. It drops the repeated frames and plays each remaining frame at 8 a second, so it passes in about 16 s. Its crop of `SOW_CLIP` keeps the time and the date of the clock panel, the Stockpiles panel, the field, the farm, and the followed farmer's panel, and leaves out the clock's speed buttons, the toolbar, and the news.
- **Proof.** Run `$V run sowing`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The tiles and the farmers' spots come from `aim.ts` at run time, so they follow a change to the camera's opening view or its input rates. A change to the map of seed 7 or to the rules moves the farmers and the sown tiles, and `sowing.ts` follows it. The farm's anchor and the field's corners are `firstSpringCommands`'s.
- The orders go in the order of `firstSpringCommands`: the farm, the field, then the four chops. The refused drags and the refused farm change nothing, so they leave the ticks as the rules play them.
- The camp's trodden ground reaches the tiles (128, 124) and (128, 125) beside the field's south west corner and reads as soil, so the grass tiles of `SOW_TILES` leave them out.
- The scenery draws stones and tufts of grass over a few field tiles, such as (130, 123), whose box reads 19% soil when sown. The soil check takes the mean over the field's bare tiles and over its sown tiles, and the shoots check reads each tile.
- By day the settlers without a job wander over the field and hide some of its tiles, so the tile checks read the field before the farm stands, at midnight, when every settler sits at the camp, and at 12:00 on day 3, when the farmers stand idle elsewhere. The cancel waits for the midnight after day 4 for the same reason.
- A farmer at work stands on the tile it sows, so a click at its tunic can miss when the farm's pick box lies behind it. The scenario tries each farmer in turn.
- A `Selection` row reads only the value before a control's buttons, so `Places` reads `2 of 2` and not the button faces beside it.
