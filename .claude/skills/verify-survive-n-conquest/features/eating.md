# Eating

A settler that missed a meal eats before any other work. On its next look for work, once a second at 1×, it checks the store it eats from, its house or the camp while its household has none. When that store holds a unit no other settler has spoken for, the settler gives up its task, walks there, and eats the unit when it arrives, at any hour of the day. That clears its missed meals, and it goes back to work and eats at dusk as usual. A settler that carries a unit delivers it first. A settler whose house is empty while a barn or the camp has food carries a unit home and eats it there. A settler whose store has no food does not walk and keeps working at half the rate. Its panel reads `Walking to the camp to eat` or `Walking home to eat` while it walks. `src/sim/eating.test.ts` and `src/sim/food.test.ts` prove the rules, and `src/ui/selection.test.ts` proves the panel's words.

## Sub-features

- `eating-hungry` reads `1, hungry` in a settler's panel on the morning after it missed its meal.
- `eating-walk` reads `Walking to the camp to eat` in the same panel by day, with food at the camp.
- `eating-fed` reads `None` under `Missed meals` after the meal, long before dusk, with the panel at the same width.

## How to get to it (user POV)

- Open the game at `?seed=7&food=0`, so the camp opens with no food.
- Place a forager's hut east of the camp and Chop its four log trees, as `foraging` does, at once.
- Run to the morning of day 2. Click Ulvar, who missed the meal of the first dusk, and run at 1× until the foragers bring food to the camp.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run eating`, which runs doctor itself.

- **Give the orders.** The page opens at 960 by 540 on `?seed=7&food=0`, recorded, with `clock: 'paused'`, and takes the view of `foraging`. `the camp opens with no food` reads the Stockpiles panel. The Chop tool clicks the four log trees and the Forager's hut tool places the hut, and `the player's orders place the hut site` counts its label.
- **Find the hungry settler.** `reach` stops at 06:30, 07:00, 07:30, and 08:00 on day 2, and at each stop the scenario clicks the fullest cells of tunic pixels until Ulvar's panel opens. `Ulvar missed the meal of the first dusk and reads hungry` needs `1, hungry`. It takes `eating-hungry.png`.
- **Watch the walk.** From there `reach` stops every 3 game minutes until 13:00 and reads the panel at each paused stop. `with food at the camp by day, Ulvar walks there to eat` needs `Walking to the camp to eat` with food at the camp, and takes `eating-walking.png`. `Ulvar eats at the camp by day, which clears the missed meal` needs `None` before 18:00, and takes `eating-fed.png`. `the panel keeps its width while the settler walks to eat` compares the panel's width at the three stops.
- **Compare with main.** At 09:30 on day 2 `Ulvar's panel reads no missed meal` and the scenario takes `eating-pair.png`. Run the same scenario in a checkout of an older build to take its side of the pair: there the two checks of the walk fail, and the panel at 09:30 reads `1, hungry`.
- **Proof.** `eating-walk-to-eat.gif` runs from just before the walk to just after the meal, cropped to the camp, the hut, and the panel. The evidence folder holds it, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The orders land at the paused tick a few game minutes after 08:00, so who sets out first and when can move by a few minutes from run to run. The scenario finds Ulvar by his panel's title and reads his panel at every stop, so no check waits on a fixed tick.
- A settler eats on the tick it arrives, so the panel almost never reads `Eating`. The scenario reads `None` under `Missed meals` instead.
- The foragers bring in about 1 unit for every 2 game hours each while they are hungry themselves, and 6 settlers wait for a meal on day 2, so a settler other than Ulvar can take the first units.
