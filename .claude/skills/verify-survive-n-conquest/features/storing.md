# Storing

The barn is the second store of food, so where the food is kept becomes the player's choice. The player places it with the `Barn` tool, `B`, on 3 by 3 tiles of open, level ground, and the settlers build it from 16 logs and 6 stone in 90 seconds of work at 1×. It stands as red plank walls under a steep gable roof with a pale door braced with an X, apart from the thatched house and the round roof of the hut. A finished barn holds up to 120 food, and food in it keeps. A forager carries each unit it picks to the nearest store with room, the camp or a finished barn, measured in a straight line from the picked tree to the camp center or the barn's middle and counting the units already on their way there. A settler without a job carries food that lies on the ground to the nearest store with room the same way, 1 unit at a time. Every carrier puts its unit down at dusk, and a unit that nobody carried is gone at the second dawn after it was put down. A household with a house stocks its home from the store nearest the house that has food. A household with no house eats at the camp, and settlers without a job keep one day of its meals at the camp, carried from the nearest barn. The barn's panel says what it is and reads its food against its 120. The Stockpiles panel shows the food in barns and at the camp as one total, `Food in barns and camp`, and the food in homes as another, and the camp's panel keeps the camp's own count. This scenario plays a hut, a barn, and a house on seed 7 through day 4, and a second page where every settler holds a job, so food on the ground lies until it is gone. `src/sim/barn.test.ts` proves the rules, and `src/sim/firstYear.test.ts` and `scripts/barn-year.ts` compare a barn beside the hut with a barn far from it over the first year.

## Sub-features

- `storing-tool` picks the Barn tool with B, says it places a barn on 3 by 3 tiles, and places a barn site with a click.
- `storing-site` labels the site `Barn site`, with `Logs n/16`, `Stone n/6`, and its work.
- `storing-panel` reads the finished barn's title, its note, and `Food n of 120`.
- `storing-house` reads a household with a house take food from the barn: the house's food rises while the camp's stays.
- `storing-barn` reads the barn's food rise from the foragers while the camp's does not.
- `storing-totals` reads `Food in barns and camp` as the barn's and the camp's food together and `Food in homes` as the house's.
- `storing-ground` shows food on the ground that nobody carried on day 3, and the same ground without it on day 4.

## How to get to it (user POV)

- Open the game at `?seed=7`. The forest's edge lies a few tiles east of the camp, and rock lies north-west of it.
- Press C and drag over the trees at the forest's edge east of the camp. Press M and drag over the two rock tiles nearest the camp.
- Press G and click open ground at the forest's edge for the hut. Press B and click the open ground between the hut and the camp for the barn. Press H and click open ground north of the hut for a house.
- Run at 8×. The hut stands on day 1, and the barn and the house on day 2 or 3.
- Click the barn, the camp, and the house to read the food each holds. On day 4 the barn fills while the camp holds the same.
- To see food go, open `?seed=7&food=8`, mark the same trees, and place four huts. Their eight places take every settler, so nobody carries what the foragers put down at the dusk of day 2.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run storing`, which runs doctor itself.
- The first page opens at 960 by 540 on `?seed=7` with the settlers, no `food` setting, recorded, and `clock: 'paused'`. The ground page opens the same way on `?seed=7&food=8`, not recorded.

- **Give the orders.** `takeView` takes `STORE_ORDER_VIEW`, about 42 m over the camp looking north-east, which holds the rock, the camp, and the forest's edge. It drags Chop over `STORE_ORDERS.chop`, the tiles (137, 129) to (145, 139), and Quarry over `STORE_ORDERS.quarry`, (121, 114) to (122, 115), and clicks the hut on (136, 127) with G, the barn on (134, 127) with B, and the house on (137, 123) with H. `B picks the Barn tool, which places a barn site with a click` reads the pressed button, the hint, and `Barn site placed.` `the Chop and Quarry drags mark trees and rock, and the hut, the barn, and the house sites are placed` reads the status line after each order. `the barn site's label reads 0 of 16 logs, 0 of 6 stone, and waits for materials` reads the label. It takes `storing-sites.png` and wheels `STORE_CLOSER` in to about 23 m.
- **Watch them built.** It runs at 8× until the hut's and the barn's labels are gone, and pauses. `the settlers build the hut and the barn` reads the clock when each label went.
- **Read the barn.** It clicks the barn's roof. `at ... the barn's panel says what it is and reads its food against its 120` reads `Barn`, `A finished barn. Food in it keeps.`, and `Food n of 120`. It takes `storing-barn-panel.png`.
- **Read the stores.** At each of `STORE_STOPS` it clicks the barn, the camp, and the house in turn and reads each one's `Food`, then the Stockpiles panel. `from day 3 23:00 to day 4 07:00 the household with the house takes food from the barn` needs the house's food to rise while the camp's stays, so the units came from the barn, the only other store. `from day 4 07:00 to day 4 18:30 the barn's food rises by at least 3 in its panel while the camp's does not rise` compares the two stops. `the Stockpiles panel totals the barn's and the camp's food as one and the house's as another` holds at all three stops.
- **The clip.** `storing-barn-to-house.gif` runs from 03:25 on day 4, before the dawn at 03:36, to 06:30 at 2×, cropped by `STORE_CLIP` to the clock, the house, the barn, the hut, and the camp's edge. At dawn a member of the household walks from the house to the barn's door and back with a sack, and the foragers walk from the forest into the barn.
- **Food on the ground.** The ground page takes the same views, drags the same Chop, and clicks four huts at `GROUND_HUTS` with G. `the ground page places four huts, whose eight places take every settler` reads the status lines. At day 3 12:00 `every settler holds a job, so nobody carries food from the ground` reads 8 and 0 in the Stockpiles panel, and it takes `storing-ground-lying.png`. At day 4 12:00 it takes `storing-ground-gone.png`. `food that nobody carried lies on the ground on day 3 and is gone by noon on day 4` counts the pixels of `FOOD_SACK` in both.
- **Proof.** Run `$V run storing`. The evidence folder holds the clip, the screenshots, and `result.json` with every check, including `no page errors`.

## Gotchas

- `STORE_ORDERS` and `STORE_SPOTS` are where the camera rig and the picker put each tile's center at the two views, from `scripts/aim.ts` with the command in the comment above `STORE_SEARCH`. A change to the camera's opening view, its input rates, or the map of seed 7 moves them.
- The barn stands between the hut and the camp, so every tree the hut reaches lies nearer the barn's middle than the camp center. A barn on the far side of the hut, at (139, 127), lost the race to the house for the logs, and the Chop drag felled the trees nearest it, so it filled slowly.
- Units that a forager took before the barn was finished still go to the camp, because a forager chooses its store when it takes the tree. The camp's food can rise for a few game hours after the barn stands. The scenario reads the barn's rise on day 4, long after.
- Settlers without a job keep one day of meals at the camp for the households without a house, from the barn. On day 4 the camp holds more than the six meals of its three households, so none is carried there. A stop on day 2 or 3 can see the camp rise from the barn.
- A unit that a carrier puts down at dusk is carried the next day whenever a settler without a job is free. Food is gone only when nobody carries it, so the ground page gives every settler a job. With the camp's 24 food, the camp filled, the foragers waited, and nothing lay on the ground, so the ground page opens with `?food=8`.
- The sack of a unit of food is close in color to a log and to the text of the clock and the camera controls. `FOOD_SACK` matches only the lit top of a sack at noon, and the check counts it only in `GROUND_BOX` around the camp. On rj-firebat two sacks beside the camp read 99 pixels at day 3 12:00 and the box read 4 at day 4 12:00.
- On rj-firebat the barn stood at day 3 06:12 and its panel read `Food 0 of 120`. The stores read barn 6, camp 11, house 4 at day 3 23:00, barn 7, camp 11, house 6 at day 4 07:00, and barn 15, camp 11, house 6 at day 4 18:30. `storing-barn-to-house.gif` took 3.0 MB.
