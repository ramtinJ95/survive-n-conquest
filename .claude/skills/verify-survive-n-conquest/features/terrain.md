# Terrain

The map has hills, water, forest, and rock outcrops. A seed decides the whole map. The same seed always draws the same map, and the player chooses the seed with the `seed` URL parameter.

## Sub-features

- `terrain-kinds` draws grass, water, forest with trees, and rock with boulders on rolling hills.
- `terrain-seed` draws a different map for each seed.
- `terrain-repeat` draws the same map each time the same seed loads.
- `terrain-default` draws seed 7 when the URL has no seed.
- `terrain-word` takes any text as a seed. A whole number up to 4294967295 is the seed itself, and other text is hashed.

## How to get to it (user POV)

- Open the game. The map of the default seed appears.
- Add `?seed=<number or word>` to the URL and load the page. The corner panel shows the seed in use.
- Hold `X` to zoom out until the whole map is in view.

## Driving it with verify.mjs

Preconditions:

- `$V doctor` passes, or you use `$V run terrain`, which runs doctor itself.

- **Open seed 7.** The scenario runs `open(WIDE, { search: '?seed=7&swarm=off' })`, which pauses the clock at noon, and `still(page)`. Every load in this scenario adds `swarm=off`, because the checks compare the map and the units stand somewhere else on each load. `terrain-seed-7.png` shows the map from the first camera view.
- **See the whole map.** Hold `X` for 2.5 seconds with `hold(page, 'KeyX', 2500)`. `terrain-seed-7-whole-map.png` shows the full map. The check `seed 7 shows water, plants, and rock` reads the share of each in the screenshot.
- **Open seed 2026.** Load `?seed=2026` and repeat both steps. `terrain-seed-2026.png` is taken from the same camera as `terrain-seed-7.png`. The check `seeds 7 and 2026 draw different maps` passes.
- **Reload seed 7.** Load `?seed=7` in a fresh page. The check `seed 7 draws the same map again` passes when the screenshot matches the first one.
- **Open with no seed.** Load `?swarm=off`, which has no seed. The check `no seed draws the default seed 7` passes.
- **Open a word.** Load `?seed=winter`. The check `a word is a seed too` passes when the map differs from seed 7.
- **Proof.** Run `$V run terrain`. The evidence folder holds seven screenshots and `result.json`. Put `terrain-seed-7.png` and `terrain-seed-2026.png` side by side to show two seeds from one camera.

## Gotchas

- The surface checks sort pixels by color. Sky is close to `SKY_RGB`, water is blue, plants are green, and rock is gray. They follow the spring colors in `src/render/palette.ts` and the spring noon sky in `src/render/daylight.ts`. Update `SKY_RGB` and `SURFACES` in `verify.mjs` when either changes on purpose, and say so in the pull request.
- Hills have no pixel check. Judge them by eye in the screenshots, where the sun shades the slopes.
- The scenario names seed 7 as the default. Update `SEEDS` in `verify.mjs` when `DEFAULT_SEED` in `src/sim/seed.ts` changes.
- The comparisons need a still world. Each load pauses the clock at a different tick, so units would stand in different places and fail `seed 7 draws the same map again` for a reason that has nothing to do with the map. Keep `swarm=off` on every load.
- The comparisons need the same light. Every page of this scenario is paused at noon on day 1. Two pages can stop up to 2 game minutes apart, which moves the shadows by less than the comparison allows.
- `still` waits until two screenshots 250 ms apart are identical. The camera eases into place, so take a screenshot only after `still`.
