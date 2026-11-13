# Window

Opening the game shows the map from above. The view fills the browser window and fills it again when the window changes size.

## Sub-features

- `window-open` shows the map on first load.
- `window-fill` sizes the world to the full window with no scroll bars or margins.
- `window-resize` refills the window after it changes size.

## How to get to it (user POV)

- Run `bun run dev` and open the printed URL.
- Open the URL of a production build served by `vite preview`.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run window`, which runs doctor itself.

- **Open the game.** Load the page at 1280 by 720. The scenario runs `open(WIDE, { record: true })`, which pauses the clock at noon, and `still(page)`. The check `world fills 1280x720` passes, and `window-1280x720.png` shows the map.
- **See the map.** The check `the map fills the 1280x720 window` reads the screenshot and passes when plants cover at least 30% of it.
- **Shrink the window.** Resize the viewport to 960 by 600. The checks `world fills 960x600` and `the map fills the 960x600 window` pass, and `window-960x600.png` shows the same place at the new size.
- **Restore the window.** Resize back to 1280 by 720. `window-resize.gif` shows both resizes. The clip starts at noon, after the clock has paused, and is 640 pixels wide at 5 frames per second.
- **Proof.** Run `$V run window`. The evidence folder holds two screenshots, one GIF, and `result.json` with every check, including `no page errors`.

## Gotchas

- The plant check counts green pixels at the default seed and the default camera, at noon in spring. A change to the default seed, the first camera view, the palette, or the light can move it. See the gotchas in [Terrain](./terrain.md).
- The recorded video keeps the first viewport size. During the 960 by 600 step, the GIF shows the page in the top-left corner with an empty border. That border is the recording, not the game.
- SwiftShader renders slowly. Wait with `still`, never with a fixed sleep alone.
