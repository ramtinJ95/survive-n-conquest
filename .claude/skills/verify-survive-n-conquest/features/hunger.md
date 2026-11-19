# Hunger

Each settler eats once a day, at dusk, when it comes home: 1 unit of food from its household's store, the house when its household has one and the camp when it has none. A new game opens with 24 food at the camp, three days for 8 settlers, and nothing in this stage produces food. A settler that finds no food at dusk has missed a meal and is hungry, and it eats at dawn instead if its store has food by then. At its third missed meal in a row it dies and leaves the map. A household with a house carries food home from the camp until the house holds 3 days of meals for its living members. The Stockpiles panel shows the food in barns and at the camp as one total and the food in homes as another. With no barn, the first total is the camp's food, and the scenario reads it as that. The `Settlement news` log at the bottom right, left of the toolbar, names who went hungry, who ate again, and who starved, and each line stays at least 30 s of wall time. A settler's panel reads its missed meals, and the house and camp panels read the food they store. When the last settler dies, a dialog says that the settlement has died out and offers a new map, and the clock stops. This scenario proves a settlement that does nothing, from the last meal to the end. `src/sim/food.test.ts` proves the rules, the death time of each settler on seed 7, and the determinism of the run.

## Sub-features

- `hunger-store` shows the camp's food fall by 8 at each of the first three dusks.
- `hunger-news` names all 8 settlers in the news as they go hungry and as they starve.
- `hunger-panel` reads 1 and then 2 missed meals in a settler's panel.
- `hunger-over` shows the died-out dialog at the dusk of day 6, stops the clock, and opens a new map with 24 food from its `New map` button.

## How to get to it (user POV)

- Open the game at `?seed=7` and give no orders.
- Run at 8×. The camp's food reads 16, 8, and 0 after the first three dusks.
- The news names the hungry settlers at the dusk of day 4 and the dead at the dusk of day 6, when the dialog shows.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run hunger`, which runs doctor itself.

- **Watch the store empty.** The first page opens at 960 by 540 on `?seed=7`, recorded, with `clock: 'paused'`. The check `the camp opens with 24 food and the homes with none` reads the Stockpiles panel. `reach` stops at 22:00 on days 1 and 2 and at 18:55 on day 3, and the checks read 16, 8, and 8.
- **Run to the end.** From 18:55 on day 3 `runUntil` steps the paused clock by `HUNGER_RUN`, 60 game minutes at a time until 12:00 on day 7 at most, and reads the news log and the camp's food at each stop. It records each news line at the stop that first shows it. When the last settler dies the game stops the clock itself, and `reach` returns there, at 20:54 on day 6, with the `The settlement has died out` dialog showing. The checks `the news names all 8 settlers as they go hungry`, `... as they starve`, and `the camp is empty from the last meal on` read what it heard. `the clock stops when the settlement has died out` reads the clock twice, 3 s apart, and `the settlement dies out at the dusk of day 6` reads when the dialog showed. It takes `hunger-died-out.png`.
- **Start again.** `New map opens a new map with 24 food at the camp` clicks `New map` and reads the new page's seed and food. `New map` picks a random seed by design, so the seed in its detail differs on every run, and the check needs only a seed other than 7. `hunger-last-meal-to-death.gif` runs from 18:55 on day 3 to 3 s after the dialog showed, zoomed in to about 49 m on the camp, without the camera controls, and played at 3 times the speed it was recorded at.
- **Read a hungry settler.** A second page on `?seed=7` runs to noon on day 5 and clicks the tunics it finds, the largest first, until a settler's panel opens. `a settler that missed its first meal reads hungry` needs `Missed meals` to read `1, hungry`, and it takes `hunger-settler-panel.png`. At noon on day 6 the same settler reads `2, hungry`.
- **Proof.** Run `$V run hunger`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- The scenarios that run settlers past the dusk of day 6, `look`, `selecting`, and `cold`, open with `?food=200`, the `FED` setting in `verify.mjs`, or their settlers starve and the clock stops before winter. Scenarios that stop earlier open as a player does, so their settlers can go hungry from the dusk of day 3 or 4 on, and the news log can show at the bottom right.
- The settlers die on arrival at the camp, over about half a game hour after dusk, so the starved settlers come in more than one news line.
- A line of the news log joins the events of one kind within one game hour, so the scenario collects every text a line takes at the stops. A stop sees only the text the line has then, so the detail of `the news names all 8 settlers ...` names the stop where each text first showed, not the minute it was written.
- Each stop adds a pause to the clip. With stops every 30 game minutes the clip took 8.4 MB, over the 8 MB limit, and with `decimate` as well it took 13.7 MB, so the stops are every 60 game minutes. With those stops and no `decimate` it took 7.1 MB.
- A settler that does not get home by dawn, such as one working far from the camp, misses that meal at dawn. It then walks to its store and eats there by day if the store has food. This scenario gives no orders, so no store has food from the dusk of day 3 on and no settler eats by day. `features/eating.md` covers the walk to eat.
