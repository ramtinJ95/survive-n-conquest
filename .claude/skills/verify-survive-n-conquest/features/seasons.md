# Seasons

The ground and the trees change with the season. Spring is light green with pink blossom on the broadleaf trees. Summer is deep green with dry meadows. Autumn turns the broadleaf trees orange and the grass brown. Winter covers the ground and the trees in snow. The night is 40% of the day in spring and autumn, 30% in summer, and 55% in winter. A season lasts three days and a year lasts twelve.

## Sub-features

- `seasons-ground` colors the grass, the meadows, the forest floor, and the high rock for the season.
- `seasons-trees` colors the broadleaf trees for the season and puts snow on the pines in winter.
- `seasons-turn` changes the look from one season to the next over the last afternoon and evening of a season.
- `seasons-night` sets dusk at 19:12 in spring and autumn, 20:24 in summer, and 17:24 in winter. Dawn is as long after midnight as dusk is before it.
- `seasons-sun` raises the noon sun highest in summer and keeps it lowest in winter.

## How to get to it (user POV)

- Open the game and let the clock run. Spring is days 1 to 3, summer days 4 to 6, autumn days 7 to 9, and winter days 10 to 12.
- Press 4 to run at 8×. A season then passes in 1 minute 52 seconds, and the first winter noon comes after about 5 minutes 44 seconds.
- Press Space to hold the view at any time.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run seasons`, which runs doctor itself.

- **Open the game.** Load `?swarm=off` at 1280 by 720 with `clock: 'running'`. The camera never moves, so every screenshot has the same view.
- **Stop at noon of each season.** `reach` pauses at 12:00 on days 1, 4, 7, and 10. `season-1-spring-noon.png`, `season-2-summer-noon.png`, `season-3-autumn-noon.png`, and `season-4-winter-noon.png` show the four looks. The checks `the date reads <Season> at day <n> 12:00` read the date.
- **Read the colors.** The checks `<Season> colors the map at noon` read the lower 65% of each noon screenshot against `SEASON_LOOKS`. Spring needs green plants and pink blossom. Summer needs green plants and no blossom. Autumn needs orange leaves and few green plants. Winter needs snow and no green plants. The checks `<Season> looks different from the season before it` compare each noon with the last one.
- **Stop in the evening.** `reach` pauses at 18:30 on the same days. `season-<n>-<season>-evening.png` shows each. The check `at 18:30 it is still day in summer and already night in winter` compares each evening's brightness with its own noon.
- **Stop at midnight.** `reach` pauses at 00:00 on days 2, 5, 8, and 11. `season-<n>-<season>-midnight.png` shows each. The checks `midnight in <Season> is dark, cold, and light enough to see the map` pass when the screenshot is under 60% of the noon brightness, is at least 20 on a scale of 255, and has more than 1.5 times as much blue for its red as the noon screenshot has.
- **Proof.** Run `$V run seasons`. The evidence folder holds twelve screenshots and `result.json` with every check, including `no page errors`.

## Gotchas

- The run takes about 9 minutes, because the first winter midnight is 9 days and 16 hours after the 08:00 start. There is no way to jump ahead, and none should be added for the harness.
- Keep `swarm=off`. The checks read the colors of the land. Villager yellow counts as an autumn leaf and monster red over snow counts as blossom, so units that walk into view would move the shares. [Daylight](./daylight.md) and [Swarm](./swarm.md) show the units in the light.
- Stop inside a season, not on its last afternoon. The look turns to the next season from 12:00 on days 3, 6, 9, and 12.
- The colors are those of `src/render/palette.ts` under the noon light. Update `SEASON_MARKS` and `SEASON_LOOKS` in `verify.mjs` when the palette changes on purpose, and say so in the pull request.
- Snow at night is nearly as bright on screen as grass by day. Compare a night with the noon of its own season, never with another season.
- An autumn midnight has more red than blue, because orange leaves reflect little of the blue moonlight. The cold of the night is therefore measured as a shift toward blue from the noon of the same season, not as more blue than red.
- The pines stay green through autumn and the water stays blue all year, so no season is one color.
- The scenario records no clip, so it does not capture the turn from one season to the next. The unit tests in `src/render/seasonal.test.ts` cover that turn.
