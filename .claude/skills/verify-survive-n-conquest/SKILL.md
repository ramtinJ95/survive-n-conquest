---
name: verify-survive-n-conquest
description: Launch the survive-n-conquest browser game from a production build, drive it in headless Chromium the way a player would, and capture screenshots, GIF clips, and pixel checks as pull request proof. Use when a change to the game needs evidence that it works, or when you need to see the running game.
---

# Verify survive-n-conquest

The game is a Three.js scene in a browser page. The world is a full-window canvas with the id `world`. The interface is HTML over that canvas, located by ARIA role and accessible name. The clock panel at the top holds the time of day, the date, and the `Game speed` controls. The sun, the sky, and the colors of the map follow that clock. The Stockpiles panel at the top left shows the logs, stone, and hides on stockpile tiles, the food in barns and at the camp as one total (`Barn and camp food`), the food in homes, the firewood in woodsheds and at the camp as one total (`Shed and camp firewood`), the firewood in homes (`Firewood in homes`), and the living settlers with a job and with none. A label over each unfinished site, with the role `status` and the name of its kind's site, `House site`, `Forager's hut site`, `Barn site`, `Hunter's lodge site`, `Woodshed site`, or `Tailor's hut site`, shows the units that have arrived of each good the building needs and the building work. The camera controls panel sits at the bottom left. With no tool active, a click selects a settler, a site, a house, a forager's hut, a barn, a hunter's lodge, a woodshed, a tailor's hut, or the camp, and a panel with the role `region` and the name `Selection` sits above the camera controls and reads what it is and what it does. The panels of the hut, the lodge, the woodshed, and the tailor's hut hold the `Fewer places` and `More places` buttons that set their filled places. Deer wander the map and run from settlers, and a click on a deer selects nothing. The `seed` URL parameter chooses the map. The game opens with 8 settlers at the camp near the map center. `swarm=on` opens it with the benchmark load instead: 1500 villagers who work every tree and rock tile on the map, all marked at the start, and 3000 monsters, and `swarm=off` opens it with no units. `deer=off` leaves the deer out, from the start and at every dawn, for pictures that a check compares across two pages or two days.

Every command below runs from the root of the checkout under test. `scripts/verify.mjs` is the only harness, and it resolves Playwright from that checkout's `node_modules`.

```sh
V=.claude/skills/verify-survive-n-conquest/scripts/verify.mjs
```

## Prerequisites

In a Nexus pylon, `.nexus/setup` installs all of these when the pylon is made, and `.nexus/resume` keeps the packages current on every wake.

- `bun install` has run in the checkout.
- The private assets repository is cloned at `game-assets/`, so the build serves `models.glb`. Without it the game draws stand-in shapes and says so, and doctor fails.
- `bun` and `ffmpeg` are on `PATH`.
- A headless Chromium is installed. In a pylon it is Debian's `chromium-headless-shell` package at `/usr/lib/chromium/chromium-headless-shell`, and `verify.mjs` launches that binary whenever it exists. A pylon cannot install Playwright's own Chromium, because it downloads from `storage.googleapis.com`, which the pylon's allowlist does not include. On a machine without the Debian package, run `node_modules/.bin/playwright install chromium-headless-shell`.
- Playwright's ffmpeg build is installed, because Playwright records video with it. Run `node_modules/.bin/playwright install ffmpeg`.

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

Doctor is read-only. It checks that an instance is recorded, that the port serves this build, that this shell can signal the preview process, that the build revision matches the checkout, that the build serves the models, that `ffmpeg` runs, and that headless Chromium launches with WebGL2. It prints the WebGL renderer string. Run it first whenever anything looks off, and fix every `FAIL` before you trust a capture.

## Drive

`drive <scenario>` opens the recorded instance in headless Chromium and runs one scenario from the `SCENARIOS` table in `scripts/verify.mjs`. The feature map in `features/` says what each scenario proves and how a player reaches the feature. Read `features/README.md` before you drive.

To cover a new feature, add a scenario to `SCENARIOS` and a feature file to `features/`. A scenario gets a session with these helpers.

- `open(viewport, { record, search, clock })` opens the game at a viewport size, optionally recording video, and waits for the first frames and the clock. `search` is a query string such as `'?seed=7'`. The light follows the clock, so `clock` decides what the page looks like. The default, `'noon'`, runs the clock to 12:00 on day 1 and pauses it there, so that every page shows the same spring noon. `'paused'` pauses at once, a few game minutes after the 08:00 start. `'running'` leaves the clock running. The result holds `since()`, the seconds since the page was created, which is also the time in its video.
- `gameMinutes(page)` reads the clock panel and returns the game minutes since 00:00 on day 1.
- `pause(page)` presses Space and waits for the `Pause` button to report that it is pressed.
- `reach(page, { day, time })` runs the clock to a day and an `HH:MM` time and leaves it paused there. It runs at 8×, slows to 1× half a game hour before the target, pauses, and then steps forward in short runs. It fails if the clock stops more than 2 game minutes past the target. A paused screenshot shows the same light on every run, give or take those 2 game minutes, so take any check that ties the picture to a time of day at a `reach` stop. Do not take it from screenshots of a running clock, because how many of those a game hour gets depends on the machine.
- `settle(page)` waits for `canvas#world` and two animation frames.
- `still(page)` waits until two screenshots, at least 250 ms and two drawn frames apart, are identical. Use it after every action, because the camera eases into place. It never returns while the clock runs, because the time of day and the light change several times a second.
- `hold(page, key, ms)` holds a key for `ms` of wall time, and `drag(page, from, to, button)` drags the mouse. The game caps each frame's step at 0.1 s, so on a slow machine a held key moves the camera less far than on a fast one.
- `screenshot(page, label)` waits for two drawn frames, then saves `<label>.png`.
- `finishClip(context, page, label, { from, width })` closes the page, converts its video to `<label>.gif`, and checks that the GIF is under 8 MB. `from` cuts the seconds before it, taken from `since()`, `width` caps the GIF's width, and `crop`, a box `{ x, y, width, height }` in page pixels, keeps only that part of the picture, `colors` caps the palette, and `speed` plays the clip that many times as fast as it was recorded, for a run too long to watch at its own pace. Say so wherever the clip is shown. `decimate` drops every frame that repeats the one before and shows each frame left once at 8 a second, so a paused stop passes in one frame and a run plays at the pace SwiftShader drew it, several times its own. With `decimate`, `speed` keeps one of every `speed` frames left. Say that too wherever the clip is shown. It steps the width and the colors down at 8 frames per second until the GIF fits, and drops to 4 frames per second only when no 8 fps step fits.
- `finishClips(context, page, cuts)` closes the page once and makes one GIF for each cut of its video, `{ label, from, to, width, crop, colors, speed, decimate }`, with the same steps and check as `finishClip`. `to` ends the cut, in the seconds of `since()`.
- `expectFillsViewport(page, viewport)` checks the size of the world.
- `expectChanged(name, before, after)` and `expectUnchanged(name, before, after)` compare two screenshots.
- `expectSurfaces(name, png, minimums, rows)` checks the share of sky, water, plants, rock, or ground in a screenshot. The colors it looks for are those of a spring noon.
- `expectShares(name, kinds, png, { atLeast, atMost }, rows)` checks the share of any set of pixel kinds, such as `SEASON_MARKS`, against lower and upper limits.
- `unitPixels(png)` counts the full-resolution pixels in villager yellow and in monster red, as they look in daylight.
- `drawsPerFrame(page)` returns the draw calls and the triangles that one frame sends to WebGL, the shadow pass included, as the mean of ten frames. An init script counts them inside the page, so the game needs no hook and an older build can be measured too.
- `orderPixels(png, width, skip)` counts the full-resolution pixels in the pure color of each order mark, `chop`, `quarry`, `stockpile`, `site`, `fits`, and `blocks`, in a screenshot `width` pixels wide, leaving out the box `skip`.
- `check(name, ok, detail)` records any other check.

Drive the game through the page, as a player does: viewport changes, pointer, and keyboard. Do not call into the game's modules or add test-only hooks to prove a behavior.

A scenario that clicks given tiles aims from a fixed view. `scripts/aim.ts` takes a seed, a view in the pixels of a wheel, a right drag, and a pan, and the tiles, and prints the pixel of each tile's center at that view on a 960 by 540 page and the tile the game's picker takes there. It runs the game's camera rig and picker under `bun`, outside the page, to find where to click. The scenario still clicks through the page.

## Evidence

Each drive writes to `.verify/evidence/<UTC timestamp>-<scenario>/`, which git ignores. The folder holds the screenshots, the GIF clips, and `result.json` with the scenario, the URL, the build revision, the browser version, every check with its detail, and the captured files.

- Capture the action and the resulting state, not only the final screen. A clip shows the change happening.
- A check that reads pixels from a screenshot proves what the player sees. Report its detail line next to the image.
- Report every `FAIL` line. A failed check is a finding, not a reason to loosen the check.
- Headless Chromium renders WebGL through SwiftShader on the CPU. Its frame rate says nothing about the game's frame rate. Never report it as performance.
- `drive frames` is the one scenario that measures frame time. It launches a browser that draws on the machine's GPU, and fails where none does, as in a pylon. `features/frames.md` says what it reports and how to compare two builds.
- PR media goes to the `pr-media` branch under `pr-<number>/`. Upload only the files the pull request body embeds. Copy a GIF from the evidence folder as it is. Upload a screenshot as a lossy WebP copy at quality 85, and keep the PNG in the evidence folder, where the pixel checks read it. Never commit `.verify/` itself. Add the files to the branch in a separate worktree, so the checkout under test keeps its branch.

```sh
git fetch origin pr-media
git worktree add ../pr-media origin/pr-media
mkdir -p ../pr-media/pr-<number>
cp .verify/evidence/<run>/<clip>.gif ../pr-media/pr-<number>/
ffmpeg -v error -i .verify/evidence/<run>/<shot>.png -c:v libwebp -quality 85 ../pr-media/pr-<number>/<shot>.webp
git -C ../pr-media add pr-<number>
git -C ../pr-media commit -m "media: pr-<number>"
git -C ../pr-media push origin HEAD:pr-media
```

Other workers push to `pr-media` too, and a stage's close rewrites it to a commit that shares no history with yours. If the push is refused because the branch moved, move only your upload commit onto the new tip and push again. A plain `pull --rebase` would replay the pruned history.

```sh
git -C ../pr-media fetch origin pr-media
git -C ../pr-media rebase --onto origin/pr-media HEAD~1
git -C ../pr-media push origin HEAD:pr-media
```

Remove the worktree once the push has gone through.

```sh
git worktree remove ../pr-media
```

Embed each file in the pull request body by its raw URL, `https://raw.githubusercontent.com/ramtinJ95/survive-n-conquest/pr-media/pr-<number>/<file>`.

### Closing a stage

A pull request's media stays on `pr-media` only until its stage closes. The stage's demo summary embeds only its demo set, from `pr-media` under `stage-<n>/`, and the set stays under 15 MB. Build the set with a normal push, like any other upload. To fit a clip into the budget, drop its repeated frames first, because SwiftShader draws fewer frames than the GIF holds. Shorten the clip only if that is not enough.

```sh
ffmpeg -v error -i <clip>.gif -vf "mpdecimate,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" -fps_mode vfr stage-<n>/<clip>.gif
```

Once the owner has accepted the demo summary, and only when the orchestrator orders it, `pr-media` is rewritten to one commit with no parent. It keeps everything at the tip except the closed stage's `pr-<number>/` folders. The lease ties the push to the tip you read, so it fails if another worker pushed in between. Then fetch and run the recipe again. Never use a plain `--force`, and never point this at `main`.

```sh
git fetch origin pr-media
old=$(git rev-parse origin/pr-media)
index=$(mktemp -u)
GIT_INDEX_FILE=$index git read-tree "$old"
GIT_INDEX_FILE=$index git rm -r -q --cached --ignore-unmatch pr-<a> pr-<b>
new=$(git commit-tree "$(GIT_INDEX_FILE=$index git write-tree)" -m "media: close stage <n>, pruned from $old")
rm "$index"
git push --force-with-lease=refs/heads/pr-media:"$old" origin "$new":refs/heads/pr-media
```

Report `$old`. GitHub keeps the pruned media reachable by that commit for a while.

## Cleanup

```sh
$V stop
```

`stop` signals only the process recorded in `.verify/state/instance.json`, and only while that port still serves this build. If the recorded process still runs but the port does not serve this build, `stop` keeps the record and refuses, because it cannot prove the process is its own. Otherwise it removes `.verify/state/` and keeps `.verify/evidence/`. It never kills by process name. `run` calls it in a `finally` block, so a failed scenario still tears down.

## Speed

SwiftShader renders every frame on the CPU, so a run's length depends on the machine, and its result must not. Run browser scenarios in a pylon with 6 CPUs and 8 GiB on rj-firebat, and run them one at a time, because two browsers slow each other down.

Headless Chromium starts the next animation frame before SwiftShader has drawn the last one, so about 30 frames wait in a queue and a screenshot waits behind all of them. At 1280 by 720 on rj-firebat a frame takes 220 to 300 ms to draw, and a screenshot of a paused page took 6.6 to 8.4 s. On a 2 CPU pylon a frame took about 1.8 s and a screenshot 29 to 67 s.

The camera scenario's held keys assume a frame of 220 to 400 ms, as on rj-firebat and on the owner's Mac. On a 2 CPU pylon a held key draws only one or two frames, so the camera stops short and its limit checks can fail for a reason that has nothing to do with the camera. The scenario reaches the nearest zoom with the wheel, which does not depend on the frame time: the world of pull request 2.6 has half again as many triangles, a frame takes longer, and 5 seconds of a held `Z` stopped short of the nearest view of 14 meters.

The scenarios take about 1.2 to 1.4 times as long as before that pull request. On the owner's Mac `camera` took 3 minutes 47 seconds against 2 minutes 38, and `hauling` 7 minutes 38 against 6 minutes 1.

## The frame pacer

Every page that `open` makes runs an init script, `paceFramesToTheGpu`, before the game loads. It replaces `requestAnimationFrame` and `cancelAnimationFrame`, and it wraps `getContext` to find each WebGL2 context. It runs the frame callbacks only once a fence shows that the GPU has drawn the frame before, as a real GPU makes the page wait. With it, a screenshot of a paused page on rj-firebat took 0.18 to 0.42 s, and frames take as long to draw as without it.

What it changes:

- The page starts frames at the rate SwiftShader draws them, not at the rate Chromium would start them.
- The game's frame callbacks receive Chromium's own timestamps, so its 0.1 s cap on a frame's step applies as it would without the pacer.
- On rj-firebat the page runs 3.4 to 4.0 frames a second with the pacer and 2.7 to 3.6 without it. The game's step is capped per frame, so a held key moves the camera somewhat farther with the pacer, and the camera flies a slightly different path.
- It runs all the callbacks of a frame in one go, so microtasks that one callback queues run after the others, not between them as in a browser. The game asks for one callback a frame, through `renderer.setAnimationLoop`.
- The page can change its HTML before the canvas draws the frame that matches it. With a frame of 250 ms, a screenshot taken at once can show the new clock beside the old light, so `screenshot` waits for two drawn frames first.

What it could hide:

- It cannot show how fast the game runs. That was already true of SwiftShader.
- A game that draws through a context the pacer does not find, such as an `OffscreenCanvas` in a worker, is not paced, and its screenshots slow down again.
- A bug that shows only when frames pile up, or that depends on how `requestAnimationFrame` hands out ids, does not show here.

A page whose game stops asking for frames, or loses or restores its WebGL context, does not hang. A fence of a lost context counts as drawn, so the game still gets its frames. `settle`, and so `screenshot` and `still`, fail when the page runs no frame for 60 s. They count frame callbacks, not pictures, so they do not prove that the game still draws. Only a check that compares screenshots proves that.

The clips record what the paced page draws, so a clip shows the frames a player would see, at SwiftShader's frame rate.

## Sandboxes

A sandboxed shell often cannot see or signal a process that an earlier command started. In that case doctor reports `preview pid can be stopped from this shell: ... denied`, and `stop` refuses with the exact `kill <pid>` to run outside the sandbox. Use `run`, which keeps the whole lifecycle in one process, to avoid stranding a server.
