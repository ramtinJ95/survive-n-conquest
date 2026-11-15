# Look

The settlement is drawn with models from the purchased low-poly packs. The camp is a floor of soil with three tents, a ring of stones, a pot on poles, and a flame that the sun does not light. A log and a stone are the same shape on the ground, in a stockpile, on a site, and over the head of the settler that carries it. A site under work stands in a scaffold, and the house rises inside it, walls first and roof last. The finished house is timber under thatch. The settlers are built in code: boots, a yellow tunic, a head, and two arms that swing as they walk, strike as they work, and reach up under a load. Everything takes the light of the scene, so it is warm by day and cold at night, and only the flame stays bright.

## Sub-features

- `look-models` draws the camp, the goods, and the house from `models.glb`, and says on the page when it draws stand-in shapes because the file is missing. The scaffold, the camp floor, the flame, and the settlers are built in code.
- `look-site` shows a site supplied, half built in its scaffold, and finished.
- `look-carry` shows a carried log or stone over the settler that carries it.
- `look-dusk` shows the settlement at work as the light turns, and the settlers walking to the camp.
- `look-readable` shows the settlement at the nearest and the farthest zoom, at noon and at midnight, in spring and in winter.
- `look-instanced` draws every repeated shape as one instanced mesh, so a frame takes a few draw calls however many units, goods, and houses the map holds.

## How to get to it (user POV)

- Open the game. The camp stands near the map center with the settlers around it.
- Mark trees with C and rock with M, and a stockpile with P. Press H and click to place a house, then Escape.
- Run the clock at 8× and watch the goods, the site, and the house. Scroll in to see a settler carry, and out to see the whole map.
- Let the clock run past dusk to see the night, and to day 10 to see the winter.
- Open the game with `?swarm=on` to see 1500 villagers in the settlers' shape.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run look`, which runs doctor itself. Doctor fails without `game-assets/public/models.glb`.
- The page opens on seed 7 at 960 by 540 with the settlers and `clock: 'paused'`, and records video.

- **Build the settlement.** The page makes the marks and places the house of the `building` scenario, from the same views and at the same stops. It then drags the land up by `LOOK_PAN`, so that the nearest view holds the camp below the house.
  - `the game draws the models, not stand-in shapes` needs no `.models-notice` on the page.
- **Watch the site.** It runs at 8× and takes `look-site-supplied.png` when the label shows some but not all of each good, scrolls to the nearest view for `look-site-supplied-near.png`, and scrolls back by `LOOK_BACK_WHEEL`. It takes `look-site-half-built.png` when the bar reads 50% or more, and `look-house-finished.png` when the label is gone.
- **Watch the dusk.** It reaches 18:45, runs at 1× until 19:40, and pauses. `look-dusk.gif` is that stretch, cropped to `LOOK_CLIP`.
- **Read it near and far.** At 00:00 and 12:00 on day 2, and at 12:00 on day 10 and 00:00 on day 11, in winter, it scrolls to the nearest and then the farthest view and takes `look-<midnight|noon|winter-noon|winter-midnight>-<near|far>.png`.
  - `look-noon-near shows the house under its thatch` and its winter twin count `THATCH` in `LOOK_BOXES.house`.
  - `look-noon-near shows the settlers in their tunics` and its winter twin count `UNIT_COLORS.villagers` in `LOOK_BOXES.land`.
  - `look-midnight-near shows the fire burning at the camp, and nothing else as bright` and its winter twin count `FLAME` in `LOOK_BOXES.fire` and in the rest of `LOOK_BOXES.land`.
- **Draw the swarm.** A second page opens with `?swarm=on` at noon, takes `BUILD_VIEW`, and takes `look-swarm.png`.
- **Count the draws.** After each screenshot `drawsPerFrame` reads what a frame sends to WebGL.
  - `<screenshot> takes few draw calls, so its repeated shapes are instanced` needs at most `LOOK_MOST.calls` draw calls, and prints the triangles.
- **Proof.** Run `$V run look`. The evidence folder holds `look-dusk.gif`, the thirteen screenshots, and `result.json` with every check, including `no page errors`.
- **Before and after.** To compare with an older build, copy this `verify.mjs` into a checkout of that build, and run `$V launch`, `$V drive look`, and `$V stop` there. `run` would stop at doctor, because the older build serves no models. The views and the stops are the same, so the screenshots pair up by name.

## Gotchas

- The checks read the nearest view only. At the farthest view the house is a few pixels wide and a settler is less than one, so those screenshots are for the eye.
- `THATCH` also matches about 300 pixels of goods and tunics on a site with no house, so the check needs 1500.
- `FLAME` matches a tunic in daylight, so the fire is only counted at midnight.
- A draw call count says that shapes are instanced, not that the frame is fast. The triangles include the shadow pass. Measure the frame time in a browser that draws on a real GPU.
- The winter stops add about five minutes, because the clock has to run from day 2 to day 10 at 8×.
- Do not take these checks from the clip. Its frames depend on how fast SwiftShader draws.
