#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = process.cwd();
const STATE_DIR = join(ROOT, '.verify', 'state');
const INSTANCE_FILE = join(STATE_DIR, 'instance.json');
const EVIDENCE_ROOT = join(ROOT, '.verify', 'evidence');
const APP_NAME = 'survive-n-conquest';
const WORLD = 'canvas#world';
const SKY_RGB = [0x9f, 0xc9, 0xe8];
const GIF_STEPS = [
  { width: 960, colors: 256, fps: 8 },
  { width: 800, colors: 256, fps: 8 },
  { width: 800, colors: 96, fps: 8 },
  { width: 640, colors: 256, fps: 8 },
  { width: 640, colors: 96, fps: 8 },
  { width: 560, colors: 256, fps: 8 },
  { width: 480, colors: 256, fps: 8 },
  { width: 480, colors: 64, fps: 8 },
  { width: 640, colors: 96, fps: 4 },
  { width: 480, colors: 64, fps: 4 },
];
const GIF_BYTE_LIMIT = 8_000_000;
const MINUTES_PER_DAY = 1440;
const GAME_MINUTES_PER_SECOND_AT_1X = MINUTES_PER_DAY / 300;
const FASTEST_SPEED = 8;
const PROBE = { width: 160, height: 90 };
const UNIT_COLORS = {
  villagers: ([r, g, b]) => r > 170 && g > 0.55 * r && b < 0.25 * r,
  monsters: ([r, g, b]) => r > 90 && r > 2.2 * g && r > 2 * b,
};
const BROWSER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

class VerifyError extends Error {}

function fail(message) {
  throw new VerifyError(message);
}

function assertRepoRoot() {
  const manifest = join(ROOT, 'package.json');
  const name = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : null;
  if (name !== APP_NAME) fail(`run from the root of a ${APP_NAME} checkout, not ${ROOT}`);
}

function playwright() {
  return createRequire(join(ROOT, 'package.json'))('playwright');
}

function readInstance() {
  return existsSync(INSTANCE_FILE) ? JSON.parse(readFileSync(INSTANCE_FILE, 'utf8')) : null;
}

function signal(pid, name) {
  try {
    process.kill(pid, name);
    return 'sent';
  } catch (error) {
    return error.code === 'ESRCH' ? 'gone' : 'denied';
  }
}

function git(...args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
}

function revision() {
  const sha = git('rev-parse', '--short', 'HEAD');
  if (!git('status', '--porcelain')) return sha;
  const changes = createHash('sha256').update(git('diff', 'HEAD', '--binary'));
  for (const file of git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
    changes.update(file).update(readFileSync(join(ROOT, file)));
  }
  return `${sha}-dirty-${changes.digest('hex').slice(0, 8)}`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function servesThisBuild(url) {
  const built = join(ROOT, 'dist', 'index.html');
  try {
    const response = await fetch(url);
    return response.ok && existsSync(built) && (await response.text()) === readFileSync(built, 'utf8');
  } catch {
    return false;
  }
}

async function launch(port) {
  const running = readInstance();
  if (running && (await servesThisBuild(running.url))) {
    fail(`an instance already runs at ${running.url} (pid ${running.pid}); run stop first`);
  }
  if (spawnSync('bun', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
    fail('bun run build failed');
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const log = join(STATE_DIR, 'preview.log');
  const url = `http://127.0.0.1:${port}/`;
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(
    process.execPath,
    [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: ROOT, detached: true, stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')] },
  );
  child.unref();
  const instance = { pid: child.pid, port, url, revision: revision(), startedAt: new Date().toISOString() };
  writeFileSync(INSTANCE_FILE, `${JSON.stringify(instance, null, 2)}\n`);
  for (let attempt = 0; attempt < 60 && signal(child.pid, 0) === 'sent'; attempt++) {
    if (await servesThisBuild(url)) {
      console.log(`ready at ${url} (pid ${child.pid}, build ${instance.revision})`);
      return;
    }
    await sleep(250);
  }
  const output = readFileSync(log, 'utf8');
  signal(child.pid, 'SIGTERM');
  rmSync(STATE_DIR, { recursive: true, force: true });
  fail(`vite preview did not serve ${url}:\n${output}`);
}

async function stop() {
  const instance = readInstance();
  if (!instance) {
    console.log('no instance recorded; nothing to stop');
    return;
  }
  if (await servesThisBuild(instance.url)) {
    if (signal(instance.pid, 'SIGTERM') === 'denied') {
      fail(
        `this shell cannot signal pid ${instance.pid}. A sandbox hides processes that an earlier command started. ` +
          `Run "kill ${instance.pid}" outside the sandbox, then run stop again.`,
      );
    }
    for (let attempt = 0; attempt < 20 && signal(instance.pid, 0) !== 'gone'; attempt++) await sleep(250);
    if (signal(instance.pid, 0) !== 'gone') fail(`pid ${instance.pid} ignored SIGTERM; stop it by pid and run stop again`);
  } else if (signal(instance.pid, 0) !== 'gone') {
    fail(
      `pid ${instance.pid} still runs, but ${instance.url} does not serve this checkout's build, so this run cannot prove it owns the process. ` +
        `Check pid ${instance.pid} by hand, stop it if it is the preview, then delete ${STATE_DIR}.`,
    );
  }
  rmSync(STATE_DIR, { recursive: true, force: true });
  console.log(`stopped; evidence kept in ${EVIDENCE_ROOT}`);
}

async function probeBrowser() {
  try {
    const browser = await playwright().chromium.launch({ args: BROWSER_ARGS });
    const page = await browser.newPage();
    await page.setContent('<canvas></canvas>');
    const renderer = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown renderer') : null;
    });
    const version = browser.version();
    await browser.close();
    return { ok: renderer !== null, detail: `chromium ${version}, WebGL2 ${renderer ?? 'unavailable'}` };
  } catch (error) {
    return { ok: false, detail: String(error.message).split('\n').slice(0, 3).join(' ') };
  }
}

function printChecks(checks) {
  for (const { name, ok, detail } of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  return checks.every((check) => check.ok);
}

async function doctor() {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, detail });
  const instance = readInstance();
  check('instance recorded', instance !== null, instance ? INSTANCE_FILE : 'none; run launch');
  if (instance) {
    check('preview serves this build', await servesThisBuild(instance.url), instance.url);
    const reach = signal(instance.pid, 0);
    check('preview pid can be stopped from this shell', reach === 'sent', `pid ${instance.pid} ${reach}`);
    check('build matches checkout', instance.revision === revision(), `built ${instance.revision}, checkout ${revision()}`);
  }
  check('ffmpeg on PATH', spawnSync('ffmpeg', ['-version']).status === 0, 'needed for GIFs and pixel probes');
  const browser = await probeBrowser();
  check('headless browser launches with WebGL2', browser.ok, browser.detail);
  return printChecks(checks);
}

function ffmpeg(args, input) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { input, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail(`ffmpeg ${args.join(' ')} failed: ${result.stderr ?? result.error}`);
  return result.stdout;
}

/** The pixels of a PNG, given as a path or as the bytes of the file, scaled down to the probe size. */
function probe(png) {
  const scale = `scale=${PROBE.width}:${PROBE.height}:flags=area`;
  const piped = Buffer.isBuffer(png);
  const source = piped ? ['-f', 'png_pipe', '-i', '-'] : ['-i', png];
  return ffmpeg([...source, '-vf', scale, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], piped ? png : undefined);
}

function meanColor(png) {
  const pixels = probe(png);
  const mean = [0, 0, 0];
  for (let i = 0; i < pixels.length; i++) mean[i % 3] += (3 * pixels[i]) / pixels.length;
  return mean;
}

const brightness = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const blueness = ([red, , blue]) => blue / red;

function difference(pngA, pngB) {
  const a = probe(pngA);
  const b = probe(pngB);
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const SURFACES = {
  sky: (rgb) => distance(rgb, SKY_RGB) < 14,
  water: ([r, g, b]) => b > g && b > r + 40,
  plants: ([r, g, b]) => g > r + 15 && g > b + 25,
  rock: ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 28 && r + g + b > 210 && r + g + b < 645,
};

/** What each season alone puts on the map. Snow is near white, autumn leaves are orange, and blossom is pink. */
const SEASON_MARKS = {
  plants: SURFACES.plants,
  blossom: ([r, g, b]) => r > g + 25 && b > g,
  orange: ([r, g, b]) => r > g + 30 && g > b + 30,
  snow: ([r, g, b]) => Math.min(r, g, b) > 170 && Math.max(r, g, b) - Math.min(r, g, b) < 45,
};

/** The share of the pixels between two rows that each kind claims. A pixel goes to the first kind that claims it. */
function shares(kinds, png, [top, bottom] = [0, 1]) {
  const pixels = probe(png);
  const from = Math.floor(top * PROBE.height) * PROBE.width;
  const to = Math.floor(bottom * PROBE.height) * PROBE.width;
  const found = Object.fromEntries(Object.keys(kinds).map((kind) => [kind, 0]));
  for (let i = from; i < to; i++) {
    const rgb = [pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]];
    const kind = Object.keys(kinds).find((name) => kinds[name](rgb));
    if (kind) found[kind] += 1 / (to - from);
  }
  return found;
}

function surfaceShares(png, rows) {
  const found = shares(SURFACES, png, rows);
  found.ground = 1 - found.sky;
  return found;
}

function unitPixels(png) {
  const pixels = ffmpeg(['-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const counts = Object.fromEntries(Object.keys(UNIT_COLORS).map((group) => [group, 0]));
  for (let i = 0; i < pixels.length; i += 3) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    for (const [group, matches] of Object.entries(UNIT_COLORS)) if (matches(rgb)) counts[group] += 1;
  }
  return counts;
}

/** Converts a video to a GIF that starts `from` seconds in and is no wider than `width`, and steps its size down until it is under the limit. */
function toGif(video, gif, { from = 0, width = GIF_STEPS[0].width } = {}) {
  for (const step of GIF_STEPS.filter((step) => step.width <= width)) {
    const palette = `fps=${step.fps},scale=${step.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${step.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none`;
    ffmpeg(['-ss', from.toFixed(2), '-i', video, '-vf', palette, gif]);
    if (statSync(gif).size <= GIF_BYTE_LIMIT) break;
  }
  rmSync(video);
}

const clockMinutes = ({ day, time }) => {
  const [hours, minutes] = time.split(':').map(Number);
  return (day - 1) * MINUTES_PER_DAY + hours * 60 + minutes;
};

const clockAt = (minutes) => {
  const pad = (value) => String(value).padStart(2, '0');
  const ofDay = minutes % MINUTES_PER_DAY;
  return { day: Math.floor(minutes / MINUTES_PER_DAY) + 1, time: `${pad(Math.floor(ofDay / 60))}:${pad(ofDay % 60)}` };
};

const clockText = (minutes) => {
  const { day, time } = clockAt(minutes);
  return `day ${day} ${time}`;
};

function createSession(browser, instance, dir, evidence) {
  const check = (name, ok, detail) => evidence.checks.push({ name, ok, detail });
  const capture = (file) => {
    evidence.files.push(file);
    return join(dir, file);
  };
  return {
    check,

    async open(viewport, { record = false, search = '', clock = 'noon' } = {}) {
      const start = {
        noon: (page) => this.reach(page, { day: 1, time: '12:00' }),
        paused: (page) => this.pause(page),
        running: () => {},
      }[clock];
      if (!start) fail(`open cannot start the clock as "${clock}"; use noon, paused, or running`);
      const context = await browser.newContext({
        viewport,
        ...(record && { recordVideo: { dir, size: viewport } }),
      });
      const page = await context.newPage();
      const created = Date.now();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      await page.goto(instance.url + search);
      await this.settle(page);
      await page.getByRole('status', { name: 'Date' }).filter({ hasText: /^Day / }).waitFor();
      await start(page);
      return { context, page, errors, since: () => (Date.now() - created) / 1000 };
    },

    async settle(page) {
      await page.locator(WORLD).waitFor();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    },

    async gameMinutes(page) {
      const panel = await page.getByRole('region', { name: 'Clock' }).textContent();
      const read = /^(\d\d):(\d\d)Day (\d+) /.exec(panel);
      if (!read) fail(`the clock panel reads "${panel}", not a time and a day`);
      return clockMinutes({ day: Number(read[3]), time: `${read[1]}:${read[2]}` });
    },

    async pause(page) {
      await page.keyboard.press('Space');
      await page.getByRole('button', { name: 'Pause', exact: true, pressed: true }).waitFor();
    },

    async reach(page, target) {
      const wanted = clockMinutes(target);
      const from = await this.gameMinutes(page);
      const fastest = FASTEST_SPEED * GAME_MINUTES_PER_SECOND_AT_1X;
      const deadline = Date.now() + (2 * Math.max(wanted - from, 0) * 1000) / fastest + 60_000;
      const inTime = () => {
        if (Date.now() > deadline) fail(`the clock did not reach ${clockText(wanted)} in time`);
      };
      const runUntil = async (minutes) => {
        while ((await this.gameMinutes(page)) < minutes) {
          inTime();
          await page.waitForTimeout(20);
        }
      };
      await page.keyboard.press('4');
      await runUntil(wanted - 30);
      await page.keyboard.press('1');
      await runUntil(wanted - 3);
      await this.pause(page);
      let now = await this.gameMinutes(page);
      while (now < wanted) {
        inTime();
        await page.keyboard.press('Space');
        await page.waitForTimeout(100);
        await page.keyboard.press('Space');
        await this.settle(page);
        await page.getByRole('button', { name: 'Pause', exact: true, pressed: true }).waitFor();
        now = await this.gameMinutes(page);
      }
      if (now > wanted + 2) fail(`the clock stopped at ${clockText(now)}, past ${clockText(wanted)}`);
    },

    async screenshot(page, label) {
      const path = capture(`${label}.png`);
      await page.screenshot({ path });
      return path;
    },

    async still(page) {
      let last = await page.screenshot();
      for (let attempt = 0; attempt < 60; attempt++) {
        await page.waitForTimeout(250);
        const next = await page.screenshot();
        if (next.equals(last)) return;
        last = next;
      }
      check('the view comes to rest', false, 'two screenshots 250 ms apart still differ after 15 s');
    },

    async hold(page, key, ms) {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
    },

    async drag(page, from, to, button = 'left') {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down({ button });
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up({ button });
    },

    async finishClip(context, page, label, cut) {
      await page.close();
      await context.close();
      const gif = capture(`${label}.gif`);
      toGif(await page.video().path(), gif, cut);
      const bytes = statSync(gif).size;
      check(`${label}.gif stays under 8 MB`, bytes <= GIF_BYTE_LIMIT, `${(bytes / 1e6).toFixed(1)} MB`);
    },

    difference,
    unitPixels,

    expectShares(name, kinds, png, { atLeast = {}, atMost = {} }, rows) {
      const found = shares(kinds, png, rows);
      const percent = (share) => `${(share * 100).toFixed(1)}%`;
      const seen = [
        ...Object.entries(atLeast).map(([kind, least]) => `${kind} ${percent(found[kind])} of at least ${percent(least)}`),
        ...Object.entries(atMost).map(([kind, most]) => `${kind} ${percent(found[kind])} of at most ${percent(most)}`),
      ];
      const ok =
        Object.entries(atLeast).every(([kind, least]) => found[kind] >= least) &&
        Object.entries(atMost).every(([kind, most]) => found[kind] <= most);
      check(name, ok, seen.join(', '));
    },

    expectChanged(name, before, after) {
      const moved = difference(before, after);
      check(name, moved > 2, `mean pixel difference ${moved.toFixed(2)}, needs more than 2`);
    },

    expectUnchanged(name, before, after) {
      const moved = difference(before, after);
      check(name, moved < 0.2, `mean pixel difference ${moved.toFixed(2)}, needs less than 0.2`);
    },

    expectSurfaces(name, png, minimums, rows) {
      const shares = surfaceShares(png, rows);
      const seen = Object.entries(minimums).map(
        ([surface, minimum]) => `${surface} ${(shares[surface] * 100).toFixed(1)}% of at least ${minimum * 100}%`,
      );
      const enough = Object.entries(minimums).every(([surface, minimum]) => shares[surface] >= minimum);
      check(name, enough, seen.join(', '));
    },

    async expectFillsViewport(page, viewport) {
      const box = await page.locator(WORLD).boundingBox();
      const fills = box?.x === 0 && box.y === 0 && box.width === viewport.width && box.height === viewport.height;
      check(`world fills ${viewport.width}x${viewport.height}`, fills, JSON.stringify(box));
    },
  };
}

const WIDE = { width: 1280, height: 720 };
const CENTER = { x: WIDE.width / 2, y: WIDE.height / 2 };
const CLIP = { width: 960, height: 540 };
const SEEDS = ['7', '2026'];
const OPENS_AT = clockMinutes({ day: 1, time: '08:00' });
/** The sun rises and sets at these times through the spring. */
const DAWN = '04:48';
const DUSK = '19:12';
/**
 * The daylight stops this many game minutes before and after spring dusk and dawn. Each point of night share moves
 * dusk and dawn by 7.2 minutes, so a night share more than about 5 points off 40% puts a stop on the wrong side.
 */
const BESIDE_TWILIGHT = 36;
/** The sun has set by this time in winter and is still up in summer. */
const EVENING = '18:30';
/** The share of the map, below the sky, that each season must and must not color at noon. */
const SEASON_LOOKS = [
  { season: 'Spring', atLeast: { plants: 0.4, blossom: 0.02 }, atMost: { orange: 0.02, snow: 0.02 } },
  { season: 'Summer', atLeast: { plants: 0.4 }, atMost: { blossom: 0.005, orange: 0.02, snow: 0.02 } },
  { season: 'Autumn', atLeast: { orange: 0.15 }, atMost: { plants: 0.2, blossom: 0.005, snow: 0.02 } },
  { season: 'Winter', atLeast: { snow: 0.3 }, atMost: { plants: 0.02, blossom: 0.005, orange: 0.02 } },
];

const SCENARIOS = {
  async window(session) {
    const narrow = { width: 960, height: 600 };
    const { context, page, errors, since } = await session.open(WIDE, { record: true });
    await session.still(page);
    const atNoon = since();
    await session.expectFillsViewport(page, WIDE);
    const wide = await session.screenshot(page, 'window-1280x720');
    session.expectSurfaces('the map fills the 1280x720 window', wide, { plants: 0.3 });
    await page.setViewportSize(narrow);
    await session.settle(page);
    await session.still(page);
    await session.expectFillsViewport(page, narrow);
    const small = await session.screenshot(page, 'window-960x600');
    session.expectSurfaces('the map fills the 960x600 window', small, { plants: 0.3 });
    await page.setViewportSize(WIDE);
    await session.settle(page);
    await session.still(page);
    await session.finishClip(context, page, 'window-resize', { from: atNoon, width: 640 });
    session.check('no page errors', errors.length === 0, errors.join(' | ') || 'none');
  },

  async terrain(session) {
    const errors = [];
    const view = async (search, label, wholeMap = false) => {
      const opened = await session.open(WIDE, { search });
      await session.still(opened.page);
      const close = await session.screenshot(opened.page, label);
      let far = null;
      if (wholeMap) {
        await session.hold(opened.page, 'KeyX', 2500);
        await session.still(opened.page);
        far = await session.screenshot(opened.page, `${label}-whole-map`);
      }
      await opened.context.close();
      errors.push(...opened.errors);
      return { close, far };
    };

    const [first, second] = SEEDS;
    const a = await view(`?seed=${first}&swarm=off`, `terrain-seed-${first}`, true);
    const b = await view(`?seed=${second}&swarm=off`, `terrain-seed-${second}`, true);
    const again = await view(`?seed=${first}&swarm=off`, `terrain-seed-${first}-again`);
    const unseeded = await view('?swarm=off', 'terrain-no-seed');
    const worded = await view('?seed=winter&swarm=off', 'terrain-seed-winter');

    const kinds = { water: 0.01, plants: 0.15, rock: 0.003 };
    session.expectSurfaces(`seed ${first} shows water, plants, and rock`, a.far, kinds);
    session.expectSurfaces(`seed ${second} shows water, plants, and rock`, b.far, kinds);
    session.expectChanged(`seeds ${first} and ${second} draw different maps`, a.close, b.close);
    session.expectUnchanged(`seed ${first} draws the same map again`, a.close, again.close);
    session.expectUnchanged(`no seed draws the default seed ${first}`, a.close, unseeded.close);
    session.expectChanged('a word is a seed too', a.close, worded.close);
    session.check('no page errors', errors.length === 0, errors.join(' | ') || 'none');
  },

  async camera(session) {
    const flight = await session.open(CLIP, { record: true, clock: 'paused' });
    await session.hold(flight.page, 'KeyD', 800);
    await session.drag(flight.page, { x: 620, y: 220 }, { x: 380, y: 360 });
    await session.hold(flight.page, 'KeyQ', 1000);
    await session.drag(flight.page, { x: 380, y: 230 }, { x: 560, y: 290 }, 'right');
    for (let notch = 0; notch < 5; notch++) {
      await flight.page.mouse.wheel(0, -200);
      await flight.page.waitForTimeout(120);
    }
    await flight.page.waitForTimeout(400);
    await session.hold(flight.page, 'KeyX', 900);
    await flight.page.waitForTimeout(500);
    await session.finishClip(flight.context, flight.page, 'camera-flight');

    const { context, page, errors } = await session.open(WIDE, { search: '?swarm=off' });
    await session.still(page);
    let shots = 0;
    const shoot = (label) => session.screenshot(page, `camera-${String(++shots).padStart(2, '0')}-${label}`);
    let before = await shoot('start');
    const moves = [
      ['a held D key pans', 'pan-key', () => session.hold(page, 'KeyD', 600)],
      ['a drag pans', 'pan-drag', () => session.drag(page, { x: 800, y: 300 }, { x: 500, y: 450 })],
      ['a held Q key turns', 'turn-key', () => session.hold(page, 'KeyQ', 600)],
      ['a right-drag turns and tilts', 'turn-drag', () => session.drag(page, { x: 500, y: 300 }, { x: 700, y: 380 }, 'right')],
      ['a held F key tilts', 'tilt-key', () => session.hold(page, 'KeyF', 600)],
      ['a held Z key zooms', 'zoom-key', () => session.hold(page, 'KeyZ', 600)],
      ['the wheel zooms', 'zoom-wheel', async () => {
        await page.mouse.move(CENTER.x, CENTER.y);
        await page.mouse.wheel(0, 400);
      }],
    ];
    for (const [name, label, move] of moves) {
      await move();
      await session.still(page);
      const after = await shoot(label);
      session.expectChanged(name, before, after);
      before = after;
    }

    await session.hold(page, 'KeyX', 4000);
    await session.still(page);
    const farthest = await shoot('farthest');
    session.expectSurfaces('the sky shows around the map at the farthest view', farthest, { sky: 0.05 });
    await page.mouse.wheel(0, 2000);
    await session.hold(page, 'KeyX', 1000);
    await session.still(page);
    session.expectUnchanged('zooming out stops at the farthest view', farthest, await shoot('farthest-again'));

    await session.hold(page, 'KeyW', 4000);
    await session.still(page);
    let edge = await shoot('map-edge');
    session.expectChanged('the camera reaches the map edge', farthest, edge);
    let rested = false;
    for (let leg = 0; leg < 8 && !rested; leg++) {
      await session.hold(page, 'KeyW', 2500);
      await session.still(page);
      const next = await shoot('map-edge');
      rested = session.difference(edge, next) < 0.2;
      edge = next;
    }
    session.check('panning stops in a corner of the map', rested, rested ? 'the view stopped while W stayed held' : 'the view still moved after 20 s of W');
    session.expectSurfaces('the map stays in view at its corner', edge, { plants: 0.05 });

    await session.hold(page, 'KeyZ', 5000);
    await session.hold(page, 'KeyF', 3000);
    await session.still(page);
    const nearest = await shoot('nearest');
    await page.mouse.wheel(0, -2000);
    await session.hold(page, 'KeyF', 1000);
    await session.still(page);
    session.expectUnchanged('zooming in and tilting stop at the lowest view', nearest, await shoot('nearest-again'));
    for (const leg of ['one', 'two', 'three', 'four']) {
      await session.hold(page, 'KeyS', 2500);
      await session.hold(page, 'KeyQ', 500);
      await session.still(page);
      const low = await shoot(`low-flight-${leg}`);
      session.expectSurfaces(`the ground fills the lower view on low flight ${leg}`, low, { ground: 0.9 }, [0.6, 1]);
    }
    await context.close();
    const seen = [...flight.errors, ...errors];
    session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
  },

  async clock(session) {
    const panels = async (page) => ({
      clock: await page.getByRole('region', { name: 'Clock' }).boundingBox(),
      controls: await page.getByRole('complementary', { name: 'Camera controls' }).boundingBox(),
    });
    const expectApart = async (page, viewport) => {
      const { clock, controls } = await panels(page);
      const inside = (box) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
      const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      const ok = inside(clock) && inside(controls) && disjoint(clock, controls);
      session.check(`the clock and the camera controls fit apart at ${viewport.width}x${viewport.height}`, ok, `clock ${JSON.stringify(clock)}, controls ${JSON.stringify(controls)}`);
    };

    const { context, page, errors, since } = await session.open(WIDE, { record: true, clock: 'running' });
    const openedAt = await session.gameMinutes(page);
    const latest = OPENS_AT + since() * GAME_MINUTES_PER_SECOND_AT_1X + 1;
    const date = page.getByRole('status', { name: 'Date' });
    const time = page.getByRole('timer', { name: 'Time of day' });
    const controls = page.getByRole('group', { name: 'Game speed' });
    const buttons = {
      Pause: controls.getByRole('button', { name: 'Pause', exact: true }),
      ...Object.fromEntries([1, 2, 4, 8].map((speed) => [`Speed ${speed}×`, controls.getByRole('button', { name: `Speed ${speed}×` })])),
    };

    const click = async (button) => {
      const box = await button.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const gameMinutes = () => session.gameMinutes(page);
    const pressedButtons = async () => {
      const states = await Promise.all(Object.entries(buttons).map(async ([name, button]) => [name, await button.getAttribute('aria-pressed')]));
      return states.filter(([, state]) => state === 'true').map(([name]) => name).join(', ');
    };
    const expectPressed = async (...names) => {
      const wanted = names.join(', ');
      let pressed = await pressedButtons();
      for (let polls = 0; polls < 20 && pressed !== wanted; polls++) {
        await page.waitForTimeout(100);
        pressed = await pressedButtons();
      }
      session.check(`pressed: ${names.join(' and ')}`, pressed === wanted, `aria-pressed on ${pressed || 'nothing'}`);
    };
    const expectRate = async (label, speed, ms) => {
      const before = await gameMinutes();
      const start = Date.now();
      await page.waitForTimeout(ms);
      const after = await gameMinutes();
      const seconds = (Date.now() - start) / 1000;
      const rate = (after - before) / seconds;
      const expected = speed * GAME_MINUTES_PER_SECOND_AT_1X;
      const ok = speed === 0 ? after === before : Math.abs(rate / expected - 1) < 0.25;
      session.check(`${label} runs ${expected} game minutes per second`, ok, `${before} to ${after} game minutes in ${seconds.toFixed(2)} s, ${rate.toFixed(1)} per second`);
    };

    const opening = await date.textContent();
    session.check('opens on the first day of spring', opening === 'Day 1 · Early Spring · Year 1', `date "${opening}", time "${await time.textContent()}"`);
    session.check(
      'opens at 08:00 in the morning',
      openedAt >= OPENS_AT && openedAt <= latest,
      `the first reading is ${clockText(openedAt)}, and a clock that started at 08:00 reads no later than ${clockText(Math.floor(latest))} by then`,
    );
    await expectPressed('Speed 1×');
    await expectApart(page, WIDE);
    await expectRate('1×', 1, 4000);
    await session.screenshot(page, 'clock-1x');

    await click(buttons['Speed 2×']);
    await expectPressed('Speed 2×');
    await expectRate('2× by pointer', 2, 4000);

    await page.keyboard.press('3');
    await expectPressed('Speed 4×');
    await expectRate('4× by the 3 key', 4, 4000);

    await page.keyboard.press('4');
    await expectPressed('Speed 8×');
    await expectRate('8× by the 4 key', 8, 3000);

    await page.keyboard.press('Space');
    await expectPressed('Pause', 'Speed 8×');
    const paused = await session.screenshot(page, 'clock-paused');
    await expectRate('pause by Space', 0, 2500);
    session.expectUnchanged('nothing on screen moves while paused', paused, await session.screenshot(page, 'clock-paused-later'));

    const heldAt = await time.textContent();
    await session.hold(page, 'KeyW', 600);
    await session.still(page);
    session.expectChanged('the W key still moves the camera while paused', paused, await session.screenshot(page, 'clock-paused-camera-moved'));
    await expectPressed('Pause', 'Speed 8×');
    const stillAt = await time.textContent();
    session.check('the camera keys leave the clock alone', stillAt === heldAt, `time "${heldAt}" before W, "${stillAt}" after`);

    for (let presses = 0; presses < 6 && !(await buttons.Pause.evaluate((node) => node === document.activeElement)); presses++) {
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
    await expectPressed('Speed 8×');
    await expectRate('resume by Tab and Enter on Pause', 8, 3000);

    await date.filter({ hasText: /^Day 2 / }).waitFor({ timeout: 60_000 });
    const nextDay = await date.textContent();
    session.check('the date turns to the second day at 8×', nextDay === 'Day 2 · Mid Spring · Year 1', `date "${nextDay}", time "${await time.textContent()}"`);
    await page.waitForTimeout(1500);
    await click(buttons.Pause);
    await expectPressed('Pause', 'Speed 8×');
    await session.screenshot(page, 'clock-day-2');
    await session.finishClip(context, page, 'clock-speeds');

    const narrow = { width: 960, height: 600 };
    const small = await session.open(narrow);
    await session.still(small.page);
    await expectApart(small.page, narrow);
    await session.screenshot(small.page, 'clock-960x600');
    await small.context.close();
    const seen = [...errors, ...small.errors];
    session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
  },

  async daylight(session) {
    const { context, page, errors, since } = await session.open(CLIP, { record: true, clock: 'running' });
    await page.keyboard.press('4');
    const fastFrom = since();
    let before = await session.gameMinutes(page);
    const end = before + MINUTES_PER_DAY;
    const deadline = Date.now() + 120_000;
    const samples = [];
    while (before < end) {
      if (Date.now() > deadline) fail(`the clock reached only ${clockText(before)} in two minutes at 8×`);
      const png = await page.screenshot();
      const after = await session.gameMinutes(page);
      samples.push({ minutes: (before + after) / 2, png });
      before = after;
    }
    await session.pause(page);
    await session.finishClip(context, page, 'day-at-8x', { from: fastFrom, width: 640 });

    const stops = await session.open(CLIP, { clock: 'running' });
    const dusk = clockMinutes({ day: 1, time: DUSK });
    const dawn = clockMinutes({ day: 2, time: DAWN });
    const moments = {
      noon: { day: 1, time: '12:00' },
      'before-dusk': clockAt(dusk - BESIDE_TWILIGHT),
      'after-dusk': clockAt(dusk + BESIDE_TWILIGHT),
      midnight: { day: 2, time: '00:00' },
      'before-dawn': clockAt(dawn - BESIDE_TWILIGHT),
      'after-dawn': clockAt(dawn + BESIDE_TWILIGHT),
    };
    const saved = {};
    for (const [index, [moment, when]] of Object.entries(moments).entries()) {
      await session.reach(stops.page, when);
      await session.still(stops.page);
      saved[moment] = await session.screenshot(stops.page, `day-${index + 1}-${moment}`);
    }
    await stops.context.close();
    errors.push(...stops.errors);
    const lit = session.unitPixels(saved.noon);
    const unlit = session.unitPixels(saved.midnight);
    session.check(
      'villagers and monsters show their colors at noon',
      lit.villagers >= 200 && lit.monsters >= 200,
      `${lit.villagers} villager pixels and ${lit.monsters} monster pixels, needs 200 of each`,
    );
    session.check(
      'no villager or monster glows at midnight',
      unlit.villagers < 50 && unlit.monsters < 50,
      `${unlit.villagers} villager pixels and ${unlit.monsters} monster pixels in their daylight colors, needs fewer than 50 of each`,
    );

    for (const sample of samples) sample.light = brightness(meanColor(sample.png));
    const hourOf = ({ minutes }) => (minutes % MINUTES_PER_DAY) / 60;
    const lights = (inside) => samples.filter((sample) => inside(hourOf(sample))).map((sample) => sample.light);
    const day = lights((hour) => hour >= 9 && hour <= 15);
    const night = lights((hour) => hour >= 20.5 || hour <= 3.5);
    if (day.length === 0 || night.length === 0) fail(`${samples.length} screenshots in one day left none by day or none by night`);
    const dimmestDay = Math.min(...day);
    const brightestNight = Math.max(...night);
    const darkestNight = Math.min(...night);
    const levels = `${day.length} readings from 09:00 to 15:00 are ${dimmestDay.toFixed(0)} to ${Math.max(...day).toFixed(0)}, ${night.length} from 20:30 to 03:30 are ${darkestNight.toFixed(0)} to ${brightestNight.toFixed(0)}, on a scale of 255`;
    session.check('the day is more than twice as bright as the night', dimmestDay > 2 * brightestNight, levels);
    session.check('the night stays light enough to see the map', darkestNight >= 20, levels);

    const noonBlue = blueness(meanColor(saved.noon));
    const sides = { 'before-dusk': 'day', 'after-dusk': 'night', 'before-dawn': 'night', 'after-dawn': 'day' };
    const readings = Object.entries(sides).map(([moment, side]) => {
      const blue = blueness(meanColor(saved[moment]));
      return { side, blue, seen: blue > noonBlue ? 'night' : 'day', at: moments[moment].time };
    });
    session.check(
      `a spring night lasts from ${DUSK} to ${DAWN}, 40% of the day`,
      readings.every(({ side, seen }) => side === seen),
      `night is bluer than noon, which has ${noonBlue.toFixed(2)} times as much blue as red; ` +
        readings.map(({ side, blue, seen, at }) => `${at} has ${blue.toFixed(2)}, ${seen}, needs ${side}`).join('; '),
    );
    session.check('no page errors', errors.length === 0, errors.join(' | ') || 'none');
  },

  async seasons(session) {
    const { context, page, errors } = await session.open(WIDE, { clock: 'running', search: '?swarm=off' });
    const date = page.getByRole('status', { name: 'Date' });
    const share = {};
    let lastNoon = null;
    for (const [index, { season, atLeast, atMost }] of SEASON_LOOKS.entries()) {
      const day = 3 * index + 1;
      const stops = { noon: { day, time: '12:00' }, evening: { day, time: EVENING }, midnight: { day: day + 1, time: '00:00' } };
      const shots = {};
      for (const [stop, when] of Object.entries(stops)) {
        await session.reach(page, when);
        await session.still(page);
        shots[stop] = await session.screenshot(page, `season-${index + 1}-${season.toLowerCase()}-${stop}`);
        const read = await date.textContent();
        session.check(`the date reads ${season} at ${clockText(clockMinutes(when))}`, read.includes(season), `date "${read}"`);
      }

      session.expectShares(`${season} colors the map at noon`, SEASON_MARKS, shots.noon, { atLeast, atMost }, [0.35, 1]);
      if (lastNoon) session.expectChanged(`${season} looks different from the season before it`, lastNoon, shots.noon);
      lastNoon = shots.noon;

      const noon = meanColor(shots.noon);
      const midnight = meanColor(shots.midnight);
      share[season] = brightness(meanColor(shots.evening)) / brightness(noon);
      session.check(
        `midnight in ${season} is dark, cold, and light enough to see the map`,
        brightness(midnight) < 0.6 * brightness(noon) &&
          brightness(midnight) >= 20 &&
          blueness(midnight) > 1.5 * blueness(noon),
        `midnight is ${brightness(midnight).toFixed(0)} against ${brightness(noon).toFixed(0)} at noon, on a scale of 255, and has ${blueness(midnight).toFixed(2)} times as much blue as red against ${blueness(noon).toFixed(2)} at noon`,
      );
    }
    session.check(
      `at ${EVENING} it is still day in summer and already night in winter`,
      share.Summer > 0.7 && share.Winter < 0.6,
      `the summer evening keeps ${(share.Summer * 100).toFixed(0)}% of its noon brightness, needs more than 70%; the winter evening keeps ${(share.Winter * 100).toFixed(0)}%, needs less than 60%`,
    );
    await context.close();
    session.check('no page errors', errors.length === 0, errors.join(' | ') || 'none');
  },
};

SCENARIOS.swarm = async (session) => {
  const seen = [];
  const pressed = (page, name) => page.getByRole('button', { name, exact: true, pressed: true }).waitFor();

  const flight = await session.open(CLIP, { record: true, clock: 'running' });
  await flight.page.keyboard.press('4');
  await pressed(flight.page, 'Speed 8×');
  await flight.page.waitForTimeout(5000);
  await session.hold(flight.page, 'KeyX', 1200);
  await flight.page.waitForTimeout(5000);
  await session.finishClip(flight.context, flight.page, 'swarm-8x');
  seen.push(...flight.errors);

  const { context, page, errors } = await session.open(WIDE);
  await session.still(page);
  const before = await session.screenshot(page, 'swarm-paused');
  const counted = session.unitPixels(before);
  session.check('villagers and monsters both show', counted.villagers >= 500 && counted.monsters >= 500, `${counted.villagers} villager pixels and ${counted.monsters} monster pixels, needs 500 of each`);
  await page.waitForTimeout(2000);
  session.expectUnchanged('the swarm holds still while the clock is paused', before, await session.screenshot(page, 'swarm-paused-later'));

  await session.reach(page, { day: 2, time: '12:00' });
  await session.still(page);
  session.expectChanged('the swarm moves while the clock runs', before, await session.screenshot(page, 'swarm-a-day-later'));
  await context.close();
  seen.push(...errors);

  const bare = await session.open(WIDE, { search: '?swarm=off' });
  await session.still(bare.page);
  const empty = await session.screenshot(bare.page, 'swarm-off');
  const none = session.unitPixels(empty);
  session.check('?swarm=off shows no unit colors', none.villagers < 50 && none.monsters < 50, `${none.villagers} villager pixels and ${none.monsters} monster pixels, needs fewer than 50 of each`);
  session.expectChanged('the swarm draws units over the same map', empty, before);

  await session.reach(bare.page, { day: 2, time: '12:00' });
  await session.still(bare.page);
  session.expectUnchanged('a day later the same noon lights the bare map the same way', empty, await session.screenshot(bare.page, 'swarm-off-a-day-later'));
  await bare.context.close();
  seen.push(...bare.errors);
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

function scenarioNamed(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) fail(`unknown scenario "${name}"; known: ${Object.keys(SCENARIOS).join(', ')}`);
  return scenario;
}

async function drive(name) {
  const scenario = scenarioNamed(name);
  const instance = readInstance();
  if (!instance || !(await servesThisBuild(instance.url))) fail('no instance serves this build; run launch first');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const dir = join(EVIDENCE_ROOT, `${stamp}-${name}`);
  mkdirSync(dir, { recursive: true });
  const evidence = { scenario: name, url: instance.url, revision: instance.revision, browser: null, checks: [], files: [] };
  try {
    const browser = await playwright().chromium.launch({ args: BROWSER_ARGS });
    evidence.browser = browser.version();
    try {
      await scenario(createSession(browser, instance, dir, evidence));
    } finally {
      await browser.close();
    }
  } catch (error) {
    evidence.checks.push({ name: 'scenario ran to the end', ok: false, detail: error.message.split('\n')[0] });
  }
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  const passed = printChecks(evidence.checks);
  console.log(`evidence: ${dir}`);
  return passed;
}

async function run(name, port) {
  scenarioNamed(name);
  await launch(port);
  try {
    return (await doctor()) && (await drive(name));
  } finally {
    await stop();
  }
}

const args = parseArgs({
  allowPositionals: true,
  options: { port: { type: 'string', default: '4173' } },
});
const [command, scenario] = args.positionals;
const port = Number(args.values.port);
const COMMANDS = {
  run: () => run(scenario, port),
  launch: () => launch(port).then(() => true),
  doctor,
  drive: () => drive(scenario),
  stop: () => stop().then(() => true),
};

try {
  if (!COMMANDS[command]) fail(`usage: verify.mjs <${Object.keys(COMMANDS).join('|')}> [scenario] [--port N]`);
  assertRepoRoot();
  if (!(await COMMANDS[command]())) process.exitCode = 1;
} catch (error) {
  if (!(error instanceof VerifyError)) throw error;
  console.error(`verify: ${error.message}`);
  process.exitCode = 1;
}
