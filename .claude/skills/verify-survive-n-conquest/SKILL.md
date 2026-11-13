---
name: verify-survive-n-conquest
description: Launch the survive-n-conquest browser game from a production build, drive it in headless Chromium the way a player would, and capture screenshots, GIF clips, and pixel checks as pull request proof. Use when a change to the game needs evidence that it works, or when you need to see the running game.
---

# Verify survive-n-conquest

The game is a Three.js scene in a browser page. The world is a full-window canvas with the id `world`. The interface is HTML over that canvas, located by ARIA role and accessible name. The clock panel at the top holds the time of day, the date, and the `Game speed` controls. The camera controls panel sits at the bottom left. The `seed` URL parameter chooses the map.

Every command below runs from the root of the checkout under test. `scripts/verify.mjs` is the only harness, and it resolves Playwright from that checkout's `node_modules`.

```sh
V=.claude/skills/verify-survive-n-conquest/scripts/verify.mjs
```

## Prerequisites

- `bun install` has run in the checkout.
- `bun` and `ffmpeg` are on `PATH`.
- Playwright's headless Chromium is installed once per machine. Run `node_modules/.bin/playwright install chromium-headless-shell`. It downloads from `cdn.playwright.dev` into `~/Library/Caches/ms-playwright` on macOS.

## Launch

The one-shot path builds, serves, checks, drives one scenario, and stops, all in one process. Use it by default.

```sh
$V run terrain --port 4173
```

To drive several scenarios against one instance, launch it, drive, and stop it yourself.

```sh
$V launch --port 4173
$V drive terrain
$V drive camera
$V stop
```

`launch` runs `bun run build`, then starts `vite preview` on `127.0.0.1:<port>` with `--strictPort`. It prints `ready at http://127.0.0.1:<port>/` only when the server returns this checkout's `dist/index.html`. It records the instance in `.verify/state/instance.json`, and `vite preview` writes its output to `.verify/state/preview.log`. The proof is of the production build, not of the dev server.

Pick a free port for each checkout. Two worktrees can run side by side on different ports. `--strictPort` makes a taken port fail loudly instead of drifting to the next one.

## Doctor

```sh
$V doctor
```

Doctor is read-only. It checks that an instance is recorded, that the port serves this build, that this shell can signal the preview process, that the build revision matches the checkout, that `ffmpeg` runs, and that headless Chromium launches with WebGL2. It prints the WebGL renderer string. Run it first whenever anything looks off, and fix every `FAIL` before you trust a capture.

## Drive

`drive <scenario>` opens the recorded instance in headless Chromium and runs one scenario from the `SCENARIOS` table in `scripts/verify.mjs`. The feature map in `features/` says what each scenario proves and how a player reaches the feature. Read `features/README.md` before you drive.

To cover a new feature, add a scenario to `SCENARIOS` and a feature file to `features/`. A scenario gets a session with these helpers.

- `open(viewport, { record, search, clock })` opens the game at a viewport size, optionally recording video, and waits for the first frames and the clock. `search` is a query string such as `'?seed=7'`. By default it presses Space to pause the clock, as a player would, so the screen comes to rest. Pass `clock: 'running'` to leave the clock running.
- `settle(page)` waits for `canvas#world` and two animation frames.
- `still(page)` waits until two screenshots 250 ms apart are identical. Use it after every action, because the camera eases into place. It never returns while the clock runs, because the time of day changes several times a second.
- `hold(page, key, ms)` holds a key, and `drag(page, from, to, button)` drags the mouse.
- `screenshot(page, label)` saves `<label>.png`.
- `finishClip(context, page, label)` closes the page, converts its video to `<label>.gif`, and checks that the GIF is under 8 MB.
- `expectFillsViewport(page, viewport)` checks the size of the world.
- `expectChanged(name, before, after)` and `expectUnchanged(name, before, after)` compare two screenshots.
- `expectSurfaces(name, png, minimums, rows)` checks the share of sky, water, plants, rock, or ground in a screenshot.
- `check(name, ok, detail)` records any other check.

Drive the game through the page, as a player does: viewport changes, pointer, and keyboard. Do not call into the game's modules or add test-only hooks to prove a behavior.

## Evidence

Each drive writes to `.verify/evidence/<UTC timestamp>-<scenario>/`, which git ignores. The folder holds the screenshots, the GIF clips, and `result.json` with the scenario, the URL, the build revision, the browser version, every check with its detail, and the captured files.

- Capture the action and the resulting state, not only the final screen. A clip shows the change happening.
- A check that reads pixels from a screenshot proves what the player sees. Report its detail line next to the image.
- Report every `FAIL` line. A failed check is a finding, not a reason to loosen the check.
- Headless Chromium renders WebGL through SwiftShader on the CPU. Its frame rate says nothing about the game's frame rate. Never report it as performance.
- PR media goes to the `pr-media` branch under `pr-<number>/`. Copy it from the evidence folder, and never commit `.verify/` itself.

## Cleanup

```sh
$V stop
```

`stop` signals only the process recorded in `.verify/state/instance.json`, and only while that port still serves this build. If the recorded process still runs but the port does not serve this build, `stop` keeps the record and refuses, because it cannot prove the process is its own. Otherwise it removes `.verify/state/` and keeps `.verify/evidence/`. It never kills by process name. `run` calls it in a `finally` block, so a failed scenario still tears down.

## Sandboxes

A sandboxed shell often cannot see or signal a process that an earlier command started. In that case doctor reports `preview pid can be stopped from this shell: ... denied`, and `stop` refuses with the exact `kill <pid>` to run outside the sandbox. Use `run`, which keeps the whole lifecycle in one process, to avoid stranding a server.
