# Frames

The game draws a working settlement and the swarm of 1500 villagers and 3000 monsters at a frame rate a player does not notice. This scenario measures the work of a frame on a real GPU. It is the only scenario that does: every other one draws on the CPU, and its frame rate says nothing about the game.

## Sub-features

- `frames-settlement` times the frames of a settlement at work, with a house site half supplied.
- `frames-swarm` times the frames of the swarm.

## How to get to it (user POV)

- Open the game in a browser on a machine with a GPU. Mark work, place a house, and run the clock at 1×.
- Open the game with `?swarm=on` and let the clock run.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run frames`, which runs doctor itself.
- The machine has a GPU that Chromium can draw on, as the owner's Mac has. `launchGpuBrowser` launches Playwright's own Chromium, headless first and in a window second. When that Chromium is not installed, as in a pylon, which has no GPU and cannot install it, `drive frames` prints `frames: did not run, and counts no failure` with the reason, writes no evidence, and exits with status 0. When it is installed but both launches draw on the CPU, the drive fails as before, because on the owner's Mac that is a broken GPU, not a missing one.
- No sweep drives it: `$V list` leaves it out. Run it by name on the owner's Mac. Until the owner does, the game's real frame rate is unmeasured, and a pull request built in a pylon says so.
- The browser runs with no cap on its frame rate, and without the frame pacer of the other scenarios.

- **Time the settlement.** The page opens on seed 7 at 960 by 540, makes the marks and places the house of the `building` scenario, and steps the paused clock 5 game minutes at a time, as `building` does, until the site holds some but not all of each good. It then runs at 1× and takes `FRAME_SAMPLES.count` samples of `FRAME_SAMPLES.ms` each.
  - `the settlement at work: frames are drawn and timed` prints the median and the range of the work of a frame in milliseconds and of the frames a second, and the draw calls and the triangles of a frame.
- **Time the swarm.** A second page opens with `?swarm=on`, takes `BUILD_VIEW`, and is sampled the same way.
  - `the swarm: frames are drawn and timed` prints the same numbers.
- **Proof.** Run `$V run frames`. The evidence folder holds `result.json` with both lines and the WebGL renderer that drew the frames. The scenario takes no screenshot.
- **Compare two builds.** Launch each build on its own port, and drive `frames` against them in turn, three times or more. Compare the medians, and report the ranges with them.

## Gotchas

- The checks pass whenever frames are drawn. The numbers are the result, so read the detail lines.
- The work of a frame is the time of its callbacks plus `gl.finish()`, which waits for the GPU. The frames a second depend on how the browser hands out frames, and at this size the browser limits them, not the game.
- Other load on the machine moves the numbers. On the owner's Mac under load the samples of one drive of the settlement ranged from 0.36 to 1.23 ms, so one drive does not rank two builds.
- The numbers are those of a 960 by 540 window at a device pixel ratio of 1. A full screen on a Retina display draws many times the pixels, and this scenario does not measure it.
- A frame that sends no draw call is not timed.
