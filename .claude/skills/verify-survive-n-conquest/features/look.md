# Look

The settlement is drawn with models from the purchased low-poly packs, in a world that is built in code. The camp is a patch of worn soil with three tents in dyed cloth, a ring of stones, a pot on poles, a barrel, two stacked crates, and a flame that the sun does not light. Smoke rises from the fire, and the fire lights the camp from the time the sun stands low. A log and a stone are the same shape on the ground, in a stockpile, on a site, and over the head of the settler that carries it. A site under work stands in a scaffold, and the house rises inside it, walls first and roof last. The finished house is timber under thatch and as wide as its nine tiles. The settlers are built in code: two legs, a yellow tunic with a belt, a head with hair, and two arms that swing as they walk, strike as they work, and reach up under a load. The map is an island in a sea. Pines, oaks, blossom trees, and birches stand in groves and sway in the wind, grass tufts, flowers, bushes, pebbles, and reeds cover the open grass, and waves cross the water. Everything takes the light of the scene, a warm sun under a blue sky by day and a cold moon at night, and only the flame and what it lights stay warm in the dark.

## Sub-features

- `look-models` draws the camp, the goods, and the house from `models.glb`, and says on the page when it draws stand-in shapes because the file is missing. The scaffold, the worn soil, the flame, the smoke, the settlers, the trees, the rock, and the ground cover are built in code.
- `look-site` shows a site supplied, half built in its scaffold, and finished.
- `look-carry` shows a carried log or stone over the settler that carries it.
- `look-dusk` shows the settlement at work as the light turns, and the settlers walking to the camp.
- `look-land` draws the island in its sea, four kinds of tree, and five kinds of ground cover, which leave a tile when a stack or a house takes it.
- `look-motion` moves the plants, the water, the flame, and the smoke with the time of day, and holds them still while the clock is paused.
- `look-firelight` lights the camp from the fire, weakly by day and at full strength once the sun is down.
- `look-readable` shows the settlement at the nearest zoom of 14 meters, at 22 meters, and at the farthest zoom, at noon and at midnight, in spring and in winter.
- `look-instanced` draws every repeated shape as one instanced mesh, so a frame takes a few dozen draw calls however many trees, units, goods, and houses the map holds.

## How to get to it (user POV)

- Open the game. The camp stands near the map center with the settlers around it.
- Mark trees with C and rock with M, and a stockpile with P. Press H and click to place a house, then Escape.
- Run the clock at 8× and watch the goods, the site, and the house. Scroll in to see a settler carry, and out to see the whole island.
- Let the clock run past dusk to see the fire light the camp, and to day 10 to see the winter.
- Open the game with `?swarm=on` to see 1500 villagers in the settlers' shape.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run look`, which runs doctor itself. Doctor fails without `game-assets/public/models.glb`.
- The page opens on seed 7 at 960 by 540 with the settlers and `clock: 'paused'`, and records video.

- **Build the settlement.** The page makes the marks and places the house of the `building` scenario, from the same views and at the same stops. It then drags the land up by `LOOK_PAN` and west by `LOOK_SHIFT`, so that the near view holds the camp below the house and both stand west of the winter readiness panel, which shows from the first day of autumn.
  - `the game draws the models, not stand-in shapes` needs no `.models-notice` on the page.
- **Watch the site.** It steps the paused clock 5 game minutes at a time, as `building` does, and takes `look-site-supplied.png` at the first stop where the label shows some but not all of each good. It scrolls in to the nearest view and out by `LOOK_NEAR_WHEEL` to the near view of 22 meters for `look-site-supplied-near.png`, and scrolls back by `LOOK_BACK_WHEEL`. It takes `look-site-half-built.png` at the first stop where the bar reads 50% or more, and `look-house-finished.png` at the first stop without the label.
- **Watch the dusk.** It reaches 18:45, then `reach(page, { day: 1, time: '19:40' }, { speed: '1' })` runs the clock at 1× to 19:40 and pauses it there. `look-dusk.gif` is that stretch, cropped to `LOOK_CLIP`.
- **Read it near and far.** At 00:00 and 12:00 on day 2, and at 12:00 on day 10 and 00:00 on day 11, in winter, it scrolls to the nearest view of 14 meters, out by `LOOK_NEAR_WHEEL` to the near view of 22 meters, and then to the farthest view. It takes `look-<midnight|noon|winter-noon|winter-midnight>-<nearest|near|far>.png`. The checks read the near view, which was the nearest view on `main`, so its pictures line up with those of `main`.
  - `look-noon-near shows the house under its thatch` and its winter twin count `THATCH` in `LOOK_BOXES.house` and need 1900 pixels. The house read 3711 in spring and 4108 in winter.
  - `look-noon-near shows the settlers in their tunics` and its winter twin count `UNIT_COLORS.villagers` in `LOOK_BOXES.land` outside `LOOK_BOXES.house`, and need 150 pixels. The land read 573 in spring and 1065 in winter.
  - `look-midnight-near shows the flame of the fire at the camp, and no other` and its winter twin count `FLAME`, the flame's own two colors and the blend between them, in `LOOK_BOXES.fire` and in the rest of `LOOK_BOXES.land`. They need 100 pixels at the fire and at most 5 elsewhere. The flame read 182 at both midnights and nothing else matched.
  - `look-midnight-near shows the fire lighting the camp, and nothing away from the camp as bright` and its winter twin count `FIRELIT`, a bright warm color, in `LOOK_BOXES.camp` without the flame's own pixels, and in the rest of `LOOK_BOXES.land`. They need 1500 pixels in the camp and at most 5 away from it. The camp read 3011 in spring and 3264 in winter, and the land away from it 0.
- **Draw the swarm.** A second page opens with `?swarm=on` at noon, takes `BUILD_VIEW`, and takes `look-swarm.png`.
- **Count the draws.** After each screenshot `drawsPerFrame` reads what a frame sends to WebGL.
  - `<screenshot> takes few draw calls, so its repeated shapes are instanced` needs at most `LOOK_MOST.calls` draw calls, 46, and prints the triangles. A frame took 36 to 38 calls, and 42 on the owner's GPU with a site and its marks in view.
- **Proof.** Run `$V run look`. The evidence folder holds `look-dusk.gif`, the seventeen screenshots, and `result.json` with every check, including `no page errors`.
- **Before and after.** To compare with an older build, copy this `verify.mjs` into a checkout of that build, and run `$V launch`, `$V drive look`, and `$V stop` there. `run` would stop at doctor, because the older build serves no models. The stops are the same. A build from before the nearest zoom of 14 meters stops its zoom at 22 meters, so its `-nearest` screenshots pair with this build's `-near` screenshots, and its `-far` screenshots with this build's `-far`.

## Gotchas

- The checks read the near view only. At the farthest view the house is a few pixels wide and a settler is less than one, so those screenshots are for the eye.
- `THATCH` also matches goods and tunics, 222 pixels in the house's box on a site with no house, so the check needs 1900.
- The sunlit slope of the thatch is as bright and as yellow as a tunic. A count of `UNIT_COLORS.villagers` therefore leaves the house's box out. Until it did, the settlers' check passed on the thatch alone.
- The flame is the one thing that the light does not change, so `FLAME` asks for its exact colors, as the order marks' checks do. `FIRELIT` matches the flame, the ground, the tents, and the settlers in its light, and a tunic in daylight, so it is only counted at midnight.
- A draw call count says that shapes are instanced, not that the frame is fast. The triangles include the shadow pass. Measure the frame time with [Frames](./frames.md), in a browser that draws on a real GPU.
- The winter stops add about five minutes, because the clock has to run from day 2 to day 10 at 8×.
- Do not take these checks from the clip. Its frames depend on how fast SwiftShader draws.
