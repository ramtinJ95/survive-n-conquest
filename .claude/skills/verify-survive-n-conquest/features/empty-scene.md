# Empty scene

Opening the game shows a lit green ground under a pale blue sky. The view fills the browser window and fills it again when the window changes size. Nothing moves and nothing responds to input yet.

## Sub-features

- `scene-open` shows the sky and the lit ground on first load.
- `scene-fill` sizes the world to the full window with no scroll bars or margins.
- `scene-resize` refills the window after it changes size.

## How to get to it (user POV)

- Run `bun run dev` and open the printed URL.
- Open the URL of a production build served by `vite preview`.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run empty-scene`, which runs doctor itself.

- **Open the game.** Load the page at 1280 by 720. The scenario runs `open(wide, { record: true })`. The check `world fills 1280x720` passes, and `empty-scene-1280x720.png` shows sky above and ground below.
- **See the scene.** Read the pixels at the top and bottom edges of the screenshot. The checks `sky fills the top edge` and `lit ground fills the bottom edge` pass. The sky pixel is close to `159,201,232`, and the ground pixel is neither sky-colored nor dark.
- **Shrink the window.** Resize the viewport to 960 by 600. The check `world fills 960x600` passes, and `empty-scene-960x600.png` shows the same scene at the new size.
- **Restore the window.** Resize back to 1280 by 720. `empty-scene-resize.gif` shows both resizes.
- **Proof.** Run `$V run empty-scene`. The evidence folder holds two screenshots, one GIF, and `result.json` with every check, including `no page errors`.

## Gotchas

- The sky check compares against the sky color in `src/render/world.ts`. Update `SKY_RGB` in `verify.mjs` when the sky color changes on purpose, and say so in the pull request.
- Lighting by the clock will change the sky and the ground over a day. Once the clock exists, pin the time of day before you read pixels.
- The recorded video keeps the first viewport size. During the 960 by 600 step, the GIF shows the page in the top-left corner with an empty border. That border is the recording, not the game.
- SwiftShader renders slowly. Wait for frames with `settle`, never with a fixed sleep alone.
