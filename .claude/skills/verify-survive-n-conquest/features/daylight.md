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
- **Watch one day.** Read the clock four times a second until it reads 24 game hours later. Then press Space. `day-at-8x.gif` shows the whole day, from the morning through dusk, the night, and dawn, back to the morning. No check reads this page.
- **Stop at eight moments.** A second page of the same size runs `reach` to 09:00, 12:00, 15:00, 19:02, and 20:02 on day 1, and to 00:00, 03:58, and 04:58 on day 2. The 19:02, 20:02, 03:58, and 04:58 stops are 30 game minutes either side of the moments the map turns blue after dusk and back before dawn. `day-1-morning.png`, `day-2-noon.png`, `day-3-afternoon.png`, `day-4-before-dusk.png`, `day-5-after-dusk.png`, `day-6-midnight.png`, `day-7-before-dawn.png`, and `day-8-after-dawn.png` show the light at each, with the clock paused. Every check below reads these screenshots.
- **See the units by day and by night.** The check `villagers and monsters show their colors at noon` counts the pixels of each unit color in `day-2-noon.png` with `unitPixels` and needs 200 of each. The check `no villager or monster glows at midnight` needs fewer than 50 of each in `day-6-midnight.png`.
- **Compare the day with the night.** The brightness of a screenshot is the mean of its pixels on a scale of 255. The check `the day is more than twice as bright as the night` compares the dimmest of 09:00, 12:00, and 15:00 with the brightest of 20:02, 00:00, and 03:58. The check `the night stays light enough to see the map` passes when the darkest of the three night stops is at least 20.
- **Place the night.** The check `a spring night lasts from 19:12 to 04:48, 40% of the day` reads the mean color of the four stops beside dusk and dawn. A stop is night when it has more blue for each part of red than halfway between `day-2-noon.png` and `day-6-midnight.png`. The check passes when 19:02 and 04:58 are day and 20:02 and 03:58 are night. Each point of night share moves dusk and dawn by 7.2 game minutes, so a night share more than about 4 points off 40% puts a stop on the wrong side.
- **Proof.** Run `$V run daylight`. The evidence folder holds `day-at-8x.gif`, eight screenshots, and `result.json` with every check, including `day-at-8x.gif stays under 8 MB` and `no page errors`.

## Gotchas

- The scenario covers the first day, which is in spring. The other seasons are in [Seasons](./seasons.md).
- Read the light only from paused screenshots. A page that runs at 8× gets as many screenshots in a day as the machine can take, and with the swarm on, SwiftShader needs two to three seconds for each. An earlier check added up the dark share of the day from such screenshots, and it read 43% and then 46% on two runs of one build. A paused screenshot shows the same light on every run, give or take the 2 game minutes by which `reach` can stop late.
- Place the night by color, not by brightness. The light dims for half an hour before the sun sets, and at 19:12 the map is already darker than halfway between noon and midnight. The setting sun is orange, and the moon is blue and lights the map only while the sun is down. On the build that added this check, paused screenshots had 0.75 times as much blue as red at noon and 1.46 at midnight, so halfway is 1.11. The evening read 0.59 at 18:48, 0.48 at dusk, 0.94 at 19:24, and 1.19 at 19:36, so it passes halfway about 20 game minutes after dusk. The morning read 1.18 at 04:24, 0.92 at 04:36, and 0.48 at dawn, so it falls back about 20 minutes before dawn. The stops sit 30 minutes either side of those moments, where the readings are far from halfway.
- The night check has a tolerance of about 4 points of night share. The stops are centered on the moments the map turns blue and back, not on dusk and dawn, so that a night too long and a night too short fail by the same margin. The exact share is the job of the unit tests of the rule in `src/sim/daylight.ts`. The check here only shows that the screen follows it.
- The brightness includes the clock panel and the controls panel, which do not change with the time of day. They raise the night a little and the checks leave room for that.
- The light changes and the swarm moves in every frame, so the GIF is large. The scenario caps it at 640 pixels wide, and `finishClip` lowers the width, the color count, and then the frame rate until it is under 8 MB.
- The shadows of the units have no pixel check. Judge them by eye in a close view.
- The direction of the shadows has no pixel check. Judge it by eye in the clip, where the shadows point west in the morning and east in the evening.
