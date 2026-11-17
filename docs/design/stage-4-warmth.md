# Stage 4: warmth

Stage 4 gives the winter a second way to kill. At the end a settler needs a warm night on every night of winter. Warmth comes from a house, from a fire that burns firewood, and from clothing made of hides. You split logs into firewood, make clothing from the hides of the deer your hunters shoot, and try to bring all eight settlers through the first winter fed and warm.

The stage exists to settle three things that later stages build on: how a second need sits beside hunger, how a workshop turns one good into another and stops when its input has not arrived, and how a household keeps more than one good at home. It is also the stage that gives houses a use. In stage 3 a house is a place to sleep and nothing more.

The stage 3 summary (`docs/design/stage-3-demo.md`) found that the first year is far from tight. With a hut, a barn, and a lodge, the barn ends the year with 108 food on seed 7. Warmth takes logs, stone, and hands in the same year, so this stage also measures whether that makes the year tight, before or beside any change to the food numbers.

The owner decided on 2026-11-15 that the look is not tuned further until the mechanics can be playtested. New buildings and goods in this stage get plain shapes built in code, and no pull request of this stage is a look pass.

## Rules and numbers

These values come from `docs/design.md`, from the stage 3 brief, or are new in this brief. New values are marked as proposals. A measurement or a playtest in this stage can replace a proposal.

| Value | Number | Source |
| --- | --- | --- |
| Cold nights | The 3 nights of winter. No other night is cold. | Proposal. The design gives a year 12 days and a season 3. |
| A warm night | A villager has two of three: it sleeps in a house, a fire burns where it sleeps, it wears clothing. | Proposal. The design names a house, firewood, and clothing as the sources of warmth. |
| Cold | After 1 cold night. A cold villager works at half the rate and walks at full speed. Cold and hungry together are still half the rate. | Proposal, in the form of hunger |
| Frozen | A villager dies at its 3rd cold night in a row | Proposal, in the form of hunger |
| Firewood | 1 log splits into 2 firewood with 10 seconds of work | Proposal. The design says firewood is split from logs. |
| Woodshed | 2 by 2 tiles, 6 logs, 20 seconds of building work, 1 place, holds 40 firewood, takes logs from stockpiles within 30 tiles | Proposal |
| A house's fire | Burns 2 firewood on a winter night. A house holds up to 6 firewood, which is three nights. | Proposal |
| The camp's fire | Burns 4 firewood on a winter night when anyone sleeps at the camp. The camp holds up to 12 firewood. Outside winter it burns for nothing, as it does today. | Proposal |
| Hide | A killed deer leaves 1 hide beside its 6 food. A hide on the ground keeps. | Proposal. The design says clothing is made from hides. |
| Tailor's hut | 2 by 2 tiles, 8 logs, 30 seconds of building work, 1 place, holds 8 pieces of clothing, takes hides from stockpiles within 30 tiles | Proposal |
| Clothing | 2 hides and 60 seconds of work make 1 piece. A villager wears 1 piece. Clothing does not wear out in this stage. | Proposal |
| Tick time limit for the benchmark | 99th percentile under 4 ms on the owner's machine | Stage 1 |

Work times are at 1× speed and are stored as ticks. A winter has 3 nights, so a house burns 6 firewood in a winter, which is 3 logs, and the camp's fire burns 12, which is 6 logs. On seed 7 the hunters of stage 3 make 13 kills by the end of autumn, which is 13 hides and 6 pieces of clothing. The number of hides for one piece therefore depends on what the owner decides about deer in stage 3's open decisions.

### Cold and warmth

- Warmth is a need like food. A villager stores its cold nights in a row, as it stores its missed meals.
- A night is judged when the villager comes home at dusk, at the moment of its meal. A villager that never gets home has no house and no fire that night.
- A villager is warm when it has two of the three. In a house with a fire it is warm without clothing. In a house without a fire it is warm when it wears clothing. At the camp it is warm when the camp's fire burns and it wears clothing. Everything else is a cold night.
- A warm night clears the cold nights. So does every night outside winter.
- After 1 or 2 cold nights a villager is cold. At its 3rd cold night in a row it dies and is removed from the map, as a starved villager is. A winter has 3 nights, so a villager with no warm night all winter dies in the winter's last night.
- The interface says who had a cold night and who froze, by name, in the news of stage 3. The game's end is the same: when the last villager dies, the settlement has died out.

### Fires and firewood

- Firewood is a physical good. A villager carries 1 unit. It keeps under a roof and on the ground.
- A house's fire burns when its household comes home on a winter night and the house holds 2 firewood. It takes the 2 units. A house with less has no fire that night and keeps what it has.
- The camp's fire burns on a winter night when a villager comes home to the camp and the camp holds 4 firewood. It takes the 4 units.
- A household stocks its home with firewood as it stocks it with food. When the house holds less than 6 firewood, a member carries 1 unit from the nearest woodshed that has some. Food comes first. A villager with a job does it too.
- Villagers without a job carry firewood from the nearest woodshed to the camp while a household sleeps at the camp and the camp holds less than 12. This follows the rule that #29 added for food.
- A house with a fire shows it on the map at night with a plain sign built in code, so the player sees which houses are warm.

### The woodshed

- The woodshed is a workplace with 1 place and a store of firewood. Its panel is the workplace panel of stage 3 and shows the firewood it holds.
- The woodcutter carries 1 log from the nearest stockpile within 30 tiles to the shed, splits it there, and puts the 2 firewood into the shed's store.
- The woodcutter stops when the shed is full or no stockpile within reach has a log. Its panel says which.
- Logs for firewood and logs for building come from the same stockpiles. A building site takes a log before the woodcutter does.

### Hides and clothing

- A killed deer leaves 1 hide on its tile with its food. Villagers without a job carry hides to a stockpile zone, which now takes logs, stone, and hides.
- The tailor's hut is a workplace with 1 place and a store of clothing. The tailor carries 2 hides from the nearest stockpile within 30 tiles, one at a time, works them, and puts 1 piece of clothing into the hut's store.
- The tailor stops when the hut is full or no stockpile within reach has a hide. Its panel says which.
- A villager without clothing fetches 1 piece from the nearest tailor's hut that has one and wears it. This comes after stocking the home and before every other kind of work, and a villager with a job does it too.
- When a villager dies, its clothing is gone with it. The player does not choose who gets clothing in this stage.
- A clothed villager is drawn so that it differs from an unclothed one at the game's usual zoom, with a plain change built in code.

### What the player reads

- The top-left panel shows the firewood in woodsheds and at the camp as one total and the firewood in homes as another, beside the food totals of stage 3, and the hides in stockpiles.
- A house's panel shows its firewood beside its food, and in winter whether its fire burned last night.
- A villager's panel shows whether it wears clothing and its cold nights.
- From the first day of autumn the interface says how ready the settlement is for the winter: how many households have a house, how many houses hold three nights of firewood, how many villagers wear clothing, and how many villagers would have a cold night if winter began tonight.

## Structure the stage sets up

- A second need is a second column on the villager with the same rule: a count in a row, a weakened state after the first, and death at the third. The half rate reads both columns.
- A workshop is a workplace that takes one good and gives another. It has a reach for its input and a store for its output, and it stops when either fails. The woodshed and the tailor's hut are the first two. A third is added in one place, and the pull request that adds the first says where.
- Goods are one list with a kind. Firewood, hides, and clothing are added to logs, stone, and food. A new good is added in one place.
- A household's store holds each good with its own limit.
- What a villager wears is a column on the villager.
- From the pull request that adds each system, the benchmark's 1,500 villagers split firewood, stock their homes, burn fires, make clothing, and wear it. The benchmark of stage 3 does not reach a winter. This stage adds a run that does, and each pull request reports the largest tick at a winter dusk and the cold nights and deaths from cold in the measured ticks.

## Pull requests

4.1 and 4.3 can run at the same time. 4.2 follows 4.1, 4.4 follows 4.2 and 4.3, and 4.5 comes last. Every pull request that touches the simulation reports the benchmark output. Every pull request ends in something the owner can try in the running game, named under "Play it".

### 4.1 Split firewood at a woodshed

- **Behavior.** You place a woodshed, the settlers build it, and one of them becomes the woodcutter. It carries logs from a stockpile, splits them, and the firewood total rises. The shed's panel shows what it holds and why the woodcutter stops.
- **Also in this pull request.** Goods become one list with a kind, and the workshop gets its form.
- **Play it.** Chop a grove, mark a stockpile, build a woodshed, and watch the logs become firewood.
- **Proof.** A clip of the woodcutter from the stockpile to the split firewood while the total rises, a screenshot of the shed's panel when it has stopped for lack of logs, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 4.2 Winter nights are cold

- **Behavior.** Houses and the camp burn firewood on winter nights. Households carry firewood home, and settlers without a job keep the camp's fire fed. A settler without two of the three sources of warmth has a cold night, works at half the rate after it, and dies at the third in a row. The interface shows the firewood totals and says who was cold and who froze. Nobody has clothing yet, so only a house with a fire is warm.
- **Play it.** Go into a winter with two houses, a woodshed, and two households at the camp, and see who freezes on the last night.
- **Proof.** A clip of a winter dusk with two houses whose fires burn and two households at the camp, a screenshot of a cold settler's panel, the night on which each settler dies on seed 7 with stage 3's three buildings and nothing for warmth, and the benchmark output with its winter run.
- **Worker.** Claude Code on the default model.

### 4.3 Make clothing from hides

- **Behavior.** A killed deer leaves a hide. Settlers carry hides to a stockpile. You place a tailor's hut, and the tailor makes clothing from the hides. The hut's panel shows the clothing it holds and why the tailor stops.
- **Play it.** Build a lodge and a tailor's hut and count the clothing at the end of autumn.
- **Proof.** A clip from a kill to a piece of clothing in the hut, the hides and the clothing on seed 7 at each season's end with stage 3's first-year commands and a tailor's hut, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 4.4 Settlers wear clothing

- **Behavior.** A settler without clothing fetches a piece from the tailor's hut and wears it. A clothed settler is warm in a house without a fire and at the camp when its fire burns. The settler's panel shows its clothing, and a clothed settler differs on the map.
- **Play it.** Bring two households through the winter at the camp's fire, in clothing, without a house.
- **Proof.** A clip of a settler that fetches clothing and of a winter dusk at the camp with clothed and unclothed settlers, the news of the morning after, and the benchmark output with its winter run.
- **Worker.** Claude Code on the default model.

### 4.5 Read how ready the settlement is for winter

- **Behavior.** From the first day of autumn the interface says how many households have a house, how many houses hold firewood for the winter, how many settlers wear clothing, and how many settlers would be cold tonight. A house's panel says whether its fire burned last night.
- **Also in this pull request.** The stage's measurement of the first year, described under "What the stage decides".
- **Play it.** Bring all 8 settlers through the first winter fed and warm.
- **Proof.** A clip of the autumn readout changing as the last house gets its firewood, the tables of the first year on seed 7 for the three sets of commands, and the benchmark output with its winter run.
- **Worker.** Claude Code on the default model.

## How the owner plays it

Each pull request is playable when it merges. In the checkout of `main`:

1. `git pull`
2. `git -C game-assets pull`
3. `bun install`, then `bun run dev`, and open the address it prints.

At 8× a day takes 38 seconds and a year 7.5 minutes. What the owner says after playing becomes a fix pull request or a changed proposal in this brief.

## What the stage decides

- Whether two of three is a rule a player can read and plan with, or whether warmth should be one source with the others as help.
- Whether death at the third cold night in a row, which is the whole winter without one warm night, is fear enough. The other choice is death at the second.
- Whether 8 settlers can prepare a winter's warmth beside its food. Pull request 4.5 measures three first years on seed 7 with fixed commands, all given in the first spring or as soon as the goods allow. A miss changes the proposals, not the measurement.
  - **Wood.** Stage 3's hut, barn, and lodge, a woodshed, and a house for each household. The target is that all 8 come through the winter fed and warm.
  - **Wood and hides.** The same with two houses and a tailor's hut. The target is that the two households in houses are warm by their fires, the two at the camp are warm in clothing by the camp's fire, and all 8 come through.
  - **Nothing for warmth.** Stage 3's hut, barn, and lodge alone. The target is that all 8 are fed and all 8 freeze in the last night of winter.
- Whether warmth makes the first year tight. 4.5 reports the food in the barn at the year's end in each of the three years, beside the 108 that stage 3 measured without warmth.
- Whether one woodcutter and one tailor keep up with 8 settlers, and what a household's walk to the woodshed costs.
- The tick time with 1,500 villagers that keep warm, against the 4 ms limit, and the largest tick at a winter dusk.

## What the stage leaves out

- Clothing that wears out, kinds of clothing, and tanning as its own step.
- Firewood that must dry, and a fire that spreads.
- Cold outside winter, cold by day, and temperature as a number.
- Illness from cold, which belongs to health in the second wave.
- Stone tools and axes as goods.
- Births, children, aging, and death of old age, which are stage 5.
- Farming, which is stage 6.
- Choosing which villager gets clothing or a job.
- Saving and loading.
- Any tuning of the look.
