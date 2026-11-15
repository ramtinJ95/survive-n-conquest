# Settlers

A new game opens with 8 settlers in villager yellow at the camp, a floor of soil with three tents and a fire, on the walkable tile nearest the map center that a walk from the map edge reaches. By day each settler walks between random points within 8 tiles of the camp at 1.5 tiles per second. At dusk, 19:12 in spring, every settler walks to the camp center along the shortest walk over land, then straight out to its own spot in a ring 1.5 tiles around it. A spot that a straight walk from the center cannot reach is the center itself. It stays there until dawn, 04:48 in spring, and then wanders out again. Settlers never step onto water or rock. A settler with no walk to the camp stays where it stands through the night.

## Sub-features

- `settlers-open` opens the game with the settlers at the camp near the map center.
- `settlers-wander` walks the settlers between points near the camp by day.
- `settlers-dusk` walks every settler to the camp at dusk, around water and rock.
- `settlers-night` keeps the settlers at the camp until dawn.
- `settlers-dawn` sends the settlers out again at dawn.

## How to get to it (user POV)

- Open the game without a `swarm` parameter. The first view looks at the map center, where the camp is.
- Scroll the wheel toward you to zoom in on the camp.
- Press 4 to run at 8× until dusk, then 1 to watch the settlers walk home at 1×.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run settlers`, which runs doctor itself.

- **Zoom in on the camp.** Every page of this scenario opens at 960 by 540 with `clock: 'paused'`, moves the pointer to the center of the view, turns the wheel by 900 pixels toward the player, and waits with `still(page)`. A wheel turn zooms by a fixed factor, so every page shows the same view, and the camp sits in the middle of it.
- **Watch a dusk and a dawn.** The first page records video. It runs `reach` to 19:00 on day 1, then runs at 1× to 19:35, at 8× to 04:35 on day 2, and at 1× to 05:10, and pauses. `settlers-dusk-and-dawn.gif` starts at 19:00 and shows the settlers walking home after 19:12, the night at 8×, and the settlers leaving the camp after 04:48. The check `settlers-dusk-and-dawn.gif stays under 8 MB` passes.
- **Stop at five moments.** A second page, with the settlers, runs `reach` to 15:00, 19:00, and 21:00 on day 1 and to 04:30 and 07:00 on day 2, and takes `settlers-<stop>.png` at each. A third page, with `?swarm=off`, does the same and takes `bare-<stop>.png`. `reach` stops both pages on the same tick, so the only difference between two screenshots of one stop is the settlers and their shadows.
- **Find the settlers.** For each stop, `changedPixels` finds the pixels where the two screenshots differ by more than 25 in a color channel. It reports how many there are, their centroid, and their spread, which is the root mean square distance from the centroid in pixels. This finds the settlers at night, when they are too dark for `unitPixels`.
- **See them by day.** The check `the settlers show by day` needs 400 villager pixels in `settlers-afternoon.png` and fewer than 50 in `bare-afternoon.png`.
- **See them gather.** The check `at night the settlers stand together at the camp in the middle of the view` needs a spread under 40 pixels at 21:00 and a centroid within 60 pixels of the view center.
- **See them stay.** The check `the settlers stay at the camp until dawn` needs the centroid and the spread at 04:30 to be within 10 pixels of those at 21:00.
- **See them out by day.** The checks `by day the settlers wander away from the camp`, `before dusk the settlers are still out`, and `after dawn the settlers leave the camp again` need a spread more than twice the night spread at 15:00, 19:00, and 07:00.
- **Proof.** Run `$V run settlers`. The evidence folder holds `settlers-dusk-and-dawn.gif`, ten screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The checks read where the settlers are, not how many there are. The count of 8 comes from the unit tests in `src/sim/settlers.test.ts`, and from `settlers-night.png`, where all 8 stand in the ring. By day the wander box reaches into the forest beside the camp, so `settlers-afternoon.png` shows 7, and the eighth walks under the trees or out of the view.
- The spread at night is about 28 pixels, which matches the ring of spots 1.5 tiles from the camp center at about 20 pixels a tile. By day it is 75 to 95 pixels.
- The centroid at night sits about 30 pixels above the view center, because the settlers stand upright and the camp is the ground under them.
- The night and the before-dawn outlines differ by a few pixels even though no settler moved, because the moonlight shades the settlers differently at 21:00 and at 04:30.
- On rj-firebat the settlers were all at the camp by 19:26, 14 game minutes after dusk, and the first left it at 04:54, 6 minutes after dawn. The 1× parts of the clip leave room on both sides.
- Do not take these checks from the clip. Its frames depend on how fast SwiftShader draws, and the settlers walk while it runs.
- Walking around water and rock is covered by the unit tests, which follow a settler around a wall and check every unit's tile on every tick. A pixel check cannot tell a walk around a lake from one across it.
