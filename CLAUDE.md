# survive-n-conquest

A colony-survival and base-building game. TypeScript, Three.js, Bun, Vite, Vitest.

The agreed design is in `docs/design.md`. Each stage has a brief in `docs/design/`. Read both before you build.

## Workflow

- `main` is protected. Never push to it. Every change lands through a pull request.
- Pull requests are squash-merged and the merged branch is deleted automatically.
- PR titles are conventional commits, because the squash commit takes the PR title.
- Claude Code sessions follow pstack poteto-mode and the skills it routes to. The orchestrator loads the skill in each Claude Code worker with `/pstack:poteto-mode`. A Claude Code session that did not receive that command reads `skills/poteto-mode/SKILL.md` in the installed pstack plugin in full before it starts. Pi workers cannot load pstack and are exempt.

## Stages and pull requests

- The milestone is a list of stages. A stage is three to six pull requests.
- A pull request adds one behavior that a person can watch work. One clip proves it. A review takes about fifteen minutes.
- Each stage opens with a brief in `docs/design/stage-<n>-<name>.md`. The brief states the rules, the numbers, and the pull requests of the stage. No code for a stage starts before the owner accepts its brief.
- Each stage ends with a demo summary that collects every clip from the stage.

## Who does the work

- One orchestrator session runs the program. It writes briefs, starts workers, and checks what they produce. It does not write game code.
- Each pull request has one Claude Code worker in a Nexus pylon, started by the orchestrator with `nexus start --claude`. The worker is the only writer of its branch.
- A worker in a pylon runs on `claude-opus-5-5` at high effort. A stage brief calls this the default model. Fable is not available in a pylon, so design and visuals work in a pylon also runs on `claude-opus-5-5`, and its pull request says so.
- Design and visuals work that the orchestrator runs on the owner's machine runs on `claude-fable-5-2` at high effort. That is work whose main purpose is how the game looks: models, materials, lighting, animation, and the look of the world and the interface. Pass the model when you spawn the worker.
- After you spawn a Claude Code worker, read its status line and confirm that it runs on the right model.
- Before the pull request opens, the worker has a shepherdr reviewer from a different model family check the diff, as the pylon's `PYLON.md` says. After it opens, the project's Nexus review loop reviews it and runs `.nexus/check`. The worker resolves the findings of both.

## Instructions to workers

- Every instruction that an orchestrator sends to a Claude Code worker starts with `/pstack:poteto-mode` on its own first line. The task follows on the next lines. This rule covers the first instruction and every later one.
- Shepherdr types a message that starts with a slash command into the worker's terminal and does not watch the worker. Call `watch` on the worker after you send the message, or its report never arrives.
- Pi workers do not have pstack. Give them plain instructions.

## Building in a pylon

- `.nexus/setup` runs once when a pylon is made. It installs ffmpeg and Debian's Chromium headless shell from apt, bun from npm at the version CI pins, the packages from `bun.lock`, and the ffmpeg build that Playwright records video with.
- `.nexus/resume` runs on every wake and installs again only when `bun.lock` or `package.json` changed.
- `.nexus/check` is the check a pull request must pass. It installs if needed, then runs `bun run typecheck`, `bun run test`, and `bun run build`, and exits nonzero if any of them fails.
- The verification skill runs in the pylon, in headless Chromium.

## Pushing and opening the pull request

- The worker pushes its branch through `origin`.
- The worker uploads its captures to the `pr-media` branch under `pr-<number>/`.
- The worker opens the pull request itself, ready for review. The body has the sections Why, What changed, Scope, Blast Radius, and Verification, with the media embedded by raw URL.
- The GitHub MCP is the fallback for small text-only changes.

## What merges without the owner

A pull request merges without the owner when all three hold.

1. The automated checks pass.
2. The reviewer's findings are resolved.
3. The orchestrator has checked the clips and screenshots against the goal the pull request states.

Two kinds of pull request always wait for the owner.

- A stage brief.
- A change to a decision in `docs/design.md`.

Feedback after a merge becomes a fix pull request with before and after captures.

Remind the owner about `/pr-diary` once per stage, when the stage ends. This replaces the reminder on every pull request. Never run `/pr-diary` yourself.

## Proof in every pull request

A PR is ready only when its body proves that the thing it set out to build works, in a form a reader can check without running anything.

- **Features:** screenshots or a clip of the behaviour running in the built game, plus the output of the tests or commands that cover it.
- **Bug and visual fixes:** the before and after states, as screenshots and clips, captured from the same scene, seed and camera.
- **In the body itself:** media is embedded in the PR description, not left behind a link. Clips are GIFs so they play inline.
- **Honest gaps:** say what was not verified.

Proof comes from the project's verification skill, generated with pstack `create-verification-skill` and kept honest with `maintain-verification-skill`. That skill owns launching the game, driving it the way a player would, and capturing the evidence. Until it exists, creating it is part of the first PR.

Capture files are pushed to the `pr-media` branch under `pr-<number>/` and embedded by raw URL, so they never land on `main`.

## Performance rules

- The per-tick simulation loop allocates nothing. Use the fixed-capacity tables and reuse scratch buffers.
- The benchmark runs 1500 villagers and 3000 monsters. A pull request that touches the simulation reports the tick time against the limit in the stage brief.
- The 4 ms limit in the stage briefs is defined on the owner's machine. A pull request built in a pylon reports the pylon's numbers and says they are pylon numbers.

## Assets

Purchased or licensed source assets go in `assets-source/`, which is ignored. Never commit them: this repository is public and their licences forbid redistribution.
