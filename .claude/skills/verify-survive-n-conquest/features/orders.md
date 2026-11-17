# Orders to the land

The player tells the land what should happen on it. A toolbar at the right edge offers Chop, Quarry, Stockpile, House, Forager's hut, Barn, Hunter's lodge, Woodshed, Tailor's hut, and Cancel. The Forager's hut, Hunter's lodge, Woodshed, and Tailor's hut tools work as House does on 2 by 2 tiles and the Barn tool on 3 by 3, and [Foraging](./foraging.md), [Storing](./storing.md), [Hunting](./hunting.md), [Firewood](./firewood.md), and [Clothing](./clothing.md) prove them. With Chop, Quarry, Stockpile, or Cancel active, a drag with the main button outlines a rectangle of tiles and, on release, marks the trees in it for felling, marks its rock for quarrying, adds its open ground to the stockpile zone, or removes those marks and every unfinished house site it touches. With House active, a see-through house stands on the 3 by 3 tiles under the pointer, green when it fits and red when it does not, and the status line under the clock says why. A click places the site. Marks show on the map in the color of their tool, by day and by night, in every season. Chopped trees carry an amber pin. Settlers act on Chop and Quarry marks, as [Gathering](./gathering.md) says.

## Sub-features

- `orders-tools` picks a tool by its button, by its key (`C` Chop, `M` Quarry, `P` Stockpile, `H` House, `G` Forager's hut, `B` Barn, `L` Hunter's lodge, `K` Woodshed, `T` Tailor's hut, `Delete` or `Backspace` Cancel), or from the keyboard. The toolbar is one stop in the Tab order, the arrow keys, Home, and End move between its tools without moving the camera, and Enter picks one. Escape or a second press puts it away.
- `orders-drag` outlines the dragged rectangle on the tile grid and counts the tiles it would change before the release.
- `orders-chop` marks exactly the forest tiles that draw a tree.
- `orders-quarry` marks rock tiles.
- `orders-stockpile` adds open ground to the zone, never under the camp's disc or a site.
- `orders-house` previews a site before it is placed and refuses one that does not fit, with the reason.
- `orders-cancel` removes marks, stockpile tiles, and unfinished sites.
- `orders-camera` keeps the right or middle drag, the wheel, and the keys on the camera while a tool is active. A main-button drag pans only with no tool.
- `orders-readable` keeps every mark and the placement preview readable at the near, opening, and farthest views, at noon and at midnight, in spring and in winter.
- `orders-layout` keeps the toolbar, the status line, the clock, and the camera controls apart at 1280 by 720, 960 by 600, and 960 by 540, with the date on one line.

## How to get to it (user POV)

- Open the game. Press a tool's key or click its button in the toolbar at the right edge.
- Drag over the map with the main button, or move the pointer and click with House.
- Press Escape to put the tool away.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run orders`, which runs doctor itself.
- Every page opens on seed 7 at its opening view, paused at noon. The clip page and the layout page open with the settlers. The page that reads every mark opens with `swarm=off`, because it runs the clock to midnight and to winter, and settlers would fell the marked trees and quarry the marked rock on the way.

- **Use each tool.** A recorded page at 960 by 540 zooms in by one wheel step and uses Chop, Quarry, Stockpile, House, and Cancel by their keys. The checks read the status line after each order, such as `a Chop drag marks trees`, and count the pure order colors in a screenshot, such as `marked trees show pins and outlines`. `a main-button drag with a tool marks instead of moving the camera` compares the view outside the dragged rectangle, the toolbar, and the status line. `a refused house changes nothing on the map` compares the view before and after a refused click. One GIF per tool: `orders-chop.gif`, `orders-quarry.gif`, `orders-stockpile.gif`, `orders-house.gif`, and `orders-cancel.gif`.
- **Read every mark.** A second page at 1280 by 720 places one of each order, hovers a house over the stockpile's edge, and takes the near, opening, and farthest views at spring noon, spring midnight, winter noon, and winter midnight. Each `every kind of mark reads ...` check counts the pure color of each kind, and the green or red of the preview, which follows the tile under the resting pointer as the view zooms. At each stop it also hovers a house over rock and over forest, and `a refused house reads over rock, ...` and `... over forest, ...` count its red. Over rock the outline needs 60 pixels and read 104 to 155. Over the forest it needs 50: the crowns cover part of the outline and sway with the tick, and it read 57 at the spring midnight and 110 to 123 at the other three stops.
- **Keep the camera.** The same page checks that a right-drag still turns the camera with House active, that Escape and a second click put a tool away, that the toolbar is one Tab stop, that ArrowDown moves from Chop to Quarry and leaves the camera alone, that Enter picks Quarry, and that a main-button drag with no tool pans.
- **Fit the panels.** The checks `the toolbar, status line, clock, and camera controls fit apart at ...` compare the boxes of the four panels, and `the date stays on one line at ...` compares the date's height with the time's, on a third page at 960 by 600 and then 960 by 540.
- **Proof.** Run `$V run orders`. The evidence folder holds the five GIFs, `orders-marks-<season>-<time>-<zoom>.png`, `orders-refused-<rock|forest>-<season>-<time>.png`, `orders-960x600.png`, `orders-960x540.png`, and `result.json`.

## Gotchas

- An order covers a rectangle of tiles, not of screen pixels. The camera opens turned by 0.55 radians, so a drag from the top left to the bottom right of the screen covers a long thin strip of tiles. The drags in `ORDER_SPOTS` and `CLIP_SPOTS` run mostly down the screen, which spans a square of tiles. They were found by projecting the corners of chosen tile rectangles through the game's camera rig. A new map or camera start needs new spots.
- The toolbar's buttons wear the order colors, so the counts leave out the toolbar's box.
- The counts look for the pure colors that only the outlines, the pins, and the ghost's edges draw, because nothing lights or fogs those. The fills are mixed with the ground and do not count.
- The toolbar's chop orange and cancel raspberry are chosen so that `unitPixels` counts neither as a villager or a monster. The `swarm` and `daylight` scenarios count unit colors over the whole screen, toolbar included.
- Every extra Tab stop delays the clock scenario's walk to the Pause button, which allows 6 presses. Keep the toolbar one stop.
- The settlers walk while the clock runs. Keep the page paused for every comparison.
- With the settlers, a running clock removes marks: a felled tree loses its pin and a spent rock tile its outline. Open with `swarm=off` any page that runs the clock and counts marks.
- A drag preview and the status line update when the worker answers. Wait for the status text before you take a screenshot.
