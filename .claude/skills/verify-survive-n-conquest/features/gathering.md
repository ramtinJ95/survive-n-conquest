# Gathering

The settlers carry out Chop and Quarry marks. An idle settler looks for work every 10 ticks and takes the nearest open task by straight-line distance, and one settler works a tree or a rock tile at a time. A settler chops from the tree's own tile. After 20 seconds of work at 1× the tree disappears, its pin goes, and 2 pale logs lie on its tile. A settler quarries a rock tile from a walkable tile beside it. Each 20 seconds of work puts one grey stone on the tile where the settler stands, and after 8 stone the rock tile is spent: its outline goes, it turns to bare earth at the same height, and settlers walk onto it to quarry the rock behind. At dusk every settler drops the work and walks to the camp. At dawn the settlers take the work up again, and the work done stays on the tree or the rock tile.

## Sub-features

- `gathering-chop` fells each marked tree, removes its pin, and leaves 2 logs on its tile.
- `gathering-quarry` quarries marked rock from a walkable side and leaves stone where the settler stands.
- `gathering-spent` turns a rock tile that gave 8 stone into bare ground that settlers walk onto, and removes its mark.
- `gathering-dusk` sends the settlers from the work to the camp at dusk.
- `gathering-dawn` sends them back to the work at dawn.

## How to get to it (user POV)

- Open the game without a `swarm` parameter. Scroll in on the camp.
- Press C and drag over trees, or press M and drag over rock. Press Escape to put the tool away.
- Press 4 to run at 8× and watch the settlers walk to the marks and work them.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run gathering`, which runs doctor itself.
- Every page opens on seed 7 at 960 by 540 with `clock: 'paused'`, at 08:00 on day 1 with the clock paused at tick 0. It then takes one of the `GATHER_VIEWS`: a wheel step in, a right-drag that turns and tilts the camera, and a main-button drag with no tool that pans it forward. The grove view looks east from the camp, and the rock view looks south at the north face of an outcrop. Both keep the camp in the lower half of the picture.

- **Clear a grove.** The first page records video in the grove view. It presses C and drags the grove's `area`, and the check `a Chop drag marks the grove` reads `12 trees marked for felling`. It takes `gathering-grove-marked.png`, and `reach` runs the clock at 8× to `GROVE_CLEARED`, where it takes `gathering-grove-cleared.png`. `gathering-grove.gif` runs from the drag to the cleared grove.
  - `the marked grove shows its pins` counts the pure chop orange inside the grove's `box`.
  - `by ... the settlers have felled every marked tree` needs that count to fall to almost nothing, because a pin goes only when its tree falls.
  - `the felled trees leave logs on the ground` counts `GOOD_COLORS.logs` in the same box, before and after.
- **Quarry through a dusk and a dawn.** The second page, with `?deer=off`, records video in the rock view. It presses M and drags the rock's `area`, and the check `a Quarry drag marks the rock face` reads `21 rock tiles marked for quarrying`. Then it goes through `GATHER_STOPS`. Each stop is a `reach` stop. It takes `gathering-working.png` at noon and cuts `gathering-dusk.gif` from a `reach` at 2× through dusk. It takes `gathering-night.png` and cuts `gathering-dawn.gif` from a `reach` at 2× through dawn. It takes `gathering-back.png` on the morning of day 2, then `reach` runs at 4× to `gathering-rock-spent.png`, and it cuts `gathering-quarry.gif` from that run.
- **Find the settlers.** A third page with `?swarm=off&deer=off` takes the rock view and stops at noon, at night, and on the morning of day 2. `changedIn` counts the pixels inside the rock view's `camp` box that differ from that bare page. Only settlers and their shadows can change them, because neither page has deer. With deer, a deer that grazed beside the bare page's fire made 45 pixels differ on the morning of day 2, against the limit of 20. `TUNIC_IN_SHADE` inside the rock view's `box` counts the settlers at the rock face by day. The settlers quarry in the shade of the rock, which the sky lights blue, and their tunics are too dark there for `UNIT_COLORS.villagers`: it read 13 and 37 pixels where `TUNIC_IN_SHADE` read 46 and 87.
  - `the bare rock face shows nothing in the color of a tunic` needs at most 2 pixels of `TUNIC_IN_SHADE` at the face of the bare page at both day stops. It read 0 and 0. Lit thatch matches that color too, so use it only beside such a reading.
  - `at ... the settlers quarry the rock face, away from the camp` needs 25 tunic pixels at the face and an empty camp at noon.
  - `at ... the settlers have left the work and stand at the camp` needs a full camp at night.
  - `at ... on day 2 the settlers are back at the rock face` needs the noon reading again on the morning of day 2.
- **See the stone and the spent tiles.**
  - `quarried rock leaves stone in front of the rock face` counts `GOOD_COLORS.stone` in the box before the drag and at the last stop.
  - `by ... on day 2 rock tiles are spent and lose their mark` needs a quarter fewer pixels in `QUARRY_TINT`, the violet that the mark mixes into each marked tile, at the last stop than on the morning of day 2. The outline of the marks does not shrink when the front row goes, so the check counts the tint.
  - `by ... the settlers stand on the spent tiles to quarry the rock behind them` needs the settlers' pixels at the face to move up the screen, toward the rock, between those two stops.
- **Proof.** Run `$V run gathering`. The evidence folder holds `gathering-grove.gif`, `gathering-dusk.gif`, `gathering-dawn.gif`, `gathering-quarry.gif`, eleven screenshots, and `result.json` with every check, including `no page errors`. The clips are cut to `GATHER_CLIP`, the clock, the camp, and the work at full size, in 64 colors.

## Gotchas

- One settler quarries a rock tile for 1600 ticks, nearly a whole spring day of 1800 daylight ticks. The settlers reach the face about an hour after the drag, so no rock tile is spent on day 1. The work done stays on the tile through the night, and the first tiles are spent on the morning of day 2.
- Only 8 of the 21 marked rock tiles have a walkable side at first. The others wait until a tile beside them is spent, and then a settler walks onto the spent tile to quarry them.
- The drags land on tick 0 and every stop is the first tick of its minute, so the work starts on the same tick and each stop shows the same picture on every run. On seed 7 the grove was clear by 12:42, all 8 settlers stood at the camp by 20:10 and were back at work by 06:00, and the 8 rock tiles open to a side were spent between 08:05 and 08:56 on day 2. The stops leave half an hour or more on both sides of those times, so a change to the settlers' work that moves them a little does not break the checks.
- The logs and stone are lit models in the pale wood and the pale grey of `assets/models.json`, so their colors follow the light. `GOOD_COLORS` matches them in spring daylight only, and the checks that use it stop in daylight. The sun is warm and the sky is blue, so stone reads a little yellow on its lit faces and blue on its shaded ones, and `GOOD_COLORS.stone` takes a grey on either side of neutral. The blurred edge of a label matches it, so keep labels out of a box that reads stone.
- From the opening view the forest stands between the camera and any grove near the camp, so the felled trees and their logs hide behind other crowns. The grove view looks at the forest's near edge from the camp's side.
- At 17:00 the outcrop's shadow falls on the settlers at the rock face, and they read too dark for `UNIT_COLORS.villagers`. The day stops are at noon and 07:00.
- `GOOD_COLORS.logs` also matches the sand at the lake shore, so it only counts inside the grove's box.
- Do not take these checks from the clips. Their frames depend on how fast SwiftShader draws.
