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
// Pixels of page space kept clear around a covered region, so its shadow and border stay out of a comparison.
const COVER_MARGIN = 8;
// Four legs of this held S, flown from the map centre, stay well inside the map at any frame rate. features/camera.md works out the bound.
const LOW_FLIGHT_LEG_MS = 400;
// Two reach stops at the same noon measured 0.000 outside the clock panel on every run. One tick later reads about 0.05.
const SAME_NOON_LIMIT = 0.02;
const UNIT_COLORS = {
  villagers: ([r, g, b]) => r > 170 && g > 0.55 * r && b < 0.25 * r,
  monsters: ([r, g, b]) => r > 90 && r > 2.2 * g && r > 2 * b,
};
const BROWSER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
// A pylon cannot download Playwright's own Chromium, because its host is not on the allowlist, so .nexus/setup installs Debian's.
const DEBIAN_HEADLESS_SHELL = '/usr/lib/chromium/chromium-headless-shell';
const BROWSER_PATH = existsSync(DEBIAN_HEADLESS_SHELL) ? DEBIAN_HEADLESS_SHELL : undefined;

class VerifyError extends Error {}

const NO_FRAME_MS = 60_000;

// Headless Chromium starts the next animation frame before SwiftShader has drawn the last one, so about 30 frames queue
// and a screenshot waits behind all of them: 8 s on rj-firebat, up to 67 s on a 2 CPU pylon. This init script runs each
// frame's callbacks only once the GPU has finished the frame before, as a real GPU would make the page wait.
function paceFramesToTheGpu() {
  const getContext = HTMLCanvasElement.prototype.getContext;
  const contexts = new Set();
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest);
    if (type === 'webgl2' && context) contexts.add(context);
    return context;
  };
  const request = window.requestAnimationFrame.bind(window);
  let callbacks = new Map();
  let running = new Map();
  let nextId = 1;
  let fences = [];
  let scheduled = false;
  // A lost or restored context never signals its old fence, and the game must still get its frames to recover.
  const drawn = () => fences.every(([gl, fence]) => !gl.isSync(fence) || gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED);
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    request(frame);
  };
  function frame(time) {
    scheduled = false;
    if (!drawn()) return schedule();
    for (const [gl, fence] of fences) gl.deleteSync(fence);
    running = callbacks;
    callbacks = new Map();
    for (const [id, callback] of running) {
      running.delete(id);
      try {
        callback(time);
      } catch (error) {
        reportError(error);
      }
    }
    fences = [...contexts].map((gl) => [gl, gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)]);
    for (const [gl] of fences) gl.flush();
    if (callbacks.size) schedule();
  }
  window.requestAnimationFrame = (callback) => {
    callbacks.set(nextId, callback);
    schedule();
    return nextId++;
  };
  window.cancelAnimationFrame = (id) => {
    callbacks.delete(id);
    running.delete(id);
  };
}

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

function launchBrowser() {
  return playwright().chromium.launch({ args: BROWSER_ARGS, executablePath: BROWSER_PATH });
}

async function probeBrowser() {
  try {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setContent('<canvas></canvas>');
    const renderer = await page.evaluate(() => {
      const gl = document.querySelector('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown renderer') : null;
    });
    const version = browser.version();
    await browser.close();
    return { ok: renderer !== null, detail: `chromium ${version} at ${BROWSER_PATH ?? "Playwright's own path"}, WebGL2 ${renderer ?? 'unavailable'}` };
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

// `cover` is a box in probe pixels that the comparison leaves out.
function difference(pngA, pngB, cover) {
  const a = probe(pngA);
  const b = probe(pngB);
  const covered = (pixel) => {
    const x = pixel % PROBE.width;
    const y = Math.floor(pixel / PROBE.width);
    return cover && x >= cover.left && x < cover.right && y >= cover.top && y < cover.bottom;
  };
  let total = 0;
  let counted = 0;
  for (let i = 0; i < a.length; i++) {
    if (covered(Math.floor(i / 3))) continue;
    total += Math.abs(a[i] - b[i]);
    counted++;
  }
  return total / counted;
}

const unionOf = (a, b) => ({
  region: a.region,
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
});

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

/** The pure colors that the outlines of the orders and the chop pins draw, which no light or fog changes. */
const ORDER_RGB = {
  chop: [0xff, 0x7a, 0x1a],
  quarry: [0xc7, 0x7d, 0xff],
  stockpile: [0x2f, 0xd6, 0xc4],
  site: [0x5a, 0xa8, 0xff],
  fits: [0x7d, 0xff, 0x8a],
  blocks: [0xff, 0x4d, 0x8d],
};
const ORDER_TOLERANCE = 24;

/**
 * Counts the pixels of each order color in a screenshot `width` pixels wide, leaving out `skip`, a box in page pixels
 * such as the toolbar, whose buttons wear the same colors.
 */
function orderPixels(png, width, skip) {
  const pixels = ffmpeg(['-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const counts = Object.fromEntries(Object.keys(ORDER_RGB).map((kind) => [kind, 0]));
  const skipped = (pixel) => {
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    return skip && x >= skip.x && x < skip.x + skip.width && y >= skip.y && y < skip.y + skip.height;
  };
  for (let i = 0; i < pixels.length; i += 3) {
    if (skipped(i / 3)) continue;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    for (const [kind, color] of Object.entries(ORDER_RGB)) if (distance(rgb, color) < ORDER_TOLERANCE) counts[kind] += 1;
  }
  return counts;
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

/** Where two screenshots of one size differ by more than `threshold` in some channel: how many pixels, their centroid, and their spread around it, in pixels. */
function changedPixels(pngA, pngB, width, threshold = SETTLER_THRESHOLD) {
  const a = ffmpeg(['-i', pngA, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const b = ffmpeg(['-i', pngB, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const xs = [];
  const ys = [];
  for (let i = 0; i < a.length; i += 3) {
    const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (delta <= threshold) continue;
    xs.push((i / 3) % width);
    ys.push(Math.floor(i / 3 / width));
  }
  const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
  const x = mean(xs);
  const y = mean(ys);
  const spread = Math.sqrt(mean(xs.map((px, i) => (px - x) ** 2 + (ys[i] - y) ** 2)));
  return { count: xs.length, x, y, spread };
}

/** Converts a video to a GIF that starts `from` seconds in and is no wider than `width`, and steps its size down until it is under the limit. */
function toGif(video, gif, { from = 0, to, width = GIF_STEPS[0].width } = {}) {
  const span = to === undefined ? [] : ['-t', (to - from).toFixed(2)];
  for (const step of GIF_STEPS.filter((step) => step.width <= width)) {
    const palette = `fps=${step.fps},scale=${step.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${step.colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none`;
    ffmpeg(['-ss', from.toFixed(2), ...span, '-i', video, '-vf', palette, gif]);
    if (statSync(gif).size <= GIF_BYTE_LIMIT) break;
  }
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
      await context.addInitScript(paceFramesToTheGpu);
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
      const twoFrames = page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      let timer;
      const noFrame = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new VerifyError(`the page ran no frame for ${NO_FRAME_MS / 1000} s`)), NO_FRAME_MS);
      });
      await Promise.race([twoFrames, noFrame]).finally(() => clearTimeout(timer));
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
      await this.settle(page);
      await page.screenshot({ path });
      return path;
    },

    async still(page) {
      let last = await page.screenshot();
      for (let attempt = 0; attempt < 60; attempt++) {
        await page.waitForTimeout(250);
        await this.settle(page);
        const next = await page.screenshot();
        if (next.equals(last)) return;
        last = next;
      }
      check('the view comes to rest', false, 'two screenshots a drawn frame apart still differ after 60 tries');
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
      await this.finishClips(context, page, [{ label, ...cut }]);
    },

    async finishClips(context, page, cuts) {
      await page.close();
      await context.close();
      const video = await page.video().path();
      for (const { label, ...cut } of cuts) {
        const gif = capture(`${label}.gif`);
        toGif(video, gif, cut);
        const bytes = statSync(gif).size;
        check(`${label}.gif stays under 8 MB`, bytes <= GIF_BYTE_LIMIT, `${(bytes / 1e6).toFixed(1)} MB`);
      }
      rmSync(video);
    },

    difference,
    unitPixels,
    orderPixels,

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

    // The box, in probe pixels and with a margin, of the region with this accessible name.
    async coverOf(page, region) {
      const box = await page.getByRole('region', { name: region }).boundingBox();
      const { width, height } = page.viewportSize();
      const across = PROBE.width / width;
      const down = PROBE.height / height;
      return {
        region,
        left: Math.max(0, Math.floor((box.x - COVER_MARGIN) * across)),
        top: Math.max(0, Math.floor((box.y - COVER_MARGIN) * down)),
        right: Math.min(PROBE.width, Math.ceil((box.x + box.width + COVER_MARGIN) * across)),
        bottom: Math.min(PROBE.height, Math.ceil((box.y + box.height + COVER_MARGIN) * down)),
      };
    },

    expectSameOutside(name, before, after, cover, limit) {
      const moved = difference(before, after, cover);
      check(name, moved < limit, `mean pixel difference ${moved.toFixed(3)} outside the ${cover.region} region, needs less than ${limit}`);
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
/** The game opens with 8 settlers. This opens it with the benchmark load of 1500 villagers and 3000 monsters instead. */
const SWARM = '?swarm=on';
/** One wheel turn of this many pixels zooms the opening view in on the camp. A wheel zoom lands on the same view on every run. */
const SETTLER_VIEW_WHEEL = -900;
/** A pixel differs between the settlers and the bare map when one of its channels differs by more than this. */
const SETTLER_THRESHOLD = 25;
/** At the camp zoom, a tile is about 20 pixels wide. The settlers' spots lie 1.5 tiles from the camp center. */
const SETTLER_GATHERED_SPREAD = 40;
/** The camera opens looking at the map center, and the camp is the walkable tile nearest it. */
const SETTLER_CAMP_OFF_CENTER = 60;
/** Between 21:00 and 04:30 the light changes the shading of the settlers, so the outline they leave moves by a few pixels. */
const SETTLER_STAYED = 10;
const OPENS_AT = clockMinutes({ day: 1, time: '08:00' });
/** The sun rises and sets at these times through the spring. */
const DAWN = '04:48';
const DUSK = '19:12';
/** The moon's blue takes over from the sunset's orange this many game minutes after dusk, and gives way as long before dawn. */
const BLUE_LAG = 20;
/**
 * The daylight stops this many game minutes either side of the moments the map turns blue and back. Each point of
 * night share moves dusk and dawn by 7.2 minutes, so a night share more than about 4 points off 40% puts a stop on the
 * wrong side.
 */
const BESIDE_TWILIGHT = 30;
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
    await context.close();

    const low = await session.open(WIDE, { search: '?swarm=off' });
    await session.hold(low.page, 'KeyZ', 5000);
    await session.hold(low.page, 'KeyF', 3000);
    await low.page.mouse.wheel(0, -2000);
    await session.hold(low.page, 'KeyF', 1000);
    for (const leg of ['one', 'two', 'three', 'four']) {
      await session.hold(low.page, 'KeyS', LOW_FLIGHT_LEG_MS);
      await session.hold(low.page, 'KeyQ', 500);
      await session.still(low.page);
      const shot = await session.screenshot(low.page, `camera-${String(++shots).padStart(2, '0')}-low-flight-${leg}`);
      session.expectSurfaces(`the ground fills the lower view on low flight ${leg}`, shot, { ground: 0.9 }, [0.6, 1]);
    }
    await low.context.close();
    const seen = [...flight.errors, ...errors, ...low.errors];
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
    const { context, page, errors, since } = await session.open(CLIP, { record: true, clock: 'running', search: SWARM });
    await page.keyboard.press('4');
    const fastFrom = since();
    const end = (await session.gameMinutes(page)) + MINUTES_PER_DAY;
    const deadline = Date.now() + 120_000;
    for (let now = await session.gameMinutes(page); now < end; now = await session.gameMinutes(page)) {
      if (Date.now() > deadline) fail(`the clock reached only ${clockText(now)} in two minutes at 8×`);
      await page.waitForTimeout(250);
    }
    await session.pause(page);
    await session.finishClip(context, page, 'day-at-8x', { from: fastFrom, width: 640 });

    const paused = await session.open(CLIP, { clock: 'running', search: SWARM });
    const turnsBlue = clockMinutes({ day: 1, time: DUSK }) + BLUE_LAG;
    const turnsBack = clockMinutes({ day: 2, time: DAWN }) - BLUE_LAG;
    const stops = Object.entries({
      morning: { when: { day: 1, time: '09:00' }, side: 'day' },
      noon: { when: { day: 1, time: '12:00' }, side: 'day' },
      afternoon: { when: { day: 1, time: '15:00' }, side: 'day' },
      'before-dusk': { when: clockAt(turnsBlue - BESIDE_TWILIGHT), side: 'day', twilight: true },
      'after-dusk': { when: clockAt(turnsBlue + BESIDE_TWILIGHT), side: 'night', twilight: true },
      midnight: { when: { day: 2, time: '00:00' }, side: 'night' },
      'before-dawn': { when: clockAt(turnsBack - BESIDE_TWILIGHT), side: 'night', twilight: true },
      'after-dawn': { when: clockAt(turnsBack + BESIDE_TWILIGHT), side: 'day', twilight: true },
    }).map(([name, stop]) => ({ name, ...stop }));
    for (const [index, stop] of stops.entries()) {
      await session.reach(paused.page, stop.when);
      await session.still(paused.page);
      stop.png = await session.screenshot(paused.page, `day-${index + 1}-${stop.name}`);
      const color = meanColor(stop.png);
      stop.light = brightness(color);
      stop.blue = blueness(color);
    }
    await paused.context.close();
    errors.push(...paused.errors);
    const at = Object.fromEntries(stops.map((stop) => [stop.name, stop]));

    const lit = session.unitPixels(at.noon.png);
    const unlit = session.unitPixels(at.midnight.png);
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

    const day = stops.filter((stop) => stop.side === 'day' && !stop.twilight);
    const night = stops.filter((stop) => stop.side === 'night');
    const range = (group) => {
      const lights = group.map((stop) => stop.light);
      return { least: Math.min(...lights), most: Math.max(...lights), times: group.map((stop) => stop.when.time).join(', ') };
    };
    const [byDay, byNight] = [range(day), range(night)];
    const levels = `${byDay.times} read ${byDay.least.toFixed(0)} to ${byDay.most.toFixed(0)}, ${byNight.times} read ${byNight.least.toFixed(0)} to ${byNight.most.toFixed(0)}, on a scale of 255`;
    session.check('the day is more than twice as bright as the night', byDay.least > 2 * byNight.most, levels);
    session.check('the night stays light enough to see the map', byNight.least >= 20, levels);

    const halfway = (at.noon.blue + at.midnight.blue) / 2;
    const readings = stops
      .filter((stop) => stop.twilight)
      .map(({ when, side, blue }) => ({ time: when.time, side, blue, seen: blue > halfway ? 'night' : 'day' }));
    session.check(
      `a spring night lasts from ${DUSK} to ${DAWN}, 40% of the day`,
      readings.every(({ side, seen }) => side === seen),
      `night has more blue for each part of red than ${halfway.toFixed(2)}, halfway between noon and midnight; ` +
        readings.map(({ time, side, blue, seen }) => `${time} has ${blue.toFixed(2)}, ${seen}, needs ${side}`).join('; '),
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

  const flight = await session.open(CLIP, { record: true, clock: 'running', search: SWARM });
  await flight.page.keyboard.press('4');
  await pressed(flight.page, 'Speed 8×');
  await flight.page.waitForTimeout(5000);
  await session.hold(flight.page, 'KeyX', 1200);
  await flight.page.waitForTimeout(5000);
  await session.finishClip(flight.context, flight.page, 'swarm-8x');
  seen.push(...flight.errors);

  const { context, page, errors } = await session.open(WIDE, { search: SWARM });
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
  const panelBefore = await session.coverOf(bare.page, 'Clock');
  const none = session.unitPixels(empty);
  session.check('?swarm=off shows no unit colors', none.villagers < 50 && none.monsters < 50, `${none.villagers} villager pixels and ${none.monsters} monster pixels, needs fewer than 50 of each`);
  session.expectChanged('the swarm draws units over the same map', empty, before);

  await session.reach(bare.page, { day: 2, time: '12:00' });
  await session.still(bare.page);
  const dayLater = await session.screenshot(bare.page, 'swarm-off-a-day-later');
  const panel = unionOf(panelBefore, await session.coverOf(bare.page, 'Clock'));
  session.expectSameOutside('a day later the same noon lights the bare map the same way', empty, dayLater, panel, SAME_NOON_LIMIT);
  await bare.context.close();
  seen.push(...bare.errors);
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

SCENARIOS.settlers = async (session) => {
  const zoomToCamp = async (page) => {
    await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
    await page.mouse.wheel(0, SETTLER_VIEW_WHEEL);
    await session.still(page);
  };
  const runTo = async (page, key, when) => {
    await page.keyboard.press(key);
    const wanted = clockMinutes(when);
    const deadline = Date.now() + 120_000;
    while ((await session.gameMinutes(page)) < wanted) {
      if (Date.now() > deadline) fail(`the clock did not reach ${clockText(wanted)} in two minutes`);
      await page.waitForTimeout(100);
    }
  };

  const clip = await session.open(CLIP, { record: true, clock: 'paused' });
  await zoomToCamp(clip.page);
  await session.reach(clip.page, { day: 1, time: '19:00' });
  const duskFrom = clip.since();
  await runTo(clip.page, '1', { day: 1, time: '19:35' });
  await runTo(clip.page, '4', { day: 2, time: '04:35' });
  await runTo(clip.page, '1', { day: 2, time: '05:10' });
  await session.pause(clip.page);
  await session.finishClip(clip.context, clip.page, 'settlers-dusk-and-dawn', { from: duskFrom });

  const stops = Object.entries({
    afternoon: { day: 1, time: '15:00' },
    'before-dusk': { day: 1, time: '19:00' },
    night: { day: 1, time: '21:00' },
    'before-dawn': { day: 2, time: '04:30' },
    morning: { day: 2, time: '07:00' },
  });
  const visit = async (search, label) => {
    const opened = await session.open(CLIP, { search, clock: 'paused' });
    await zoomToCamp(opened.page);
    const shots = {};
    for (const [name, when] of stops) {
      await session.reach(opened.page, when);
      await session.still(opened.page);
      shots[name] = await session.screenshot(opened.page, `${label}-${name}`);
    }
    await opened.context.close();
    return { shots, errors: opened.errors };
  };
  const settled = await visit('', 'settlers');
  const bare = await visit('?swarm=off', 'bare');
  const at = Object.fromEntries(stops.map(([name]) => [name, changedPixels(bare.shots[name], settled.shots[name], CLIP.width)]));
  const describe = (name) => `${name} ${at[name].count} pixels around (${at[name].x.toFixed(0)}, ${at[name].y.toFixed(0)}) with a spread of ${at[name].spread.toFixed(1)}`;

  const lit = session.unitPixels(settled.shots.afternoon);
  const none = session.unitPixels(bare.shots.afternoon);
  session.check('the settlers show by day', lit.villagers >= 400 && none.villagers < 50, `${lit.villagers} villager pixels with the settlers and ${none.villagers} on the bare map at 15:00, needs 400 and fewer than 50`);
  const gathered = at.night;
  const offCenter = Math.hypot(gathered.x - CLIP.width / 2, gathered.y - CLIP.height / 2);
  session.check(
    'at night the settlers stand together at the camp in the middle of the view',
    gathered.spread < SETTLER_GATHERED_SPREAD && offCenter < SETTLER_CAMP_OFF_CENTER,
    `${describe('night')}, ${offCenter.toFixed(0)} pixels from the view center; needs a spread under ${SETTLER_GATHERED_SPREAD} and under ${SETTLER_CAMP_OFF_CENTER} pixels from the center`,
  );
  const moved = Math.hypot(at['before-dawn'].x - gathered.x, at['before-dawn'].y - gathered.y);
  session.check(
    'the settlers stay at the camp until dawn',
    moved < SETTLER_STAYED && Math.abs(at['before-dawn'].spread - gathered.spread) < SETTLER_STAYED,
    `${describe('before-dawn')} against ${describe('night')}; needs the centroid and the spread to move less than ${SETTLER_STAYED} pixels`,
  );
  for (const [name, label] of [
    ['afternoon', 'by day the settlers wander away from the camp'],
    ['before-dusk', 'before dusk the settlers are still out'],
    ['morning', 'after dawn the settlers leave the camp again'],
  ]) {
    session.check(label, at[name].spread > 2 * gathered.spread, `${describe(name)} against ${describe('night')}; needs more than twice the night spread`);
  }
  const seen = [...clip.errors, ...settled.errors, ...bare.errors];
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/** Where each order goes on the opening view of seed 7, as shares of the viewport's width and height. */
const ORDER_SPOTS = {
  chop: [[0.577, 0.488], [0.63, 0.571]],
  quarry: [[0.371, 0.429], [0.398, 0.531]],
  stockpile: [[0.447, 0.388], [0.5, 0.479]],
  houseFits: [0.472, 0.476],
  houseOnStockpile: [0.455, 0.442],
  houseOnRock: [0.386, 0.502],
  houseInForest: [0.67, 0.562],
  cancel: [[0.476, 0.435], [0.476, 0.496]],
};
/** The clips zoom in by one wheel step of this many pixels first, to 66 m, so that a house site reads in the GIF. */
const CLIP_WHEEL = -400;
const CLIP_SPOTS = {
  chop: [[0.639, 0.478], [0.759, 0.642]],
  quarry: [[0.258, 0.368], [0.294, 0.563]],
  stockpile: [[0.411, 0.314], [0.5, 0.463]],
  houseFits: [0.45, 0.456],
  houseOnStockpile: [0.421, 0.397],
  cancel: [[0.459, 0.387], [0.455, 0.493]],
};
const TOOL_NAMES = ['Chop', 'Quarry', 'Stockpile', 'House', 'Cancel'];
/** Wheel pixels from the opening view of 120 m to a near view of 36 m, then out to the farthest view, then back to 120 m. */
const NEAR_WHEEL = -800;
const FAR_WHEEL = 2000;
const BACK_WHEEL = Math.log(120 / 243.2) / 0.0015;
/** The fewest outline and pin pixels that each kind of mark must draw in a 1280x720 view, at each zoom. */
const MARKS_AT_LEAST = { mid: 20, near: 50, far: 10 };

SCENARIOS.orders = async (session) => {
  const seen = [];
  const spot = (viewport, [fx, fy]) => ({ x: Math.round(fx * viewport.width), y: Math.round(fy * viewport.height) });
  const toolbar = (page) => page.getByRole('toolbar', { name: 'Orders' });
  const tool = (page, name) => toolbar(page).getByRole('button', { name, exact: true });
  const status = (page) => page.getByRole('status', { name: 'Order' });
  const pressedTools = async (page) => {
    const states = await Promise.all(TOOL_NAMES.map(async (name) => [name, await tool(page, name).getAttribute('aria-pressed')]));
    return states.filter(([, state]) => state === 'true').map(([name]) => name).join(', ');
  };
  const expectTool = async (page, name, wanted) => {
    const pressed = await pressedTools(page);
    session.check(name, pressed === wanted, `pressed: ${pressed || 'no tool'}`);
  };
  const expectSaid = async (page, name, pattern) => {
    const said = status(page).filter({ hasText: pattern });
    const ok = await said.waitFor({ timeout: 15_000 }).then(() => true, () => false);
    session.check(name, ok, `the status line reads "${(await status(page).textContent()) ?? ''}"`);
  };
  const marksIn = async (page, png) => session.orderPixels(png, page.viewportSize().width, await toolbar(page).boundingBox());
  const expectMarks = async (page, name, png, least) => {
    const counted = await marksIn(page, png);
    counted.preview = counted.fits + counted.blocks;
    const short = Object.entries(least).filter(([kind, fewest]) => counted[kind] < fewest);
    session.check(name, short.length === 0, Object.entries(least).map(([kind, fewest]) => `${kind} ${counted[kind]} of at least ${fewest}`).join(', '));
    return counted;
  };
  const dragOn = async (page, viewport, [from, to]) => {
    await session.drag(page, spot(viewport, from), spot(viewport, to));
  };
  const coverBox = (page, box, margin = COVER_MARGIN) => {
    const { width, height } = page.viewportSize();
    return {
      region: 'order',
      left: Math.max(0, Math.floor(((box.x - margin) * PROBE.width) / width)),
      top: Math.max(0, Math.floor(((box.y - margin) * PROBE.height) / height)),
      right: Math.min(PROBE.width, Math.ceil(((box.x + box.width + margin) * PROBE.width) / width)),
      bottom: Math.min(PROBE.height, Math.ceil(((box.y + box.height + margin) * PROBE.height) / height)),
    };
  };
  const boxOf = (viewport, [from, to]) => {
    const a = spot(viewport, from);
    const b = spot(viewport, to);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  };
  const statusCover = async (page) => coverBox(page, (await status(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 });

  const clip = await session.open(CLIP, { record: true });
  const { page } = clip;
  await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await page.mouse.wheel(0, CLIP_WHEEL);
  await session.still(page);
  const start = await session.screenshot(page, 'orders-01-start');
  const cuts = [];

  let from = clip.since();
  await page.keyboard.press('KeyC');
  await expectTool(page, 'the C key picks Chop', 'Chop');
  await expectSaid(page, 'Chop says what a drag does', /Drag over trees/);
  const chop = boxOf(CLIP, CLIP_SPOTS.chop);
  await page.mouse.move(spot(CLIP, CLIP_SPOTS.chop[0]).x, spot(CLIP, CLIP_SPOTS.chop[0]).y);
  await page.mouse.down();
  await page.mouse.move(spot(CLIP, CLIP_SPOTS.chop[1]).x, spot(CLIP, CLIP_SPOTS.chop[1]).y, { steps: 6 });
  await expectSaid(page, 'a Chop drag counts the trees before the release', /Release to mark \d+ trees?/);
  await session.screenshot(page, 'orders-02-chop-dragging');
  await page.mouse.up();
  await expectSaid(page, 'a Chop drag marks trees', /\d+ trees? marked for felling/);
  await session.still(page);
  const chopped = await session.screenshot(page, 'orders-03-chopped');
  await expectMarks(page, 'marked trees show pins and outlines', chopped, { chop: 50 });
  const untouched = unionOf(unionOf(coverBox(page, chop, 60), await statusCover(page)), coverBox(page, (await toolbar(page).boundingBox())));
  session.expectSameOutside('a main-button drag with a tool marks instead of moving the camera', start, chopped, untouched, 0.5);
  cuts.push({ label: 'orders-chop', from, to: clip.since() });

  from = clip.since();
  await page.keyboard.press('KeyM');
  await expectTool(page, 'the M key picks Quarry', 'Quarry');
  await dragOn(page, CLIP, CLIP_SPOTS.quarry);
  await expectSaid(page, 'a Quarry drag marks rock', /\d+ rock tiles? marked for quarrying/);
  await session.still(page);
  await expectMarks(page, 'marked rock shows its outline', await session.screenshot(page, 'orders-04-quarried'), { quarry: 50 });
  cuts.push({ label: 'orders-quarry', from, to: clip.since() });

  from = clip.since();
  await page.keyboard.press('KeyP');
  await expectTool(page, 'the P key picks Stockpile', 'Stockpile');
  await dragOn(page, CLIP, CLIP_SPOTS.stockpile);
  await expectSaid(page, 'a Stockpile drag makes a zone', /\d+ tiles? joins? the stockpile zone/);
  await session.still(page);
  const stocked = await session.screenshot(page, 'orders-05-stockpile');
  await expectMarks(page, 'the stockpile zone shows its outline', stocked, { stockpile: 50 });
  cuts.push({ label: 'orders-stockpile', from, to: clip.since() });

  from = clip.since();
  await page.keyboard.press('KeyH');
  await expectTool(page, 'the H key picks House', 'House');
  const fits = spot(CLIP, CLIP_SPOTS.houseFits);
  await page.mouse.move(fits.x, fits.y, { steps: 3 });
  await expectSaid(page, 'a house that fits says so before it is placed', /Click to place the house site here/);
  await session.still(page);
  await expectMarks(page, 'a house that fits previews green', await session.screenshot(page, 'orders-06-house-fits'), { fits: 30 });
  await page.mouse.click(fits.x, fits.y);
  await expectSaid(page, 'a click places the house site', /House site placed/);
  await session.still(page);
  await expectMarks(page, 'the house site shows its outline', await session.screenshot(page, 'orders-07-house-placed'), { site: 30 });
  const refused = spot(CLIP, CLIP_SPOTS.houseOnStockpile);
  await page.mouse.move(refused.x, refused.y, { steps: 3 });
  await expectSaid(page, 'a house over the stockpile says why it does not fit before it is placed', /Cannot build here\. A stockpile stands in the way/);
  await session.still(page);
  const refusedBefore = await session.screenshot(page, 'orders-08-house-refused-preview');
  await expectMarks(page, 'a house that does not fit previews red', refusedBefore, { blocks: 10 });
  const coverBefore = await statusCover(page);
  await page.mouse.click(refused.x, refused.y);
  await expectSaid(page, 'a refused house says why after the click', /Cannot build here\. A stockpile stands in the way/);
  await session.still(page);
  const refusedAfter = await session.screenshot(page, 'orders-09-house-refused');
  session.expectSameOutside('a refused house changes nothing on the map', refusedBefore, refusedAfter, unionOf(coverBefore, await statusCover(page)), 0.05);
  cuts.push({ label: 'orders-house', from, to: clip.since() });

  from = clip.since();
  await page.keyboard.press('Delete');
  await expectTool(page, 'the Delete key picks Cancel', 'Cancel');
  await dragOn(page, CLIP, CLIP_SPOTS.cancel);
  await expectSaid(page, 'a Cancel drag removes orders', /Orders removed from \d+ tiles?/);
  const removed = Number(/from (\d+) tile/.exec((await status(page).textContent()) ?? '')?.[1] ?? 0);
  session.check('Cancel removes stockpile tiles as well as the nine of the site', removed > 9, `${removed} tiles removed`);
  await page.mouse.move(CLIP.width / 2, 20);
  await session.still(page);
  const cancelled = await expectMarks(page, 'Cancel leaves the other marks', await session.screenshot(page, 'orders-10-cancelled'), { chop: 50, quarry: 50 });
  session.check('Cancel removes the house site', cancelled.site < 30, `${cancelled.site} site pixels, needs fewer than 30`);
  await page.keyboard.press('Escape');
  await expectTool(page, 'Escape puts the tool away', '');
  session.check('the status line hides without a tool', await status(page).isHidden(), 'hidden');
  cuts.push({ label: 'orders-cancel', from, to: clip.since() + 1 });
  await session.finishClips(clip.context, page, cuts.map((cut) => ({ ...cut, width: 800 })));
  seen.push(...clip.errors);

  const wide = await session.open(WIDE);
  const view = wide.page;
  await session.still(view);
  const bare = await session.screenshot(view, 'orders-11-bare');
  const none = await marksIn(view, bare);
  session.check('the map draws no order colors before any order', Object.values(none).every((count) => count < 30), JSON.stringify(none));
  for (const [key, order] of [['KeyC', 'chop'], ['KeyM', 'quarry'], ['KeyP', 'stockpile']]) {
    await view.keyboard.press(key);
    await dragOn(view, WIDE, ORDER_SPOTS[order]);
    await expectSaid(view, `the ${order} order lands on the 1280x720 view`, /marked|joins? the stockpile/);
  }
  await view.keyboard.press('KeyH');
  const placed = spot(WIDE, ORDER_SPOTS.houseFits);
  await view.mouse.click(placed.x, placed.y);
  await expectSaid(view, 'the house site lands on the 1280x720 view', /House site placed/);
  const hover = spot(WIDE, ORDER_SPOTS.houseOnStockpile);
  await view.mouse.move(hover.x, hover.y, { steps: 3 });
  await expectSaid(view, 'a house over the stockpile edge previews beside the marks', /Cannot build here\. A stockpile stands in the way/);

  // The preview follows the tile under the resting pointer as the view zooms, so it is green on some views and red on others.
  const every = { chop: 1, quarry: 1, stockpile: 1, site: 1, preview: 1 };
  const atLeast = (zoom) => Object.fromEntries(Object.keys(every).map((kind) => [kind, MARKS_AT_LEAST[zoom]]));
  const zooms = async (label) => {
    await session.still(view);
    await expectMarks(view, `every kind of mark reads ${label} at the opening view`, await session.screenshot(view, `orders-marks-${label}-mid`), atLeast('mid'));
    await view.mouse.wheel(0, NEAR_WHEEL);
    await session.still(view);
    await expectMarks(view, `every kind of mark reads ${label} at a near view`, await session.screenshot(view, `orders-marks-${label}-near`), atLeast('near'));
    await view.mouse.wheel(0, FAR_WHEEL);
    await session.still(view);
    await expectMarks(view, `every kind of mark reads ${label} at the farthest view`, await session.screenshot(view, `orders-marks-${label}-far`), atLeast('far'));
    await view.mouse.wheel(0, BACK_WHEEL);
    await session.still(view);
    for (const [where, place, reason] of [
      ['rock', ORDER_SPOTS.houseOnRock, /cannot stand on rock/],
      ['forest', ORDER_SPOTS.houseInForest, /Trees stand in the way/],
    ]) {
      const over = spot(WIDE, place);
      await view.mouse.move(over.x, over.y, { steps: 3 });
      await expectSaid(view, `a house over ${where} says why it does not fit, ${label}`, reason);
      await session.still(view);
      await expectMarks(view, `a refused house reads over ${where}, ${label}`, await session.screenshot(view, `orders-refused-${where}-${label}`), { blocks: 60 });
    }
    await view.mouse.move(hover.x, hover.y, { steps: 3 });
  };
  await zooms('spring-noon');
  await session.reach(view, { day: 2, time: '00:00' });
  await zooms('spring-midnight');
  await session.reach(view, { day: 10, time: '12:00' });
  await zooms('winter-noon');
  await session.reach(view, { day: 11, time: '00:00' });
  await zooms('winter-midnight');

  await session.still(view);
  const beforeTurn = await session.screenshot(view, 'orders-12-before-turn');
  await session.drag(view, { x: 500, y: 300 }, { x: 700, y: 380 }, 'right');
  await session.still(view);
  session.expectChanged('a right-drag still turns the camera while a tool is active', beforeTurn, await session.screenshot(view, 'orders-13-turned'));
  await expectTool(view, 'the tool stays active through a right-drag', 'House');
  await view.keyboard.press('Escape');
  await expectTool(view, 'Escape puts House away', '');
  await tool(view, 'Chop').click();
  await expectTool(view, 'a click on Chop picks it', 'Chop');
  await tool(view, 'Chop').click();
  await expectTool(view, 'a second click on Chop puts it away', '');
  const inToolbar = () => toolbar(view).evaluate((node) => node.contains(document.activeElement));
  let stops = 0;
  for (; stops < 12 && !(await inToolbar()); stops++) await view.keyboard.press('Tab');
  session.check('the toolbar is one stop in the Tab order', await tool(view, 'Chop').evaluate((node) => node === document.activeElement), `${stops} presses of Tab reached it, at Chop`);
  const beforeArrow = await session.screenshot(view, 'orders-15a-before-arrow');
  await view.keyboard.press('ArrowDown');
  await session.still(view);
  session.check('ArrowDown moves from Chop to Quarry', await tool(view, 'Quarry').evaluate((node) => node === document.activeElement), 'focus on Quarry');
  const afterArrow = await session.screenshot(view, 'orders-15b-after-arrow');
  session.expectSameOutside('an arrow key in the toolbar leaves the camera alone', beforeArrow, afterArrow, coverBox(view, await toolbar(view).boundingBox()), 0.2);
  await view.keyboard.press('Enter');
  await expectTool(view, 'Tab, ArrowDown, and Enter pick Quarry', 'Quarry');
  await view.keyboard.press('Escape');
  await view.locator(WORLD).focus().catch(() => {});
  await session.still(view);
  const beforePan = await session.screenshot(view, 'orders-14-before-pan');
  await session.drag(view, { x: 800, y: 300 }, { x: 500, y: 450 });
  await session.still(view);
  session.expectChanged('a main-button drag with no tool moves the camera', beforePan, await session.screenshot(view, 'orders-15-panned'));

  const panels = async (page) => ({
    clock: await page.getByRole('region', { name: 'Clock' }).boundingBox(),
    controls: await page.getByRole('complementary', { name: 'Camera controls' }).boundingBox(),
    toolbar: await toolbar(page).boundingBox(),
    status: await status(page).boundingBox(),
  });
  const expectApart = async (page, viewport) => {
    const boxes = await panels(page);
    const inside = (box) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
    const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    const named = Object.entries(boxes);
    const ok = named.every(([, box]) => inside(box)) && named.every(([a, boxA], i) => named.slice(i + 1).every(([, boxB]) => disjoint(boxA, boxB)));
    const detail = named.map(([name, box]) => `${name} ${box ? `${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'missing'}`).join('; ');
    session.check(`the toolbar, status line, clock, and camera controls fit apart at ${viewport.width}x${viewport.height}`, ok, detail);
  };
  await view.keyboard.press('KeyH');
  await view.mouse.move(hover.x, hover.y, { steps: 3 });
  await expectApart(view, WIDE);
  await wide.context.close();
  seen.push(...wide.errors);

  const narrow = await session.open({ width: 960, height: 600 });
  for (const size of [{ width: 960, height: 600 }, { width: 960, height: 540 }]) {
    await narrow.page.setViewportSize(size);
    await session.settle(narrow.page);
    await narrow.page.keyboard.press('KeyH');
    const at = spot(size, ORDER_SPOTS.houseFits);
    await narrow.page.mouse.move(at.x, at.y, { steps: 3 });
    await expectSaid(narrow.page, `House previews a site at ${size.width}x${size.height}`, /Click to place the house site here/);
    await session.still(narrow.page);
    await expectApart(narrow.page, size);
    const date = await narrow.page.getByRole('status', { name: 'Date' }).boundingBox();
    const time = await narrow.page.getByRole('timer', { name: 'Time of day' }).boundingBox();
    session.check(`the date stays on one line at ${size.width}x${size.height}`, date.height < time.height, `date ${date.height.toFixed(0)} px tall, time ${time.height.toFixed(0)} px`);
    await session.screenshot(narrow.page, `orders-${size.width}x${size.height}`);
    await narrow.page.keyboard.press('Escape');
  }
  await narrow.context.close();
  seen.push(...narrow.errors);
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
    const browser = await launchBrowser();
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
