# Selecting

With no order tool active, a click on a settler, a house, a house site, or the camp selects it. A ring in the interface's accent color over a dark edge marks the selected thing on the ground, keeps at least 12 pixels of radius at every zoom, and follows a settler that walks. A panel at the bottom left, above the camera controls, says what the selected thing is and what it is doing. A settler's panel is titled with its name and says what it does in words, what it carries, its sex, its household, and its home. A site's panel says what has arrived of each good, how far the building work is, and how many settlers build it. A house's panel says that it is a finished house and which household lives there. The camp's panel says how many settlers stand at the camp. The panel stays true while the clock runs and while it is paused. A site that is finished becomes a house in its panel, and a cancelled site clears the selection. A click near a settler, within 16 pixels of its body, selects the nearest settler. Over a house, a site, or the camp, a settler wins only within 4 pixels of its body, so a click on the camp between the settlers around the fire selects the camp. A drag still moves the camera and selects nothing. A click on bare ground, the panel's close button, or Escape clears the selection. A forager's hut's panel, its places control, and a forager's panel are proven by [Foraging](./foraging.md).

## Sub-features

- `selecting-settler` selects the settler nearest a click within 16 pixels of its body, and its panel reads `Doing`, `Carries`, `Sex`, `Household`, and `Home`. A settler inside its house cannot be picked.
- `selecting-follow` keeps the settler's panel and its mark up to date as the settler walks, works, and carries.
- `selecting-site` selects a house site, and its panel reads `Logs n/12`, `Stone n/6`, `Work` as `Waiting for materials` or a percent, and `Builders`.
- `selecting-house` turns the panel of a selected site into the panel of a house when the site is finished, and selects a finished house on a click.
- `selecting-camp` selects the camp, and its panel reads `Settlers here`.
- `selecting-clear` clears the selection on a click on bare ground, on Escape, and when the selected site is cancelled.
- `selecting-tools` leaves clicks to the active tool. One Escape puts the tool away and keeps the selection.
- `selecting-mark` marks the selected thing in a way that reads by day and at midnight, over grass and over snow, at every zoom.
- `selecting-layout` keeps the panel clear of the clock, the toolbar, the Stockpiles panel, the status line, and the camera controls at 960 by 540.

## How to get to it (user POV)

- Open the game. Make sure no tool on the right is pressed, or press Escape.
- Click a settler. Run the clock and read the panel at the bottom left as the settler works.
- Mark trees, rock, and a stockpile, place a house, press Escape, and click the site. Run the clock until the house is finished.
- At night, click the camp fire.
- Press Escape, or click the panel's close button, to clear the selection.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run selecting`, which runs doctor itself.
- Every page opens on seed 7 at 960 by 540 with the settlers, the third at noon and the others with `clock: 'paused'`.
- The scenario finds a settler by the tunic pixels of `UNIT_COLORS.villagers` in a paused screenshot, leaving out the interface boxes. It finds the camp by its `FLAME` pixels at night. It reads the panel by the role `region` and the name `Selection`, its `h2`, its note, and its `dt` and `dd` rows, in one round trip.

- **Select a settler at work.** The first page records video. It reaches 08:15, marks the work of `building` with `markWork`, and zooms by `BUILD_CLOSER`. It clicks `SELECT_OFFSET` pixels to the right of the largest tunic.
  - `a click 10 px beside a settler selects it` reads a settler's panel: its title is the settler's name, and it has a `Sex` row of `Man` or `Woman` and a `Household` row. Every check that a click selects a settler reads the panel this way.
  - `by day over the grass, the mark shows in both of its colors` counts what the selection adds to the paused frame, at least `MARK_LEAST` of `MARK_ACCENT` and of `MARK_EDGE`. `the mark rings the selected settler` finds a tunic within `MARK_ON_SETTLER` pixels of the accent's center.
- **Follow it.** It presses 3 for 4× and reads the panel every 120 ms until it has read `FOLLOW.distinct` different `Doing` values or the clock reaches 11:20, then pauses.
  - `the settler panel follows what the settler does` needs 3 different values, one of them `Walking to ...` and one of them `Chopping a tree`, `Quarrying stone`, or `Building a house`.
  - `the Carries row agrees with what the settler is doing at every reading` needs `1 log` beside `Carrying a log ...`, `1 stone` beside `Carrying stone ...`, and `Nothing` beside every other value.
  - `the mark has followed the settler` needs the accent's center to have moved `MARK_MOVES` pixels and to lie beside a tunic. `while paused the settler panel holds still` reads the panel twice a second apart.
- **Select the site, then see it become a house.** It reaches 11:30, places the house of `building` at `BUILD_SPOTS.closerHouse`, presses Escape, and clicks the same point.
  - `a House click places the site and leaves the selection alone` keeps the settler's panel. `a click on the site selects it` reads `Logs 0/12`, `Stone 0/6`, `Waiting for materials`, and `Builders 0`.
  - It runs at 8× until the label reads 50%. `the site panel agrees with the site's label and counts the builders` reads `12/12`, `6/6`, the label's percent, and 1 to 4 builders.
  - It runs on until the label is gone. `the selected site has become a house in the panel` reads `House` and `A finished house.` without another click. `the mark rings the house` finds the accent centered within 40 pixels of the click. Escape clears the selection, and a click on the house then selects it.
  - The page cuts `selecting-settler.gif` from the selection to the end of the follow, and `selecting-site-to-house.gif` from the 50% stop to the house.
- **Cancel a selected site.** The second page takes `BUILD_VIEW`, places a house at `BUILD_SPOTS.house`, and clicks it. It presses H and clicks the site, then presses Escape once.
  - `with House active a click on the site places nothing and selects nothing, and one Escape puts the tool away and keeps the selection` reads the refusal in the status line and the site's panel throughout.
  - It presses Delete and drags over the site. `cancelling the selected site clears the selection` reads `Orders removed` and no panel.
- **The camp, and the mark by night and on snow.** The third page opens at noon and stays at the opening view. It clicks the camp as a player would, and again when a settler standing in the camp took the click: first the blue tent behind the fire, then the points of `CAMP_AIM` farthest from every lit tunic, at most `CAMP_TRIES` clicks.
  - `a click on the camp selects the camp` reads `Camp` and a count of `Settlers here`.
  - `the camp stays selected until midnight, and its panel then counts all 8 settlers there` reads `Settlers here 8` at spring midnight without another click.
  - Each mark check takes the frame with the selection, presses Escape, and takes the same paused frame without it. They run at spring midnight on the camp, at winter noon over snow on a settler, and at winter midnight on the camp, which it selects again at winter noon.
  - It zooms to the farthest view. `at the farthest zoom a click on the firelit camp selects one of the settlers ringed there` clicks the largest patch of `FIRELIT` ground.
- **Pick at every view.** The fourth page selects a settler and then clicks bare ground, at the opening view and at the nearest zoom turned by a right drag of `SELECT_TURN` pixels. The bare point lies `BARE_CLEARANCE` pixels from every tunic.
  - `a drag that starts on a settler moves the camera and selects nothing` drags 80 pixels from a tunic.
- **Layout.** `the settler panel`, `the site panel`, and `the camp panel covers no other panel` compare the panel's box with the clock, the toolbar, the Stockpiles panel, the camera controls, and the status line when it shows. After the settler's, `the settler panel, with every row at its longest reading, stays clear of the Stockpiles panel and shows every row` copies the open settler panel beside it, puts the longest reading of each row in `SETTLER_LONGEST` into the copy, and measures the copy: its top must lie at or below the Stockpiles panel's bottom, and its rows must fit its height. A row that `SETTLER_LONGEST` lacks keeps its reading, so a new row adds its height to the copy. On 2026-11-18 the copy was 400x225 from y 259, and the Stockpiles panel ended at y 237.

## Gotchas

- Take every reading from a paused frame. Trees, cover, water, and smoke move with the clock, so the mark's pixels are counted as what the selection adds to the same paused frame.
- The clock's pressed speed button has the accent color, so pixel searches leave out the interface boxes.
- The `Doing` values the follow sees depend on which settler the click took and on the run. The check asks for kinds of value, not for an order.
- At the farthest zoom of 243 m a settler is less than a pixel of tunic by day, so no scenario can aim at one there. At night the 8 settlers stand within a settler's reach of the fire, so a click on the camp selects a settler, and the camp can be selected only from nearer.
- A settler that stands in front of the fire covers it, so a click on the flame selects that settler. At 08:00 several settlers still stand in the camp, many in the tents' shade, so the scenario clicks the camp at noon, and clicks again when a settler took the click.
- Over a house, a site, or the camp, a settler wins only when the box the picker draws around that building does not hide it. The box is coarser than the models, so a settler just past a roof can lose the click to the building.
- The winter stops run the clock to day 10, which takes several minutes in a browser that draws on the CPU.
