# Births

A household with a house, food, and warmth has a child at a dawn. It qualifies when it has a house in which fewer than 5 people live, both of its couple are alive, its woman is 16 or older and younger than 40, none of its members has a missed meal or a cold night after the dawn's meals, and it has seen more than 6 dawns since it formed and since its last birth. It then has a child with a chance of 1 in 4, drawn from the seed, the household, and the dawn. The child is a new villager with a sex, a name no living member of its household bears, and both parents. It stands at its house's door at its birth, plays within 3 tiles of a door by day, goes inside with its household at dusk, eats a meal from the household's store there, does no work, and is drawn smaller than an adult. The news says who was born and to whom. A child's panel is titled with its name and its parents, as `Wend, son of Merek and Elsi`, and reads `Child, works at 10` in its `Job` row and `Boy, 0` in `Sex and age`. A household reads as its couple and its other members and its dead by count, as `Merek and Elsi, 1 child`, in the settler's panel and the house's panel alike. The Stockpiles panel counts the children in a `Children` row, apart from the settlers with a job and without one.

## Sub-features

- `births-birth` gives a child to a household at the dawn its draw falls under the chance, with the news line, the child at its house, and one more child in the top-left count.
- `births-child` reads a child's panel: its parents in its title, `Child, works at 10`, its sex and age, its household, and `Playing by the house`, and `At home` with no missed meal once it went in at dusk.
- `births-household` reads a household as its couple and its other members by count, in the settler's panel and the house's panel.
- `births-none` gives no child to a household at the camp, in a house of 5, with a woman of 40, or hungry, each at a dawn its draw falls under the chance.
- `births-setting` starts a verification page with the children and the dawns the `settlers` setting states, and a player's page ignores it.
- `births-layout` keeps a child's panel clear of every other panel at 960 by 540, 960 by 600, and 1280 by 720.

## How to get to it (user POV)

- Build a house in the first spring. Its household has its first child at the dawn of day 8 at the soonest, a little over 4 minutes into a game at 8×, and at each dawn after that with a chance of 1 in 4.
- Click the child by the house's door, and read its panel. Click the house, and read its household.
- Let the household go hungry, and no second child comes while a member has a missed meal at the dawn.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run births`, which runs doctor itself.
- `bun .claude/skills/verify-survive-n-conquest/scripts/births.ts '<settlers>' <food> <dawns>` plays the scenario's commands in `src/sim` and prints, for each dawn, every household's house, living members, wanting members, woman's age, and whether its draw falls under the chance, and the children born. The scenario checks that the rules give it its cases, then checks the page against them.
- Every page opens on seed 7 at 960 by 540 with the `settlers` setting `m30,w28@6;m32,w30,w8,m6,w3@6;m33,w39@6;m29,w27@6`: four households that have seen 6 dawns, the second with three children, the third's woman 40 from 17:36 on day 3. Every page but the player's takes `HIDES_YEAR_VIEW` and gives `FIREWOOD_YEAR_START`, the orders of `firewood-year`, at 08:00 on day 1. The player's page opens with the same settings and `?food=200`, without `clock=paused`, and gives no orders. The four houses go to the households in the order they stand: house slot 6 to Merek and Elsi, 3 to Ulvar and Ysa, 5 to Jorrin and Fenna, and 4 to Dorran and Nella.

- **A player's page.** It opens with `clock: 'player'` and the setting, and pauses. `a player's page ... ignores the settlers setting` needs `Children` at 0 and 8 settlers with a job or without one.
- **The fed page.** It records video with `?food=200`, so every household is fed. At 09:00 on day 6 it selects the house of Merek and Elsi again and takes `births-house-panel.png`.
  - `the settlers setting opens the map with its 8 settlers and the 3 children` reads the Stockpiles panel at 08:00.
  - It steps the paused clock a minute at a time across the dawn of day 4, reading the news. `the news says "Day 4, 03:36. Wend was born to Merek and Elsi."` needs the line at 03:37, and `no line names a birth to Dorran and Nella` holds although their draw falls under the chance at the camp. The top-left panel then counts 4 children. The page wheels in over the house of Merek and Elsi at 03:27 and cuts `births-dawn.gif` from there to 04:07, cropped to the house, its doors, and the news log. It wheels back out after 22:00, before it clicks the houses.
  - At 09:00 on day 4 it clicks the tunics nearest the house of Merek and Elsi until the child's panel opens, checks its rows, takes `births-child-panel.png`, and checks the panel's layout at the three sizes.
  - At 22:00 the same panel reads `At home` and `Missed meals: None`, and the house reads `Merek and Elsi, 1 child`.
  - At the dawn of day 5 no line says a child was born, the house of 5 reads `Ulvar and Ysa, 3 children`, and the house of the woman of 40 reads `Jorrin and Fenna`.
  - At the dawn of day 6 Dorran and Nella, fed in their own house since day 5, have a child, and their house reads `Dorran and Nella, 1 child`.
- **The hungry page.** It has the same setting and orders with the camp's own 24 food. Dorran and Nella move into an empty house on day 5 and go hungry at its dusk. At the dawn of day 6 they have no child, and their house reads `Dorran and Nella`.

## Gotchas

- A stop at a minute stands on that minute's first tick. The dawn of day 4 is at 03:36, so the line shows at the stop of 03:37, and the news dates it 03:36.
- The draws come from the seed, the household's number, and the dawn's count, so a change to the orders that finishes a house at another dawn moves every case. Run `births.ts` first: its check fails before the page opens when the rules no longer give the cases.
- `@6` says a household has seen 6 dawns before the map's first tick, so it draws at its first dawn with a house. Without it a household first draws at the dawn of day 8.
- A child stands a little more than half as tall as an adult, and `tunics` finds its yellow as it finds an adult's.
