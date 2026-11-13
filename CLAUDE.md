# survive-n-conquest

A colony-survival and base-building game. TypeScript, Three.js, Bun, Vite, Vitest.

## Workflow

- `main` is protected. Never push to it. Every change lands through a pull request.
- Pull requests are squash-merged and the merged branch is deleted automatically.
- PR titles are conventional commits, because the squash commit takes the PR title.
- All PR work follows pstack poteto-mode and the skills it routes to. The skill cannot be invoked by the model, so read `skills/poteto-mode/SKILL.md` in the installed pstack plugin in full before starting, and use `pstack:poteto-agent` for delegated work.

## Proof in every pull request

A PR is ready only when its body proves that the thing it set out to build works, in a form a reader can check without running anything.

- **Features:** screenshots or a clip of the behaviour running in the built game, plus the output of the tests or commands that cover it.
- **Bug and visual fixes:** the before and after states, as screenshots and clips, captured from the same scene, seed and camera.
- **In the body itself:** media is embedded in the PR description, not left behind a link. Clips are GIFs so they play inline.
- **Honest gaps:** say what was not verified.

Capture files are pushed to the `pr-media` branch under `pr-<number>/` and embedded by raw URL, so they never land on `main`.

## Assets

Purchased or licensed source assets go in `assets-source/`, which is ignored. Never commit them: this repository is public and their licences forbid redistribution.
