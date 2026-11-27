# Stage 5: life cycle

Stage 5 makes the settlement's people change over the years. At the end a settler has an age, children are born into households that have a house, a child grows up and starts to work at ten, grown children form new households, and the old die. A settlement that is kept fed and warm grows, and one that is not ages into a shortage of workers.

The stage exists to settle three things that later stages build on: how a settler enters the game after the map starts, how a household holds more than its two founders and passes its house on, and how the number of working hands follows from what the player built years before. It is also the stage that gives the game a length beyond its first year. Until now every measurement ended at the first winter.

Stage 4 left one result open that this stage depends on. In the first years it measured on seed 7, no firewood is split and settlers freeze on day 12 (`docs/design/stage-4-demo.md`, "Left open for the owner"). The owner decided on 2026-11-23 to measure first whether a player's own order of commands survives the winter under today's rules, before any rule changes. The first report of that measurement, on the same day, found a year on seed 7 in which all 8 settlers come through fed and warm: four houses on the places nearest the camp, and the woodshed ordered only once no building site lacks a log. Its tables are not in the repository yet. Pull requests 5.1 to 5.4 do not depend on it. The measurement of many years in 5.5 starts from that year.

After the stage 5 summary, on 2026-11-25, the owner decided three fixes to this stage's rules, recorded below where each rule is stated: a newly paired household stays under its parents' roofs until a house is free (#59), a widowed settler can pair again (#61), and the food in a house nobody lives in comes back into reach (#58). The owner did not choose "Woodshed before sites", so the decision of 2026-11-23 stands, and no rule changes who takes a log.

The owner decided on 2026-11-15 that the look is not tuned further until the mechanics can be playtested. A child gets a plain shape built in code, and no pull request of this stage is a look pass.

## Rules and numbers

These values come from `docs/design.md`, from the briefs of stages 3 and 4, or are new in this brief. New values are marked as proposals. A measurement or a playtest in this stage can replace a proposal.

| Value | Number | Source |
| --- | --- | --- |
| Aging | 5 years of age in a game year. One year of age is 2.4 days, which is 12 minutes at 1× and 1.5 minutes at 8×. | Design |
| Starting settlers | 4 households of one man and one woman. Each settler's age is a whole number of years from 18 to 30, every age as likely as another, drawn by the seed. | Stage 3 for the households. The ages are a proposal. |
| A child | Under 10. A child does not work. | Design: a child starts work at age ten. |
| Start of work | At 10, which is 24 days or 2 game years after birth | Design |
| Grown | At 16, which is 38.4 days or 3.2 game years after birth. A grown settler can form a household. | Proposal |
| Bearing children | A woman from 16 until she is 40 | Proposal |
| A house | The home of one household, as today. No child is born into a house in which 5 people live. | Proposal. Three days of food for 5 is 15 of the house's 16. |
| A birth | At a dawn, in a household that qualifies, with a chance of 1 in 4. A household draws for no birth at its first 6 dawns, nor at the 6 dawns after a birth. | Proposal |
| A child's sex | A girl or a boy with the same chance, drawn by the seed | Proposal |
| Life span | A whole number of years from 60 to 80, every number as likely as another, drawn by the seed at birth | Proposal. The design says the old die. |
| A child's needs | 1 meal a day, as an adult. On a winter night a child is warm only in a house whose fire burns. | Proposal |
| Settlers alive | At most 1,500. No child is born while 1,500 live. | Design: the home city holds up to 1,500 villagers. |
| Rows in the villagers table | 4,096 on a played map. A row is never used twice, so this limits everyone who ever lives on the map, not the living. No child is born when the table is full. | Proposal |
| Households | At most 2,048 on a map, up from 1,024. A household's number is never used twice. | Proposal. Half the villagers' rows, so the households cannot run out first. |
| Tick time limit for the benchmark | 99th percentile under 4 ms on the owner's machine | Stage 1 |

A starting settler of 18 to 30 with a span of 60 to 80 years reaches its span 6 to 12.4 game years after the map starts. At 8× that is 45 to 93 minutes of play. A household that qualifies at every dawn has a child every 10 days on average: the 6 dawns it must wait, and a birth at the fourth draw.

### Age

- Every villager has a birth tick, and its age follows from the clock. The interface shows the age in whole years.
- A starting settler's birth tick lies before the map's first tick, so that it has its drawn age on day 1.
- Every villager has a life span, drawn by the seed when it is born or when the map starts.
- A villager dies of old age at the first dawn at which it has reached its life span, where it slept. One that reaches its span exactly at a dawn dies at that dawn. It is removed from the map as a starved villager is. Its household, its house, its place at a workplace, and its clothing follow the rules of stages 3 and 4.
- Age changes nothing else in this stage. An old settler works and walks as a young one does, until the dawn it dies.
- A villager's death has a cause that the game stores: hunger, cold, or old age. Today the interface and the benchmark each work the cause out from the missed meals and the cold nights, which cannot say old age.

### Couples and households

- A household has a couple: the man and the woman who formed it. The household stores both. The four starting households' couples are their two settlers.
- The members of a household are its couple, while they live, and their children who have not formed a household of their own. Nobody else joins a household in this stage.
- A settler whose partner has died stays in its household with its children and keeps its house. It does not pair again in this stage, and its household has no more births.
  - The owner decided on 2026-11-25 that a widowed settler can pair again, and #61 built it. A settler is single when it is 16 or older and has no living partner, and the kin rule and the order of a dawn are unchanged. The rest is the orchestrator's reading, as #61 built it. One who never had a partner and pairs with a widowed settler joins the widowed settler's household, which keeps its number, its house, and its children. Two widowed settlers who pair make one household of the lower number. The household waits more than 6 dawns from the pairing before a birth, as a new household does. (#61)
- A house is freed when the last member of its household dies or leaves it to form a household. The food and the firewood in it stay in it, as today.
  - The owner decided on 2026-11-25 that the food in a house nobody lives in comes back into reach, and #58 built it. A finished house that no household lives in is a source, as a barn is, for a household stocking its home, for the settlers without a job stocking a home in which nobody can carry, and for the camp. The rest is the orchestrator's reading, as #58 built it. The nearest source wins, and an equally near camp, barn, or woodshed comes first. Firewood leaves such a house the same way. Nothing is carried into it and nobody eats there, and a household that takes the house keeps what is left in it. (#58)
- A house without a household goes to the household with the lowest number that has none. That happens when the house is finished, when it is freed, and when a household forms while a house stands empty. Of several empty houses the household takes the one that was finished first.

### Births

- A household qualifies for a birth at a dawn when all of these hold:
  - It has a house, and fewer than 5 people live in it.
  - Both of its couple are alive, and the woman is 16 or older and younger than 40.
  - None of its members has a missed meal or a cold night, after the dawn's meals.
  - It has seen more than 6 dawns since it formed, and more than 6 since its last birth. The starting households see their first dawn on day 2, so their first child can come at the dawn of day 8.
- At each dawn at which it qualifies, the household has a child with a chance of 1 in 4. The draw comes from the seed, the household, and the dawn, so a map with the same commands has the same births.
- A household at the camp has no children. A house is therefore what lets a settlement grow, beside what it does for warmth.
- The child is a villager from its birth: a new row in the table, with a sex and a life span drawn by the seed, a name from the game's list that no living member of its household bears, its household, and the ids of both parents.
- A parent's id stays valid after the parent's death, because a row is never used twice. The design asks for this, so that family trees need no change to the data later.
- Pregnancy is left out. The mother works on the day of the birth as on every other day.

### Children

- A child lives in its household's house. By day it stays within 3 tiles of the house's door, and at dusk it goes inside with the household.
- A child does no work: it takes no order, fills no place at a workplace, carries nothing, and stocks nothing. It is counted as a child, not among the settlers with a job or without one.
- Eating is not work. A child eats 1 meal from the household's store at dusk, and a child with a missed meal eats at any hour once the store has food, by stage 3's rule.
- The household stocks its home for all its members, children too, by stage 3's rule of three days of food for each member.
- A child wears no clothing in this stage. On a winter night it is warm when it sleeps in a house whose fire burns, and it has a cold night in a house without a fire. It dies of its missed meals and its cold nights by the rules of stages 3 and 4.
- When a household has no living member of 10 or older, nobody in it can carry. The settlers without a job then stock its home with food and firewood, as they stock the camp by the rule of #29. Such homes come before the camp in a settler's order of stocking: food for each of them, the household with the lowest number first, then firewood for each of them in the same order, then the camp's food and the camp's firewood.
- A child is drawn smaller than an adult, so that the two differ at the game's usual zoom.
- At the dawn on which it is 10 a child starts to work. From then on it is a settler like any other: it takes orders to the land, fills an open place at a workplace when it is the nearest without a job, stocks its home, and fetches and wears clothing. It still lives with its household.

### New households

- A settler is single when it is 16 or older and has never had a partner.
  - Since 2026-11-25 a settler is single when it is 16 or older and has no living partner, as "Couples and households" records. (#61)
- Two single settlers can pair when one is a man and one a woman, neither is the other's parent, and they share no parent. No other tie of kin counts in this stage.
- At each dawn the game pairs single settlers. It goes through the single women from the oldest to the youngest, and by the lower id at the same age. Each takes the single man she can pair with who is nearest her in age, the older one when two are as near, and then the lower id. A woman with no such man stays single that dawn, and the next woman is tried.
- The two leave their parents' households and form a new household, of which they are the couple. The households of one dawn get their numbers in the order of the pairings.
- A new household takes an empty house at once when one stands. With none it lives at the camp until a house is finished or freed.
  - The owner decided on 2026-11-25 that a newly paired household stays under its parents' roofs until a house is free, and #59 built it. With no empty house, each of the two goes on living where it lived the day before, and a finished or freed house goes to the household with the lowest number that has none, as before. The rest is the orchestrator's reading, as #59 built it. One from its parents' house lodges there. It sleeps there, is warm by its fire, eats from its store, counts among its people for the 3 days of food and the limit of 5, and carries for it. One from the camp stays at the camp. A house is never freed under a lodger: when the last of its household dies or leaves, the lodger's household takes it at once. The settler's `Home` row reads `Parents' house`. (#59)
- A single settler stays in its parents' household until it pairs. It counts among the people of the house.
- The player does not choose who pairs with whom, and does not move households between houses, in this stage.

### The order of a dawn

Several of these rules act at a dawn, and their order changes who lives where and who is born. At each dawn the game does this, in this order:

1. The dawn of stages 3 and 4, as today: the meals of those who missed one.
2. Villagers who have reached their life span die, those who reach it at this dawn too.
3. Children who are 10 start to work.
4. Single settlers pair, and each new household takes an empty house if one stands.
5. Households that qualify draw for a birth.

### What the player reads

- A settler's panel shows its age, and for a child that it is a child and the age at which it starts to work. A settler born in the game shows its parents by name.
- A dead settler's panel says what it died of, old age too, and at what age.
- A household is read as its couple by name and its other members by count, such as `Ulvar and Ysa, 3 children`. The dead are counted and not named, such as `1 died`. Today the line names every dead member, and with one dead member it already overlapped the Stockpiles panel at 960 by 540. The pull request that changes the line moves the checks that read it and says so.
- A house's panel shows its household in the same form.
- The top-left panel says how many children the settlement has, beside the settlers with a job and without one.
- The news says, by name: who was born and to whom, who started to work, who formed a household, and who died of old age.
- The camp's panel shows the settlement's people as a whole: how many are children, how many work, how many are 50 or older, and the births and deaths of the year so far.
- The panels are tight at 960 by 540, and three fix pull requests of stage 4 dealt with boxes that overlapped. Every new reading goes into a row that exists where it reads well there, such as the age beside the sex. A pull request that adds a row or lengthens one measures every panel at the three window sizes with the checks that `readiness` and `selecting` hold.

## Structure the stage sets up

- The villagers table has a capacity above the number of villagers on the map and a count of the rows in use. Today its size is the starting count and nothing can be added. Everything that is sized by the villagers takes the capacity too: the hunters' columns, the animals' grid, the households, the frames the interface reads, and the renderer's instances. The interface counts the rows in use, so an unused row is never a settler.
- A birth is the one place where a villager is added after the map starts. A later stage that brings refugees adds them through the same place.
- A household's members are the villagers whose household column names it. Today a household is the two villagers whose ids follow from its number, and nothing can join or leave.
- A household is formed in one place, with its couple, its number, and its house.
- The age at which a villager works is one test that the tasks and the jobs both ask. Today no living villager is kept from work.
- A cause of death is a column on the villager, and the interface and the benchmark both read it.
- A draw that belongs to a household and a dawn, and not to one villager, has its own stream from the seed. Today every draw belongs to a villager, an animal, or a monster.
- The loops over villagers skip the dead, and rows are never used twice, so a long game carries its dead in the table. 5.1 measures the benchmark with 1,500 living villagers and 1,500 dead rows beside them, against the same run without the dead rows, and proposes how the dead leave the table with ids that stay valid, if they must.
- The benchmark exercises the stage. It starts as a settlement in its later years, not as 750 new couples: households that formed before the map's first tick, couples of every age with their children at home, single grown children who can pair, and settlers near the end of their span, 1,500 living in all. Its limit on the living is 1,600 in place of 1,500. Each pull request extends that start by what it adds, so that in the measured ticks children are born, children start to work, grown children pair, and the old die. It reports how many of each happened in the measured ticks, and a pull request whose own event did not happen there changes the start or the measured ticks until it does. The benchmark's check that 90% of the villagers are at work counts the living villagers of 10 or older, and the pull request that changes it gives the reading before and after.

## Pull requests

5.1 comes first and 5.2 follows it. 5.3 and 5.4 can run at the same time after 5.2. 5.5 comes last. Every pull request that touches the simulation reports the benchmark output. Every pull request ends in something the owner can try in the running game, named under "Play it".

No scenario can wait in a browser for a settler to grow old: at 8× the first death of old age is 45 minutes away. A pull request that must show a later year opens its scenario page with a setting that only a verification page takes, as `?clock=paused` is. The setting starts the map with settlers of stated ages, in stated households, with stated parents. A player's game is unchanged by it, and 5.1, which adds it, says so with a check. The long years themselves are measured in `src/sim` by a script, as stage 4's years were.

### 5.1 Settlers age and die of old age

- **Behavior.** Every settler has an age that rises as the years pass, and its panel shows it. A settler dies of old age at the first dawn at which it has reached its life span. The news names it, and its panel says what it died of and at what age.
- **Also in this pull request.** The table's capacity and its count of rows in use, the cause of death, the verification setting for ages, and the benchmark with the dead rows.
- **Play it.** Select a settler, read its age, run a year at 8×, and read it again.
- **Proof.** A clip of a settler's panel as its age turns over at the tick the rule gives, a clip of a page of old settlers on the dawn one of them dies, the age and the span of each of the 8 starting settlers on seed 7 with the dawn each span gives, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 5.2 Children are born into households

- **Behavior.** A household with a house, food, and warmth has a child at a dawn. The child has a name, a sex, and its parents, lives in the house, stays near its door by day, eats from the household's store, and needs a house with a fire on a winter night. The news says who was born and to whom, and the top-left panel counts the children. A household at the camp, a house of 5, a hungry or cold household, and a household whose woman is 40 have no child.
- **Also in this pull request.** The household's couple and its members by the household column, the household line by count, the test of who works, the household's own stream of draws, and the stocking of a home in which nobody can carry.
- **Play it.** Build a house in the first spring and wait for the first child, which can come from the dawn of day 8. Then let the household go hungry and see that no second child comes.
- **Proof.** A clip of the dawn of a birth with the news and the child at the door, a screenshot of the child's panel and of its house's panel, the day of each birth on seed 7 in two years with four houses, the same years with one household kept hungry, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 5.3 Children grow up and start to work

- **Behavior.** At the dawn on which a child is 10 it starts to work. It takes orders to the land, fills an open place at a workplace, stocks its home, and fetches clothing. The news says who started to work, and the top-left panel counts one child fewer and one settler more.
- **Play it.** Start a page of 9-year-olds, mark trees, and watch them join the work at their dawn.
- **Proof.** A clip of a child at its house's door on the day before and at a tree on the day after, the panel of the same settler on both days, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 5.4 Grown children form new households

- **Behavior.** A single man and a single woman of 16 or older, who are not parent and child and share no parent, form a household at a dawn. They leave their parents' houses, take an empty house or live at the camp, and move into the next house that is finished or freed. The news says who formed a household.
- **Play it.** Start a page with grown children in two houses, build a third house, and watch the new household move in.
- **Proof.** A clip from the dawn of a pairing to the new household's first dusk in its own house, the panels of both parents' houses before and after, the pairings of a page with six single settlers of stated ages and parents against the order the rule gives, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 5.5 Read the settlement's people

- **Behavior.** The camp's panel shows how many of the settlement are children, how many work, how many are 50 or older, and the births and deaths of the year so far.
- **Also in this pull request.** The stage's measurement of many years, described under "What the stage decides".
- **Play it.** Play five years at 8×, which takes 38 minutes, and read how the settlement's people changed.
- **Proof.** A clip of the camp's panel across a dawn with a birth, the tables of the measured years on seed 7, and the benchmark output.
- **Worker.** Claude Code on the default model.

## How the owner plays it

Each pull request is playable when it merges. In the checkout of `main`:

1. `git pull`
2. `git -C game-assets pull`
3. `bun install`, then `bun run dev`, and open the address it prints.

At 8× a day takes 38 seconds and a year 7.5 minutes. The first child can come at the dawn of day 8, which is a little over 4 minutes into a game at 8×. It starts to work 15 minutes after its birth and can form a household 24 minutes after it. What the owner says after playing becomes a fix pull request or a changed proposal in this brief.

## What the stage decides

- Whether a house is the right condition for a child, and whether 5 people in a house is the right brake on births.
- Whether a child that eats as an adult for two game years before it works is a cost a player feels and plans for.
- How fast a settlement grows. 5.5 measures 20 years on seed 7 in `src/sim`. The year starts from the first year the firewood measurement found. After it the script orders by one rule that it states in full and holds in its code: when each house, hut, lodge, woodshed, and tailor's hut is ordered, and where. It reports, at each year's end, the people by age band, the births, the deaths with their causes, the households with and without a house, the meals eaten of the meals due, and the food and firewood in store.
  - The orchestrator's estimate, which nothing has measured: a couple in a house has a child about every 10 days until 5 live there, so four couples have about 12 children by year 3, and none of those can form a household before year 3.2. The design's city of 1,500 in a first playthrough of 15 to 20 hours needs far faster growth than that, and also counts on refugees, which the first milestone leaves out. The cap of a house, the gap between births, and the ages are the numbers to move.
- Whether a settlement ages into a shortage of workers, as the design says it can. 5.5 runs the same 20 years with births switched off from year 3 on, by a switch that only the script has. It reports the workers and the mouths at each year's end, and the first year in which a settler misses a meal and the first in which one starves.
- Whether a widowed settler should pair again, which this brief leaves out, and whether pairing by the game is enough until marriage arrives as its own system.
- Whether the dead can stay in the villagers table. A settlement that grows toward the design's 1,500 fills 4,096 rows, and from then on no child is born. 5.1 gives the cost of the dead rows and proposes the way out.
- Whether 8× is fast enough to play through generations. The design gives the speeds as pause, 1×, 2×, 4×, and 8×, and a faster speed would be a change to it.
- The tick time with 1,500 villagers that are born, grow up, and die, against the 4 ms limit, and the largest tick at a dawn with births.

## What the stage leaves out

- Marriage as the player's choice, courtship, divorce, and a second pairing after a partner's death.
  - On 2026-11-25 the owner decided that a widowed settler can pair again, as "Couples and households" records. (#61)
- Adoption. Children whose parents died keep their house and are fed by the settlement.
- Pregnancy, death in childbirth, twins, and care that takes a parent from work.
- Clothing for children.
- Education and school.
- A view of the family tree. The stage stores the parents and shows them by name only.
- Old age that slows a settler, and settlers who stop working.
- Illness, which belongs to health in the second wave.
- Inheritance, graves, and bodies.
- Refugees and edicts, which arrive after the first milestone.
- The levy of adult men, which is stage 7.
- Farming, which is stage 6.
- Choosing which settler gets a job, a house, or clothing.
- Saving and loading.
- Any tuning of the look.
