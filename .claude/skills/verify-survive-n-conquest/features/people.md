# People

The camp's panel reads the settlement's people as a whole, below its `Settlers here`, `Food`, and `Firewood` rows. `Children` counts the living children and `Workers` the living who work, each as a number, as the Stockpiles panel counts its `Children`. A child is a settler who does no work, and a worker any other living settler. `50 or older` counts the living whose age, the one their panels show, is 50 or more in whole years. `This year` counts the births and the deaths of every cause since the first tick of the calendar year, as `1 born, 1 died`. Both start again from 0 at that tick, and a settlement that died out keeps them. The panel holds no button but its close button.

## Sub-features

- `people-setting` reads a verification page's `settlers` setting: its children, its workers, and its settlers of 50 or older, with no birth or death.
- `people-death` counts a death of old age at the first dawn, with one settler of 50 or older fewer.
- `people-birth` counts a birth at the dawn it comes, one child more and one birth more at the stop of the news line, and nothing else changed.
- `people-layout` keeps the panel clear of every other panel at 960 by 540, 960 by 600, and 1280 by 720, and fits it at every row's longest reading.

## How to get to it (user POV)

- Click the camp with no tool active, and read the last three rows of its panel. Play five years at 8×, which takes 38 minutes, and read how they changed.
- On a verification page the `settlers` setting states the children, the workers, and the old a map starts with, and a span such as `m60:60` that ends at the first dawn.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run people`, which runs doctor itself.
- `bun .claude/skills/verify-survive-n-conquest/scripts/births.ts '<settlers>' 200 3` plays the page's commands in `src/sim` and prints, after each dawn, the living children, workers, and settlers of 50 or older, and the births and deaths since the start. The scenario checks that the rules give it its case, then checks the page against those counts.
- The page opens on seed 7 at 960 by 540 with `?food=200&settlers=m30,w28@6;m32,w30,w8,m6,w3@6;m33,w39@6;m29,w27@6;m60:60,w55`: the `births` page with a fifth household at the camp, a man of 60 whose span ends at 60 and a woman of 55. It takes `HIDES_YEAR_VIEW` and gives `FIREWOOD_YEAR_START` at 08:00 on day 1.

- **The setting.** At 08:00 it clicks the camp's tents until the panel titled `Camp` opens, which then reads `3` children, `10` workers, `2` of 50 or older, and `0 born, 0 died`, and holds only the `Close selection` button.
- **The first dawn.** At the stop of 04:49 on day 2 the man of 60 has died of old age, and the panel reads `3` children, `9` workers, `1` of 50 or older, and `0 born, 1 died`.
- **The birth.** It runs to 03:32 on day 4 and steps the paused clock a minute at a time to 03:40. The panel reads `0 born, 1 died` until the stop of 03:37, and `4` children and `1 born, 1 died` from there, the stop at which the news says `Day 4, 03:36. Brina was born to Merek and Elsi.` It takes `people-dawn.png`. The clip `people-dawn.gif` runs from 03:32 to 03:40, cropped to the panel and the news log.
- **The sizes.** At 960 by 540, 960 by 600, and 1280 by 720 it checks that every reading is above 0 and as `births.ts` gives it, that the panel covers no other panel, and takes `people-camp-panel-<size>.png`. It fills a copy of the panel with every row's longest reading from `panelReadings` and checks that the copy stays clear of the Stockpiles panel, shows every row, reads each row on one line, and is no taller than the settler's panel at its own longest readings. It takes `people-camp-longest-<size>.png` of that copy.

## Gotchas

- A stop at a minute stands on that minute's first tick. The dawn of day 4 is at 03:36, so the counts change at the stop of 03:37.
- The fifth household works on day 1, so the houses stand on other days than on the `births` page, and the child born at the dawn of day 4 takes another id and so another name. Run `births.ts` first.
- Over the camp a click must land almost on a settler's body to take it, so a click on a tent selects the camp. Near the camp a click can take a house or the lodge instead, and the scenario tries the next tent.
- The year's counts in the first year equal the tallies since the start, which is what `births.ts` prints. A page that crosses into year 2 needs its own count.
