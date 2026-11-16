# Households

The 8 settlers of a new game are 4 households, each one man and one woman, with names the seed chooses. A finished house becomes the home of the household with the lowest number that has none. At dusk the members of a household with a home put down what they carry, walk to the walkable tile beside their house nearest them, and go inside, where they are not drawn. The households without a house walk to their spots in the ring at the camp, as before. At dawn every settler comes out where it was: those inside on the tile beside the house where they went in. A household whose house is finished during a night goes home at the next dusk. The names and the households show in no panel yet, so this scenario proves the homes, and `src/sim/households.test.ts` proves the names and the pairing.

## Sub-features

- `households-homes` makes the first two finished houses the homes of households 0 and 1.
- `households-dusk` walks the members of a household with a home to their house at dusk and the others to the camp.
- `households-inside` keeps the members inside their house, not drawn, until dawn. The scenario proves only that they are not at the camp. That they are not drawn beside the house is in `households-midnight.png` and in the unit test of `src/render/swarm.ts`.
- `households-dawn` brings them out beside their house at dawn.

## How to get to it (user POV)

- Open the game without a `swarm` parameter. The first view looks at the camp.
- Mark trees and rock with Chop and Quarry, a stockpile, and two houses near the camp with House. Run at 8× until the site labels are gone.
- Zoom in on the houses and the camp, run to dusk, and watch at 1×.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run households`, which runs doctor itself.

- **Build two houses.** The first page opens at 960 by 540 with `clock: 'paused'`, takes the building view, and at 08:15 drags Chop over 26 trees, Quarry over 136 rock tiles, and Stockpile over 4 tiles, then clicks House above the camp and left of it. The checks `the C order is given`, `the M order is given`, `the P order is given`, `house site 1 is placed`, and `house site 2 is placed` read the status line. It runs at 8× until no `House site` label is left. The check `both houses are finished before the dusk of day 2` reads the clock.
- **Watch a dusk and a dawn.** It zooms in toward the point between the houses and the camp and takes `households-homes.png`. It runs `reach` to 19:00 on day 2, at 1× to 19:50, at 8× to 04:35 on day 3, and at 1× to 05:05. `households-dusk-and-dawn.gif` is cropped to the clock, the quarry, the houses, and the camp, and shows households 0 and 1 walk from the quarry into their houses, households 2 and 3 walk to the camp, the camp's ring of four through the night, and the settlers stepping out beside the houses after dawn at 04:48.
- **Stop on the next night.** The same page runs `reach` to 00:00, 03:30, and 03:40 on day 4, the first day of summer, whose dawn is at 03:36, and takes `households-<stop>.png`. A page with the settlers and no orders takes `plain-<stop>.png`, and a page with `?swarm=off` takes `bare-<stop>.png`, from the same view at the same stops.
- **See half the settlers at the camp.** The check `at midnight the two households without a home stand at the camp, and the two with one do not` counts the pixels of the camp box that differ from the bare map by more than 25 in a channel, on the page with homes and on the plain page, and needs the first to be 0.3 to 0.75 of the second.
- **See them come out at dawn.** The checks `at dawn the household of the upper house comes out beside it` and `... of the left house ...` count `TUNIC_IN_SHADE` pixels in the land beside each house. They need at most 5 at 03:30, at least 40 at 03:40, and at most 30 in the same box of the plain page at 03:40.
- **Proof.** Run `$V run households`. The evidence folder holds the clip, ten screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- In the pylon the camp box read 882 pixels with homes and 1632 without, a share of 0.54. The land beside the houses read 0 and 0 tunic pixels at 03:30, 97 and 102 to 104 at 03:40, and 0 and 15 to 17 on the plain page.
- At night a tunic is too dark for any tunic rule, so no check reads what stands beside the houses at night, and a build that drew the housed settlers beside their doors all night would still pass. The night check proves only that they are not at the camp. `households-midnight.png` shows the empty land beside the houses, and `src/render/swarm.test.ts` proves that a villager inside is not drawn. A difference from the bare map beside a house reads 100 to 250 pixels of the house's own edges, too close to two settlers to tell them apart.
- A settler that comes out at dawn takes work within a think cycle and walks away, so the after-dawn stop must stay a few game minutes after dawn. `reach` stops up to 2 game minutes late.
- The day 4 stops are in summer because the clip's night ends on day 3. The spring dawn is at 04:48, the summer dawn at 03:36.
- The camp box leaves the houses out. A box that held a house would read the house against the bare map, and its edges change with the light.
- The houses took until about 14:45 on day 2, most of it waiting for stone. Fewer marks leave the second house unfinished at the dusk of day 2.
