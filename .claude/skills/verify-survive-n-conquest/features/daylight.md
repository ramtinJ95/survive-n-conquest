# Daylight

The sun, the sky, and the shadows follow the clock. The sun rises in the east, stands in the south at noon, and sets in the west. The sky turns from blue through orange to a dark blue night, and the moon lights the night enough to play in. In spring the night lasts 40% of the day, from 19:12 to 04:48.

## Sub-features

- `daylight-sun` moves the sunlight and the shadows across the map through the day.
- `daylight-sky` colors the sky behind the map and the haze over the far land by the height of the sun.
- `daylight-night` makes the night dark and blue, and keeps the map readable in it.
- `daylight-clock` follows the game clock at every speed and holds still while the game is paused.
- `daylight-morning` opens a new game at 08:00, in full daylight.
- `daylight-units` lights the villagers and the monsters like the land. They cast and take shadows, and they are dark at night.

## How to get to it (user POV)

- Open the game. It opens at 08:00 on day 1, and the light changes as the clock runs.
- Press 4 to run at 8×. A day then passes in 37.5 seconds.
- Press Space to hold the light at any time of day.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run daylight`, which runs doctor itself.

- **Open the game and run at 8×.** Load the page at 960 by 540 with recording on and `clock: 'running'`, then press 4. The clip starts at that key press. The swarm stays on, because the checks read the brightness of the whole screen, which the units barely change, and the clip then shows the units in the same light as the land.
- **Watch one day.** Take one screenshot after another, and read the clock before and after each one, until the clock reads 24 game hours later. Then press Space. `day-at-8x.gif` shows the whole day, from the morning through dusk, the night, and dawn, back to the morning.
- **Stop at four moments.** A second page of the same size runs `reach` to 12:00 and 19:12 on day 1, and to 00:00 and 04:48 on day 2. `day-1-noon.png`, `day-2-dusk.png`, `day-3-midnight.png`, and `day-4-dawn.png` show the light at each, with the clock paused.
- **See the units by day and by night.** The check `villagers and monsters show their colors at noon` counts the pixels of each unit color in `day-1-noon.png` with `unitPixels` and needs 200 of each. The check `no villager or monster glows at midnight` needs fewer than 50 of each in `day-3-midnight.png`.
- **Compare the day with the night.** The brightness of a screenshot is the mean of its pixels on a scale of 255. The check `the day is more than twice as bright as the night` compares the dimmest screenshot from 09:00 to 15:00 with the brightest one from 20:30 to 03:30. The check `the night stays light enough to see the map` passes when the darkest night screenshot is at least 20.
- **Measure the night.** The check `a spring day is dark for about 40% of its length` adds up the game time in which the screenshots are darker than halfway between day and night. Between two screenshots it takes the brightness to change in a straight line. It passes between 33% and 47%.
- **Proof.** Run `$V run daylight`. The evidence folder holds `day-at-8x.gif`, four screenshots, and `result.json` with every check, including `day-at-8x.gif stays under 8 MB` and `no page errors`.

## Gotchas

- The scenario covers the first day, which is in spring. The other seasons are in [Seasons](./seasons.md).
- The screenshots for the brightness checks are taken while the clock runs at 8×, and they are not saved. With the swarm on, SwiftShader needs two to three seconds for each, so they are one to two game hours apart. The clock is read before and after each screenshot, and the screenshot gets the time halfway between.
- Take the four saved screenshots from the second page, which pauses at each time. The nearest screenshot from the running page can be an hour early, and an hour before dawn the map is still dark.
- The brightness includes the clock panel and the controls panel, which do not change with the time of day. They raise the night a little and the checks leave room for that.
- The rule for the length of the night is in `src/sim/daylight.ts` and has its own unit tests. The 40% check here only shows that the screen follows it.
- The light changes and the swarm moves in every frame, so the GIF is large. The scenario caps it at 640 pixels wide, and `finishClip` lowers the width, the color count, and then the frame rate until it is under 8 MB.
- The shadows of the units have no pixel check. Judge them by eye in a close view.
- The direction of the shadows has no pixel check. Judge it by eye in the clip, where the shadows point west in the morning and east in the evening.
