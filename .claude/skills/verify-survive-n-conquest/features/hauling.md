# Hauling

The settlers carry goods from the ground to the stockpile zone. Carrying a unit from the ground to a stockpile is more urgent than chopping and quarrying, so an idle settler without a job takes it first. A child or a settler with a job never carries to a stockpile. A carrier takes one unit at a time, at 1.5 tiles per second, and carries it above its head as a small log or stone. A carrying task reserves its unit where it lies and one free place in a stockpile, so two settlers never walk for the same log or the same gap. A stockpile tile holds up to 8 units of one good. When no stockpile has room, the goods stay where they lie and nobody walks for them. At dusk a carrier puts its unit down where it stands and walks to the camp, or into its house when its household has one, and after dawn the settlers carry the dropped units on. The Stockpiles panel at the top left shows how many logs, how much stone, and how many hides lie on stockpile tiles.

## Sub-features

- `hauling-carry` carries logs from the ground into a stockpile one unit at a time and stacks them there.
- `hauling-totals` shows the Logs and Stone totals of the stockpile tiles in the Stockpiles panel, rising as units arrive.
- `hauling-full` leaves goods where they lie once every stockpile place is taken, with nobody walking for them.
- `hauling-dusk` makes each carrier put its unit down where it stands at dusk and walk to the camp, with the totals unchanged through the night.
- `hauling-dawn` sends the settlers back to the dropped units after dawn.
- `hauling-layout` keeps the Stockpiles panel clear of the clock, the status line, the toolbar, and the camera hint at 1280 by 720 and 960 by 540.

## How to get to it (user POV)

- Open the game without a `swarm` parameter. Scroll in on the camp and look at the forest edge.
- Press C and drag over trees, then wait for the settlers to fell them.
- Press P and drag over open ground to make a stockpile zone. Press Escape to put the tool away.
- Press 4 to run at 8× and watch the settlers carry the logs into the zone, and the Logs total at the top left rise.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run hauling`, which runs doctor itself.
- Every page but the last opens on seed 7 at 960 by 540 with `clock: 'paused'` and takes the grove view of `GATHER_VIEWS`, which `takeView` shared with `gathering`. The first three press C and drag the grove's `area`, and reach `HAUL_STOPS` before they mark a stockpile, so the 24 logs of the 12 felled trees lie in the grove when the carrying starts.

- **Fill a stockpile from a cleared grove.** The first page records video. It takes `hauling-grove-cleared.png` at 13:30, presses P and drags `HAUL_SPOTS.near`, and reads `20 tiles join the stockpile zone.` from the status line. It takes `hauling-grove-rising.png` at 15:00 and `hauling-grove-stacked.png` at 17:30. `hauling-grove.gif` runs from the drag to the last stop, cropped to `HAUL_CLIP`.
  - `at 13:30, with no stockpile, the felled logs lie in the grove and the panel counts none` reads `Logs 0` and `Stone 0` and counts `GOOD_COLORS.logs` in the grove's box.
  - `the Logs total rises from 13:30 to 15:00 to 17:30` reads the panel at the three stops.
  - `the logs stack up inside the stockpile` counts log pixels in `HAUL_BOXES.near` at the three stops.
  - `by 17:30 the logs have left the grove` needs the grove's log pixels to fall to half or less.
- **Fill a small stockpile.** The second page drags `HAUL_SPOTS.small` at 13:30, 2 tiles and 16 places, and `a Stockpile drag makes fewer places than the 24 logs` reads the count from the status line. It takes `hauling-full-filled.png` at 17:00 and `hauling-full.png` at 10:00 on day 2.
  - `the full stockpile holds as many logs as it has places ...` needs the Logs total to equal the places at both stops.
  - `... the logs with no place still lie in the grove` counts `LOGS_IN_A_CLEARED_GROVE_BY_DAY` in the grove's box at both stops, and needs 50 pixels each time. It also counts that color in `hauling-grove-stacked.png`, where the first stockpile emptied the same grove by 17:30, and needs at most 5 there.
- **Put the units down at dusk.** The third page takes `hauling-route-before.png` at 15:30, then drags `HAUL_SPOTS.far` near the lake, a long walk from the grove. It takes `hauling-dusk-before.png` at 19:05, with carriers on the route and logs above their heads, reads the panel at 19:30, takes `hauling-dusk-after.png` at 21:00, reads the panel at 04:30 on day 2, and takes `hauling-dawn-carried.png` at 11:00 on day 2. A fourth page with `?swarm=off` takes the same view at 15:30, 19:05, and 21:00, and at 11:00 on day 2, `hauling-bare-<stop>.png`. `changedIn` counts the pixels in `HAUL_BOXES.route` and `HAUL_BOXES.camp` that differ from that bare page.
  - `at 15:30, before the far stockpile, nothing lies on the route` needs at most 10 more log pixels on the route than the bare map shows there at the same stop, and almost no change on the route. Pink flowers grow on the route and match `GOOD_COLORS.logs`: the route and the bare map both read 30.
  - `at 19:05 carriers walk the route` needs the route to differ from the bare map.
  - `at 21:00 the units lie on the route where the carriers put them down, and the settlers stand at the camp` needs the route to differ by more than `NIGHT_THRESHOLD`, and the camp by more than `SETTLER_THRESHOLD`.
  - `the totals do not change from 19:30 to day 2 04:30` reads the panel at 19:30, 21:00, and 04:30.
  - `after dawn the settlers carry the dropped units on by day 2 11:00` needs at most 10 more pixels of `GOOD_COLORS.logs` on the route at 11:00 than the bare map shows at that stop, and a higher Logs total than at night. The night checks show the units lying on the route and nobody carrying them until dawn. This check shows that they are gone from the route and on a stockpile by 11:00. In a pylon the route and the bare map both read 1 at 11:00. With the dropped units never carried on, the route read 35 log pixels at 11:00 against 1 on the bare map, while the Logs total still rose from 8 to 16 with the grove's logs.
- **Fit the panel.** The last page opens at 1280 by 720, presses P so that the status line shows its hint, and compares the box of the Stockpiles panel with the boxes of the clock, the status line, the toolbar, and the camera hint. It checks that the panel shows `Logs` and `Stone`, takes `hauling-1280x720.png`, and does the same at 960 by 540 for `hauling-960x540.png`.
- **Proof.** Run `$V run hauling`. The evidence folder holds `hauling-grove.gif`, the screenshots above, and `result.json` with every check, including `no page errors`.

## Gotchas

- With a stockpile marked from the start, each log leaves the grove almost as soon as its tree falls, so no stop shows the logs lying in the grove. The scenario clears the grove first. The first two pages mark their stockpile at 13:30, and the dusk page marks its stockpile at 15:30.
- Carrying is more urgent than chopping, so a grove with a stockpile is cleared hours later than in `gathering`.
- `GOOD_COLORS` matches the logs in the sun of a spring day only. It finds them at 17:30 and not at 18:30. Every log count stops between 10:00 and 17:30.
- A log put down at night differs from the bare ground by about 25 in its brightest channel, no more than `SETTLER_THRESHOLD`. The night check uses `NIGHT_THRESHOLD`.
- At 19:30 the settlers still walk across the route to the camp. The after-dusk screenshot waits until 21:00, when they all stand at the camp.
- The carriers take the front logs first. Beside the full stockpile the 8 logs left lie under the crowns at the back of the grove. The sky lights that deep shade blue, the pale wood reads near (100, 96, 78) there, and `GOOD_COLORS.logs` matches none of it. So this check counts `LOGS_IN_A_CLEARED_GROVE_BY_DAY`, which takes the wood in the sun and in that shade, about 12 pixels for each log. That predicate also matches blossom, flowers, and the forest in the evening light, so use it only in a cleared grove by day, and beside a reading of the same grove empty.
- The wheel zooms toward the middle of the screen, not the pointer. A closer view of the route loses the far stockpile and hides the grove behind its crowns, so the dusk page keeps the grove view, where a carrier and its log are a few pixels across.
- A grove tile holds the 2 logs of its tree, so two settlers often walk to the same tile, each for one of its logs.
- Do not read the route between dawn and 09:00. The carriers lift the dropped units then, and the low sun brightens fast, so a reading catches the scene in motion. In a pylon the route read 149, 1, 33, 10, and 32 log pixels more than the bare map at 06:00, 06:30, 07:00, 07:30, and 09:00, and 20 at 07:00 with the scenario's own stops, where the owner's Mac had read 33. Those stops landed a few ticks apart on different machines and with different stops before them. `reach` now stops on the first tick of its minute, so the same stops read the same on every run.
- Do not take these checks from the clip. Its frames depend on how fast SwiftShader draws.
