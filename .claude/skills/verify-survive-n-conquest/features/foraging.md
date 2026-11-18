# Foraging

The forager's hut is the first workplace and the first source of food. The player places it with the `Forager's hut` tool, `G`, whose button reads Hut, on 2 by 2 tiles of open, level ground, and the settlers build it from 8 logs in 30 seconds of work at 1×. It stands as a low square of log walls under a steep roof of eight sides, smaller than a house. When it is finished, the two settlers without a job nearest it take its places and become foragers, and the `Settlement news` log names them. A forager walks to the tree nearest it within 20 tiles of the hut that bears forage, picks 1 food in 30 seconds of work, and carries it to the nearest store with room, which is the camp until a barn stands nearer, and the food in barns and at the camp in the Stockpiles panel rises. `features/storing.md` covers the barn. A picked tree bears again after 2 days, and nothing bears in winter. The hut's panel says what it does, names its foragers in the order they came, and sets how many of its 2 places are filled with `Fewer places` and `More places`. Lowering the places frees the forager that came last, and raising them fills the place with the nearest settler without a job. A settler's panel reads its job and what a forager does, and the Stockpiles panel counts the living settlers with a job and with none. This scenario plays the hut of the first year on seed 7, from the orders to the food it brings in on day 2. `src/sim/foraging.test.ts`, `src/sim/jobs.test.ts`, and `src/sim/firstYear.test.ts` prove the rules, the winter, and the year, and `src/ui/selection.test.ts` proves what a forager's panel says in winter and with the camp full.

## Sub-features

- `foraging-tool` picks the hut tool with G, previews the 2 by 2 tiles right of and below the pointer, and places a hut site with a click.
- `foraging-site` labels the site `Forager's hut site`, with `Logs n/8`, no stone, and its work.
- `foraging-hut` builds the hut and fills its two places with the nearest settlers without a job.
- `foraging-panel` reads the hut's note, its foragers by name in the order they came, and `Places 2 of 2`.
- `foraging-places` frees the forager that came last with `Fewer places` and fills the place again with `More places`.
- `foraging-jobs` reads `Job Forager` and what the forager does in its panel, and counts the settlers with a job and with none in the Stockpiles panel.
- `foraging-news` names the settlers who became foragers and the one who left the hut.
- `foraging-food` raises the food at the camp from the dawn of day 2 to its dusk.

## How to get to it (user POV)

- Open the game at `?seed=7`. The forest's edge lies a few tiles east of the camp.
- The camp has no logs. Press C and click the four trees nearest the camp on the forest's edge, so the settlers fell them for the hut's 8 logs.
- Press G and click open ground at the forest's edge east of the camp. Press Escape.
- Run at 8×. The label over the site goes at about 12:15, and the news names the two new foragers.
- Click the hut to read its panel and set its places. Click a forager to read what it does.
- Watch day 2 at 8×. The food at the camp rises as the foragers carry it in, and falls by 8 at dusk, when the settlers eat.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run foraging`, which runs doctor itself.
- One page opens at 960 by 540 on `?seed=7` with the settlers, no `food` setting, recorded, and `clock: 'paused'`, a few game minutes after 08:00.

- **Take the view.** `takeForageView` zooms with a wheel of `FORAGE_VIEW.wheel` pixels to about 23 m, turns and tilts with a right drag of `FORAGE_VIEW.turn` to look east from the camp over the hut to the forest, and pans with a drag of `FORAGE_VIEW.pan`. `a new game opens with 24 food at the camp and all 8 settlers without a job` reads the Stockpiles panel.
- **Give the orders.** It presses C and clicks each of `FORAGE_SPOTS.trees`, the tiles (137, 129), (138, 130), (134, 131), and (135, 134). `a Chop click on each of the four trees marks one tree` reads the status line after each. It moves the pointer onto the toolbar, presses G, moves to `FORAGE_SPOTS.hut`, the tile (136, 127), and clicks. `G picks the Forager's hut tool, which previews and places a hut site with a click` reads the pressed button, the hint, the preview line, and `Forager's hut site placed.` It takes `foraging-hut-preview.png` with the ghost over the 2 by 2 tiles, where `a hut that fits previews green over its tiles` counts `FORAGE_PREVIEW_FITS` pixels of the fits color, presses Escape, and takes `foraging-site.png`. `the hut site's label reads 0 of 8 logs, no stone, and waits for materials` reads the label by its role and name.
- **Watch it built.** It runs at 8× until the label is gone and pauses. `the hut is finished on day 1 between 11:30 and 13:30` reads the clock when the label went.
- **Read the hut.** It clicks `FORAGE_SPOTS.roof`, and the hut's middle when a settler took the click. `at ... the hut's panel says what it does and names its two foragers, with both places filled` reads the title, the note, two names in `Foragers`, and `Places 2 of 2`. It takes `foraging-hut-panel.png`. `the Stockpiles panel counts 2 settlers with a job and 6 with none` and `the news names the two settlers who became foragers` read the top left and the news log.
- **Set the places.** It presses `Fewer places`. `Fewer places frees the forager that came last and leaves one place filled` reads the first forager alone, `Places 1 of 2`, and 1 and 7 in the Stockpiles panel. `the news says the freed forager left the hut` reads `<name> left the forager's hut.` It presses `More places`. `More places fills the place again by the nearest settler without a job` reads two foragers, `Places 2 of 2`, and 2 and 6.
- **Read a forager.** It presses Escape and reaches 05:00 on day 2, after the dawn at 04:48, when every settler steps out of the camp. It clicks the fullest cells of tunic pixels until a panel reads `Job Forager`. `at ... a forager's panel reads its job and what it does` needs one of the hut's foragers and a `Doing` of a forager, and `at 960x540 the forager's panel shows every one of its rows` needs the panel to hold all its rows. It takes `foraging-forager-panel.png`.
- **Watch a day of foraging.** It reads the camp's food at 05:00 with the forager still selected, reaches 19:00, before the dusk at 19:12, and reads it again. `the food at the camp rises by at least 4 from day 2 05:00 to day 2 19:00` compares the two readings, and `the two foragers keep their places through the day` reads the Stockpiles panel and the followed forager's panel. `foraging-day.gif` runs from the 05:00 stop to the 19:00 stop, cropped by `FORAGE_CLIP` to the clock, the Stockpiles panel, the followed forager's panel, the camp, the hut, and the forest's edge, with 32 colors, and played at twice the speed it was recorded at, so the day takes about 15 s. It takes `foraging-dusk.png`.
- **Proof.** Run `$V run foraging`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- `FORAGE_SPOTS` are where the camera rig and the picker of `src/render` put each tile's center at `FORAGE_VIEW` on a 960 by 540 page, and the picker takes each one's tile there. `scripts/aim.ts` prints them, with the command in the comment above `FORAGE_VIEW`. A click aims at the ground under the trees, because the picker marches over the height field and not the trees. A change to the camera's opening view, its input rates, or the map of seed 7 moves them, so run `aim.ts` again.
- A view from the south, the opening view's side, put a tree in front of the hut. The view from the west shows the camp, the open ground, and the hut in front of the forest.
- The page gives its orders a few game minutes after 08:00, not at the first tick as `scripts/first-year.ts` does, so the settlers stand elsewhere when the hut is finished. On this page Elsi and Ulvar take its places and the hut stands at about 12:15, where the script names Ysa and Jorrin at 12:18. The scenario reads the names from the panel and checks the order, not the names.
- `More places` fills the place with the settler without a job nearest the hut's middle when it is pressed, which need not be the forager just freed. On rj-firebat it was Merek or Fenna.
- At the hut's finish its builders stand at its corners. From this view the pick box of the hut hides those behind it, so a click on them selects the hut. The scenario reads a forager's panel after dawn on day 2, when all 8 settlers step out of the camp onto open ground.
- A forager at work stands on its tree's tile under the crown, so the trees hide it while it forages. The clip follows a selected forager, so its panel and its ring say where it is. The trees it works on day 2 lie up to 9 tiles north and south of the hut.
- On rj-firebat the camp read 20 food at 05:00 on day 2 and 28 at 19:00, 8 units in, as `scripts/first-year.ts` counts for day 2. The check needs 4, half of that, because a unit in a forager's hands at either stop is not counted.
- The page never reaches winter. `src/ui/selection.test.ts` runs a hut to winter noon and reads `Idle, nothing grows until spring` in a forager's panel, and `src/sim/foraging.test.ts` proves that nothing bears then.
- A `Selection` row reads only the value before a control's buttons, so `Places` reads `2 of 2` and not the button faces beside it.
