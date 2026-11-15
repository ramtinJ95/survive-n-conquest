# Stage 3: food

Stage 3 gives the settlers a reason to work. At the end the settlers live in households, eat once a day, and die if they miss too many meals. You feed them by foraging and hunting, keep the food in a barn, and try to bring all eight through the first winter.

The stage exists to settle three things that every later stage builds on: how a villager gets a job at a workplace, how a household keeps and uses its own store, and how a need that is not met harms a villager. It is also the first stage that can be lost, so it is the first one that can be played for more than a look.

The owner decided on 2026-11-15 that the look is not tuned further until the mechanics can be playtested. New buildings and animals in this stage get plain shapes that fit the look of pull request 2.6, and no pull request of this stage is a look pass.

## Rules and numbers

These values come from `docs/design.md` or are new in this brief. New values are marked as proposals. A measurement or a playtest in this stage can replace a proposal.

| Value | Number | Source |
| --- | --- | --- |
| Food | One kind. 1 unit is one meal for one adult. | Design: one food type and no diet effect. The size of a unit is a proposal. |
| Meals | 1 a day for each villager | Proposal |
| Hungry | After 1 missed meal. A hungry villager works at half the rate and walks at full speed. | Proposal |
| Starved | A villager dies at its 3rd missed meal in a row | Proposal |
| Starting households | 4, each one man and one woman | Proposal. The design says each villager has a sex and a household. |
| Camp store | Starts with 24 food, which is three days for 8 settlers. Holds up to 40. | Proposal |
| House store | Up to 16 food | Proposal |
| What a household keeps at home | 3 days of food for its members, when it can get it | Proposal |
| Food on open ground | Gone at the second dawn after it was put down | Proposal |
| Forager's hut | 2 by 2 tiles, 8 logs, 30 seconds of building work, 2 places, works the forest within 20 tiles | Proposal |
| Foraging | 20 seconds of work at a forest tile with a tree gives 1 food. The tile bears again after 2 days. Nothing grows in winter. | Proposal |
| Barn | 3 by 3 tiles, 16 logs and 6 stone, 90 seconds of building work, holds 120 food | Proposal |
| Hunter's lodge | 2 by 2 tiles, 8 logs and 4 stone, 30 seconds of building work, 2 places, hunts within 40 tiles | Proposal |
| Deer | 1 for every 1,500 land tiles when the map starts. 1 walks in from the map edge at each dawn while there are fewer than that. A deer gives 6 food. | Proposal |
| A shot | 4 seconds of aiming from 10 tiles or nearer. It hits 2 times in 3. | Proposal |
| Buildings and sites | At most 1,024 on a map, up from 256 | Proposal. 1,500 villagers need more than 256 homes. |
| Animals | At most 256 on a map | Proposal |
| Tick time limit for the benchmark | 99th percentile under 4 ms on the owner's machine | Stage 1 |

Work times are at 1× speed and are stored as ticks. A year is 12 days, so 8 settlers eat 96 food in a year, and 24 of it in the winter.

### Households and homes

- Every villager has a name, a sex, and a household. The names come from a list in the game and are chosen by the seed.
- A finished house becomes the home of one household that has none. The household with the lowest number goes first. A house is the home of one household.
- A household with no house lives at the camp, as all settlers do in stage 2.
- At dusk a villager with a home walks to the nearest walkable tile beside its house and goes inside. It is not on the map until dawn. A villager with no walk to its house stays where it stands.
- When the last member of a household dies, its house is free for another household.
- The player does not move households between houses in this stage.

### Stores and food

- A store is a place under a roof that holds food: the camp, a barn, and a house. Food in a store keeps.
- Food is a physical good like logs and stone. A villager carries 1 unit. A unit is a count in one store or on one tile, never a number in a global total.
- A stockpile zone takes logs and stone only. Food that is put down outside a store lies on the ground and is gone at the second dawn after it was put down.
- A villager without a job carries food from the ground to the nearest store with room, as it carries logs to a stockpile. A house is not a target of this carrying.
- The interface shows the food in barns and at the camp as one total, and the food in homes as another.

### Eating and hunger

- A villager eats when it comes home at dusk: it takes 1 unit from its household's store. A household at the camp eats from the camp store.
- A villager that found no food at dusk has missed a meal. It eats at dawn instead if its store has food by then, and that clears the missed meals.
- After 1 or 2 missed meals a villager is hungry. At its 3rd missed meal in a row it dies and is removed from the map. Bodies and graves are left out.
- A household stocks its own home. When the house holds less than 3 days of food for its members, a member carries 1 unit from the nearest barn or the camp to the house. This comes before every other kind of work, and a villager with a job does it too. Units on their way count against what the house lacks.
- The interface says who went hungry and who died, by name. When the last villager dies, the game says that the settlement has died out and offers a new map.

### Jobs at a workplace

Stage 2 gave orders to the land, and any free villager carried them out. That stays. Stage 3 adds the first workplaces.

- A workplace has places. The player sets how many of them are filled, from none to all, in the building's panel. A new workplace asks for all its places.
- An open place is filled by the nearest adult without a job. Lowering the number frees the villager that came last.
- A villager with a job does that job by day, and stocks its home. It takes no order to the land.
- A villager without a job does everything from stage 2: it chops, quarries, carries, and builds. The player therefore chooses between hands at the workplaces and hands for building. The interface shows how many villagers have a job and how many have none.
- When a villager with a job dies, its place opens again.

### Foraging

- A forager walks to a forest tile with a tree inside the hut's reach that bears forage, works it, and carries the unit to the nearest store with room.
- One forager works a tile at a time. A picked tile bears again after 2 days.
- At the first dawn of winter all forage is gone, and none grows until spring.
- A felled tree bears nothing, so a settlement that clears the forest around its hut loses that food.

### Hunting

- Deer are animals on the map, in their own table. They wander on grass and forest and stay off water and rock.
- A deer runs from any villager within 6 tiles, at 3 tiles per second for a few seconds.
- A hunter walks toward the nearest deer inside the lodge's reach that no other hunter follows. From 10 tiles or nearer it aims for 4 seconds. If the deer is still within 12 tiles, it shoots.
- A hit kills the deer and leaves 6 food on its tile. A miss sends the deer running.
- The hunter carries the food to the nearest store with room. Villagers without a job help, because it is food on the ground.
- Deer stay through the winter, so hunting is the food of the cold season. Deer killed faster than they walk in leave the map empty.
- Bows and arrows are not goods yet. A hunter needs nothing to hunt.

### Selecting

- With no tool active, a click selects a villager, a building, a site, or the camp. A click on bare ground or Escape clears the selection.
- A villager's panel shows its name, sex, household, home, job, what it is doing, what it carries, and its missed meals.
- A building's panel shows what it is, who lives or works there, and what it stores. A workplace's panel sets its filled places.

## Structure the stage sets up

- Households are a table. A villager stores its household, and a household stores its home.
- Buildings become one table with a kind, so a house, a hut, a barn, and a lodge share placement, supply, and building work. The rule that no building may divide the land covers every kind.
- A need is a column on the villager with one rule for what happens when it is not met. Warmth in stage 4 follows the same form.
- Animals are a fixed-capacity table beside villagers and monsters.
- From the pull request that adds each system, the benchmark's 1,500 villagers live in households, eat, stock their homes, forage, and hunt. The benchmark reports the meals eaten and the food gathered in the measured ticks. Everyone eats and goes home at dusk, and every task opens at dawn, so each pull request also reports the largest tick at dusk and at dawn.

## Pull requests

3.1 and 3.2 can run at the same time. The rest go in order. Every pull request that touches the simulation reports the benchmark output. Every pull request ends in something the owner can try in the running game, named under "Play it".

### 3.1 Select a villager or a building and read it

- **Behavior.** With no tool active, you click a settler, a house, a site, or the camp, and a panel shows what it is and what it is doing. The selected thing is marked on the map.
- **Play it.** Follow one settler through a day and read what it does.
- **Proof.** A clip of selecting a settler at work, a site, and a house, and a screenshot of each panel.
- **Worker.** Claude Code on the default model. The panel follows the interface that pull request 2.2 set.

### 3.2 Households move into houses

- **Behavior.** The 8 settlers are 4 named households. A finished house becomes a household's home. At dusk its members walk home and go inside, and the others walk to the camp. The panels show names, households, and homes.
- **Play it.** Build two houses and watch who moves in and where everyone goes at dusk.
- **Proof.** A clip of a dusk with two homes and two households at the camp, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 3.3 Settlers eat, go hungry, and starve

- **Behavior.** The camp starts with 24 food. Each settler eats once a day from its household's store, households carry food home from the camp, and a settler that misses three meals in a row dies. The interface shows the food totals and says who is hungry and who died. When nobody is left, the game says so.
- **Play it.** Do nothing and watch the settlement run out of food. The stage has no food source yet, so this pull request can only be lost.
- **Proof.** A clip from the last meal to the first death at 8×, a screenshot of a hungry settler's panel, the day on which each settler died on seed 7, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 3.4 Assign foragers to a hut

- **Behavior.** You place a forager's hut, the settlers build it, and two of them become foragers. They pick food in the forest around the hut and carry it to the camp. In the hut's panel you set how many places are filled. In winter the foragers find nothing.
- **Also in this pull request.** Buildings become one table with a kind. Villagers with a job stop taking orders to the land.
- **Play it.** Keep 8 settlers fed from spring to autumn, and see what happens in winter.
- **Proof.** A clip of two foragers through one day while the food total rises, the food gathered by one forager in a spring day on seed 7, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 3.5 Store food in a barn

- **Behavior.** You place a barn, and the settlers build it. Foragers and settlers without a job carry food to the nearest store with room, and households fetch their food from the nearest one. Food left on the ground is gone at the second dawn. The barn's panel shows what it holds.
- **Play it.** Put a barn beside the hut and the houses, and compare with a barn far away.
- **Proof.** A clip of food moving from the forest into a barn and from the barn into a house, a screenshot of food on the ground before and after it is gone, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 3.6 Hunt deer

- **Behavior.** Deer wander the map and run from settlers. You place a hunter's lodge, and two hunters stalk and shoot deer and carry the food home. Deer walk in from the map edge over time, and hunting works in winter.
- **Play it.** Bring all 8 settlers through the first winter.
- **Proof.** A clip of one hunt from the stalk to the food in the barn, a clip of deer running from a settler, the result of a first year on seed 7 with a fixed set of commands (food in store at each season's end and settlers alive after the winter), and the benchmark output.
- **Worker.** Claude Code on the default model.

## How the owner plays it

Each pull request is playable when it merges. In the checkout of `main`:

1. `git pull`
2. Once: `git clone git@github.com:ramtinJ95/survive-n-conquest-assets.git game-assets`. Later: `git -C game-assets pull`.
3. `bun install`, then `bun run dev`, and open the address it prints.

At 8× a day takes 38 seconds and a year 7.5 minutes. What the owner says after playing becomes a fix pull request or a changed proposal in this brief.

## What the stage decides

- Whether one meal a day and death at the third missed meal give enough warning and enough fear.
- Whether 8 settlers can store the 24 food of a winter and still build. The target on seed 7 is that a player who builds one hut, one barn, and one lodge in the first spring brings all 8 through the winter, and that a player who builds no food source loses the first settlers at dusk on day 6, in late summer, when the 24 food of the camp are eaten and three meals are missed. Pull request 3.6 measures both with fixed commands. A miss changes the proposals, not the measurement.
- Whether setting the filled places of a workplace is enough control over who works where.
- Whether households that fetch their own food make the place of a barn matter.
- The tick time with 1,500 villagers that eat, forage, and hunt, against the 4 ms limit, and the largest tick at dusk and at dawn.

## What the stage leaves out

- Farming, which is stage 6.
- Warmth, firewood, clothing, and hides, which are stage 4.
- Births, children, aging, and death of old age, which are stage 5.
- Bows, arrows, and stone tools as goods.
- Cooking, food kinds, and any effect of diet.
- Fishing, and animals that attack.
- Bodies, graves, and grief.
- Moving a household by hand, and choosing which villager takes a job.
- Saving and loading.
- Any tuning of the look.
