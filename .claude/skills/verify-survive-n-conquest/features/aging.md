# Aging

Every settler has an age that rises with the clock, 5 years of age in a game year, so a year of age is 2.4 days or 7,200 ticks. A starting settler is 18 to 30 years old on day 1, as the seed draws it, and has a life span of 60 to 80 years, also drawn by the seed. A settler dies of old age at the first dawn at which it has reached its span, where it slept. Its panel's `Sex and age` row reads its sex and its age in whole years, such as `Woman, 24`. A dead settler's panel reads what it died of and at what age in its `Doing` row, such as `Died of old age at 70`, and its age at death in `Sex and age`. The news names who died of old age at the dawn it happens. The `settlers` URL setting, which only a verification page takes, starts the map with settlers of stated ages and spans.

## Sub-features

- `aging-seed` gives every starting settler the age the seed draws, the same on a verification page and on a player's page.
- `aging-turn` turns every starting settler a year older at tick 7,200, 17:36 on day 3, because a settler of age `a` is born at tick `-a * 7200`.
- `aging-death` kills a settler of old age at the first dawn at which it has reached its span, and its panel and the news say so.
- `aging-setting` starts a verification page with the settlers of the `settlers` setting, and a player's page ignores it.
- `aging-layout` keeps the panel of a settler who died of old age clear of every other panel at 960 by 540, 960 by 600, and 1280 by 720.

## How to get to it (user POV)

- Open the game, click a settler, and read `Sex and age`.
- Run a year at 8×, which takes 7.5 minutes, and read it again: it reads 5 years more. Every starting settler turns a year older at 17:36 on day 3, and every 2.4 days after that.
- A starting settler first dies of old age 6 game years after the map starts at the soonest, 45 minutes at 8×. A verification page shows it sooner with the `settlers` setting.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run aging`, which runs doctor itself.
- `bun scripts/ages.ts --seed 7 --json` prints the 8 starting settlers of seed 7 with their age on day 1, their span, and the dawn the span gives, from the game's own modules. The scenario compares the panels with it.
- Every page opens on seed 7 at 960 by 540 with the settlers and stops at 12:00 on day 1, when they have wandered apart from the camp. The scenario zooms in by `AGING_WHEEL` and clicks every tunic of that paused frame, keeping each settler's panel once, as `settlerPanel` reads it.

- **The seed's ages, and the turn of a year.** The first page records video and has no `settlers` setting.
  - `on a verification page without the settlers setting, every settler clicked ... reads the age seed 7 gives it, from 18 to 30` needs at least 6 of the 8 settlers.
  - It selects one settler, reaches 17:30 on day 3, and steps the paused clock a minute at a time. `the selected settler's age turns a year older at day 3 17:36, tick 7,200 ...` needs the age of day 1 up to 17:35 and one more at 17:36. The page cuts `aging-age-turns.gif` from 17:30 to 17:40.
- **A player's page.** The second page opens as a player opens it, with `clock: 'player'` and the `settlers` setting of the third page, pauses at once, and runs to 12:00.
  - `a player's page, without clock=paused, ignores the settlers setting ...` needs every settler read to have the seed's age.
- **A death of old age.** The third page records video with `settlers=` `OLD_SETTLERS`: four households of 61 to 72 years, and Household 1's man is 70 with a span of 70, so he has reached it at the first tick.
  - `the settlers setting starts the map with the stated ages` reads at least 6 settlers.
  - It selects the man of 70 at noon, reaches 04:40 on day 2, and steps a minute at a time, reading the news at each stop. `... dies of old age at the first dawn, 04:48 on day 2, and the first stop after it shows it` needs `Died of old age at 70` and `Man, 70` at 04:49. The dawn tick is 2,600, and a stop at 04:48 stands before it.
  - `the news says "Day 2, 04:48. <name> died of old age." at the dawn it happens`.
  - At 04:52 it takes `aging-died-of-old-age.png`, and at each of the three window sizes `aging-dead-panel-<size>.png` with `the panel of the settler who died of old age covers no other panel`. The page cuts `aging-dies-of-old-age.gif` from 04:40 to 04:52.
- `readiness` and `selecting` measure every panel with the longest readings of `panelReadings`, which hold `Woman, 80`, `Man, 80`, and `Died of old age at 80`.

## Gotchas

- A stop at a minute stands on that minute's first tick, before the step that runs it. A dawn at 04:48 shows at the stop of 04:49, and the news dates it 04:48.
- The setting works only with `clock=paused`, which `open` adds to every page except `clock: 'player'`.
- In 5.1 each household of the setting is a man and then a woman, as the starting households are: `m70:70,w66` is Household 1 with a man of 70 whose span is 70 and a woman of 66 whose span the seed draws. Households are separated by `;`.
- At 08:00 the 8 settlers stand bunched at the camp, and clicks find only one or two of them.
