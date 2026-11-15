# Building

The settlers build the house the player places. A house needs 12 logs and 6 stone. Supplying a site is more urgent than carrying to a stockpile, so an idle settler first carries a unit the site lacks, taken from the ground or from a stockpile, whichever lies nearer the site, and stacks it on the site's nine tiles. Once every unit has arrived, up to four settlers share 90 seconds of building work at 1×, each on a corner tile. A label over the site shows the logs and the stone that have arrived, of 12 and of 6, and then the work as a bar with a percent. It keeps its size at every zoom, reads by day and by night, and makes way while an order tool is active. A scaffold stands on the site while the work goes on, and the house rises inside it, walls first and roof last. When the work is done the materials are used up, the label and the scaffold go, and a timber house under a thatch roof stands on the nine tiles, which settlers walk around.

## Sub-features

- `building-label` shows over each unfinished site the logs and the stone that have arrived, `Logs n/12` and `Stone n/6`, and `Waiting for materials` until all of them have.
- `building-supply` carries the units a site lacks from the ground and from stockpiles, and stacks them on its tiles.
- `building-work` shares the building work among the settlers once every unit has arrived, shows it as a bar and a percent in the label, and raises the house in a scaffold on the site.
- `building-house` turns the finished site into a house that stands on its nine tiles, with its materials used up and its label gone.
- `building-around` keeps the settlers off the house's tiles, so they walk around it.
- `building-label-aside` hides every label while an order tool is active, so labels never cover the marks and the house preview, and shows them again when the tool is put away.
- `building-readable` keeps the label inside the window and its text legible at the nearest and the farthest zoom, at noon and at midnight.

## How to get to it (user POV)

- Open the game. Mark trees with C and rock with M near the camp, and a stockpile with P. Press Escape.
- Press 4 to run at 8× until the Stockpiles panel counts some logs.
- Press H and click open ground near the camp to place the house. Press Escape.
- Run the clock at 8× and watch the label over the site, the units stacking on its tiles, the walls rising in the scaffold, and the roof closing.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run building`, which runs doctor itself.
- Both pages open on seed 7 at 960 by 540 with the settlers and `clock: 'paused'`, and take `BUILD_VIEW` with `takeView`.

- **Mark the work.** The first page records video. It reaches 08:15, presses C, M, and P, and drags `BUILD_SPOTS.chop`, `quarry`, and `stockpile`, each followed by Escape.
  - `a Chop drag marks its tiles` reads `7 trees marked for felling`, `a Quarry drag marks its tiles` reads `23 rock tiles marked for quarrying`, and `a Stockpile drag marks its tiles` reads `4 tiles join the stockpile zone`.
- **Place the house.** It zooms in by `BUILD_CLOSER`, reaches 11:30, reads the Stockpiles panel, presses H, clicks `BUILD_SPOTS.closerHouse`, and presses Escape. It takes `building-empty.png`.
  - `a House click places the site` reads `House site placed`.
  - `the label makes way while the House tool is active and shows once Escape puts it away` reads the label's visibility by role before and after Escape.
  - `at day 1 11:30 the empty site's label reads 0 of 12 logs and 0 of 6 stone, and no work` reads the `House site` status by role.
  - `at day 1 11:30 nothing lies on the site` counts `GOOD_COLORS` in `BUILD_BOXES.site`.
- **Watch it supplied and built.** It runs at 8× and pauses when the label shows 4 logs or more and 1 stone or more, but not all of either, and takes `building-half-supplied.png`. It runs on until the bar reads 50% or more and takes `building-work.png`, and on until the label is gone and takes `building-finished.png`. `building.gif` runs from the placed site to the finished house, cropped to `BUILD_CLIP`.
  - `at ... the label shows some but not all of each good` and `at ... the delivered units lie on the site's tiles` read the label and count log and stone pixels on the site.
  - `the site takes logs from the stockpile` needs the Logs total to be lower at the half-supplied or the work stop than at 11:30. Nothing but a site takes units out of a stockpile.
  - `at ... every unit has arrived and the work bar reads above 0 and below 100` reads `Logs 12/12`, `Stone 6/6`, and the percent.
  - `at ... the work bar is shown and filled to the work's share` needs the `Building work` progress bar visible, its `aria-valuenow` equal to the label's percent, and its fill within 5 points of that share.
  - `at ... the walls have risen in their scaffold on the site` needs more `SITE_TIMBER` pixels on the site at the work stop than at the half-supplied stop.
  - `at ... the label is gone and the house stands on the site` needs no label and `HOUSE_ROOF` pixels on the site, few at the work stop and many at the finished stop.
  - `at ... no log is drawn on the house's tiles any more` needs the log pixels on the site to go. It shows only what the player sees, because walls could hide a stack. `src/sim/building.test.ts` proves that the house uses up its logs and its stone. In the light of 17:00 almost no stone pixel matches `GOOD_COLORS.stone`, and at 17:55 the stone that carriers hold as they pass behind the house matches it in about 45 pixels, so stone has no pixel check here.
- **See the settlers walk around it.** It reaches 08:30, 09:30, and 10:30 on day 2 and takes `building-around-<HHMM>.png` at each.
  - `on the morning of day 2 settlers walk beside the house` counts villager pixels in `BUILD_BOXES.around` outside `BUILD_BOXES.site` at each stop, and needs enough at one of them.
- **Read the label.** The second page presses H, clicks `BUILD_SPOTS.house`, and presses Escape, with no marks, so the label reads 0 of 12 and 0 of 6 all day. At 12:00 on day 1 and at 00:00 on day 2 it scrolls to the nearest and then the farthest view and takes `building-label-<day|midnight>-<near|far>.png`.
  - `at ..., at the ... zoom, the label lies inside the window and its text reads` needs the label's box inside the window, its text by role, and near-white text pixels inside the box.
- **Proof.** Run `$V run building`. The evidence folder holds `building.gif`, the screenshots above, and `result.json` with every check, including `no page errors`.

## Gotchas

- Supplying is more urgent than carrying to a stockpile. A house placed together with the stockpile takes every unit straight from the ground, so the scenario places it at 11:30, once the stockpile holds logs.
- The stone is the slowest part. One stone takes a settler 20 seconds of work at 1×, so the site waits for its last stone until mid-afternoon, and the house stands at about 17:50. The stops that read the label are paused when the label shows them, not at fixed times, and every one is a paused frame.
- After 17:30 the evening light turns the villager yellow outside `UNIT_COLORS`, so the settlers are counted beside the house on the morning of day 2, when they carry stone past it to the stockpile.
- `HOUSE_ROOF` is the thatch of the roof in the late afternoon. The builders' tunics are a brighter gold with more green, and the timber has more blue, so neither matches. About 50 pixels of the site match it at half the work, when no roof is on, against about 2200 once the house stands.
- A settler inside the house's tiles would be hidden by its walls, so no pixel check can show that none stands there. `src/sim/building.test.ts` covers it: a finished house blocks its nine tiles and moves its builders off them, and routes go around it.
- The labels hide while any order tool is active, so a scenario that reads a label presses Escape first.
- The label is HTML. It changes as soon as the frame arrives from the worker, so a clip can show the label gone one drawn frame before the house appears.
- Do not take these checks from the clip. Its frames depend on how fast SwiftShader draws.
