# Growing up

At the first dawn at which a child is 10 it starts to work, and from then on it is a settler like any other: it takes orders to the land, fills an open place at a workplace when it is the nearest without a job, stocks its home, and fetches and wears clothing. It still lives with its household. A child that turns 10 by day plays until the next dawn. The news names the children who started to work at a dawn, as `Day 4, 03:36. Sten, Tilde, Tobin and Penna started to work.` The Stockpiles panel counts one child fewer and one settler more. The settler's panel keeps its parents in its title, reads its job in `Job` and what it does in `Doing`, and reads `Boy, 10` in `Sex and age`: a girl or a boy until 16, a woman or a man from then. It is drawn at an adult's size. The readiness panel counts it among the settlers who can wear clothing.

## Sub-features

- `growing-up-door` reads a child of 9 playing by its house's door on the day before it starts to work.
- `growing-up-dawn` gives the news line at the dawn the children start to work, and the top-left counts after it.
- `growing-up-panel` reads the same settler after the dawn: its parents in its title, `Job: None`, `Boy, 10`, and at its first tree `Chopping a tree`.
- `growing-up-readiness` counts the new settlers among `Settlers in clothing` in the first autumn.
- `growing-up-layout` keeps the settler's panel clear of every other panel at 960 by 540, 960 by 600, and 1280 by 720.

## How to get to it (user POV)

- A child born in a played game starts to work 24 days after its birth, 15 minutes at 8×. Select it the evening before and watch it leave the house's door for the work at dawn.
- On a verification page the `settlers` setting starts the map with children of 9, who start to work at the dawn of day 4.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run growing-up`, which runs doctor itself.
- `bun .claude/skills/verify-survive-n-conquest/scripts/births.ts '<settlers>' <food> <dawns>` prints, for each dawn, the children who started to work there with their households. The scenario checks that the rules give it its case before the page opens.
- The page opens on seed 7 at 960 by 540 with `?food=200&settlers=m30,w28,m9;m32,w30,w9;m33,w31,m9;m29,w27,w9`: four households, each a couple and a child of 9, none of which has seen a dawn, so no child is born before the dawn of day 8. It takes `HIDES_YEAR_VIEW` and gives `FIREWOOD_YEAR_START` at 08:00 on day 1. House slot 6, which goes to Merek and Elsi, stands on day 3, and the others on day 4.

- `the settlers setting opens the map with 8 settlers and 4 children of 9` reads the Stockpiles panel at 08:00.
- At 15:00 on day 3 the page wheels in over the house of Merek and Elsi, clicks the tunics nearest it until the panel of `Sten, son of Merek and Elsi` opens, checks `Child, works at 10`, `Boy, 9`, and `Playing by the house`, and takes `growing-up-before-panel.png`. It wheels back out, drags the view so the house and the trees east of it share the middle, and wheels in by `GROWING_VIEW`. The clip starts there.
- It runs at 8× to 03:35 on day 4 and steps the paused clock a minute at a time across the dawn. `the news says "Day 4, 03:36. Sten, Tilde, Tobin and Penna started to work."` needs the line at the stop of 03:37. The top-left panel then counts 0 children and 12 settlers, and the panel reads `Job: None` and `Boy, 10`.
- It steps 5 minutes at a time until the panel reads `Chopping a tree`, which it does at 05:13, and takes `growing-up-at-tree.png` and `growing-up-after-panel.png`. The clip `growing-up.gif` ends there. It is the whole page at 640 px, with repeated frames dropped and one of every 6 frames left.
- It checks the panel's layout at the three sizes, then runs to 09:00 on day 7, the first autumn, where the readiness panel reads `0 of 12` settlers in clothing.

## Gotchas

- Every child of a whole age `a` stated on day 1 was born at `-a × 7200` ticks, so a child of 9 turns 10 at 17:36 on day 3 and starts at the dawn of day 4, not on the day it turns 10.
- At 17:00 the warm light keeps `tunics` from finding the settlers' yellow, so the page selects the child at 15:00.
- A click on a tunic beside a site label can select the site. `selectTitled` tries each spot until the panel with the child's title opens.
