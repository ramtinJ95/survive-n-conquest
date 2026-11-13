# Stage 1: foundation

Stage 1 builds what every later stage depends on. At the end you can open the game, fly a camera over a seeded map, watch days and seasons pass, and see 1500 villagers and 3000 monsters move at full speed. Nothing in the world has behavior yet.

The stage exists to test the two largest technical risks before any game rule depends on them. The first risk is the performance budget. The second risk is whether a pull request can prove its own work with captures.

## Rules and numbers

These values come from `docs/design.md` or are new in this brief. New values are marked as proposals. A measurement in this stage can replace a proposal.

| Value | Number | Source |
| --- | --- | --- |
| Simulation tick | 10 ticks per second at 1× | Proposal |
| Day and night cycle | 3000 ticks | Design |
| Season | 3 days | Design |
| Night share | 30% summer, 40% spring and autumn, 55% winter | Design |
| Speeds | pause, 1×, 2×, 4×, 8× | Design |
| Tile | About one meter. A villager walks 1.5 tiles per second. | Proposal |
| Default map size | 256 by 256 tiles. The setting goes up to 512. | Proposal |
| Benchmark load | 1500 villagers and 3000 monsters | Design |
| Tick time limit for the benchmark | 99th percentile under 4 ms on the owner's machine | Proposal |

The 8× speed runs 80 ticks per second, which leaves 12.5 ms for each tick. The benchmark units only move, so they must use far less than that. The 4 ms limit leaves the rest for the behavior that later stages add.

## Structure the stage sets up

- `src/sim/` holds the simulation. It imports nothing from the renderer or the browser. It runs in a Web Worker in the game and directly in tests.
- Each kind of entity is a table of typed arrays with a fixed capacity and stable ids. A system is a function that runs over the tables.
- The simulation takes a seed and a list of commands. The same seed and commands produce the same state.
- `src/render/` draws the world with Three.js from buffers that the simulation hands over.
- `src/ui/` holds the interface as HTML and CSS over the canvas.

## Pull requests

The first pull request goes alone. The second and third can run at the same time after it merges.

### 1.1 Scaffold the app and the verification skill

- **Behavior.** `bun run dev` opens an empty lit 3D scene in the browser.
- **Also in this pull request.** Type checks, tests, and a build run on every pull request. The verification skill launches the game in a headless browser, drives it, and saves screenshots and GIF clips.
- **Proof.** A screenshot of the scene that the skill captured, and a passing check run.
- **Worker.** Claude Code on the default model.

### 1.2 Draw a seeded terrain with a free camera

- **Behavior.** The map has hills, water, forest, and rock outcrops, generated from a seed. You pan, rotate, and zoom the camera.
- **Proof.** A clip of the camera moving over the map, and screenshots of two different seeds.
- **Worker.** Claude Code on Fable 5.2, because the pull request sets the look of the world.

### 1.3 Run the clock in a worker

- **Behavior.** The simulation runs in a Web Worker on a fixed tick. The interface shows the day, the season, and the year. You pause the game and change its speed.
- **Proof.** A clip of the date advancing at each speed, and a test that two runs from one seed produce the same state.
- **Worker.** Claude Code on the default model.

### 1.4 Light the world by the clock

- **Behavior.** The sun rises and sets. Winter nights are longer than summer nights. The terrain changes with the season.
- **Proof.** A clip of one full day at 8×, and one screenshot of each season at noon and at midnight.
- **Worker.** Claude Code on Fable 5.2.

### 1.5 Benchmark 1500 villagers and 3000 monsters

- **Behavior.** Villagers walk between random points. Monsters follow one flow field to the center of the map. Each group is one instanced draw call.
- **Also in this pull request.** `bun run bench` runs the simulation without a browser and reports the median and the 99th percentile tick time, and the heap growth across the measured ticks.
- **Proof.** The benchmark output on the 256 map and on the 512 map, and a clip of the swarm.
- **Worker.** Claude Code on the default model.

## What the stage decides

- The benchmark on the 512 map decides whether the full map size holds.
- A measured tick time replaces the 4 ms proposal.
- The frame rate with 4500 units on screen is measured in a real browser on the owner's machine. A headless browser does not use the same graphics hardware, so its frame rate proves nothing.

## What the stage leaves out

- Villager needs, jobs, goods, and buildings.
- Monster behavior beyond movement.
- Fog of war.
- Saving and loading.
- Real models. Every shape is a primitive built in code.
