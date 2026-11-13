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

- **Fly over the map.** A recorded page at 960 by 540 pans with `D`, pans with a drag, turns with `Q`, turns and tilts with a right-drag, zooms in with the wheel, and zooms out with `X`. `camera-flight.gif` shows the flight. The check `camera-flight.gif stays under 8 MB` passes.
- **Try each control.** A second page uses `hold`, `drag`, and `page.mouse.wheel` for one control at a time and takes a screenshot after each. The checks `a held D key pans`, `a drag pans`, `a held Q key turns`, `a right-drag turns and tilts`, `a held F key tilts`, `a held Z key zooms`, and `the wheel zooms` pass when the view changed.
- **Zoom out to the limit.** Hold `X` for 4 seconds, then zoom out more with the wheel and the key. The check `zooming out stops at the farthest view` passes when the second screenshot matches the first.
- **Pan to the edge.** Hold `W` for 4 seconds. The check `the camera reaches the map edge` passes. The view then slides along the edge. Hold `W` in legs of 2.5 seconds until two screenshots in a row match. The checks `panning stops in a corner of the map` and `the map stays in view at its corner` pass.
- **Fly low.** Hold `Z` and then `F` to reach the nearest and lowest view. The check `zooming in and tilting stop at the lowest view` passes. Then fly four legs with `S` and `Q`. Each check `the ground fills the lower view on low flight <leg>` passes when at least 90% of the bottom 40% of the screenshot is not sky.
- **Proof.** Run `$V run camera`. The evidence folder holds `camera-flight.gif`, numbered screenshots from `camera-01-start.png` on, and `result.json`.

## Gotchas

- A camera under the ground sees the sky through it, because the ground has no underside. The low-flight checks rely on that.
- At the lowest view the far ground fades into the sky color. Read only the bottom 40% of the screenshot for ground.
- Playwright names keys by code, such as `KeyW`. The game reads `event.code`, so the keys do not depend on the keyboard layout.
- The camera eases toward its goal. Wait with `still` after every action before you take a screenshot.
- SwiftShader runs at a low frame rate, and the game caps each frame's step at 0.1 seconds. A held key therefore moves the camera less far than on real hardware. Hold times in the limit steps are long on purpose.
- A pan against the map edge does not stop at once. The view slides along the edge until it reaches a corner. Compare screenshots only after the view rests in the corner.
- The clip records in real time, and every frame of a flight differs from the last, so the GIF grows fast. Keep the flight under about 8 seconds. `finishClip` lowers the GIF width and its color count step by step, from 960 pixels and 256 colors, until the file is under 8 MB.
