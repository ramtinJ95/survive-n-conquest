# Clock and speed controls

A panel at the top center of the window, clear of the camera controls at the bottom left, shows the time of day, the date, and the speed controls. The simulation runs in a Web Worker at 10 ticks per second at 1×. A day is 3000 ticks, so a day lasts 300 seconds at 1× and the time of day moves about 4.8 game minutes each real second. The player pauses the game and runs it at 1×, 2×, 4×, or 8×.

## Sub-features

- `clock-time` shows the time of day as `HH:MM` and advances it while the game runs.
- `clock-date` shows `Day <n> · <Early|Mid|Late> <Spring|Summer|Autumn|Winter> · Year <n>`. The game opens on `Day 1 · Early Spring · Year 1` at `00:00`.
- `clock-speed` runs the clock at 1×, 2×, 4×, or 8×, where each step doubles the rate.
- `clock-pause` holds the clock. Resuming keeps the speed that was chosen before the pause.
- `clock-keys` drives the same controls from the keyboard. Space toggles the pause. The keys 1, 2, 3, and 4 choose 1×, 2×, 4×, and 8×. Tab reaches each button, and Enter or Space presses the focused button. None of these keys moves the camera, and no camera key changes the clock.
- `clock-layout` keeps the clock panel inside the window and apart from the camera controls.

## How to get to it (user POV)

- Open the game. The clock runs at 1× from the first frame. The `seed` URL parameter changes the map and also seeds the simulation.
- Press the buttons in the `Game speed` group. The `Pause` button toggles. The `Speed N×` buttons choose a speed and resume a paused game.
- Press Space or the keys 1 to 4 anywhere on the page.
- To reach a chosen time, run at 8× and pause when the time of day or the date reads the target. At 8×, a game hour passes in about 1.6 seconds, a day in 37.5 seconds, a season in 1 minute 52 seconds, and a year in 7 minutes 30 seconds. Midnight of `Early Winter` on day 10 is 9 days in, which takes about 5 minutes 38 seconds at 8×.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run clock`, which runs doctor itself.

- **Open the game.** Load the page at 1280 by 720 with recording on and `clock: 'running'`. The check `opens on the first day of spring` passes, and `pressed: Speed 1×` shows that 1× is the selected speed. The check `the clock and the camera controls fit apart at 1280x720` compares the two panels' boxes.
- **Watch 1×.** Wait 4 seconds. The check `1× runs 4.8 game minutes per second` reads the date and the time before and after and passes within 25%. `clock-1x.png` shows the panel.
- **Choose 2× with the pointer.** Click `Speed 2×`. The checks `pressed: Speed 2×` and `2× by pointer runs 9.6 game minutes per second` pass.
- **Choose 4× and 8× with keys.** Press 3, then 4. The checks for `4× by the 3 key` and `8× by the 4 key` pass at 19.2 and 38.4 game minutes per second.
- **Pause with Space.** Press Space. The check `pressed: Pause and Speed 8×` passes, and `pause by Space runs 0 game minutes per second` sees the time hold for 2.5 seconds. `clock-paused.png` shows the dimmed time and the held 8× button, and `nothing on screen moves while paused` compares it with `clock-paused-later.png`.
- **Fly while paused.** Hold W for 0.6 seconds. `the W key still moves the camera while paused` passes, and `the camera keys leave the clock alone` sees the same time and the same pressed buttons.
- **Resume from the keyboard.** Press Tab until `Pause` has focus, then press Enter. The clock runs at 8× again.
- **See the date turn.** Wait for the date to read `Day 2`. The check `the date turns to the second day at 8×` passes on `Day 2 · Mid Spring · Year 1`. Click `Pause`, and `clock-day-2.png` shows the paused second day.
- **Check the small window.** Open a fresh page at 960 by 600, which pauses the clock. `the clock and the camera controls fit apart at 960x600` passes, and `clock-960x600.png` shows both panels.
- **Proof.** Run `$V run clock`. The evidence folder holds `clock-speeds.gif`, six screenshots, and `result.json` with every check, including `clock-speeds.gif stays under 8 MB` and `no page errors`.

## Gotchas

- Locate the panel by role and name. The date is the `status` named `Date`. The time is the `timer` named `Time of day`. The buttons sit in the `group` named `Game speed`. The speed button names use the multiplication sign `×`, not the letter x.
- Read the time from the page and never assume a time from the wall clock. The worker paces by real time, and the page lags it by up to one frame. Rate checks allow 25%.
- A button keeps focus after Tab, so Space then presses that button instead of toggling the pause. A pointer press never takes focus.
- A paused game shows two pressed buttons, `Pause` and the speed it resumes at.
- The buttons show the state that the worker reports, not the input. Read a pressed state only after it settles. The scenario polls for up to 2 seconds before it records the check or starts a rate measurement.
- The clip runs about 55 seconds, because a day takes 37.5 seconds even at 8×.
- `still(page)` never returns while the clock runs. Use it only while paused.
- Click the buttons with `page.mouse.click` at the center of their box, not with `locator.click`. A locator click waits for the button to hold still across animation frames, and SwiftShader draws the terrain so slowly that the wait takes tens of seconds and can time out.
