# Clothing reason

While hides lie where the deer fell and no settler has carried them to a stockpile yet, a tailor's hut has no hide in reach, because its tailor never takes a hide off a stockpile. The tailor's hut's panel and its tailor's panel say so in their `Doing` row, `Idle, no hide carried to a stockpile yet`, and at dusk the news says that the tailor made no clothing that day and why. The reason holds while the open hide nearest the hut's middle lies off every stockpile and the stockpile place with room nearest that hide lies within the hut's 30 tiles. A hide that a carrier already walks for does not count. With no such hide the panel reads `Idle, no hide in a stockpile within 30 tiles of the tailor's hut` as before. A woodshed reads `Idle, no log carried to a stockpile yet` in the same case for logs, after `Idle, the building sites need the logs`. The scenario gives #40's year "wood and hides" of `bun scripts/winter-year.ts hides` through the toolbar, as the readiness scenario gives it, and reads the tailor's hut's panel at noon on day 9 and the news at the dusk of day 9.

## Sub-features

- `clothing-reason-hut-panel` reads the tailor's hut's panel at 12:00 on day 9: `Doing Idle, no hide carried to a stockpile yet`. The check reads the title and the `Doing` row, and the news check reads the tailor's name.
- `clothing-reason-news` reads the line `Day 9, 19:11. Jorrin made no clothing: no hide carried yet.` in the news at the dusk of day 9, the first day the reason shows, naming the tailor the panel named.

## How to get to it (user POV)

- Open the game at `?seed=7`. With the clock paused at 08:00, give the orders of the year "wood and hides": #30's hut, barn, and lodge, two houses, the stockpile and the woodshed west of the camp, and their trees and rocks.
- Run the clock to 08:30 on day 4 and place the tailor's hut north west of the camp.
- Run on to day 9. Select the tailor's hut at noon, and watch the news at dusk.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run clothing-reason`, which runs doctor itself.
- The page opens at 960 by 540 on `?seed=7`, not recorded, with `clock: 'paused'`.

- **Give the orders.** `takeForageView` takes `HIDES_YEAR_VIEW`. The scenario gives `HIDES_YEAR_ORDERS` one by one and reads each status line against `HIDES_YEAR_SAID`, then gives `HIDES_YEAR_TAILOR` at `READY_STOPS.tailor`.
- **The panel.** At 12:00 on day 9 it clicks the hut at the points of `HIDES_REASON_HUT` until the panel reads `Tailor's hut`, and takes `clothing-reason-hut-panel.png`.
- **The news at dusk.** `reach` stops at 19:00 on day 9, and `runUntil` steps a minute at a time to 20:00, reading the news for the tailor's line. It takes `clothing-reason-news.png` at the stop that shows it.
- **Proof.** Run `$V run clothing-reason`. Run it from a checkout of the build before a change to the reason, with this scenario copied in, for the before picture from the same scene, seed, camera, and minute.

## Gotchas

- `bun scripts/workshop-reasons.ts hides-page --first` plays the page's year in `src/sim` and prints the first minute of each day on which the tailor reads the reason: 07:09 on day 9 and 06:36 on day 10. A change to the year moves the stops.
- The script's own year places the tailor's hut on the tick the lodge is finished. The page places it at 08:30 on day 4, so the two years differ after that.
- On a build before the change the panel reads `Idle, no hide in a stockpile within 30 tiles of the tailor's hut` and the news line ends `no hide in reach.`, so both checks fail there. That is the before picture.
