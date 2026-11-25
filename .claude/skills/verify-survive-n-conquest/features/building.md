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
  - `at day 1 11:30 nothing lies on the site` counts `GOOD_COLORS` in `BUILD_BOXES.tiles`, the nine tiles below the label. The fill of the label's work bar has the color of a log and the label's blurred edge the color of stone, so no goods are counted where the label is.
- **Watch it supplied and built.** The site driver's `runUntil` steps the paused clock by `SITE_STEP`, 5 game minutes at a time for at most two days, and reads the label at each stop. It stops at the first stop where the label shows 4 logs or more and 1 stone or more, but not all of either, and takes `building-half-supplied.png`. It steps on to the first stop where the bar reads 50% or more and takes `building-work.png`, and on to the first stop without the label and takes `building-finished.png`. `building.gif` runs from the placed site to the finished house, cropped to `BUILD_CLIP`. The clip is `decimate: true, speed: 2`, so each paused stop passes in one frame and it keeps one of every 2 frames left.
  - `at ... the label shows some but not all of each good` and `at ... the delivered units lie on the site's tiles` read the label and count log and stone pixels on the site's tiles, 80 of each. Half supplied, at the stop at 12:30, they read 192 and 132.
  - `the site takes logs from the stockpile` needs the Logs total to be lower at the half-supplied or the work stop than at 11:30. Nothing but a site takes units out of a stockpile on this page, which has no workshop. A woodshed's woodcutter and a tailor take logs and hides from one too.
  - `at ... every unit has arrived and the work bar reads above 0 and below 100` reads `Logs 12/12`, `Stone 6/6`, and the percent.
  - `at ... the work bar is shown and filled to the work's share` needs the `Building work` progress bar visible, its `aria-valuenow` equal to the label's percent, and its fill within 5 points of that share.
  - `at ... the walls have risen in their scaffold on the site` needs more `SITE_TIMBER` pixels on the site at the work stop than at the half-supplied stop.
  - `at ... the label is gone and the house stands on the site` needs no label and `HOUSE_ROOF` pixels in `BUILD_BOXES.roof`, at most 100 at the work stop and at least 730 at the finished stop.
  - `at ... no log is drawn on the house's tiles any more` needs the log pixels on the site to go. It shows only what the player sees, because walls could hide a stack. `src/sim/building.test.ts` proves that the house uses up its logs and its stone. At half the work the walls and the scaffold hide the stone and most of the 12 logs. About 85 log pixels show beside them, and the check needs 40 and then at most 10. Stone has no pixel check here. Until the goods were counted below the label, this check read 280 log pixels at half the work, most of them the fill of the work bar.
- **See the settlers walk around it.** It reaches 08:30, 09:30, and 10:30 on day 2 and takes `building-around-<HHMM>.png` at each.
  - `on the morning of day 2 settlers walk beside the house` counts villager pixels in `BUILD_BOXES.around` outside `BUILD_BOXES.site` at each stop, and needs 45 at one of them. The stops read 107, 26, and 64, a carrier or two in a tunic. The sunlit thatch is as bright as a tunic, which is why the house's own box is left out.
- **Read the label.** The second page presses H, clicks `BUILD_SPOTS.house`, and presses Escape, with no marks, so the label reads 0 of 12 and 0 of 6 all day. At 12:00 on day 1 and at 00:00 on day 2 it scrolls to the nearest and then the farthest view and takes `building-label-<day|midnight>-<near|far>.png`.
  - `at ..., at the ... zoom, the label lies inside the window and its text reads` needs the label's box inside the window, its text by role, and near-white text pixels inside the box.
- **Proof.** Run `$V run building`. The evidence folder holds `building.gif`, the screenshots above, and `result.json` with every check, including `no page errors`.

## Gotchas

- Supplying is more urgent than carrying to a stockpile. A house placed together with the stockpile takes every unit straight from the ground, so the scenario places it at 11:30, once the stockpile holds logs.
- The stone is the slowest part. One stone takes a settler 20 seconds of work at 1×, so the site waits for its last stone until mid-afternoon. On this build the bar reads 51% at the stop at 17:00, and the label is gone at the stop at 17:55. The stops that read the label are the first stops of `SITE_STEP` that show what they wait for, and every one is a paused frame.
- After 17:30 the evening light turns the villager yellow outside `UNIT_COLORS`, so the settlers are counted beside the house on the morning of day 2, when they carry stone past it to the stockpile.
- The house stands at the same stop on every run. The marks and the house land on the first tick of 08:15 and of 11:30, and the stops of `SITE_STEP` fall on fixed minutes. When `reach` stopped within two game minutes of its time, an order could land a few ticks apart and the settlers then took their tasks in another order. Six runs of `building` then finished the house between 17:53 and 17:56, and one at 17:23. A change to the settlers' work can move the house by as much, and the light of the afternoon changes in that half hour, so no check may depend on the color of one moment.
- `HOUSE_ROOF` is the thatch of the roof in the afternoon, in three clauses: the sunlit slope, near (174, 114, 42) at 17:23 and (174, 102, 30) at 17:55, the slope in warm shade, near (90, 66, 18) at 17:55, and the slope in olive shade, near (78, 66, 30) at 17:23. The builders' tunics read near (126, 90, 18), yellower than the sunlit slope. Timber in shade has the colors of thatch in shade. `BUILD_BOXES.roof` is therefore the band of 90 by 22 pixels that crosses both slopes below the label and above the walls of a house at half its work. 26 and 30 of its 1980 pixels matched at half the work, and 1150 and 1060 once the house stood, at 17:55 and at 17:23. This build reads 24 at the stop at 17:00 and 1144 at the stop at 17:55. The limit of 730 is the share of the lower reading that 1500 was of the first thatch's reading.
- The house is as wide as its nine tiles, so `BUILD_BOXES.site` is 112 pixels wide.
- A settler inside the house's tiles would be hidden by its walls, so no pixel check can show that none stands there. `src/sim/building.test.ts` covers it: a finished house blocks its nine tiles and moves its builders off them, and routes go around it.
- The labels hide while any order tool is active, so a scenario that reads a label presses Escape first.
- The label is HTML. It changes as soon as the frame arrives from the worker, so a clip can show the label gone one drawn frame before the house appears.
- Do not take these checks from the clip. Its frames depend on how fast SwiftShader draws.
- Without `decimate` the clip took 8.2 and 8.6 MB in two runs, over the 8 MB limit. With `decimate: true, speed: 2` it took 6.7 MB.
