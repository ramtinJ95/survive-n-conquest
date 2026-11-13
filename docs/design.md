# Game design

survive-n-conquest is a single-player colony-survival and base-building game. You start with a few settlers and nothing built. You grow a hamlet into a city with a castle while a horde of monsters attacks at night. Then you learn that you live in a kingdom, pledge to a lord, and work your way up to the crown.

This document records the design decisions agreed on 2026-11-13. Every number is a starting point to playtest, not a final value. The last section lists assumptions that the owner has not confirmed.

## Pillars

- **The colony is the heart of the game.** Food, warmth, and labor decide what you can bring to a fight.
- **Combat is never second class.** A fight has its own depth. Preparation decides most of it, and the player still makes real decisions during it.
- **Every soldier is a villager.** A death in battle removes a worker and a parent.
- **Failure is harsh but recoverable.** The game ends only when nobody is left.
- **Nothing adjusts to how weak you are.** If you lose, the cause is what you built.

## Time

| Unit | Length at normal speed |
| --- | --- |
| Day and night cycle | 5 minutes |
| Season | 3 days, named Early, Mid, and Late |
| Year | 4 seasons, 12 days, 1 hour |

Night length follows the season.

| Season | Share of the cycle that is night | Night | Daylight |
| --- | --- | --- | --- |
| Summer | 30% | 1.5 min | 3.5 min |
| Spring and autumn | 40% | 2 min | 3 min |
| Winter | 55% | 2.75 min | 2.25 min |

- Outdoor work stops at dusk. Villagers go home and guards stay on duty.
- The speeds are pause, 1×, 2×, 4×, and 8×. You can give orders while the game is paused. The game drops to 1× when the alarm is raised.
- Villagers age five years for each game year. A child starts work at age ten.
- A first playthrough of phase 1 takes an estimated 15 to 20 hours.

## Villagers

- Each villager is an individual with an age, a sex, a household, a home, a job, and needs.
- Children are born into households, grow up, and die of old age. A village can age into a shortage of workers.
- Each villager stores the ids of both parents from birth, so family trees need no data migration later.
- Women and men both work. Only adult men are called to fight. War deaths therefore reduce births for a generation.
- The target is the full depth of a harsh colony sim. Education, marriage, family trees, and happiness arrive later as new data columns and systems.

## Economy

Goods exist physically. Every log and sack of grain sits in a stockpile, a barn, or a house. Workers carry goods between places. A workshop stops when its inputs have not arrived. Each household keeps its own store of food, firewood, and clothing.

Layout therefore decides outcomes. A village can hold enough food in total while one family starves at the far end of town. Monsters that burn a barn destroy the food inside it. Markets that redistribute goods arrive at the town tier.

Needs and goods enter the game in three waves.

**Core, in the first playable version**

- Food from foraging, hunting, and farmed crops. There is one food type and no diet effect.
- Warmth from a house, firewood split from logs, and clothing made from hides.
- Shelter, one home for each household.
- Stone tools such as axes, and hunting bows with stone-tipped arrows.
- Wooden spears, cheap and quick to make, so the village is never unarmed.
- Logs and stone.

**Second wave, during the rest of phase 1**

- Iron ore, a smith, and iron tools. Workers wear tools out, and work slows without them.
- Swords from the smith and war bows from a fletcher.
- Food processing. Grain becomes flour and then bread, which feeds more than the raw crop.
- Health, with a herbalist, disease, and a varied diet.
- Livestock. Sheep give wool. Horses must be bred in numbers, which makes cavalry a late-game project.
- Fishing.

**Later**

- Happiness, with ale and a chapel.
- Education.
- Trade and money, decided together with phase 2.

Tools and weapons come in material tiers. Wood and stone come first, and iron follows.

## Progression

- Production chains gate most things. Nothing says that cavalry is locked. You have no horses yet.
- Settlement tiers gate the few large steps. The tiers are hamlet, village, town, city, and castle seat.
- You advance a tier by upgrading the village hall. The game never promotes you automatically.
- A higher tier brings a stronger horde, so you choose when you are ready.
- There is no research tree.

## The horde

### Where monsters come from

- Monsters arrive without end from beyond the edge of the map. Your tier and the passage of time set the arrival rate. You can never fight the source.
- Arrivals gather in nests on the map. An assault consists of the monsters that are in the nest. The game never creates monsters to match your strength.
- Each tier has a band of horde strength. Within a band, strength rises over the years to a ceiling. A higher tier wakes more nests and tougher types.
- For the first seasons, only single strays wander in at night. The first forecast assault comes near the end of year one.
- Winter assaults are harder, and winter nights are the longest.

### Night and dawn

- Monsters attack at night and withdraw to their nests at dawn. Stragglers caught in daylight weaken and die.
- Every defense has the same goal, which is to hold until dawn.
- A horde too large to finish in one night returns the next night. Large assaults are sieges that last several nights.

### Forecast and scouting

- A forecast names the night, the direction, and the mix of an assault.
- The forecast is precise for a nest that a scout or watchtower can see. It is vague for a nest you have lost sight of.

### Raids

- You can march out by day and attack a nest. A thinned nest sends a smaller or later assault. A burned nest is gone for a long time.
- Arrivals do not slow down when a nest burns. They join the surviving nests or found a new nest, which you must scout to find.
- Dormant monsters wake when attacked, and you fight them without your walls. Nests get tougher as your tier rises.
- A raid must be home by dusk. Winter daylight makes that window short.
- Nests hold no loot.
- Raiding one nest does not provoke the others. Add that rule only if playtests show that raids make walls unnecessary.

### Monster types

| Monster | Appears at | Behavior | What it tests |
| --- | --- | --- | --- |
| Shambler | Hamlet | Slow, weak alone, arrives in masses | How much wall you can hold, and for how long |
| Runner | Village | Fast and fragile, goes around strongpoints, hunts people in the open | Gaps, open gates, anyone outside at dusk |
| Brute | Town | Slow and tough, breaks walls and gates | Concentrated fire and a reserve behind the wall |
| Climber | City | Scales walls, attacks archers and the streets behind | Defense in depth |

Every wave mixes the types unlocked so far. The first waves hold shamblers only.

## Combat

- Combat is real time with pause. You select squads and give them orders.
- Depth comes from positioning and fortification first, and from unit roles second. There are no active abilities.
- Composition and maneuver matter more in phase 2, against human armies.

### Units

| Unit | Needs | Job |
| --- | --- | --- |
| Spearman | Wood | Holds lines, gates, and gaps. Stops runners. |
| Archer | A bow. Hunters serve as the first archers. | Thins masses and brings down brutes from walls and towers. |
| Swordsman | Iron and a smith | Wins close fights in a breach, on the wall, and in a nest. |
| Cavalry | Horses bred in numbers | Runs down runners and reaches far nests. Late game. |

The equipment that the colony makes decides which units you can field.

### The levy and the standing core

- Most fighters are workers who take up arms when you ring the bell. They return to their old jobs when you dismiss the levy.
- A few professionals stand guard all year. They fight better than levies and are on duty at night.
- Each building has an exemption switch. One bell calls every eligible man from every building that is not exempt. To keep two of four smithies open in wartime, exempt two.
- Nobody moves into the emptied jobs unless you move them.
- Squads and formations exist from the first combat build.

## Fortification

- **Palisade.** An obstacle. Men fight at its gaps and gates.
- **Watchtowers and archer platforms.** Built into the palisade line. Each holds a few archers.
- **Stone walls, after the first tiers.** Archers and soldiers stand on top and fight climbers there.
- Walls and towers have positions to man. You order a squad to a section and the men take the positions. Units do not walk along the wall top.
- Men need time to reach their section, so the distance from the barracks to the wall matters.
- A gate is open to your own people and you can order it closed. A closed gate also locks out anyone still in the fields.
- Monsters can destroy walls. Laborers repair damaged sections by day with stockpiled materials. The cost is materials and labor, with no clicks on single sections.

## Map

- One continuous map, generated from a seed. The full size is about 512 by 512 tiles. Size is a setting, and the benchmark decides whether 512 holds.
- You settle near the center. Nests form in the outer ring. A walk from the center to the edge takes most of a summer day's daylight.
- A near nest can be raided in a day. A mid-distance nest takes the whole day and is out of reach in winter. A far nest needs cavalry or a night outside the walls.
- Fog of war has three states. Unexplored land is hidden. Explored land stays as you last saw it. Live information needs a scout or a watchtower in sight.
- Monsters enter from beyond the edges. In phase 2, armies and envoys enter there too.

## Failure and recovery

- The only game over is an empty village.
- Refugees from fallen villages and cities arrive when you have spare housing and food. You choose whether to take them in.
- Edicts are laws you enact in a crisis. One example allows multiple wives after most of the men have died. Edicts arrive after the first milestone.
- Kills are the only breathing room. A nest that lost monsters on your walls needs seasons to refill.
- You can save anywhere, and the game saves automatically each season.

## Scale and performance

The home city holds up to 1500 villagers. A late assault holds about 3000 monsters. The code must meet that budget from the first build.

- The simulation stores each kind of entity in a table of typed arrays, with stable ids. Systems are functions that run over the tables in a fixed order. There is no ECS library.
- The per-tick loop allocates nothing. Tables have fixed capacity and scratch buffers are reused.
- The simulation runs in a Web Worker and hands position buffers to the renderer.
- Villagers think every few ticks, in rotating groups.
- Monsters follow one flow field per target. Villager routes to common destinations are cached. Neighbor lookups use a spatial grid.
- The renderer draws each repeated thing as one instanced draw call, fed from the tables.
- A headless benchmark runs 1500 villagers and 3000 monsters. Every pull request checks the tick time against a limit.

## Technology

- TypeScript, Three.js, Bun, Vite, and Vitest, in the browser.
- The simulation is deterministic and has no rendering or browser dependencies. It runs on a 2D tile grid with a height map. The renderer draws it in 3D.
- The simulation holds no global state, so a second map is another instance.
- Models start as primitive shapes built in code. Low-poly asset packs replace them later.
- A rewrite in a systems language is likely later. The tables map closely onto structs, and the simulation can move alone to WebAssembly.

## Phase 2

The detail is deferred until phase 1 is fun to play. These decisions stand.

- The kingdom is a map of regions. The home city stays simulated person by person. Other lords are simulated as figures.
- An army that reaches you arrives at the edge of the home map as a real force.
- Human armies fight by day.
- You pledge to a lord and climb a feudal ladder to become king.
- Refugees flee other lords' wars.

Phase 1 code keeps three rules so that phase 2 is never blocked.

1. The simulation holds no global state.
2. Squads and formations are part of the first combat build.
3. A lord's demands are paid in goods and men. Whether money exists is decided with phase 2.

## First milestone: hamlet, year one

You start with nothing, bring a village through its first winter, and face the first forecast assault. The assault holds shamblers only.

The milestone has ten stages. Each stage is a set of small pull requests.

1. **Foundation.** Terrain, camera, clock, the simulation core, the benchmark, and the verification skill.
2. **Villagers and physical goods.** People gather logs and stone, carry them, and construct a building.
3. **Food.** Foraging, hunting, a barn, and households that eat from their own stores.
4. **Warmth.** Firewood, hide clothing, and a winter that can kill.
5. **Life cycle.** Households, births, aging, and death.
6. **Farming.** Planting, harvest, and loss to frost.
7. **First threat.** Night strays, shelter, wooden spears, the levy bell with exemptions, and withdrawal at dawn.
8. **Fortification and command.** Palisade and gates, squads with formations, and the standing core.
9. **The horde.** Nests, fog of war, scouting, the forecast, and the first assault.
10. **Raids.** Daytime raids on nests, watchtowers, and hunters who serve as archers.

The milestone leaves out the tiers above hamlet, the other three monster types, iron, livestock, health, edicts, refugees, and phase 2.

## Assumptions the owner has not confirmed

- The game is single-player only.
- A playthrough is one long campaign, not a series of short runs.
- Buildings snap to the tile grid.
- The look is low-poly and flat-shaded. Lighting carries the mood, with warm days, cold nights, and hearth and torch light.
- The camera rotates and zooms freely.
- The levy has no per-person override and no partial call-up levels.
- Wall repair is automatic.
- Edicts and refugees arrive after the first milestone.
- An optional mode with one save and no reloads can arrive later.
