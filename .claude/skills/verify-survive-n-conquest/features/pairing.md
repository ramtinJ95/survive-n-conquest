# Pairing

A settler is single when it is 16 or older and has never had a partner. Two single settlers can pair when one is a man and one a woman, neither is the other's parent, and they share no parent. At each dawn, after the deaths of old age and before the births, the single women go from the oldest to the youngest, by the lower id at one age, and each takes the single man she can pair with nearest her in age, the older when two are as near, then the lower id. A woman with no such man stays single that dawn. Ages are the whole years the panel shows. The two leave their parents' households, whose houses count one member fewer, and form a household of which they are the couple, numbered in the order of the dawn's pairings. It takes at once the empty house that was finished first. With none empty, each of the two goes on living where it lived the day before, until a house is finished or freed: one from its parents' house lodges there, sleeps and eats there, and counts among that house's people, and one from the camp stays at the camp. A house is never freed under a settler who lodges in it: when the last of its household dies or leaves, the lodger's household takes it at once, ahead of the order by number. The news says `Day 6, 03:36. Sten and Tilde formed a household.`, and the settler's panel and the house's panel read the new household by its couple. A settler who lodges reads `Home` `Parents' house`, and its parents' house counts it among its children, as `Merek and Elsi, 1 child`. A settler born in the game keeps its parents in its panel's title.

## Sub-features

- `pairing-order` pairs six single settlers of stated ages and parents in the order the rule gives, and leaves single a woman whose only remaining man is her brother.
- `pairing-house` gives a new household the empty house at once, and the parents' houses count one member fewer.
- `pairing-camp` keeps a new household of two from the camp at the camp when no house stands, and moves it into the next house finished.
- `pairing-roof` keeps the two of a new household in their parents' houses when no house stands empty, through the dusk of the pairing's day, and moves them into the next house finished.
- `pairing-dusk` takes the new household into its own house at its first dusk, where it eats.
- `pairing-panels` reads the new household on its settler's panel and its house's panel, and keeps the settler's panel clear of every other panel at 960 by 540, 960 by 600, and 1280 by 720.
- `pairing-setting` starts a verification page with the households the `settlers` setting states, and a player's page ignores it.

## How to get to it (user POV)

- Open `?seed=7&clock=paused&food=200&settlers=m44,w42,m14@6;m45,w43,w14@6`: two households, Merek and Elsi with their son of 14, Ulvar and Ysa with their daughter of 14. Press 8×.
- Mark trees and rock, a stockpile, and three houses near the camp. The first two houses go to the two couples, the third stands empty.
- At the dawn of day 6, a little under 3 minutes in at 8×, the son and the daughter are 16 and pair. The news names them, they take the third house at once, and at dusk they go in to it. Click the parents' houses and the third house to read their households.
- With `m17` and `w16` in place of the 14-year-olds, they pair at the first dawn and live at the camp until the third house is finished.
- With a third couple, `settlers=m44,w42,m14@6;m45,w43,w14@6;m46,w44@6`, and the fourth house ordered only on day 7, the three houses are the three couples' when Sten and Tilde pair at the dawn of day 6. Tilde's panel reads `Home` `Parents' house`, her parents' house reads `Ulvar and Ysa, 1 child`, and at dusk each goes in to its parents' house. They move into the fourth house when it is finished.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run pairing`, which runs doctor itself.
- `bun .claude/skills/verify-survive-n-conquest/scripts/pairing.ts '<settlers>' <food> <dawns> [<day> <hh:mm>]` plays the `settlers` setting and the orders of `bun scripts/firewood-years.ts near-houses-at-minutes` without its woodshed, which are the orders the page gives as `FIREWOOD_YEAR_START`, in `src/sim` and prints, for each dawn, the couples that formed a household with their ages, the households they left, and the house each lives in, the single settlers left, and every household's house, and the minute each house was finished. With a day and a minute it gives the fourth house's order, worked out at 08:00 on day 1 as the page clicks it, only at that minute. The scenario checks that the rules give it its cases, then checks the page against them.

- **The rule in src/sim.** The six single settlers of `m50,w48,w18,m18@6;m51,w49,w18,m19@6;m52,w50,w16,m17@6` pair at the first dawn as `PAIRING_SIX_RULE` works them out by hand, and ids 10 and 11, a sister and brother, stay single. The move page's 14-year-olds pair at the dawn of day 6 and take house slot 5, the third finished. The camp page's children of 17 and 16 pair at the first dawn at the camp and move into the third house when it is finished. The roof page's 14-year-olds pair at the dawn of day 6 with the three houses, slots 3, 5, and 4, their parents' and the third couple's, Sten lives on in slot 3 and Tilde in slot 5, and the fourth house, ordered at 08:00 on day 7, is slot 6 and is finished after that dusk.
- **A player's page.** It opens with `clock: 'player'` and the six's setting, and pauses. `a player's page ... ignores the settlers setting` needs `Children` at 0 and 8 settlers with a job or without one.
- **The six.** A paused page with the six's setting and no orders steps the clock a minute at a time across the dawn of day 2 and needs the one line `Day 2, 04:48. Arvel and Mira formed a household, and so did Davin and Bera.` at the stop of 04:49. It takes `pairing-six-news.png`.
- **The move page.** It records video with `?food=200` and gives `FIREWOOD_YEAR_START` at 08:00 on day 1.
  - At 22:00 on day 5 it clicks the three houses and takes `pairing-<first|second|third>-house-before.png`: `Merek and Elsi, 1 child`, `Ulvar and Ysa, 1 child`, and `Nobody`.
  - At 03:27 on day 6 it selects the third house, whose panel reads `Nobody`, wheels in over it, and steps the clock a minute at a time to 03:40. At 03:57 the open panel reads `Sten and Tilde`. The news line comes at the stop of 03:37. It wheels out at 03:57 and takes the three houses' panels again: `Merek and Elsi`, `Ulvar and Ysa`, and `Sten and Tilde`.
  - At 09:00 it clicks the tunics nearest the third house until Sten's panel opens, titled `Sten, son of Merek and Elsi`, with `Household` `Sten and Tilde`, `Home` `A house`, and `Man, 16`. It takes `pairing-settler-panel.png` and checks the layout at the three sizes.
  - It wheels in over the third house at 20:10 and steps the clock a minute at a time until his panel reads `At home`, with `Missed meals: None`, then on to 21:30 and `pairing-dusk.png`.
  - `pairing-dawn-to-dusk.gif` joins the dawn, from 03:27 to 03:57, and the dusk, from 20:10 to 21:30, with every repeated frame dropped. It is cropped to the houses, the selection panel, and the news log: the house's panel at dawn, Sten's at dusk.
- **The camp page.** It has the camp page's setting, `?food=200`, and the same orders. The news names the pair at the dawn of day 2, and 5 minutes after the third house is finished its panel reads their couple. It takes `pairing-camp-house.png`.

- **The roof page.** It records video with `?food=200&settlers=m44,w42,m14@6;m45,w43,w14@6;m46,w44@6` and gives `FIREWOOD_YEAR_START` without its fourth house at 08:00 on day 1.
  - From 03:26 on day 6 it holds the panel of Ulvar and Ysa's house open and steps the clock a minute at a time to 03:40. The news line comes at the stop of 03:37, and at 03:56 the panel still reads `Ulvar and Ysa, 1 child`.
  - At 09:00 it takes `pairing-roof-house-panel.png` with that panel, then clicks the tunics nearest Merek and Elsi's house until Tilde's panel opens, which reads `Household` `Sten and Tilde` and `Home` `Parents' house`. At 09:00 she stands on the same tile on `main` and at this change, so the page finds her on both. It takes `pairing-roof-settler-panel.png` and checks the layout at the three sizes.
  - With her panel still open, from 20:10 it steps the clock a minute at a time until her panel reads `At home` with `Missed meals: None`, at 20:59, then on to 22:05 and `pairing-roof-dusk.png`. There the camp's panel reads `Settlers here: 0`, in `pairing-roof-camp-night.png`.
  - At 08:00 on day 7 it gives the fourth house and its chop orders. 5 minutes before the house is finished Ulvar and Ysa's house still reads `Ulvar and Ysa, 1 child`, in `pairing-roof-move-before.png`. 5 minutes after, it reads `Ulvar and Ysa`, in `pairing-roof-move-after-parents.png`, and the fourth house reads `Sten and Tilde`, in `pairing-roof-move-after.png`.
  - `pairing-roof-dawn-to-dusk.gif` joins the dawn, from 03:26 to 03:56, and the dusk, from 20:10 to 22:05, with every repeated frame dropped. It shows the whole page with the clock and the news log.
  - A second roof page, not recorded, with the same setting and orders, selects Sten at 09:00 on day 6, whose panel reads `Household` `Sten and Tilde` and `Home` `Parents' house`, and keeps his panel open from 20:10 until it reads `At home` with `Missed meals: None`, at 21:59, because he hunts far out, in `pairing-roof-his-dusk.png`. The camp's `Settlers here: 0` alone would pass with one of the two stranded outside every house.

## Gotchas

- A stated member's age is whole years on day 1, and a year of age is 2.4 days, so a 14-year-old is 16 from 03:12 on day 6 and a 15-year-old from 17:36 on day 3. The pair forms at the first dawn after both are 16.
- Every woman of the move and camp pages is 40 or older, so no birth joins a household and moves a house's count.
- The houses stand in the order the orders finish them, on seed 7 slots 3, 6, 5, and then 4. A change to the orders moves which slot is the third; run `pairing.ts` first.
- The news names the couples of one line in the order of their women's ids, and the six's two pairings come in that order too.
- Names are unique only within a household. On the six's page the woman left single is a Mira, as the first bride is, so a check cannot tell the single settlers by name in the line.
- At 09:00 on day 6 Sten works near the third house and Tilde does not, so the scenario selects Sten.
