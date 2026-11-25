# Empty house

A house whose household has died out keeps the food and the firewood that were in it, and its panel reads `Household` `Nobody` with what it holds. Such a house is a source, like a barn: a household that stocks its home, and the settlers without a job who stock the camp and the homes in which nobody can carry, take a unit from it when it is nearer than every other store that has one. Nothing is carried into it, and nobody eats in it. Its panel's `Food` and `Firewood` rows count down as the units leave. When a household takes the house, what is left in it is that household's.

## Sub-features

- `empty-house-source` makes an empty house that holds food the source of a neighbor's home when it is the nearest store that has food.
- `empty-house-panel` reads `Nobody` on the empty house's panel and counts its food down one unit at a time as the units leave.
- `empty-house-nothing-in` carries nothing into an empty house: its food never rises while nobody lives in it.

## How to get to it (user POV)

- Build houses for every household, so no household lives at the camp, and wait until the last member of a household dies. Click its house: its panel reads `Nobody` and what it holds.
- Click it again on the next days: a neighbor's household carries the food out to its own house when the empty house is the nearest store that has some.
- A verification page shows it sooner with the `settlers` setting: `?seed=7&clock=paused&settlers=m30,w28;m32,w30;m70:72,w70:72;m29,w27`, with the orders of `FIREWOOD_YEAR_START`. Household 3 is a couple of 70 whose span is 72.

## Driving it with verify.mjs

Preconditions: `doctor` passes, and the build serves the models.

- **The case in src/sim.** `bun .claude/skills/verify-survive-n-conquest/scripts/pairing.ts 'm30,w28;m32,w30;m70:72,w70:72;m29,w27' - 5` plays the setting and the orders in `src/sim`. `in src/sim the setting gives the case ...` needs household 3 in slot 3 on the night of day 5, living 0 at the dawn of `Day 6, 03:36`, and household 1 in slot 6.
- **The page.** It opens on seed 7 at 960 by 540 with the setting and the camp's own food, takes `HIDES_YEAR_VIEW`, and gives `FIREWOOD_YEAR_START` at 08:00 on day 1.
- **The night before.** At 22:00 on day 5 the house in slot 3 reads household 3's couple and some food.
- **The dawn of day 6.** It selects the house in slot 3 at 03:30, wheels in over it by `BIRTHS_CLOSER`, and steps the paused clock a minute at a time to 04:10, reading the panel at each stop. It takes `empty-house-day6-0410.png` and checks that the news names the deaths of old age at `Day 6, 03:36`.
- **The dawn of day 7.** It steps the clock a minute at a time from 05:00 to 05:20 on day 7 with the panel open and takes `empty-house-day7-0520.png`.
- **The checks.** From the stop after the deaths the panel reads `Nobody`. Its food never rises and falls by at most one unit a stop. It holds less at 04:10 on day 6 than at the deaths, and 0 at 05:20 on day 7. The house in slot 6 reads household 1's couple.
- **The clip.** `empty-house-dawns.gif` joins the two dawns, with every repeated frame dropped, cropped to the clock panel, the two houses, the selection panel, and the news log.
- **Before the rule.** The same scenario on a build without the rule fails the last two checks: the panel reads the same food at every stop.

## Gotchas

- An empty house stands only while every household with a living member has a house. A household at the camp takes a freed house at once, so a setting with more households than houses never shows one.
- A store as near as an empty house comes first: with the old couple as household 1, in slot 6, household 3's house in slot 3 is as near the camp as the empty house, and the camp wins.
- The food in the empty house is what its household kept for 3 days, less the meals of the night before, so it holds 4 at the deaths on seed 7.
