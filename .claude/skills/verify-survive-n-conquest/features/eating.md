# Eating

A settler that missed a meal eats before any other work. On its next look for work, once a second at 1×, it checks the store it eats from, its house or the camp while its household has none. When that store holds a unit no other settler has spoken for, the settler gives up its task, walks there, and eats the unit when it arrives, at any hour of the day. That clears its missed meals, and it goes back to work and eats at dusk as usual. A settler that carries a unit delivers it first. A settler whose house is empty while a barn or the camp has food carries a unit home and eats it there. A settler whose store has no food does not walk and keeps working at half the rate. Its panel reads `Walking to the camp to eat` or `Walking home to eat` while it walks. `src/sim/eating.test.ts` and `src/sim/food.test.ts` prove the rules, and `src/ui/selection.test.ts` proves the panel's words.

## Sub-features

- `eating-hungry` reads `1, hungry` in a settler's panel on the morning after it missed its meal.
- `eating-walk` reads `Walking to the camp to eat` in the same panel by day, with food at the camp.
- `eating-fed` reads `None` under `Missed meals` after the meal, long before dusk, with the panel at the same width.

## How to get to it (user POV)

- Open the game at `?seed=7&food=0`, so the camp opens with no food.
- Press Space as soon as the game opens, to pause the clock. Place a forager's hut east of the camp and Chop its four log trees, as `foraging` does.
- Run to the morning of day 2. Click a settler whose panel reads `1, hungry`, and run at 1× until the foragers bring food to the camp.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run eating`, which runs doctor itself.

- **Give the orders.** The page opens at 960 by 540 on `?seed=7&food=0`, recorded, with `clock: 'paused'`, and takes the view of `foraging`. It gives the orders at once, at 08:00 on day 1 with the clock paused at tick 0, so they land on the same tick in every run. `the camp opens with no food` reads the Stockpiles panel. The Chop tool clicks the four log trees and the Forager's hut tool places the hut, and `the player's orders place the hut site` counts its label.
- **Find the hungry settler.** `reach` stops at 07:30, 08:00, and 08:30 on day 2, and at each stop the scenario clicks the fullest cells of tunic pixels until the panel of a settler that reads `1, hungry` opens. `<name> missed the meal of the first dusk and reads hungry` needs `1, hungry`. On this build the clicks find Fenna at 07:30. It takes `eating-hungry.png`.
- **Watch the walk.** From there `reach` stops every 3 game minutes until 15:00 and reads the panel at each paused stop. `with food at the camp by day, <name> walks there to eat` needs `Walking to the camp to eat` with food at the camp, and takes `eating-walking.png`. `<name> eats at the camp by day, which clears the missed meal` needs `None` before 18:00, and takes `eating-fed.png`. `the panel keeps its width while the settler walks to eat` compares the panel's width at the three stops. On this build Fenna walks at 08:48 with 2 food at the camp, and reads `None` at 08:57.
- **Read the panel later.** At 15:30 on day 2 `<name>'s panel reads no missed meal` and the scenario takes `eating-pair.png`. It was once one side of a pair with a build from before eating by day. This `verify.mjs` cannot take the other side, because it opens every page with `?clock=paused` and stops it with the worker's `pauseAt`, which a build that old does not have.
- **Proof.** `eating-walk-to-eat.gif` runs from just before the walk to just after the meal, cropped to the camp, the hut, and the panel. The evidence folder holds it, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The tick of the orders decides who goes hungry. When a page paused as it loaded, between 08:06 and 08:09, orders at 08:06 made other settlers hungry than orders at 08:08. With the orders at tick 0 the same settler is hungry on every run. The scenario still finds its settler by the panel's title and reads the panel at every stop, so a change to the settlers' work that makes another settler hungry does not break it.
- A settler eats on the tick it arrives, so the panel almost never reads `Eating`. The scenario reads `None` under `Missed meals` instead.
- The foragers bring in about 1 unit for every 2 game hours each while they are hungry themselves, and 6 settlers wait for a meal on day 2, so another hungry settler can take the first units.
