# Stage 6: farming

Stage 6 gives the settlement a food it plans a year ahead. At the end the player marks fields, farmers sow them in spring, the crop ripens over the summer, the farmers cut it and carry it to a barn, and a frost at the end of autumn kills whatever still stands.

The stage exists to settle three things that later stages build on: how a tile holds a state that follows the calendar, how a job's work depends on the season, and how one night of weather, drawn by the seed, takes something from the player. It is also the first food whose amount the player decides in spring and learns in autumn. Foraging and hunting bring food in on the day it is needed.

Stage 5 left a question open that this stage touches and does not answer: how fast a settlement should grow (`docs/design/stage-5-demo.md`, "Left open for the owner"). In #53's 20 years a forager brings in 18 to 29 food a year, about 2 people's meals, and the settlement holds at 12 to 19 living until year 12. This stage measures the same 20 years with farms. It moves no number of the life cycle.

The owner decided three fixes to stage 5's rules on 2026-11-25: a newly paired household stays under its parents' roofs until a house is free, a widowed settler can pair again, and the food in a house nobody lives in comes back into reach. They are built as fix pull requests beside this brief, and no pull request of this stage depends on them.

The owner decided on 2026-11-15 that the look is not tuned further until the mechanics can be playtested. A field and a crop get plain shapes built in code, and no pull request of this stage is a look pass.

## Rules and numbers

These values come from `docs/design.md`, from the code on `main`, or are new in this brief. New values are marked as proposals. A measurement or a playtest in this stage can replace a proposal.

| Value | Number | Source |
| --- | --- | --- |
| Year | 12 days: spring is days 1 to 3, summer 4 to 6, autumn 7 to 9, winter 10 to 12. A day is 3,000 ticks, 5 minutes at 1×. | Design, `src/sim/calendar.ts` |
| Daylight | 1,800 ticks on a spring or autumn day, 2,100 in summer, 1,350 in winter | Design, `src/sim/daylight.ts` |
| A meal | 1 a day for each person, 12 a year | Stage 3 |
| A forager | Picks 1 food in 300 ticks and carries it in, about 3 food on a spring day | Stage 3, `src/sim/firstYear.test.ts` |
| A field | Tiles of grass that the player marks with a drag. No limit on its size. | Proposal |
| A farm | A building of 2 by 2 tiles for 8 logs, built in 300 ticks, with 2 places for farmers and a reach of 20 tiles | Proposal. The forager's hut has the same numbers. |
| Sowing | In spring only. A farmer sows one tile in 150 ticks. | Proposal |
| Ripening | A sown tile is ripe at the fifth dawn after it was sown. A tile sown on day 1 is ripe on day 6, and one sown on day 3 on day 8. | Proposal |
| Cutting | A farmer cuts one ripe tile in 200 ticks. That puts 4 food on the tile. | Proposal |
| Carrying in | 1 unit a walk, to the nearest barn or the camp with room, as a hunter carries a kill in | Stage 3 |
| Cut food on the ground | Spoils at the second dawn, as every food on open ground does today | Stage 3, `src/sim/goods.ts` |
| The frost | At the dusk of day 9. In 1 year of 4, drawn by the seed and the year, at the dusk of day 8. | Proposal |
| The frost's warning | The news says it at the dawn of the day of the frost. | Proposal |
| Tick time limit for the benchmark | 99th percentile under 4 ms on the owner's machine | Stage 1 |

The orchestrator's estimate, which nothing has measured: a farmer who works alone, with a barn 5 tiles from its field, sows 4 tiles on each spring day and needs about 600 ticks to cut a tile and carry its 4 food in. From day 6 to the frost it has 7,500 ticks of daylight, which is 12 tiles and 48 food, the meals of 4 people. With settlers without a job carrying the cut food, the same farmer cuts up to 37 tiles. An early frost leaves it 5,700 ticks.

### Fields

- The player marks a field with a tool of the toolbar, by a drag, as a stockpile is marked. Only a tile of grass with no claim, no goods, and not under the camp takes the mark.
- A field tile keeps its mark for years, until the player cancels it. Cancel removes the mark and what grows on it.
- A field tile is walkable. Nothing can be built on it and no stockpile can be marked on it while it is a field.
- A field belongs to no farm. A farmer works the field tiles within the reach of its farm, the nearest first.
- A field tile is in one of these states: bare, sown, ripe, or cut. The crop of a sown tile is drawn taller at each dawn, so that a player sees how far it is.
- The ground has no fertility. Every tile of grass bears the same.

### The farm and the farmer

- A farm is a building with places, as the forager's hut is. The game gives each open place to the nearest settler without a job, and the player sets how many places are wanted.
- In spring a farmer sows the bare field tiles in reach. It sows nothing in any other season.
- From the dawn at which a tile is ripe, a farmer cuts it. The 4 food lie on the tile. The farmer carries in what lies cut on the fields in reach before it cuts another tile, so that it leaves no more on the ground than it can bring in.
- Settlers without a job carry cut food in too, by the rule that carries a hunter's kill in today. Building and supplying the sites come before carrying in a settler's order, as today.
- A farmer cuts nothing while no barn and no camp has room for food, as a hunter does not go out then. The crop stays standing.
- A farmer with nothing to do on the fields is idle and its panel says why, as a forager's does in winter. It does not do the work of a settler without a job. The player takes places from the farm when the hands are needed elsewhere.
- A cut tile is bare again at the first dawn of spring, and so is a tile the frost killed.

### The frost

- Each year has one frost. It falls at the dusk of day 9, the last day of autumn. In 1 year of 4 it falls at the dusk of day 8. The draw comes from the seed and the year, so a map has the same frosts on every run.
- At the dawn of the day of the frost the news says that the frost comes tonight.
- At the frost every sown tile and every ripe tile that is not cut loses its crop. The news says how many tiles were lost.
- Food that is cut is not hurt by the frost. It spoils by its own rule.
- From the frost to the first dawn of spring the ground is frozen and nothing is sown.

### What the player reads

- The farm's panel shows its farmers and what they do, as a forager's hut does. An idle farmer says why: nothing is sown until spring, the crop is growing, no field lies in reach, no store has room, or the ground is frozen.
- The farm's panel counts the field tiles in its reach by state, such as `12 sown, 4 ripe`, and says how much food its farmers cut this year and how many tiles the frost took.
- The news says at a dawn that the first tile is ripe, on the day of the frost that it comes tonight, and after it how many tiles it killed.
- The panels are tight at 960 by 540. Every new reading goes into `panelReadings` and passes the checks of `readiness` and `selecting` at the three window sizes. The toolbar gets two tools, Field and Farm, and the pull request that adds them measures the toolbar at 960 by 540.

## Structure the stage sets up

- A tile holds a state that follows the calendar. The state is kept in arrays by tile with a fixed size, and it is read against the clock where it is needed, as a forage tile's `ripeAt` is. No tick walks every field tile.
- A claim that lasts. Today a mark for chopping or quarrying ends when the work is done, and a stockpile holds goods. A field mark is a claim that stays for years and carries a state.
- A job whose work follows the season, with reasons for each time of the year. Today only the forager stops for a season.
- A draw that belongs to a year, with its own stream from the seed, as stage 5 made one for a household and a dawn. A later stage that forecasts the horde or the weather uses the same place.
- A change of a tile's look that is not a change of its kind reaches the renderer through the channel that carries tile changes today.
- The count of a year for a workplace: what it brought in and what it lost. Stage 5 made the year's counts for births and deaths.
- The benchmark exercises the stage. Its map gets farms and fields beside the other buildings, and a third run beside spring and winter that starts in late summer with ripe fields, so that tiles are cut and carried in during the measured ticks and the frost falls in them. Each pull request reports how many tiles were sown, cut, and lost in the measured ticks, and the largest tick at the dusk of the frost and at a dawn at which tiles ripen.

## Pull requests

The four run one after another. Every pull request that touches the simulation reports the benchmark output. Every pull request ends in something the owner can try in the running game, named under "Play it".

### 6.1 Mark a field and sow it

- **Behavior.** The player marks a field on grass and orders a farm beside it. A settler takes a place at the farm and sows the field in spring, tile by tile. A sown tile looks sown.
- **Also in this pull request.** The field mark and the state of a tile, the farmer's job with its idle reasons, the two tools, and the farm in the benchmark's spring run.
- **Play it.** Chop 8 logs, order a farm, drag a field beside it, and watch the farmers sow it before spring ends.
- **Proof.** A clip of a field being sown, the farm's panel and a farmer's panel, the toolbar at 960 by 540, the tiles sown on each day of the first spring on seed 7, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 6.2 The crop ripens and is cut

- **Behavior.** A sown tile grows at each dawn and is ripe at the fifth. A farmer cuts it, the food lies on the tile, and the farmer and the settlers without a job carry it to a barn or the camp. The news says when the first tile is ripe.
- **Also in this pull request.** The benchmark's third run, and the first year on seed 7 with a farm, as a script in `scripts/`.
- **Play it.** Sow a field in spring, run to day 6 at 8×, which takes about 3 minutes, and watch the harvest go into the barn.
- **Proof.** A clip from a dawn at which tiles ripen to the food in the barn, a screenshot of a field in each state, the food cut and carried in on each day of the first year on seed 7, with and without settlers free to carry, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 6.3 The frost kills what stands

- **Behavior.** The news warns at the dawn of the day of the frost. At its dusk every crop that stands is lost, and the news says how many tiles. The ground stays frozen until spring, and then the fields are sown again.
- **Also in this pull request.** The year's draw from the seed, and the day of the frost in each of the first 20 years on seed 7.
- **Play it.** Sow a field too large for two farmers, read the warning on the day of the frost, and count what is lost that night.
- **Proof.** A clip of the dusk of the frost on a field that is half cut, the news lines, the same field at the first dawn of spring, the tiles lost in the first year on seed 7 with a frost on day 9 and with one on day 8, and the benchmark output with the largest tick at the frost.
- **Worker.** Claude Code on the default model.

### 6.4 Read the fields, and measure the years

- **Behavior.** The farm's panel counts the field tiles in its reach by state and says what its farmers cut this year and what the frost took.
- **Also in this pull request.** The stage's measurement of many years, described under "What the stage decides". The worker may cut the measurement into a pull request of its own, as stage 5 cut 5.5.
- **Play it.** Play two years at 8×, which takes 15 minutes, and read from the farm's panel what the second year brought against the first.
- **Proof.** A clip of the farm's panel across a harvest, the tables of the measured years on seed 7, and the benchmark output.
- **Worker.** Claude Code on the default model.

## How the owner plays it

Each pull request is playable when it merges. In the checkout of `main`:

1. `git pull`
2. `git -C game-assets pull`
3. `bun install`, then `bun run dev`, and open the address it prints.

At 8× a day takes 38 seconds, and a game starts at 08:00 on day 1. Spring ends 1 minute 40 seconds into it, the first tile can be ripe after 3 minutes, and the frost falls after 5 minutes 18 seconds, or after 4 minutes 40 seconds in a year in which it comes early. What the owner says after playing becomes a fix pull request or a changed proposal in this brief.

## What the stage decides

- Whether a field feeds a settlement through its winter. 6.2 and 6.4 measure the first year on seed 7 with a farm: the food in the barn at the year's end, beside the 97 that stage 3 measured at autumn's end with a hut, a barn, and a lodge, and the 32 of stage 4's year "wood".
- Whether the first 8 settlers can spare 2 farmers. A hut, a lodge, a woodshed, a tailor's hut, and a farm have 8 places, and then nobody builds or carries.
- How many tiles feed a person, and whether 4 food a tile and the times of sowing and cutting are right. The estimate above is the orchestrator's.
- Whether the harvest is a time at which the player needs every hand. 6.2 reports the tiles cut and the food spoiled on the ground with and without settlers free to carry.
- Whether a frost that comes a day early in 1 year of 4, with a warning that morning, is a loss the player can answer, or one that only happens to them.
- Whether farmers who stand idle through summer and winter are a cost the player manages with the places, or whether a settler with a job should do common work when its own has none. 6.4 reports the share of a farmer's daylight in which it works.
- Whether a barn's 120 food hold a harvest, and what a farmer's stop for lack of room costs.
- How fast a settlement grows with farms. 6.4 runs the 20 years of #53 on seed 7 with its rule extended by farms and fields, stated in full and held in the script's code: when a farm is ordered, where, and how many tiles. It reports the table of #53 and, for each year, the tiles sown, cut, and lost, and the food cut. #53 calls its year-20 numbers one sample of a fragile process, and the same holds here.
- The tick time with fields, against the 4 ms limit, and the largest tick at the frost.

## What the stage leaves out

- Seed. Sowing takes no food from a store in this stage.
- More than one crop, and a second sowing in a year.
- Fertility, fallow, rotation, and manure.
- Ploughs, hoes, and every tool, which come with the tool tiers.
- Flour and bread, which belong to food processing in the second wave.
- Livestock and fishing, which belong to the second wave.
- A late frost in spring, drought, hail, pests, and deer that eat the crop.
- A forecast of the weather beyond the one line on the day of the frost.
- Fences and scarecrows.
- Settlers without a job who sow or cut.
- Food that spoils in a store.
- The levy of adult men at harvest time, which is stage 7.
- Choosing which settler becomes a farmer.
- Saving and loading.
- Any tuning of the look.
