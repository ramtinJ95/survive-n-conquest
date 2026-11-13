# Swarm

The game opens with the benchmark load on the map: 1500 villagers in yellow and 3000 monsters in deep red. Villagers walk between random nearby points at 1.5 tiles per second. Monsters walk at 1 tile per second along one flow field to the land nearest the map center, and a monster that arrives enters again at the map edge. Neither group steps onto water or rock. The simulation moves them in the Web Worker, so they move only while the clock runs. The `swarm=off` URL parameter opens the same map with no units.

## Sub-features

- `swarm-shows` draws every villager and every monster standing on the ground, one instanced mesh for each group.
- `swarm-moves` moves the units with the clock, faster at higher speeds.
- `swarm-holds` keeps every unit in place while the clock is paused.
- `swarm-off` opens the map with no units when the URL has `swarm=off`.

## How to get to it (user POV)

- Open the game. The units are on the map from the first frame and move at 1×.
- Press 4 to run at 8× and watch the monsters stream toward the center.
- Press Space to pause. Every unit stops where it stands.
- Add `?swarm=off` to the URL, with or without a seed, to open the map with no units.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run swarm`, which runs doctor itself.

- **Watch the swarm at 8×.** Open the game at 960 by 540 with recording on and `clock: 'running'`, press 4, wait 5 seconds, hold `X` for 1.2 seconds to zoom out, and wait 5 seconds more. `swarm-8x.gif` shows the units moving close up and then from farther away. The check `swarm-8x.gif stays under 8 MB` passes.
- **See both groups.** Open a fresh page at 1280 by 720, which pauses the clock, and wait with `still(page)`. `swarm-paused.png` shows the units. The check `villagers and monsters both show` counts the pixels of each unit color with `unitPixels` and needs 500 of each.
- **Hold while paused.** Wait 2 seconds. The check `the swarm holds still while the clock is paused` compares `swarm-paused.png` with `swarm-paused-later.png`.
- **Run and pause again.** Press 4, wait 2.5 seconds at 8×, press Space, and wait with `still(page)`. The check `the swarm moves while the clock runs` compares `swarm-paused.png` with `swarm-after-8x.png` from the same camera.
- **Open without the swarm.** Load `?swarm=off`. `swarm-off.png` shows the bare map from the same camera. The check `?swarm=off shows no unit colors` needs fewer than 50 pixels of each unit color, which also shows that the color test does not match the terrain. The check `the swarm draws units over the same map` compares it with `swarm-paused.png`.
- **Proof.** Run `$V run swarm`. The evidence folder holds `swarm-8x.gif`, four screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- `unitPixels` matches the saturated yellow of villagers and the deep red of monsters in `src/render/swarm.ts`. Update `UNIT_COLORS` in `verify.mjs` when those colors or the lighting change on purpose, and say so in the pull request.
- Two page loads pause at different ticks, so their units stand in different places. Compare screenshots across page loads only with `swarm=off`. Within one paused page the units hold still and `still(page)` returns.
- The frame rate in headless Chromium says nothing about the game with 4500 units. SwiftShader draws on the CPU. The tick time comes from `bun run bench`, and the frame rate comes from a real browser on the owner's machine.
- The 8× clip runs about 12 seconds.
