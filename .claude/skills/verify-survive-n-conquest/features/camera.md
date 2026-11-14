# Camera

The player flies a camera over the map. The camera looks at a point on the ground. The player moves that point, turns and tilts around it, and zooms toward it. The point never leaves the map, and the camera never goes under the ground.

## Sub-features

- `camera-pan` moves the view with `W` `A` `S` `D`, the arrow keys, or a drag with the main mouse button.
- `camera-turn` turns the view with `Q` and `E`, or a sideways drag with the right or middle button.
- `camera-tilt` tilts the view with `R` and `F`, or an up-and-down drag with the right or middle button.
- `camera-zoom` zooms with `Z` and `X`, or the mouse wheel.
- `camera-bounds` stops a pan at the map edge and stops a zoom at the nearest and farthest views.
- `camera-ground` keeps the camera above the ground at the lowest view.
- `camera-hint` lists the controls and the seed in a panel in the bottom-left corner.

## How to get to it (user POV)

- Open the game. The camera starts above the map center.
- Press and hold a key, drag on the map, or turn the wheel. Keys work while the page has focus.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run camera`, which runs doctor itself.

- **Fly over the map.** A recorded page at 960 by 540, paused in the morning light of the 08:00 start, pans with `D`, pans with a drag, turns with `Q`, turns and tilts with a right-drag, zooms in with the wheel, and zooms out with `X`. `camera-flight.gif` shows the flight. The check `camera-flight.gif stays under 8 MB` passes.
- **Try each control.** A second page, loaded with `?swarm=off` and paused at noon, uses `hold`, `drag`, and `page.mouse.wheel` for one control at a time and takes a screenshot after each. The checks `a held D key pans`, `a drag pans`, `a held Q key turns`, `a right-drag turns and tilts`, `a held F key tilts`, `a held Z key zooms`, and `the wheel zooms` pass when the view changed.
- **Zoom out to the limit.** Hold `X` for 4 seconds, then zoom out more with the wheel and the key. The check `zooming out stops at the farthest view` passes when the second screenshot matches the first. The check `the sky shows around the map at the farthest view` passes when at least 5% of that screenshot has the sky color.
- **Pan to the edge.** Hold `W` for 4 seconds. The check `the camera reaches the map edge` passes. The view then slides along the edge. Hold `W` in legs of 2.5 seconds until two screenshots in a row match. The checks `panning stops in a corner of the map` and `the map stays in view at its corner` pass.
- **Fly low.** Hold `Z` and then `F` to reach the nearest and lowest view at the corner. The check `zooming in and tilting stop at the lowest view` passes. Then open a fresh page, which starts at the map centre, reach the lowest view the same way, and fly four legs of `S` for 0.4 seconds and `Q` for 0.5 seconds. Each check `the ground fills the lower view on low flight <leg>` passes when at least 90% of the bottom 40% of the screenshot is not sky.
  - The check catches a camera under the ground, which sees the sky through it. At the map's edge the camera sees past the cut edge instead, so every piece of ground in the bottom 40% must stay inside the map at any frame rate.
  - How far the look-at point moves. The map is 256 meters across, and the look-at point stays within 127 meters of the centre on each axis. At the nearest view of 22 meters a held key pans 0.9 × 22 = 19.8 meters for each second of step. The game caps a frame's step at 0.1 seconds and never steps more than the time that passed. So a held key moves the point at most for the time it is held, plus 0.1 seconds for the frame that spans the release. The bound allows another 0.1 seconds for the key events to arrive late. A machine that delays them more breaks this bound. Four legs of 0.4 seconds move the point at most 4 × 0.6 × 19.8 = 47.5 meters from the centre.
  - How far the lower view reaches. At the lowest tilt of 0.45 radians the camera is 19.8 meters behind the point and 9.6 meters above it. The game keeps the ground at sea level or above, and seed 7 rises to 18.7 meters, so the camera is at most 28.3 meters above the lowest ground. A ray through the bottom 40% of a 45° view at 16 by 9 then meets the ground at most 49.6 meters from the point. All ground that the check reads therefore lies within 97.1 meters of the centre, 30 meters inside the edge.
  - Until this change the legs held `S` for 2.5 seconds from the corner where the pan stops, and how far they flew depended on the frame rate. On rj-firebat flight four reached the edge in one run of three. From the centre, legs of 0.8 seconds could already show ground 128.8 meters out, past the edge, so the legs are 0.4 seconds. They sample less ground than before, about 8 meters a leg at full speed and 3 meters on rj-firebat.
- **Proof.** Run `$V run camera`. The evidence folder holds `camera-flight.gif`, numbered screenshots from `camera-01-start.png` on, and `result.json`.

## Gotchas

- A camera under the ground sees the sky through it, because the ground has no underside. The low-flight checks rely on that.
- At the lowest view the far ground fades into the sky color. Read only the bottom 40% of the screenshot for ground.
- The sky color changes with the time of day and the season. `SKY_RGB` is the sky of a spring noon. The low-flight checks would pass on any ground if the sky had another color, so the farthest view checks that the sky is found at all.
- Playwright names keys by code, such as `KeyW`. The game reads `event.code`, so the keys do not depend on the keyboard layout.
- The camera eases toward its goal. Wait with `still` after every action before you take a screenshot.
- SwiftShader runs at a low frame rate, and the game caps each frame's step at 0.1 seconds. A held key therefore moves the camera less far than on real hardware. Hold times in the limit steps are long on purpose.
- Keep `swarm=off` on the page for the checks. At 1280 by 720, SwiftShader takes about 270 ms for a frame of the bare map and about 400 ms for a frame with the 4500 units and their shadows. At 400 ms the held keys stop short of the nearest view, and the limit checks fail for a reason that has nothing to do with the camera. The clip keeps the units, because no check reads it. [Swarm](./swarm.md) shows the units from a camera that moves.
- A pan against the map edge does not stop at once. The view slides along the edge until it reaches a corner. Compare screenshots only after the view rests in the corner.
- The clip records in real time, and every frame of a flight differs from the last, so the GIF grows fast. Keep the flight under about 8 seconds. `finishClip` lowers the GIF width and its color count step by step, from 960 pixels and 256 colors, until the file is under 8 MB.
