# Stage 2: villagers and physical goods

Stage 2 turns the map into a place where people work. At the end you start with a few settlers and nothing built. You mark trees and rock, the settlers gather logs and stone, carry them to a stockpile, and build a house with them.

The stage exists to settle how work reaches a villager and how goods exist in the world. Every later stage adds needs, jobs, and buildings on top of those two answers.

## Rules and numbers

These values come from `docs/design.md` or are new in this brief. New values are marked as proposals. A measurement or a playtest in this stage can replace a proposal.

| Value | Number | Source |
| --- | --- | --- |
| Starting settlers | 8 adults | Proposal. The design says a few settlers. |
| Camp | The walkable tile nearest the map center that a walk from the map edge reaches | Proposal. The design says you settle near the center. |
| Work hours | Dawn to dusk, from the simulation's night rule | Design |
| Villager speed | 1.5 tiles per second, loaded or not | Stage 1 |
| Thinking | An idle villager looks for work every 10 ticks, in 10 rotating groups | Proposal. The design says every few ticks, in rotating groups. |
| Load | A villager carries 1 unit of one good | Proposal |
| Tree | 20 seconds of work by one villager fells it and leaves 2 logs | Proposal |
| Rock | 20 seconds of work by one villager at a rock tile gives 1 stone. A rock tile holds 8 stone. | Proposal |
| Stack | A tile holds up to 8 units of one good, on the ground or in a stockpile | Proposal |
| House | 3 by 3 tiles, 12 logs and 6 stone, then 90 seconds of building work shared by up to 4 villagers | Proposal |
| Sites and houses | At most 256 on a map | Proposal |
| Tick time limit for the benchmark | 99th percentile under 4 ms on the owner's machine | Stage 1 |

Work times are at 1× speed and are stored as ticks. Work done on a tree, a rock tile, or a site stays on it when the worker leaves.

### Trees and rock

- The map records which forest tiles hold a tree. It uses the rule the renderer uses today, about one forest tile in six, so the forest looks the same. Chopping removes the tree and leaves the tile as forest floor.
- A villager chops from the tree's own tile.
- A villager quarries from a walkable tile that shares a side with the rock tile. A rock tile with no such neighbor cannot be worked until one of its neighbors is spent.
- A spent rock tile becomes bare ground that units walk on. Its height does not change.
- Open ground means a grass tile, a forest tile with no tree, or a spent rock tile. Sites and stockpiles go on open ground, so a settlement in a forest clears its own plot.
- One villager works a tree or a rock tile at a time. An outcrop has many tiles, so several villagers quarry it side by side.
- Trees do not grow back in this stage.

### How goods exist

- A good is a count on a tile, never a number in a global total. The interface adds up the stockpiles to show totals, and the simulation never reads that sum.
- A felled tree leaves its logs on its own tile. Quarried stone lands on the tile where the worker stands.
- A unit that cannot go on its tile, because the stack there is full or holds another good, lands on the nearest tile that can take it, counted in steps of a walk from the first tile. A villager can therefore always reach it. This rule covers every case where a good is put down.
- If no tile on that land has room, nothing is put down. A villager that carries a unit keeps it. A tree or a rock tile whose work is done yields nothing and stays ready until there is room.
- A stockpile zone is a set of open ground tiles with no site or house on them, and not the camp. Each of its tiles holds one stack. Goods already lying on a tile when it joins a zone become its stack.
- A house site holds the goods delivered to it on its own tiles. Building work starts when the last unit arrives.

### How work reaches a villager

Stage 2 has no workplaces, so jobs that belong to a building cannot exist yet. The player gives orders to the land, and any free villager carries them out. This is a proposal. Jobs that belong to a workplace arrive with the first workplace in stage 3.

- The player marks trees to chop and rock to quarry, marks a stockpile zone, and places a house.
- Every order is a simulation command, so the same seed and commands still produce the same state.
- An idle villager takes the nearest open task of the most urgent kind that has one, by straight-line distance. The kinds, most urgent first, are building work at a site that has all its materials, carrying a unit to a site that needs it, carrying a unit from the ground to a stockpile, and chopping or quarrying.
- A carrying task is one unit. It reserves that unit where it lies and one free place where it is going, so two villagers never walk for the same log or the same gap.
- A site takes its materials from the ground and from stockpiles, whichever unit is nearest. It counts each unit on its way against what it still needs, so no more units set out than the site lacks.
- A task belongs to one villager from the moment that villager takes it until it is done or given up.
- Every villager lives on the land connected to the camp, and no house may divide that land. A task that one villager cannot reach is therefore out of reach for all. It is set aside for everyone until the next dawn or until a rock tile is spent, whichever comes first.

### Placing and cancelling

- A house site needs nine open ground tiles with no goods, no stockpile, no other site or house, and not the camp. The highest and the lowest of the nine are at most 1.5 m apart.
- A house site is refused if it would divide the land. The test blocks its nine tiles together with the tiles of every other site and house, finished or not. If any tile outside them that has a walk to the camp now would lose it, the site is refused. Houses can therefore never wall in a villager, a good, or a task.
- Units walk across an unfinished site. A finished house blocks its nine tiles. A villager standing on them when the house is finished moves to the nearest walkable tile that has a walk to the camp.
- Cancel is a tool. Dragging it over the map removes the chop marks, quarry marks, and stockpile tiles inside the rectangle, and removes any unfinished site it touches.
- Goods on a removed stockpile tile or a removed site stay where they lie as goods on the ground. Building work done on a removed site is lost. A finished house cannot be cancelled.
- A villager whose task was removed gives it up at once and puts down what it carries.
- An order that the rules refuse changes nothing, and the interface says why.

### Day and night

- At dusk a villager stops at once, gives up its task, puts down what it carries, and walks to the camp.
- Villagers stay at the camp until dawn. A villager with no walk to the camp stays where it stands.
- At dawn every task is open again.

## Structure the stage sets up

- The worker owns the map from this stage on, because chopping and quarrying change it. The main thread still generates the map and sends a copy in the start message. After that the worker sends every change, and the main thread applies it to its copy and to the terrain and the trees.
- Trees, marks, goods on the ground, and stockpiles are tile state, in arrays the size of the map. Sites and houses are one fixed-capacity table.
- Villager routes go around water, rock, and houses. Routes to common destinations such as the camp, a stockpile, or a site are cached, as the design says. Routes stay correct when a tile changes between walkable and not, and the benchmark's tick times include that cost.
- The game opens with the settlers. The stage 1 swarm of 1500 villagers and 3000 monsters stays available behind a URL setting and stays the load of `bun run bench`.
- From pull request 2.3 on, the benchmark's 1500 villagers run every task system that has landed so far, on a map with enough marks, stockpiles, and sites that the work does not run out during the measured ticks. The benchmark reports the work completed in the measured ticks and the share of villagers that held a task, so a run of idle villagers cannot pass as proof.

## Pull requests

2.1 and 2.2 can run at the same time. The rest go in order, because each one builds on the one before. Every pull request that touches the simulation reports the benchmark output.

### 2.1 Start with settlers at a camp

- **Behavior.** The game opens with 8 settlers at a camp near the center of the map. By day they wander near the camp. At dusk they walk back to it and stay until dawn. They walk around water and rock.
- **Also in this pull request.** The stage 1 swarm moves behind a URL setting. The worker owns the map and has a channel for tile changes, which nothing uses yet.
- **Proof.** A clip of the settlers through one dusk and one dawn, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 2.2 Give orders to the land

- **Behavior.** A toolbar offers Chop, Quarry, Stockpile, House, and Cancel. You drag a rectangle to mark trees, rock, or a stockpile zone, and you place a house on the tile grid. Marks show on the map. A house that does not fit its site shows that before you place it. Cancel removes marks and sites.
- **Also in this pull request.** A drag pans the camera only when no tool is active. The orders are simulation commands. No villager acts on them yet.
- **Proof.** A clip of each tool in use, a screenshot of a map with every kind of mark, and the benchmark output.
- **Worker.** Claude Code on Fable 5.2, because the pull request sets the look of the game's interface.

### 2.3 Chop trees and quarry rock

- **Behavior.** Villagers walk to marked trees and rock and work them. A felled tree disappears and leaves logs on the ground. Quarried rock leaves stone, and a rock tile is spent after 8 and opens to walking.
- **Also in this pull request.** The task system that the next two pull requests extend. The map records the trees. The benchmark villagers chop and quarry.
- **Proof.** A clip of a marked grove being cleared and a marked rock face being quarried until a tile is spent, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 2.4 Carry goods to a stockpile

- **Behavior.** Villagers pick up logs and stone from the ground, one unit at a time, and stack them in the stockpile zone. The interface shows the total of each good in stockpiles.
- **Also in this pull request.** The benchmark villagers carry what they gather.
- **Proof.** A clip of goods moving from a cleared grove into a stockpile while the totals rise, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 2.5 Build a house

- **Behavior.** Villagers carry 12 logs and 6 stone to a placed house, from the ground and from stockpiles, then build it. The site shows what has arrived and how far the work is. The finished house stands on its nine tiles and villagers walk around it.
- **Also in this pull request.** The benchmark villagers build.
- **Proof.** A clip from an empty site to a finished house, the time 8 settlers needed for it, and the benchmark output.
- **Worker.** Claude Code on the default model.

### 2.6 Give the settlement its look

- **Behavior.** The settlers, the camp, the logs and stone on the ground, the stockpile, the site, and the house get shapes, colors, and motion that read at a glance from the far and the near camera, by day and by night. A villager carrying a good shows it.
- **Proof.** Before and after screenshots from the same scene, seed, and camera, and a clip of a working settlement at dusk.
- **Worker.** Claude Code on Fable 5.2.

## What the stage decides

- Whether orders to the land, with the nearest free villager, are enough until workplaces arrive.
- Whether a load of 1 and the work times above suit the first house. The target is that 8 settlers finish it within two spring days when the trees and the rock are within 40 tiles of the site. Gathering takes at least 240 seconds of work and building 90, before any walking. Pull request 2.5 measures the real time on seed 7 and records the layout it measured as the commands of a test: the house tile, the stockpile tiles, and the marked tiles. A miss changes the proposals, not the measurement.
- The tick time with 1500 villagers running the task systems, against the 4 ms limit.

## What the stage leaves out

- Jobs that belong to a workplace, and assigning a villager to a job.
- Selecting a villager and reading its state.
- Households, homes, and any use of the finished house.
- Food, warmth, and every other need.
- Stone tools. Settlers work with their hands at one rate.
- Trees that grow back.
- Fog of war.
- Saving and loading.
- Real models. Every shape is a primitive built in code.
