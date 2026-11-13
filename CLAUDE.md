# survive-n-conquest

A colony-survival and base-building game. TypeScript, Three.js, Bun, Vite, Vitest.

The agreed design is in `docs/design.md`. Each stage has a brief in `docs/design/`. Read both before you build.

## Workflow

- `main` is protected. Never push to it. Every change lands through a pull request.
- Pull requests are squash-merged and the merged branch is deleted automatically.
- PR titles are conventional commits, because the squash commit takes the PR title.
- All PR work follows pstack poteto-mode and the skills it routes to. The skill cannot be invoked by the model. Read `skills/poteto-mode/SKILL.md` in the installed pstack plugin in full before you start, or have the orchestrator send `/pstack:poteto-mode` to the worker.

## Stages and pull requests

- The milestone is a list of stages. A stage is three to six pull requests.
- A pull request adds one behavior that a person can watch work. One clip proves it. A review takes about fifteen minutes.
- Each stage opens with a brief in `docs/design/stage-<n>-<name>.md`. The brief states the rules, the numbers, and the pull requests of the stage. No code for a stage starts before the owner accepts its brief.
- Each stage ends with a demo summary that collects every clip from the stage.

## Who does the work

- One orchestrator session runs the program. It writes briefs, starts workers, and checks what they produce. It does not write game code.
- Each pull request has one Claude Code worker, started through shepherdr in its own git worktree. The worker is the only writer of its branch.
- Graphics work runs on `claude-fable-5-2` at high effort. Graphics work means models, materials, lighting, animation, and the look of the interface. Pass the model when you spawn the worker.
- A reviewer that is not the author checks each diff before the pull request opens. Use a reviewer from a different model family.
- Pushing branches, opening pull requests, and uploading media go through a worker or the GitHub MCP.

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

## Assets

Purchased or licensed source assets go in `assets-source/`, which is ignored. Never commit them: this repository is public and their licences forbid redistribution.
