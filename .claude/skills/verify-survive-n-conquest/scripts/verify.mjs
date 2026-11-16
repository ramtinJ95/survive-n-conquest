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
// The share of the farthest view that is water. The lakes and rivers of seed 7 alone are 6% to 8% of a view, and with the sea around the island the farthest view read 40.6%.
const SEA_AROUND_THE_ISLAND = 0.25;
// The share of the farthest and lowest view that has the color of the sky. The camera never looks above the horizon, and the haze hides the sea beyond 900 m in that color. The view read 7.6%.
const SKY_AT_THE_HORIZON = 0.05;
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

function countDraws() {
  const sent = { calls: 0, triangles: 0 };
  window.drawsSent = sent;
  const gl = WebGL2RenderingContext.prototype;
  const count = (name, vertices, instances) => {
    const draw = gl[name];
    gl[name] = function (...args) {
      sent.calls++;
      if (args[0] === this.TRIANGLES) sent.triangles += (args[vertices] / 3) * (instances ? args[instances] : 1);
      return draw.apply(this, args);
    };
  };
  count('drawArrays', 2);
  count('drawElements', 1);
  count('drawArraysInstanced', 2, 3);
  count('drawElementsInstanced', 1, 4);
}

function timeFrames() {
  if (!window.drawsSent) throw new Error('timeFrames tells a drawn frame by the draws that countDraws counts, so countDraws runs first');
  const getContext = HTMLCanvasElement.prototype.getContext;
  const contexts = new Set();
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = getContext.call(this, type, ...rest);
    if (type === 'webgl2' && context) contexts.add(context);
    return context;
  };
  const request = window.requestAnimationFrame.bind(window);
  window.frameCosts = [];
  window.requestAnimationFrame = (callback) =>
    request((time) => {
      const drawn = window.drawsSent.calls;
      const from = performance.now();
      callback(time);
      if (window.drawsSent.calls === drawn) return;
      for (const gl of contexts) gl.finish();
      window.frameCosts.push(performance.now() - from);
    });
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

/** Whether the instance serves a binary glTF file of models. `vite preview` answers a missing file with the page itself. */
async function servesModels(url) {
  try {
    const response = await fetch(`${url}models.glb`);
    return response.ok && Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString('latin1') === 'glTF';
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

const rendererOf = (page) =>
  page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown renderer';
  });

async function launchGpuBrowser() {
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', `--use-angle=${process.platform === 'darwin' ? 'metal' : 'default'}`, '--disable-gpu-vsync', '--disable-frame-rate-limit'];
  const seen = [];
  for (const headless of [true, false]) {
    const browser = await playwright().chromium.launch({ args, headless });
    const page = await browser.newPage();
    const renderer = await rendererOf(page);
    await page.close();
    if (!/swiftshader|llvmpipe|software/i.test(renderer)) return { browser, renderer };
    seen.push(`${headless ? 'headless' : 'a window'}: ${renderer}`);
    await browser.close();
  }
  fail(`no browser here draws on a GPU (${seen.join('; ')})`);
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
    check(
      'the build serves the models',
      await servesModels(instance.url),
      `${instance.url}models.glb; without it the game draws stand-in shapes, so clone the private assets repository into game-assets/ and launch again`,
    );
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

/**
 * Converts a video to a GIF that starts `from` seconds in and is no wider than `width`, and steps its size down until
 * it is under the limit. `crop`, a box in video pixels, keeps only that part of the picture, and `colors` caps the
 * palette of every step.
 */
function toGif(video, gif, { from = 0, to, width = GIF_STEPS[0].width, crop, colors = 256 } = {}) {
  const span = to === undefined ? [] : ['-t', (to - from).toFixed(2)];
  const cut = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : '';
  for (const step of GIF_STEPS.filter((step) => step.width <= width)) {
    const palette = `${cut}fps=${step.fps},scale=${step.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${Math.min(step.colors, colors)}:stats_mode=diff[p];[b][p]paletteuse=dither=none`;
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

function createSession(browser, instance, dir, evidence, gpu = false) {
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
      await context.addInitScript(countDraws);
      await context.addInitScript(gpu ? timeFrames : paceFramesToTheGpu);
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

    async drawsPerFrame(page) {
      return page.evaluate(async () => {
        const frames = 10;
        const frame = () => new Promise((done) => requestAnimationFrame(done));
        await frame();
        const { calls, triangles } = window.drawsSent;
        for (let drawn = 0; drawn < frames; drawn++) await frame();
        return { calls: (window.drawsSent.calls - calls) / frames, triangles: Math.round((window.drawsSent.triangles - triangles) / frames) };
      });
    },

    async frameWork(page, ms) {
      if (!gpu) fail('only a scenario marked `gpu` times its frames, because headless Chromium draws on the CPU');
      await page.evaluate(() => (window.frameCosts.length = 0));
      await page.waitForTimeout(ms);
      const costs = await page.evaluate(() => window.frameCosts.slice());
      if (costs.length === 0) fail(`the page drew no frame in ${ms} ms`);
      return { frames: costs.length, mean: costs.reduce((sum, cost) => sum + cost, 0) / costs.length, perSecond: (costs.length * 1000) / ms };
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
/**
 * A settler is 1.1 m tall and wears a tunic between its hair and its legs. At the camp zoom the 8 tunics showed 185
 * villager pixels at 15:00, and the bare map 7. The limits are the same shares of those readings as 400 and 50 were of
 * the 486 pixels that 8 settlers of 1.75 m in one color showed.
 */
const SETTLER_TUNICS = { least: 150, bareMost: 20 };
/** Between 21:00 and 04:30 the light changes the shading of the settlers, so the outline they leave moves by a few pixels. */
const SETTLER_STAYED = 10;
/**
 * The flame of the camp's fire, in clip pixels of the opening view on seed 7. The sun does not light the flame, and its
 * red and orange are a monster's colors by day, so a check that no unit glows at night leaves this box out. At midnight
 * the flame held 53 monster-colored pixels between (465, 254) and (489, 265).
 */
const OPENING_FIRE = { x: 448, y: 240, width: 60, height: 40 };
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
/** The rows of a picture below the horizon of the opening view, where the season checks read the map. */
const BELOW_HORIZON_ROWS = [0.35, 1];
/**
 * The share of the map, below the horizon, that each season must and must not color at noon. The shares of plants,
 * orange, and snow are read on the small probe picture. Blossom grows in groves of one kind of tree, and a crown is
 * smaller than a probe pixel, so `blossom` is the share of the pixels of the full picture. On seed 7 the spring read
 * 1.03%, and summer, autumn, and winter 0.06%, 0.03%, and 0.03%. Spring needs four times what the others may show.
 */
const SEASON_LOOKS = [
  { season: 'Spring', atLeast: { plants: 0.4 }, atMost: { orange: 0.02, snow: 0.02 }, blossom: { atLeast: 0.006 } },
  { season: 'Summer', atLeast: { plants: 0.4 }, atMost: { orange: 0.02, snow: 0.02 }, blossom: { atMost: 0.0015 } },
  { season: 'Autumn', atLeast: { orange: 0.15 }, atMost: { plants: 0.2, snow: 0.02 }, blossom: { atMost: 0.0015 } },
  { season: 'Winter', atLeast: { snow: 0.3 }, atMost: { plants: 0.02, orange: 0.02 }, blossom: { atMost: 0.0015 } },
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
    session.expectSurfaces('the sea shows around the island at the farthest view', farthest, { water: SEA_AROUND_THE_ISLAND });
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

    await page.mouse.wheel(0, READ_WHEELS.near);
    await session.hold(page, 'KeyF', 6000);
    await session.still(page);
    const nearest = await shoot('nearest');
    await page.mouse.wheel(0, -2000);
    await session.hold(page, 'KeyZ', 1000);
    await session.hold(page, 'KeyF', 1000);
    await session.still(page);
    session.expectUnchanged('zooming in and tilting stop at the lowest view', nearest, await shoot('nearest-again'));
    await context.close();

    const low = await session.open(WIDE, { search: '?swarm=off' });
    await low.page.mouse.move(CENTER.x, CENTER.y);
    await low.page.mouse.wheel(0, READ_WHEELS.far);
    await session.hold(low.page, 'KeyF', 6000);
    await session.still(low.page);
    const horizon = await session.screenshot(low.page, `camera-${String(++shots).padStart(2, '0')}-horizon`);
    session.expectSurfaces('the sky shows at the horizon of the farthest and lowest view', horizon, { sky: SKY_AT_THE_HORIZON });
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
    const atFire = (kind) => pixelsIn(at.midnight.png, CLIP.width, OPENING_FIRE, UNIT_COLORS[kind]).count;
    const away = { villagers: unlit.villagers - atFire('villagers'), monsters: unlit.monsters - atFire('monsters') };
    session.check(
      'no villager or monster glows at midnight, away from the flame of the camp',
      away.villagers < 50 && away.monsters < 50,
      `${away.villagers} villager pixels and ${away.monsters} monster pixels in their daylight colors outside the fire's box, needs fewer than 50 of each; the box holds ${atFire('villagers')} and ${atFire('monsters')}`,
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
    const evening = {};
    const below = { x: 0, y: Math.floor(BELOW_HORIZON_ROWS[0] * WIDE.height), width: WIDE.width, height: WIDE.height - Math.floor(BELOW_HORIZON_ROWS[0] * WIDE.height) };
    let lastNoon = null;
    for (const [index, { season, atLeast, atMost, blossom }] of SEASON_LOOKS.entries()) {
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

      session.expectShares(`${season} colors the map at noon`, SEASON_MARKS, shots.noon, { atLeast, atMost }, BELOW_HORIZON_ROWS);
      const pink = pixelsIn(shots.noon, WIDE.width, below, SEASON_MARKS.blossom).count / (below.width * below.height);
      const percent = (share) => `${(share * 100).toFixed(2)}%`;
      session.check(
        blossom.atLeast ? `${season} is in blossom at noon` : `nothing is in blossom at noon in ${season}`,
        blossom.atLeast ? pink >= blossom.atLeast : pink <= blossom.atMost,
        `blossom colors ${percent(pink)} of the pixels below the horizon, needs ${blossom.atLeast ? `at least ${percent(blossom.atLeast)}` : `at most ${percent(blossom.atMost)}`}`,
      );
      if (lastNoon) session.expectChanged(`${season} looks different from the season before it`, lastNoon, shots.noon);
      lastNoon = shots.noon;

      const noon = meanColor(shots.noon);
      const midnight = meanColor(shots.midnight);
      const dusk = meanColor(shots.evening);
      evening[season] = { kept: brightness(dusk) / brightness(noon), blue: blueness(dusk), halfway: (blueness(noon) + blueness(midnight)) / 2 };
      session.check(
        `midnight in ${season} is dark, cold, and light enough to see the map`,
        brightness(midnight) < 0.6 * brightness(noon) &&
          brightness(midnight) >= 20 &&
          blueness(midnight) > 1.5 * blueness(noon),
        `midnight is ${brightness(midnight).toFixed(0)} against ${brightness(noon).toFixed(0)} at noon, on a scale of 255, and has ${blueness(midnight).toFixed(2)} times as much blue as red against ${blueness(noon).toFixed(2)} at noon`,
      );
    }
    const { Summer, Winter } = evening;
    session.check(
      `at ${EVENING} it is still day in summer and already night in winter`,
      Summer.blue < Summer.halfway && Winter.blue > Winter.halfway && Summer.kept > Winter.kept,
      `the summer evening has ${Summer.blue.toFixed(2)} parts of blue for each of red, needs less than ${Summer.halfway.toFixed(2)}, halfway between its noon and its midnight; ` +
        `the winter evening has ${Winter.blue.toFixed(2)}, needs more than ${Winter.halfway.toFixed(2)}; ` +
        `the summer evening keeps ${(Summer.kept * 100).toFixed(0)}% of its noon brightness and the winter evening ${(Winter.kept * 100).toFixed(0)}%, needs more in summer`,
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
  session.check(
    'the settlers show by day',
    lit.villagers >= SETTLER_TUNICS.least && none.villagers < SETTLER_TUNICS.bareMost,
    `${lit.villagers} villager pixels with the settlers and ${none.villagers} on the bare map at 15:00, needs ${SETTLER_TUNICS.least} and fewer than ${SETTLER_TUNICS.bareMost}`,
  );
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

/**
 * How the gathering scenario frames its work on seed 7, at 960 by 540. Each view zooms in by a wheel step, turns and
 * tilts by a right-drag, then pans forward by a main-button drag with no tool, all from the opening view on the camp.
 * Each of these moves depends only on its pixels once the view is at rest, so every run lands on the same view. The
 * grove view looks east from the camp at a grove on the near edge of the forest, with no other trees in front of it.
 * The rock view looks south at the north face of an outcrop, where the settlers stand to quarry it.
 *
 * `area` is the drag, as shares of the viewport. The grove drag covers tiles (140, 119) to (147, 127), which hold 12
 * trees. The rock drag covers tiles (116, 142) to (123, 144), 21 rock tiles, of which 8 have a walkable side. Each
 * spot picks its corner tile exactly. The boxes are in clip pixels: the grove with its crowns and pins, the rock face
 * with the settlers in front of it, and the camp disc with the settlers standing on it.
 */
const GATHER_VIEWS = {
  grove: {
    wheel: -500,
    turn: { x: 424, y: 60 },
    pan: 76,
    area: [[0.403, 0.429], [0.495, 0.299]],
    box: { x: 370, y: 110, width: 125, height: 135 },
  },
  rock: {
    wheel: -500,
    turn: { x: -518, y: 60 },
    pan: 76,
    area: [[0.636, 0.344], [0.551, 0.321]],
    box: { x: 510, y: 140, width: 120, height: 75 },
    camp: { x: 440, y: 305, width: 95, height: 80 },
  },
};
/**
 * The clips keep the clock, the camp, and the work at full size, and leave out the toolbar and the camera hint. 64
 * colors keep each clip under 4 MB, and the logs, the stone, and the settlers still read.
 */
const GATHER_CLIP = { crop: { x: 200, y: 0, width: 560, height: 420 }, width: 560, colors: 64 };
const paleWood = (dimmest) => ([r, g, b]) => r > dimmest && g > 0.72 * r && g < 0.9 * r && b > 0.45 * r && b < 0.7 * r;
/**
 * Pale cut wood and pale grey stone, as the `paint` of the log and the stone in `assets/models.json` looks in spring
 * daylight. The warm sun lights the stone to a white that leans a little yellow, near (210, 209, 204), and the sky
 * colors its shaded faces blue, so `stone` takes a grey on either side of neutral. It stops below the white ink of a
 * label, and a label's blurred edge still matches it, so a box that reads stone leaves the labels out.
 */
const GOOD_COLORS = {
  logs: paleWood(150),
  stone: ([r, g, b]) => Math.min(r, g, b) > 120 && Math.max(r, g, b) < 232 && Math.max(r, g, b) - Math.min(r, g, b) < 45 && b > r - 16 && g > r - 10,
};

/**
 * On seed 7, with the drags a few minutes after 08:00, the grove was clear by 12:42. All 8 settlers stood at the camp
 * by 20:10 and were back at work by 06:00. The 8 rock tiles open to a side were spent between 08:05 and 08:56 on
 * day 2. Each stop leaves half an hour or more on both sides of those times.
 */
const GROVE_CLEARED = { day: 1, time: '13:30' };
const GATHER_STOPS = [
  ['working', { day: 1, time: '12:00' }],
  ['dusk', { from: { day: 1, time: '18:55' }, to: { day: 1, time: '20:15' } }],
  ['night', { day: 1, time: '21:00' }],
  ['dawn', { from: { day: 2, time: '04:40' }, to: { day: 2, time: '06:10' } }],
  ['back', { day: 2, time: '07:00' }],
  ['spent', { day: 2, time: '09:30' }],
];
/**
 * On the owner's Mac the grove box held 522 pin pixels before and 0 after, and 0 log pixels before and 117 after. The
 * rock box held 0 stone pixels before and 297 at the last stop. The settlers at the face work in the shade of the rock,
 * where `TUNIC_IN_SHADE` matched 46 and 87 pixels at the two day stops and none on the bare map. The camp box differed
 * from the bare map in 0 pixels by day and 342 at night. The marks' tint fell from 3094 to 1684 pixels once the first
 * row of the face was spent, and the settlers moved 15 pixels up the screen onto it.
 */
const GATHER_LEAST = { pins: 200, logs: 80, stone: 150, workers: 25, campAtNight: 200, tintLost: 0.25, climb: 6 };
const GATHER_MOST = { leftover: 10, goodsBefore: 10, campByDay: 20, tunicsOnBare: 2 };
/**
 * The tunic of a settler in the sun or in the shade of the rock, where `UNIT_COLORS.villagers` is too bright for it.
 * Lit thatch matches it too, so it reads settlers only where the bare map shows none of it, as at the rock face.
 */
const TUNIC_IN_SHADE = ([r, g, b]) => r > 120 && g > 0.55 * r && g < 0.9 * r && b < 0.3 * r;

/** The violet that the quarry mark mixes into the ground of each marked rock tile. */
const QUARRY_TINT = ([r, g, b]) => b > g + 35 && r > g + 15;

/** Counts the pixels inside `box` of a screenshot `width` pixels wide that `matches` accepts, and their mean row. */
function pixelsIn(png, width, box, matches) {
  const pixels = ffmpeg(['-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  let count = 0;
  let rows = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * width + x) * 3;
      if (!matches([pixels[i], pixels[i + 1], pixels[i + 2]])) continue;
      count += 1;
      rows += y;
    }
  }
  return { count, row: count > 0 ? rows / count : NaN };
}

/** Counts the pixels inside `box` where two screenshots of one size differ by more than `threshold` in some channel. */
function changedIn(pngA, pngB, width, box, threshold = SETTLER_THRESHOLD) {
  const a = ffmpeg(['-i', pngA, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const b = ffmpeg(['-i', pngB, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  let count = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = (y * width + x) * 3;
      if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > threshold) count += 1;
    }
  }
  return count;
}

/** Takes one of the `GATHER_VIEWS` on a page at the `CLIP` size, from the opening view. */
async function takeView(session, page, view) {
  const middle = { x: CLIP.width / 2, y: CLIP.height / 2 };
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, view.wheel);
  await session.still(page);
  const from = { x: middle.x - view.turn.x / 2, y: middle.y - view.turn.y / 2 };
  await session.drag(page, from, { x: from.x + view.turn.x, y: from.y + view.turn.y }, 'right');
  await session.still(page);
  await session.drag(page, { x: middle.x, y: middle.y - view.pan / 2 }, { x: middle.x, y: middle.y + view.pan / 2 });
  await session.still(page);
}

SCENARIOS.gathering = async (session) => {
  const seen = [];
  const spot = ([fx, fy]) => ({ x: Math.round(fx * CLIP.width), y: Math.round(fy * CLIP.height) });
  const status = (page) => page.getByRole('status', { name: 'Order' });
  const expectSaid = async (page, name, pattern) => {
    const ok = await status(page).filter({ hasText: pattern }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
    session.check(name, ok, `the status line reads "${(await status(page).textContent()) ?? ''}"`);
  };
  const mark = async (page, key, [from, to]) => {
    await page.keyboard.press(key);
    await session.drag(page, spot(from), spot(to));
  };
  const count = (png, box, matches) => pixelsIn(png, CLIP.width, box, matches).count;
  const chopPins = (png) => count(png, GATHER_VIEWS.grove.box, (rgb) => distance(rgb, ORDER_RGB.chop) < ORDER_TOLERANCE);

  // Runs the clock at the speed of `key` until it shows `when`, then pauses, a few game minutes past it at 8×.
  const runTo = async (page, key, when) => {
    await page.keyboard.press(key);
    const wanted = clockMinutes(when);
    const deadline = Date.now() + 180_000;
    while ((await session.gameMinutes(page)) < wanted) {
      if (Date.now() > deadline) fail(`the clock did not reach ${clockText(wanted)} in three minutes`);
      await page.waitForTimeout(100);
    }
    await session.pause(page);
  };

  const grove = await session.open(CLIP, { record: true, clock: 'paused' });
  await takeView(session, grove.page, GATHER_VIEWS.grove);
  const groveFrom = grove.since();
  await mark(grove.page, 'KeyC', GATHER_VIEWS.grove.area);
  await expectSaid(grove.page, 'a Chop drag marks the grove', /^12 trees marked for felling/);
  await grove.page.keyboard.press('Escape');
  await session.still(grove.page);
  const marked = await session.screenshot(grove.page, 'gathering-grove-marked');
  await runTo(grove.page, '4', GROVE_CLEARED);
  await session.still(grove.page);
  const cleared = await session.screenshot(grove.page, 'gathering-grove-cleared');
  const groveTo = grove.since();
  await session.finishClips(grove.context, grove.page, [{ label: 'gathering-grove', from: groveFrom, to: groveTo, ...GATHER_CLIP }]);
  seen.push(...grove.errors);

  const pins = { before: chopPins(marked), after: chopPins(cleared) };
  session.check('the marked grove shows its pins', pins.before >= GATHER_LEAST.pins, `${pins.before} pure chop pixels in the grove, needs ${GATHER_LEAST.pins}`);
  session.check(
    `by ${GROVE_CLEARED.time} the settlers have felled every marked tree`,
    pins.after <= GATHER_MOST.leftover,
    `${pins.after} pure chop pixels left in the grove, from ${pins.before}; needs at most ${GATHER_MOST.leftover}`,
  );
  const logs = { before: count(marked, GATHER_VIEWS.grove.box, GOOD_COLORS.logs), after: count(cleared, GATHER_VIEWS.grove.box, GOOD_COLORS.logs) };
  session.check(
    'the felled trees leave logs on the ground',
    logs.before <= GATHER_MOST.goodsBefore && logs.after >= GATHER_LEAST.logs,
    `${logs.before} log pixels in the grove before and ${logs.after} after, needs at most ${GATHER_MOST.goodsBefore} and then ${GATHER_LEAST.logs}`,
  );

  const rock = await session.open(CLIP, { record: true, clock: 'paused' });
  await takeView(session, rock.page, GATHER_VIEWS.rock);
  await mark(rock.page, 'KeyM', GATHER_VIEWS.rock.area);
  await expectSaid(rock.page, 'a Quarry drag marks the rock face', /^21 rock tiles marked for quarrying/);
  await rock.page.keyboard.press('Escape');
  await session.still(rock.page);
  const face = await session.screenshot(rock.page, 'gathering-rock-marked');
  const cuts = [];
  const shots = {};
  for (const [name, when] of GATHER_STOPS) {
    if (name === 'dusk' || name === 'dawn') {
      await session.reach(rock.page, when.from);
      const from = rock.since();
      await runTo(rock.page, '2', when.to);
      cuts.push({ label: `gathering-${name}`, from, to: rock.since(), ...GATHER_CLIP });
      continue;
    }
    if (name === 'spent') {
      const from = rock.since();
      await runTo(rock.page, '3', when);
      await session.still(rock.page);
      shots.spent = await session.screenshot(rock.page, 'gathering-rock-spent');
      cuts.push({ label: 'gathering-quarry', from, to: rock.since(), ...GATHER_CLIP });
      continue;
    }
    await session.reach(rock.page, when);
    await session.still(rock.page);
    shots[name] = await session.screenshot(rock.page, `gathering-${name}`);
  }
  await session.finishClips(rock.context, rock.page, cuts);
  seen.push(...rock.errors);

  const bare = await session.open(CLIP, { search: '?swarm=off', clock: 'paused' });
  await takeView(session, bare.page, GATHER_VIEWS.rock);
  const empty = {};
  for (const [name, when] of GATHER_STOPS) {
    if (!['working', 'night', 'back'].includes(name)) continue;
    await session.reach(bare.page, when);
    await session.still(bare.page);
    empty[name] = await session.screenshot(bare.page, `gathering-bare-${name}`);
  }
  await bare.context.close();
  seen.push(...bare.errors);

  const atCamp = (name) => changedIn(empty[name], shots[name], CLIP.width, GATHER_VIEWS.rock.camp);
  const atRock = (name) => pixelsIn(shots[name], CLIP.width, GATHER_VIEWS.rock.box, TUNIC_IN_SHADE);
  const camp = { working: atCamp('working'), night: atCamp('night'), back: atCamp('back') };
  const workers = { working: atRock('working').count, back: atRock('back').count };
  const noWorkers = { working: count(empty.working, GATHER_VIEWS.rock.box, TUNIC_IN_SHADE), back: count(empty.back, GATHER_VIEWS.rock.box, TUNIC_IN_SHADE) };
  const when = Object.fromEntries(GATHER_STOPS.map(([name, stop]) => [name, stop.time ?? stop.to?.time]));
  session.check(
    'the bare rock face shows nothing in the color of a tunic',
    noWorkers.working <= GATHER_MOST.tunicsOnBare && noWorkers.back <= GATHER_MOST.tunicsOnBare,
    `${noWorkers.working} tunic pixels at the rock face of the bare map at ${when.working} and ${noWorkers.back} at ${when.back}, needs at most ${GATHER_MOST.tunicsOnBare}`,
  );
  session.check(
    `at ${when.working} the settlers quarry the rock face, away from the camp`,
    workers.working >= GATHER_LEAST.workers && camp.working <= GATHER_MOST.campByDay,
    `${workers.working} tunic pixels at the rock face, needs ${GATHER_LEAST.workers}; ${camp.working} pixels at the camp differ from the bare map, needs at most ${GATHER_MOST.campByDay}`,
  );
  session.check(
    `at ${when.night} the settlers have left the work and stand at the camp`,
    camp.night >= GATHER_LEAST.campAtNight,
    `${camp.night} pixels at the camp differ from the bare map, needs ${GATHER_LEAST.campAtNight}`,
  );
  session.check(
    `at ${when.back} on day 2 the settlers are back at the rock face`,
    workers.back >= GATHER_LEAST.workers && camp.back <= GATHER_MOST.campByDay,
    `${workers.back} tunic pixels at the rock face, needs ${GATHER_LEAST.workers}; ${camp.back} pixels at the camp differ from the bare map, needs at most ${GATHER_MOST.campByDay}`,
  );
  const stone = { before: count(face, GATHER_VIEWS.rock.box, GOOD_COLORS.stone), after: count(shots.spent, GATHER_VIEWS.rock.box, GOOD_COLORS.stone) };
  session.check(
    'quarried rock leaves stone in front of the rock face',
    stone.before <= GATHER_MOST.goodsBefore && stone.after >= GATHER_LEAST.stone,
    `${stone.before} stone pixels at the rock face before and ${stone.after} at ${when.spent} on day 2, needs at most ${GATHER_MOST.goodsBefore} and then ${GATHER_LEAST.stone}`,
  );
  const tint = { back: count(shots.back, GATHER_VIEWS.rock.box, QUARRY_TINT), spent: count(shots.spent, GATHER_VIEWS.rock.box, QUARRY_TINT) };
  session.check(
    `by ${when.spent} on day 2 rock tiles are spent and lose their mark`,
    tint.spent <= tint.back * (1 - GATHER_LEAST.tintLost),
    `${tint.back} quarry-tinted pixels at the rock face at ${when.back} and ${tint.spent} at ${when.spent}, needs ${GATHER_LEAST.tintLost * 100}% fewer`,
  );
  const climb = atRock('back').row - atRock('spent').row;
  session.check(
    `by ${when.spent} the settlers stand on the spent tiles to quarry the rock behind them`,
    climb >= GATHER_LEAST.climb,
    `the settlers at the rock face moved ${climb.toFixed(1)} pixels up the screen, toward the rock, from ${when.back}; needs ${GATHER_LEAST.climb}`,
  );
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/**
 * Every hauling page takes the grove view of `GATHER_VIEWS` on seed 7 and clears the grove before it marks a stockpile,
 * so that the 24 logs of the 12 felled trees lie in the grove when the carrying starts. The drags are shares of the
 * viewport: `near` is 20 tiles of grass between the grove and the camp, `small` is 2 tiles there, and `far` is 20
 * tiles near the lake, a long walk from the grove. The boxes are in clip pixels: the near stockpile with the stacks
 * that rise above it, the open grass that the carriers cross between the grove and the far stockpile, and the camp
 * disc. The route box ends 8 pixels short of the felled grove, whose shadows change, and short of the far stockpile.
 */
const HAUL_SPOTS = {
  near: [[0.35, 0.53], [0.39, 0.6]],
  small: [[0.37, 0.54], [0.371, 0.55]],
  far: [[0.15, 0.56], [0.19, 0.63]],
};
const HAUL_BOXES = {
  near: { x: 325, y: 250, width: 70, height: 85 },
  route: { x: 205, y: 190, width: 150, height: 90 },
  camp: { x: 440, y: 320, width: 75, height: 70 },
};
/**
 * The clip keeps the Stockpiles panel, the time, the grove, and the near stockpile. It runs 25 s of video, half of it
 * at 1× while `reach` closes in on a stop, and at 560 by 380 pixels in 64 colors it took 6.0 MB. 40 colors and this
 * crop keep it near 4 MB, and the logs, the carriers, and the totals still read.
 */
const HAUL_CLIP = { crop: { x: 0, y: 0, width: 510, height: 345 }, width: 510, colors: 40 };
/**
 * On seed 7, with the grove cleared and the near stockpile marked at 13:30, the panel read 6 logs at 14:30, 8 at 15:30,
 * 16 at 16:30, 22 at 17:30, and 24 at 18:30. The 2-tile stockpile was full by 16:30. With the far stockpile marked at
 * 15:30 the panel read 0 at 17:00 and 8 at 19:05, all night, and at 07:00 on day 2, and 24 by 11:00 on day 2.
 * `GOOD_COLORS` matches the logs in the sun until 17:30 and no longer at 18:30, so every log count stops in daylight.
 */
const HAUL_STOPS = {
  cleared: { day: 1, time: '13:30' },
  rising: { day: 1, time: '15:00' },
  stacked: { day: 1, time: '17:30' },
  full: { day: 1, time: '17:00' },
  stillFull: { day: 2, time: '10:00' },
  farMarked: { day: 1, time: '15:30' },
  beforeDusk: { day: 1, time: '19:05' },
  afterDusk: { day: 1, time: '19:30' },
  night: { day: 1, time: '21:00' },
  beforeDawn: { day: 2, time: '04:30' },
  carried: { day: 2, time: '11:00' },
};
/**
 * On the owner's Mac the grove box held 117 log pixels at 13:30 and 0 at 17:30, and the near stockpile's box 0, 89, and
 * 218 at 13:30, 15:00, and 17:30. Beside the full stockpile the carriers take the front logs first, and the 8 left lie
 * in the deep shade under the crowns at the back, where the sky colors the pale wood near (100, 96, 78) and
 * `GOOD_COLORS.logs` matches none of it. There the grove box held 91 pixels of `LOGS_IN_A_CLEARED_GROVE_BY_DAY` at
 * 17:00 and 100 at 10:00 on day 2, about 12 for each log, 332 with all 24 logs at 13:30, and 0 in the emptied grove
 * at 17:30. Before the far stockpile the route held 31 log pixels, all of them pink flowers that the bare map shows
 * too, and differed from the bare map in 0 pixels. It differed in 193 at 19:05 and in 143 at 21:00. The camp box
 * differed from the bare map in 324 pixels at 21:00. After dawn the carriers lift the dropped units between 06:00 and
 * 09:00 while the low sun brightens, so a reading then catches the scene in motion: in a pylon the route read 149, 1,
 * 33, 10, and 32 more log pixels than the bare map at 06:00, 06:30, 07:00, 07:30, and 09:00, and 20 at 07:00 with the
 * scenario's own stops. By 11:00 the route is clear again, and it and the bare map both read 1. With the dropped units never carried on it held 35 log
 * pixels at 11:00 against 1 on the bare map.
 */
const HAUL_LEAST = { lying: 100, rising: 40, stacked: 150, noPlace: 50, routeByDusk: 100, droppedAtNight: 50, campAtNight: 150 };
const HAUL_MOST = { goodsBefore: 10, leftInGrove: 0.5, emptyGrove: 5, routeBefore: 20 };
/**
 * The wood of a log in the sun or in the blue shade under a crown. Blossom, flowers, and the forest in the evening
 * match it too, so it reads logs only in a grove that is felled, by day, and beside a reading of the same grove empty.
 */
const LOGS_IN_A_CLEARED_GROVE_BY_DAY = ([r, g, b]) => r > 90 && g > 0.72 * r && g < 1.02 * r && b > 0.45 * r && b < 0.84 * r;
/** A log put down at night differs from the bare ground by about 25 in its brightest channel, too little for `SETTLER_THRESHOLD`. */
const NIGHT_THRESHOLD = 12;

SCENARIOS.hauling = async (session) => {
  const seen = [];
  const spot = ([fx, fy]) => ({ x: Math.round(fx * CLIP.width), y: Math.round(fy * CLIP.height) });
  const status = (page) => page.getByRole('status', { name: 'Order' });
  const said = async (page, pattern) => {
    await status(page).filter({ hasText: pattern }).waitFor({ timeout: 15_000 }).catch(() => {});
    return (await status(page).textContent()) ?? '';
  };
  const totals = async (page) => {
    const text = (await page.getByRole('status', { name: 'Stockpiles' }).textContent()) ?? '';
    const read = /Logs(\d+)Stone(\d+)/.exec(text);
    if (!read) fail(`the Stockpiles panel reads "${text}", not a Logs and a Stone total`);
    return { logs: Number(read[1]), stone: Number(read[2]) };
  };
  const mark = async (page, key, [from, to]) => {
    await page.keyboard.press(key);
    await session.drag(page, spot(from), spot(to));
  };
  const logsIn = (png, box) => pixelsIn(png, CLIP.width, box, GOOD_COLORS.logs).count;
  const at = async (page, when, label) => {
    await session.reach(page, when);
    await session.still(page);
    return { png: label && (await session.screenshot(page, label)), totals: await totals(page) };
  };
  const clearGrove = async (page) => {
    await takeView(session, page, GATHER_VIEWS.grove);
    await mark(page, 'KeyC', GATHER_VIEWS.grove.area);
    const chopped = await said(page, /^12 trees marked for felling/);
    await page.keyboard.press('Escape');
    return chopped;
  };
  const markStockpile = async (page, area) => {
    await mark(page, 'KeyP', area);
    const line = await said(page, /tiles? joins? the stockpile zone/);
    await page.keyboard.press('Escape');
    await session.still(page);
    const read = /^(\d+) tiles? joins? the stockpile zone/.exec(line);
    return { line, places: read ? Number(read[1]) * 8 : 0 };
  };
  const grove = GATHER_VIEWS.grove.box;
  const when = (stop) => `${HAUL_STOPS[stop].day > 1 ? `day ${HAUL_STOPS[stop].day} ` : ''}${HAUL_STOPS[stop].time}`;

  const fill = await session.open(CLIP, { record: true, clock: 'paused' });
  const chopped = await clearGrove(fill.page);
  session.check('a Chop drag marks the grove', chopped.startsWith('12 trees marked for felling'), `the status line reads "${chopped}"`);
  const cleared = await at(fill.page, HAUL_STOPS.cleared, 'hauling-grove-cleared');
  const fillFrom = fill.since();
  const near = await markStockpile(fill.page, HAUL_SPOTS.near);
  session.check('a Stockpile drag beside the grove makes room for all 24 logs', near.places >= 24, `the status line reads "${near.line}", ${near.places} places`);
  const rising = await at(fill.page, HAUL_STOPS.rising, 'hauling-grove-rising');
  const stacked = await at(fill.page, HAUL_STOPS.stacked, 'hauling-grove-stacked');
  await session.finishClips(fill.context, fill.page, [{ label: 'hauling-grove', from: fillFrom, to: fill.since(), ...HAUL_CLIP }]);
  seen.push(...fill.errors);

  const lying = logsIn(cleared.png, grove);
  session.check(
    `at ${when('cleared')}, with no stockpile, the felled logs lie in the grove and the panel counts none`,
    cleared.totals.logs === 0 && cleared.totals.stone === 0 && lying >= HAUL_LEAST.lying,
    `Logs ${cleared.totals.logs}, Stone ${cleared.totals.stone}, needs 0 and 0; ${lying} log pixels in the grove, needs ${HAUL_LEAST.lying}`,
  );
  session.check(
    `the Logs total rises from ${when('cleared')} to ${when('rising')} to ${when('stacked')}`,
    cleared.totals.logs === 0 && rising.totals.logs > 0 && stacked.totals.logs > rising.totals.logs,
    `Logs ${cleared.totals.logs}, then ${rising.totals.logs}, then ${stacked.totals.logs}`,
  );
  const piled = { before: logsIn(cleared.png, HAUL_BOXES.near), rising: logsIn(rising.png, HAUL_BOXES.near), stacked: logsIn(stacked.png, HAUL_BOXES.near) };
  session.check(
    'the logs stack up inside the stockpile',
    piled.before <= HAUL_MOST.goodsBefore && piled.rising >= HAUL_LEAST.rising && piled.stacked >= HAUL_LEAST.stacked,
    `${piled.before}, ${piled.rising}, and ${piled.stacked} log pixels in the stockpile, needs at most ${HAUL_MOST.goodsBefore}, then ${HAUL_LEAST.rising}, then ${HAUL_LEAST.stacked}`,
  );
  const left = logsIn(stacked.png, grove);
  session.check(
    `by ${when('stacked')} the logs have left the grove`,
    left <= lying * HAUL_MOST.leftInGrove,
    `${left} log pixels in the grove, from ${lying}; needs at most ${HAUL_MOST.leftInGrove * 100}% of them`,
  );

  const full = await session.open(CLIP, { clock: 'paused' });
  await clearGrove(full.page);
  await session.reach(full.page, HAUL_STOPS.cleared);
  const small = await markStockpile(full.page, HAUL_SPOTS.small);
  session.check('a Stockpile drag makes fewer places than the 24 logs', small.places > 0 && small.places < 24, `the status line reads "${small.line}", ${small.places} places`);
  const filled = await at(full.page, HAUL_STOPS.full, 'hauling-full-filled');
  const stillFull = await at(full.page, HAUL_STOPS.stillFull, 'hauling-full');
  await full.context.close();
  seen.push(...full.errors);
  session.check(
    `the full stockpile holds as many logs as it has places at ${when('full')} and at ${when('stillFull')}`,
    filled.totals.logs === small.places && stillFull.totals.logs === small.places,
    `Logs ${filled.totals.logs} and then ${stillFull.totals.logs}, needs ${small.places} both times`,
  );
  const shadedLogsIn = (png) => pixelsIn(png, CLIP.width, grove, LOGS_IN_A_CLEARED_GROVE_BY_DAY).count;
  const outside = { filled: shadedLogsIn(filled.png), stillFull: shadedLogsIn(stillFull.png), emptied: shadedLogsIn(stacked.png) };
  session.check(
    `at ${when('full')} and at ${when('stillFull')} the logs with no place still lie in the grove`,
    outside.filled >= HAUL_LEAST.noPlace && outside.stillFull >= HAUL_LEAST.noPlace && outside.emptied <= HAUL_MOST.emptyGrove,
    `${outside.filled} and then ${outside.stillFull} log pixels in the grove, needs ${HAUL_LEAST.noPlace} both times; ` +
      `${outside.emptied} in the grove that the first stockpile emptied by ${when('stacked')}, needs at most ${HAUL_MOST.emptyGrove}`,
  );

  const walk = await session.open(CLIP, { clock: 'paused' });
  await clearGrove(walk.page);
  const route = await at(walk.page, HAUL_STOPS.farMarked, 'hauling-route-before');
  const far = await markStockpile(walk.page, HAUL_SPOTS.far);
  session.check('a Stockpile drag far from the grove makes room for all 24 logs', far.places >= 24, `the status line reads "${far.line}", ${far.places} places`);
  const beforeDusk = await at(walk.page, HAUL_STOPS.beforeDusk, 'hauling-dusk-before');
  const afterDusk = await at(walk.page, HAUL_STOPS.afterDusk);
  const night = await at(walk.page, HAUL_STOPS.night, 'hauling-dusk-after');
  const beforeDawn = await at(walk.page, HAUL_STOPS.beforeDawn);
  const carried = await at(walk.page, HAUL_STOPS.carried, 'hauling-dawn-carried');
  await walk.context.close();
  seen.push(...walk.errors);

  const bare = await session.open(CLIP, { search: '?swarm=off', clock: 'paused' });
  await takeView(session, bare.page, GATHER_VIEWS.grove);
  const empty = {};
  for (const stop of ['farMarked', 'beforeDusk', 'night', 'carried']) empty[stop] = (await at(bare.page, HAUL_STOPS[stop], `hauling-bare-${stop}`)).png;
  await bare.context.close();
  seen.push(...bare.errors);

  const onRoute = (stop, png, threshold) => changedIn(empty[stop], png, CLIP.width, HAUL_BOXES.route, threshold);
  const routeBefore = { logs: logsIn(route.png, HAUL_BOXES.route), bare: logsIn(empty.farMarked, HAUL_BOXES.route), changed: onRoute('farMarked', route.png) };
  session.check(
    `at ${when('farMarked')}, before the far stockpile, nothing lies on the route`,
    routeBefore.logs - routeBefore.bare <= HAUL_MOST.goodsBefore && routeBefore.changed <= HAUL_MOST.routeBefore,
    `${routeBefore.logs} log pixels on the route and ${routeBefore.bare} on the bare map, needs at most ${HAUL_MOST.goodsBefore} more; ${routeBefore.changed} pixels differ from the bare map, needs at most ${HAUL_MOST.routeBefore}`,
  );
  const carrying = onRoute('beforeDusk', beforeDusk.png);
  session.check(
    `at ${when('beforeDusk')} carriers walk the route`,
    carrying >= HAUL_LEAST.routeByDusk,
    `${carrying} pixels on the route differ from the bare map, needs ${HAUL_LEAST.routeByDusk}`,
  );
  const dropped = onRoute('night', night.png, NIGHT_THRESHOLD);
  const camp = changedIn(empty.night, night.png, CLIP.width, HAUL_BOXES.camp);
  session.check(
    `at ${when('night')} the units lie on the route where the carriers put them down, and the settlers stand at the camp`,
    dropped >= HAUL_LEAST.droppedAtNight && camp >= HAUL_LEAST.campAtNight,
    `${dropped} pixels on the route differ from the bare map by more than ${NIGHT_THRESHOLD}, needs ${HAUL_LEAST.droppedAtNight}; ${camp} pixels at the camp differ, needs ${HAUL_LEAST.campAtNight}`,
  );
  const nightTotals = [afterDusk, night, beforeDawn].map((stop) => stop.totals.logs);
  session.check(
    `the totals do not change from ${when('afterDusk')} to ${when('beforeDawn')}`,
    nightTotals.every((logs) => logs === nightTotals[0]) && beforeDusk.totals.logs <= nightTotals[0],
    `Logs ${beforeDusk.totals.logs} at ${when('beforeDusk')}, then ${nightTotals.join(', ')}`,
  );
  const routeLogs = { carried: logsIn(carried.png, HAUL_BOXES.route), bare: logsIn(empty.carried, HAUL_BOXES.route) };
  session.check(
    `after dawn the settlers carry the dropped units on by ${when('carried')}`,
    routeLogs.carried - routeLogs.bare <= HAUL_MOST.goodsBefore && carried.totals.logs > nightTotals[0],
    `${routeLogs.carried} log pixels on the route and ${routeLogs.bare} on the bare map at ${when('carried')}, needs at most ${HAUL_MOST.goodsBefore} more; Logs ${nightTotals[0]} at night and ${carried.totals.logs} at ${when('carried')}`,
  );

  const layout = await session.open(WIDE);
  for (const size of [WIDE, CLIP]) {
    await layout.page.setViewportSize(size);
    await session.settle(layout.page);
    await layout.page.keyboard.press('KeyP');
    await said(layout.page, /Drag over open ground/);
    await session.still(layout.page);
    const panel = layout.page.getByRole('status', { name: 'Stockpiles' });
    const boxes = {
      stockpiles: await panel.boundingBox(),
      clock: await layout.page.getByRole('region', { name: 'Clock' }).boundingBox(),
      status: await status(layout.page).boundingBox(),
      toolbar: await layout.page.getByRole('toolbar', { name: 'Orders' }).boundingBox(),
      hint: await layout.page.getByRole('complementary', { name: 'Camera controls' }).boundingBox(),
    };
    const inside = (box) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height;
    const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    const others = Object.entries(boxes).filter(([name]) => name !== 'stockpiles');
    const ok = inside(boxes.stockpiles) && others.every(([, box]) => box && disjoint(boxes.stockpiles, box));
    const detail = Object.entries(boxes).map(([name, box]) => `${name} ${box ? `${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'missing'}`).join('; ');
    session.check(`the Stockpiles panel keeps clear of the clock, the status line, the toolbar, and the camera hint at ${size.width}x${size.height}`, ok, detail);
    const labels = await Promise.all(['Logs', 'Stone'].map((label) => panel.getByText(label, { exact: true }).isVisible()));
    session.check(`the Stockpiles panel shows Logs and Stone at ${size.width}x${size.height}`, labels.every(Boolean), `Logs ${labels[0] ? 'shown' : 'missing'}, Stone ${labels[1] ? 'shown' : 'missing'}; reads "${await panel.textContent()}"`);
    await session.screenshot(layout.page, `hauling-${size.width}x${size.height}`);
    await layout.page.keyboard.press('Escape');
  }
  await layout.context.close();
  seen.push(...layout.errors);
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/**
 * The building pages look north over the camp on seed 7 at 960 by 540, from the opening view: a wheel step in, a turn
 * of half a radian by a right-drag, and a pan forward, as `takeView` takes them. The rock face lies to the north-west,
 * the grove to the east, and the camp below the middle. The drags are in clip pixels, and each picks its corner tile
 * exactly. Chop covers tiles (139, 120) to (142, 126), 7 trees and 14 logs. Quarry covers (117, 111) to (124, 115), 23
 * rock tiles. The stockpile covers (131, 120) to (132, 121), 4 tiles between the site and the grove. The house page
 * then zooms in by `BUILD_CLOSER` toward the middle, to 31 m, and places the house on center tile (128, 120) from
 * there. The label page places it on the same tile from the first view.
 */
const BUILD_VIEW = { wheel: -500, turn: { x: 100, y: 0 }, pan: 60 };
const BUILD_CLOSER = -400;
const BUILD_SPOTS = {
  chop: [{ x: 619, y: 278 }, { x: 671, y: 316 }],
  quarry: [{ x: 377, y: 181 }, { x: 449, y: 238 }],
  stockpile: [{ x: 525, y: 286 }, { x: 537, y: 292 }],
  closerHouse: { x: 499, y: 286 },
  house: { x: 490, y: 279 },
};
/**
 * The boxes are in clip pixels of the closer view: the house, which is as wide as its nine tiles, up to the top of
 * its roof, the nine tiles below the site's label, and the land a tile or two around them, with the near edge of the
 * stockpile. The walkers beside the house are those in `around` and not in `site`. The goods are counted in `tiles`,
 * because the fill of the label's work bar has the color of a log and the label's edge the color of stone. The roof
 * is counted in `roof`, the band of both its slopes that lies below the label and above the walls of a house at half
 * its work, whose timber in shade has the colors of thatch in shade.
 */
const BUILD_BOXES = {
  site: { x: 445, y: 195, width: 112, height: 120 },
  roof: { x: 455, y: 236, width: 90, height: 22 },
  tiles: { x: 460, y: 240, width: 80, height: 75 },
  around: { x: 425, y: 185, width: 150, height: 150 },
};
/** The clip keeps the clock, the site with its label, the stockpile, the camp's edge, and the rock face's foot. */
const BUILD_CLIP = { crop: { x: 230, y: 0, width: 480, height: 440 }, width: 480, colors: 64 };
/**
 * The marks go down at 08:15 and the house at 11:30, once carriers have stocked logs, so that the site takes some of
 * its units from the stockpile. Both are `reach` stops, so each command lands within 4 ticks of the same tick on every
 * run. On rj-firebat the site held 4 logs and 2 stone at 12:29, 12 and 6 by 16:38, and became a house at 17:53. The
 * settlers carry stone past the house after dawn on day 2, and those stops have full daylight, as the evening stops
 * after 17:53 do not.
 */
const BUILD_STOPS = {
  marked: { day: 1, time: '08:15' },
  placed: { day: 1, time: '11:30' },
  around: [{ day: 2, time: '08:30' }, { day: 2, time: '09:30' }, { day: 2, time: '10:30' }],
  day: { day: 1, time: '12:00' },
  midnight: { day: 2, time: '00:00' },
};
/** Wheel pixels that reach the nearest view of 14 m and the farthest of 243 m from any view. */
const READ_WHEELS = { near: -3000, far: 3000 };
/**
 * The thatch of the house roof in the afternoon. The house is finished at 17:23 in one run and at 17:55 in another,
 * because `reach` stops within two game minutes of its time and an order can land a few ticks apart. The sunlit slope
 * reads near (174, 114, 42) and then near (174, 102, 30). The slope in shade is olive at 17:23, near (78, 66, 30),
 * and warm at 17:55, near (90, 66, 18). The three clauses are the sunlit slope, the warm shade, and the olive shade.
 * A tunic there reads near (126, 90, 18), yellower than the sunlit slope, and timber has more blue than the shade.
 */
const HOUSE_ROOF = ([r, g, b]) =>
  (r > 110 && r < 200 && g > 0.53 * r && g < 0.7 * r && b > 0.1 * r && b < 0.3 * r) ||
  (r >= 60 && r <= 110 && g > 0.58 * r && g < 0.8 * r && b < 0.3 * r) ||
  (r >= 68 && r <= 100 && g >= 0.78 * r && g < 0.93 * r && b > 0.25 * r && b < 0.45 * r);
/** The timber of a site's scaffold and of the walls that rise inside it, in the afternoon light. */
const SITE_TIMBER = ([r, g, b]) => r > 40 && r < 140 && g > 0.5 * r && g < 0.78 * r && b < 0.5 * r;
/** The label's text is near white, on a dark panel. */
const LABEL_INK = ([r, g, b]) => Math.min(r, g, b) > 200;
/**
 * On the owner's Mac the stockpile held 5 logs at 11:30. Two runs are given, the first with the house finished at
 * 17:55 and the second at 17:23. The site's tiles held 194 and 295 log and 134 and 137 stone pixels half supplied. At
 * half the work the walls and the scaffold hide most of the 12 logs, and 85 and 87 log pixels showed beside them. The
 * house's box held 97 and 213 timber pixels half supplied and 1952 and 2548 at half the work. The roof's band of 1980
 * pixels held 26 and 30 roof pixels at half the work and 1150 and 1060 once the house stood, and the house's tiles 0
 * log pixels. Beside the house stood at most 63 and 112 villager pixels at the three stops of day 2, a carrier or two
 * in a tunic. Each label held 149 to 157 near-white text pixels.
 */
const BUILD_LEAST = { stocked: 1, logs: 80, logsAtWork: 40, stone: 80, timber: 40, roof: 730, walkers: 45, ink: 60 };
const BUILD_MOST = { goodsBefore: 10, roofBefore: 100, goodsAfter: 10 };

function siteDriver(session) {
  const site = (page) => page.getByRole('status', { name: 'House site' });
  const order = (page) => page.getByRole('status', { name: 'Order' });
  const said = async (page, pattern) => {
    await order(page).filter({ hasText: pattern }).waitFor({ timeout: 15_000 }).catch(() => {});
    return (await order(page).textContent()) ?? '';
  };
  const reads = async (page) => {
    // One round trip: a label that a count saw can be gone before a second call reads it, when the house is finished in between.
    const text = await site(page).evaluateAll((labels) => (labels.length === 0 ? null : labels[0].innerText));
    if (text === null) return null;
    const read = /Logs\s*(\d+)\/12\s*Stone\s*(\d+)\/6\s*(?:(Waiting for materials)|(\d+)%)/.exec(text);
    if (!read) fail(`the site label reads "${text}", not the logs, the stone, and the work`);
    return { text: text.replace(/\s+/g, ' '), logs: Number(read[1]), stone: Number(read[2]), waiting: Boolean(read[3]), percent: read[4] === undefined ? null : Number(read[4]) };
  };
  const totals = async (page) => {
    const text = (await page.getByRole('status', { name: 'Stockpiles' }).textContent()) ?? '';
    const read = /Logs(\d+)Stone(\d+)/.exec(text);
    if (!read) fail(`the Stockpiles panel reads "${text}", not a Logs and a Stone total`);
    return { logs: Number(read[1]), stone: Number(read[2]) };
  };
  const placeHouse = async (page, at) => {
    await page.keyboard.press('KeyH');
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
    const line = await said(page, /House site placed/);
    await session.settle(page);
    const placedLabel = page.getByRole('status', { name: 'House site', includeHidden: true });
    const asideWithTool = (await placedLabel.count()) === 1 && (await placedLabel.isHidden());
    await page.keyboard.press('Escape');
    await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
    await session.still(page);
    return { line, asideWithTool, shownAfter: await site(page).isVisible() };
  };
  // Runs the clock at 8× until the label shows what `done` waits for, then pauses, so that every check reads a paused frame.
  const runUntil = async (page, what, done) => {
    await page.keyboard.press('4');
    const deadline = Date.now() + 180_000;
    for (;;) {
      const label = await reads(page);
      if (done(label)) break;
      if (Date.now() > deadline) fail(`the site never ${what} in three minutes at 8×; the label reads "${label?.text ?? 'nothing'}"`);
      await page.waitForTimeout(100);
    }
    await session.pause(page);
    await session.still(page);
  };
  const markWork = async (page) => {
    await takeView(session, page, BUILD_VIEW);
    const marked = [];
    for (const [key, name, pattern] of [
      ['KeyC', 'Chop', /^7 trees marked for felling/],
      ['KeyM', 'Quarry', /^23 rock tiles marked for quarrying/],
      ['KeyP', 'Stockpile', /^4 tiles join the stockpile zone/],
    ]) {
      await page.keyboard.press(key);
      await session.drag(page, ...BUILD_SPOTS[name.toLowerCase()]);
      marked.push({ name, pattern, line: await said(page, pattern) });
      await page.keyboard.press('Escape');
    }
    return marked;
  };
  return { site, said, reads, totals, placeHouse, runUntil, markWork };
}

SCENARIOS.building = async (session) => {
  const seen = [];
  const { site, reads, totals, placeHouse, runUntil, markWork } = siteDriver(session);
  const barOf = async (page) => {
    const bar = site(page).getByRole('progressbar', { name: 'Building work' });
    if ((await bar.count()) === 0 || !(await bar.isVisible())) return null;
    const outer = await bar.boundingBox();
    const fill = await bar.locator(':scope > *').first().boundingBox();
    return { now: Number(await bar.getAttribute('aria-valuenow')), share: outer && fill ? fill.width / outer.width : NaN };
  };
  const stop = async (page, label) => ({
    png: await session.screenshot(page, label),
    label: await reads(page),
    bar: await barOf(page),
    totals: await totals(page),
    at: clockText(await session.gameMinutes(page)),
  });
  const count = (png, box, matches) => pixelsIn(png, CLIP.width, box, matches).count;
  const labelText = (label) => label?.text ?? 'no label';

  const build = await session.open(CLIP, { record: true, clock: 'paused' });
  const { page } = build;
  await session.reach(page, BUILD_STOPS.marked);
  for (const { name, pattern, line } of await markWork(page)) {
    session.check(`a ${name} drag marks its tiles`, pattern.test(line), `the status line reads "${line}"`);
  }
  await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await page.mouse.wheel(0, BUILD_CLOSER);
  await session.still(page);
  await session.reach(page, BUILD_STOPS.placed);
  const stocked = await totals(page);
  const placed = await placeHouse(page, BUILD_SPOTS.closerHouse);
  session.check('a House click places the site', /^House site placed/.test(placed.line), `the status line reads "${placed.line}"`);
  session.check(
    'the label makes way while the House tool is active and shows once Escape puts it away',
    placed.asideWithTool && placed.shownAfter,
    `${placed.asideWithTool ? 'hidden' : 'not hidden'} with the tool, ${placed.shownAfter ? 'shown' : 'not shown'} after Escape`,
  );
  const from = build.since();
  const empty = await stop(page, 'building-empty');
  await runUntil(page, 'held some but not all of each good', (label) => label && label.logs >= 4 && label.stone >= 1 && label.logs < 12 && label.stone < 6);
  const half = await stop(page, 'building-half-supplied');
  await runUntil(page, 'got half its work done', (label) => label?.percent >= 50);
  const work = await stop(page, 'building-work');
  await runUntil(page, 'was finished', (label) => label === null);
  const done = await stop(page, 'building-finished');
  const to = build.since() + 2;
  await page.waitForTimeout(2000);
  const around = [];
  for (const when of BUILD_STOPS.around) {
    await session.reach(page, when);
    await session.still(page);
    around.push(await stop(page, `building-around-${when.time.replace(':', '')}`));
  }
  await session.finishClips(build.context, page, [{ label: 'building', from, to, ...BUILD_CLIP }]);
  seen.push(...build.errors);

  session.check(
    `at ${empty.at} the empty site's label reads 0 of 12 logs and 0 of 6 stone, and no work`,
    empty.label?.logs === 0 && empty.label.stone === 0 && empty.label.waiting,
    `the label reads "${labelText(empty.label)}"`,
  );
  const goods = (shot) => ({ logs: count(shot.png, BUILD_BOXES.tiles, GOOD_COLORS.logs), stone: count(shot.png, BUILD_BOXES.tiles, GOOD_COLORS.stone) });
  const goodsAt = { empty: goods(empty), half: goods(half), work: goods(work), done: goods(done) };
  session.check(
    `at ${empty.at} nothing lies on the site`,
    goodsAt.empty.logs <= BUILD_MOST.goodsBefore && goodsAt.empty.stone <= BUILD_MOST.goodsBefore,
    `${goodsAt.empty.logs} log and ${goodsAt.empty.stone} stone pixels on the site, needs at most ${BUILD_MOST.goodsBefore} of each`,
  );
  session.check(
    `at ${half.at} the label shows some but not all of each good`,
    half.label?.logs > 0 && half.label.logs < 12 && half.label.stone > 0 && half.label.stone < 6 && half.label.waiting,
    `the label reads "${labelText(half.label)}"`,
  );
  session.check(
    `at ${half.at} the delivered units lie on the site's tiles`,
    goodsAt.half.logs >= BUILD_LEAST.logs && goodsAt.half.stone >= BUILD_LEAST.stone,
    `${goodsAt.half.logs} log and ${goodsAt.half.stone} stone pixels on the site, needs ${BUILD_LEAST.logs} and ${BUILD_LEAST.stone}`,
  );
  const leastStocked = Math.min(half.totals.logs, work.totals.logs);
  session.check(
    'the site takes logs from the stockpile',
    stocked.logs >= BUILD_LEAST.stocked && leastStocked < stocked.logs,
    `Logs ${stocked.logs} in the stockpile when the house was placed, ${half.totals.logs} at ${half.at}, and ${work.totals.logs} at ${work.at}`,
  );
  session.check(
    `at ${work.at} every unit has arrived and the work bar reads above 0 and below 100`,
    work.label?.logs === 12 && work.label.stone === 6 && work.label.percent > 0 && work.label.percent < 100,
    `the label reads "${labelText(work.label)}"`,
  );
  session.check(
    `at ${work.at} the work bar is shown and filled to the work's share`,
    work.bar !== null && work.bar.now === work.label?.percent && Math.abs(work.bar.share - work.bar.now / 100) <= 0.05,
    work.bar ? `aria-valuenow ${work.bar.now}, the fill spans ${(work.bar.share * 100).toFixed(1)}% of the bar, the label reads ${work.label?.percent}%` : 'no visible bar',
  );
  const timber = { half: count(half.png, BUILD_BOXES.site, SITE_TIMBER), work: count(work.png, BUILD_BOXES.site, SITE_TIMBER) };
  session.check(
    `at ${work.at} the walls have risen in their scaffold on the site`,
    timber.work >= timber.half + BUILD_LEAST.timber,
    `${timber.half} timber pixels on the site at ${half.at} and ${timber.work} at ${work.at}, needs ${BUILD_LEAST.timber} more`,
  );
  const roof = { work: count(work.png, BUILD_BOXES.roof, HOUSE_ROOF), done: count(done.png, BUILD_BOXES.roof, HOUSE_ROOF) };
  session.check(
    `at ${done.at} the label is gone and the house stands on the site`,
    done.label === null && roof.work <= BUILD_MOST.roofBefore && roof.done >= BUILD_LEAST.roof,
    `${done.label ? `the label reads "${done.label.text}"` : 'no label'}; ${roof.work} roof pixels above the walls at ${work.at} and ${roof.done} at ${done.at}, needs at most ${BUILD_MOST.roofBefore} and then ${BUILD_LEAST.roof}`,
  );
  session.check(
    `at ${done.at} no log is drawn on the house's tiles any more`,
    goodsAt.work.logs >= BUILD_LEAST.logsAtWork && goodsAt.done.logs <= BUILD_MOST.goodsAfter,
    `${goodsAt.work.logs} log pixels on the site at ${work.at} and ${goodsAt.done.logs} at ${done.at}, needs ${BUILD_LEAST.logsAtWork} and then at most ${BUILD_MOST.goodsAfter}`,
  );
  const walkers = around.map((shot) => ({
    at: shot.at,
    beside: count(shot.png, BUILD_BOXES.around, UNIT_COLORS.villagers) - count(shot.png, BUILD_BOXES.site, UNIT_COLORS.villagers),
  }));
  session.check(
    'on the morning of day 2 settlers walk beside the house',
    Math.max(...walkers.map((stop) => stop.beside)) >= BUILD_LEAST.walkers,
    walkers.map((stop) => `${stop.beside} villager pixels around the house at ${stop.at}`).join(', ') + `; needs ${BUILD_LEAST.walkers} at one of them`,
  );

  const labels = await session.open(CLIP, { clock: 'paused' });
  await takeView(session, labels.page, BUILD_VIEW);
  await placeHouse(labels.page, BUILD_SPOTS.house);
  for (const stopName of ['day', 'midnight']) {
    await session.reach(labels.page, BUILD_STOPS[stopName]);
    for (const zoom of ['near', 'far']) {
      await labels.page.mouse.wheel(0, READ_WHEELS[zoom]);
      await session.still(labels.page);
      const png = await session.screenshot(labels.page, `building-label-${stopName}-${zoom}`);
      const label = await reads(labels.page);
      const box = await site(labels.page).boundingBox();
      const inside = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= CLIP.width && box.y + box.height <= CLIP.height;
      const ink = inside ? count(png, { x: Math.ceil(box.x), y: Math.ceil(box.y), width: Math.floor(box.width), height: Math.floor(box.height) }, LABEL_INK) : 0;
      const when = clockText(clockMinutes(BUILD_STOPS[stopName]));
      session.check(
        `at ${when}, at the ${zoom} zoom, the label lies inside the window and its text reads`,
        Boolean(inside) && label?.logs === 0 && label.stone === 0 && label.waiting && ink >= BUILD_LEAST.ink,
        `${box ? `box ${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'no box'}; reads "${labelText(label)}"; ${ink} near-white text pixels in the box, needs ${BUILD_LEAST.ink}`,
      );
    }
  }
  await labels.context.close();
  seen.push(...labels.errors);
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/**
 * The `look` scenario builds the house of `building` from the same marks, views, and stops, so the settlement it shows
 * is the one that scenario measures. The dusk clip runs at 1× from before the settlers stop work until they stand at
 * the camp. Each view is shot at the nearest zoom of 14 m, at the 22 m that was the nearest zoom on `main`, where the
 * checks read it and the pictures line up with those of `main`, and at the farthest zoom: the first midnight, the next
 * noon, and a noon and a midnight of winter, which starts on day 10.
 */
const LOOK_STOPS = {
  dusk: { from: { day: 1, time: '18:45' }, to: { day: 1, time: '19:40' } },
  views: [
    { name: 'midnight', when: { day: 2, time: '00:00' } },
    { name: 'noon', when: { day: 2, time: '12:00' } },
    { name: 'winter-noon', when: { day: 10, time: '12:00' } },
    { name: 'winter-midnight', when: { day: 11, time: '00:00' } },
  ],
};
const LOOK_CLIP = { crop: { x: 200, y: 40, width: 560, height: 420 }, width: 560, colors: 64 };
/** Pixels the land is dragged up once the house is placed, so the near view holds the camp below the house. */
const LOOK_PAN = 40;
/** Wheel pixels from the nearest view of 14 m out to the near view of 22 m, and from there back to the 31 m the house is placed from. */
const LOOK_NEAR_WHEEL = Math.log(22 / 14) / 0.0015;
const LOOK_BACK_WHEEL = Math.log(31.1 / 22) / 0.0015;
/**
 * The boxes are in clip pixels of the near view: the house up to its ridge, the fire in the middle of the camp, the
 * camp with all the ground that the fire lights, and the land clear of the panels.
 */
const LOOK_BOXES = {
  house: { x: 455, y: 150, width: 115, height: 125 },
  fire: { x: 440, y: 330, width: 50, height: 50 },
  camp: { x: 390, y: 280, width: 145, height: 153 },
  land: { x: 150, y: 60, width: 640, height: 420 },
};
/** The thatch of the house roof in daylight: a dull gold, yellower than timber and soil. Its sunlit slope is as bright as a tunic. */
const THATCH = ([r, g, b]) => r > 120 && g > 0.6 * r && g < 0.8 * r && b > 0.15 * r && b < 0.4 * r;
/**
 * The flame of the campfire is the one thing that no light changes. It is drawn in two colors, 0xff7a1a and 0xffd35a,
 * and the edge between them blends the two, so its blue follows its green.
 */
const FLAME = ([r, g, b]) => r > 240 && g > 113 && g < 220 && Math.abs(b - (26 + (64 * (g - 122)) / 89)) < 14;
/** What the fire lights at night, and the flame itself: the ground, the tents, and the settlers near it are bright and warm. A tunic in daylight is too. */
const FIRELIT = ([r, g, b]) => r > 200 && g > 90 && g < 220 && b < 110 && r > g + 30;
/**
 * On the owner's Mac the house's box held 3711 thatch pixels at the spring noon and 4108 at the winter noon, and 222
 * on a site with no house, where goods and tunics match. The land around the house held 573 and 1065 villager pixels.
 * At both midnights the fire's box held 182 flame pixels and the rest of the land 0. The camp held 3011 and 3264
 * firelit pixels beside the flame, and the land away from the camp 0.
 */
const LOOK_LEAST = { thatch: 1900, settlers: 150, flame: 100, firelit: 1500 };
/**
 * A frame draws each kind of thing in one call, and once more into the shadow map for a kind that casts a shadow.
 * `main` drew 20 to 22 calls and the first models 22 to 24. The sea and its bed, two more kinds of tree, five kinds
 * of ground cover, the settlers' legs, and the smoke brought a frame to 36 to 38 calls, and to 42 on the owner's GPU
 * with a site and its marks in view. A count that grew with the number of trees or settlers would be in the
 * thousands.
 */
const LOOK_MOST = { flameElsewhere: 5, firelitElsewhere: 5, calls: 46 };

SCENARIOS.look = async (session) => {
  const seen = [];
  const { placeHouse, runUntil, markWork } = siteDriver(session);
  const draws = [];
  const shots = {};
  const shot = async (page, label) => {
    shots[label] = await session.screenshot(page, label);
    draws.push({ label, ...(await session.drawsPerFrame(page)) });
  };
  const count = (label, box, matches) => pixelsIn(shots[label], CLIP.width, box, matches).count;
  const zoom = async (page, wheel) => {
    await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
    await page.mouse.wheel(0, wheel);
    await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
    await session.still(page);
  };

  const town = await session.open(CLIP, { record: true, clock: 'paused' });
  const { page } = town;
  const notice = await page.locator('.models-notice').allTextContents();
  session.check('the game draws the models, not stand-in shapes', notice.length === 0, notice.join(' ') || 'no notice on the page');
  await session.reach(page, BUILD_STOPS.marked);
  await markWork(page);
  await zoom(page, BUILD_CLOSER);
  await session.reach(page, BUILD_STOPS.placed);
  await placeHouse(page, BUILD_SPOTS.closerHouse);
  await session.drag(page, { x: CLIP.width / 2, y: CLIP.height / 2 + LOOK_PAN / 2 }, { x: CLIP.width / 2, y: CLIP.height / 2 - LOOK_PAN / 2 });
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);
  await runUntil(page, 'held some but not all of each good', (label) => label && label.logs >= 4 && label.stone >= 1 && label.logs < 12 && label.stone < 6);
  await shot(page, 'look-site-supplied');
  await zoom(page, READ_WHEELS.near);
  await zoom(page, LOOK_NEAR_WHEEL);
  await shot(page, 'look-site-supplied-near');
  await zoom(page, LOOK_BACK_WHEEL);
  await runUntil(page, 'got half its work done', (label) => label?.percent >= 50);
  await shot(page, 'look-site-half-built');
  await runUntil(page, 'was finished', (label) => label === null);
  await shot(page, 'look-house-finished');
  await session.reach(page, LOOK_STOPS.dusk.from);
  const from = town.since();
  await page.keyboard.press('1');
  while ((await session.gameMinutes(page)) < clockMinutes(LOOK_STOPS.dusk.to)) await page.waitForTimeout(100);
  await session.pause(page);
  const to = town.since();
  for (const { name, when } of LOOK_STOPS.views) {
    await session.reach(page, when);
    await zoom(page, READ_WHEELS.near);
    await shot(page, `look-${name}-nearest`);
    await zoom(page, LOOK_NEAR_WHEEL);
    await shot(page, `look-${name}-near`);
    await zoom(page, READ_WHEELS.far);
    await shot(page, `look-${name}-far`);
  }
  await session.finishClips(town.context, page, [{ label: 'look-dusk', from, to, ...LOOK_CLIP }]);
  seen.push(...town.errors);

  const crowd = await session.open(CLIP, { search: SWARM });
  await takeView(session, crowd.page, BUILD_VIEW);
  await shot(crowd.page, 'look-swarm');
  await crowd.context.close();
  seen.push(...crowd.errors);

  for (const season of ['', 'winter-']) {
    const noon = `look-${season}noon-near`;
    const midnight = `look-${season}midnight-near`;
    const roof = count(noon, LOOK_BOXES.house, THATCH);
    session.check(`${noon} shows the house under its thatch`, roof >= LOOK_LEAST.thatch, `${roof} thatch pixels on the house, needs ${LOOK_LEAST.thatch}`);
    const settlers = count(noon, LOOK_BOXES.land, UNIT_COLORS.villagers) - count(noon, LOOK_BOXES.house, UNIT_COLORS.villagers);
    session.check(
      `${noon} shows the settlers in their tunics`,
      settlers >= LOOK_LEAST.settlers,
      `${settlers} villager pixels on the land around the house, needs ${LOOK_LEAST.settlers}`,
    );
    const flame = count(midnight, LOOK_BOXES.fire, FLAME);
    const otherFlames = count(midnight, LOOK_BOXES.land, FLAME) - flame;
    session.check(
      `${midnight} shows the flame of the fire at the camp, and no other`,
      flame >= LOOK_LEAST.flame && otherFlames <= LOOK_MOST.flameElsewhere,
      `${flame} flame pixels at the fire and ${otherFlames} on the rest of the land, needs ${LOOK_LEAST.flame} and at most ${LOOK_MOST.flameElsewhere}`,
    );
    const inCamp = count(midnight, LOOK_BOXES.camp, FIRELIT);
    const firelit = inCamp - count(midnight, LOOK_BOXES.camp, FLAME);
    const awayFromCamp = count(midnight, LOOK_BOXES.land, FIRELIT) - inCamp;
    session.check(
      `${midnight} shows the fire lighting the camp, and nothing away from the camp as bright`,
      firelit >= LOOK_LEAST.firelit && awayFromCamp <= LOOK_MOST.firelitElsewhere,
      `${firelit} firelit pixels in the camp beside the flame and ${awayFromCamp} away from the camp, needs ${LOOK_LEAST.firelit} and at most ${LOOK_MOST.firelitElsewhere}`,
    );
  }
  for (const { label, calls, triangles } of draws) {
    session.check(
      `${label} takes few draw calls, so its repeated shapes are instanced`,
      calls > 0 && calls <= LOOK_MOST.calls,
      `${calls} draw calls and ${triangles} triangles a frame, needs at most ${LOOK_MOST.calls} calls`,
    );
  }
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/** Each case is sampled this many times for this long, at 1×, so the units move and their shapes are posed on every tick. */
const FRAME_SAMPLES = { count: 5, ms: 4000 };

SCENARIOS.frames = async (session) => {
  const { placeHouse, runUntil, markWork } = siteDriver(session);
  const measure = async (name, page) => {
    await page.keyboard.press('1');
    const samples = [];
    for (let sample = 0; sample < FRAME_SAMPLES.count; sample++) samples.push(await session.frameWork(page, FRAME_SAMPLES.ms));
    await session.pause(page);
    const { calls, triangles } = await session.drawsPerFrame(page);
    const means = samples.map((sample) => sample.mean).sort((a, b) => a - b);
    const rates = samples.map((sample) => sample.perSecond).sort((a, b) => a - b);
    const middle = Math.floor(samples.length / 2);
    session.check(
      `${name}: frames are drawn and timed`,
      samples.every((sample) => sample.frames > 0),
      `median ${means[middle].toFixed(2)} ms of work a frame, ${means[0].toFixed(2)} to ${means.at(-1).toFixed(2)} ms over ${samples.length} samples of ${FRAME_SAMPLES.ms / 1000} s; ` +
        `median ${rates[middle].toFixed(0)} frames a second, ${rates[0].toFixed(0)} to ${rates.at(-1).toFixed(0)}; ${calls} draw calls and ${triangles} triangles a frame`,
    );
  };

  const town = await session.open(CLIP, { clock: 'paused' });
  await session.reach(town.page, BUILD_STOPS.marked);
  await markWork(town.page);
  await session.reach(town.page, BUILD_STOPS.placed);
  await placeHouse(town.page, BUILD_SPOTS.house);
  await runUntil(town.page, 'held some but not all of each good', (label) => label && label.logs >= 4 && label.stone >= 1 && label.logs < 12 && label.stone < 6);
  await measure('the settlement at work', town.page);
  await town.context.close();

  const crowd = await session.open(CLIP, { search: SWARM });
  await takeView(session, crowd.page, BUILD_VIEW);
  await measure('the swarm', crowd.page);
  await crowd.context.close();
  session.check('no page errors', town.errors.length + crowd.errors.length === 0, [...town.errors, ...crowd.errors].join(' | ') || 'none');
};
SCENARIOS.frames.gpu = true;

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
/**
 * The fewest pixels of the red outline of a house that cannot stand, at the opening view. Over rock it read 104 to
 * 155. Over the forest the crowns cover part of it and sway with the tick, and it read 57 at the spring midnight and
 * 110 to 123 at the other three stops.
 */
const REFUSED_AT_LEAST = { rock: 60, forest: 50 };


/**
 * Two house sites go down at 08:15 on day 1, above and left of the camp, with 26 trees and 136 rock tiles marked and a
 * 4-tile stockpile, so that the settlers have the 24 logs and 12 stone the two need. In the pylon both stood at 14:44
 * and 14:45 on day 2, so households 0 and 1 have homes at the dusk of day 2 and households 2 and 3 do not.
 */
const HOME_ORDERS = [
  ['KeyC', /^26 trees marked for felling/, { x: 590, y: 220 }, { x: 730, y: 360 }],
  ['KeyM', /^136 rock tiles marked for quarrying/, { x: 340, y: 150 }, { x: 470, y: 240 }],
  ['KeyP', /^4 tiles join the stockpile zone/, BUILD_SPOTS.stockpile[0], BUILD_SPOTS.stockpile[1]],
];
const HOME_SPOTS = [BUILD_SPOTS.house, { x: 400, y: 330 }];
/** The closer view is zoomed in toward this point of the building view, between the two houses and the camp. */
const HOME_FOCUS = { x: 450, y: 300 };
/**
 * The stops after the clip fall on day 4, the first day of summer, whose dawn is at 03:36. 03:40 is 4 game minutes,
 * about 8 ticks, after it, so a settler that came out of a house has walked at most about a tile and a half from its
 * door, while the camp lies 4 tiles and more from either house.
 */
const HOME_STOPS = {
  dusk: { day: 2, time: '19:00' },
  walked: { day: 2, time: '19:50' },
  night: { day: 3, time: '04:35' },
  dawn: { day: 3, time: '05:05' },
  midnight: { day: 4, time: '00:00' },
  beforeDawn: { day: 4, time: '03:30' },
  afterDawn: { day: 4, time: '03:40' },
};

/**
 * In clip pixels of the closer view: the camp's ring and fire, and the land beside each house, which leaves out the
 * camp. The settlers walk home from the quarry above, so they go in, and come out, on the near sides of the houses.
 */
const HOME_BOXES = {
  camp: { x: 395, y: 315, width: 130, height: 110 },
  upperHouse: { x: 420, y: 190, width: 160, height: 125 },
  leftHouse: { x: 240, y: 285, width: 150, height: 170 },
};
/**
 * In the pylon the camp box differed from the bare map at midnight in 882 pixels with two households at home and in
 * 1632 with all 8 settlers at the camp, a share of 0.54, in both of two runs. At 03:30 the land beside the upper and
 * the left house held 0 and 0 tunic pixels, and at 03:40 they held 97 and 102 to 104. The same boxes of the page with
 * no houses held 0 and 15 to 17 at 03:40, where those of the left box are the bare ground's.
 */
const HOME_LIMITS = { campShare: [0.3, 0.75], tunicsBefore: 5, tunicsAfter: 40, tunicsWithoutHomes: 30 };
const HOME_CLIP = { crop: { x: 180, y: 0, width: 480, height: 455 }, width: 480, colors: 64 };

SCENARIOS.households = async (session) => {
  const seen = [];
  const { said } = siteDriver(session);
  const sites = (page) => page.getByRole('status', { name: 'House site' });
  const closer = async (page) => {
    await page.mouse.move(HOME_FOCUS.x, HOME_FOCUS.y);
    await page.mouse.wheel(0, BUILD_CLOSER);
    await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
    await session.still(page);
  };
  const runAt = async (page, key, when) => {
    await page.keyboard.press(key);
    const wanted = clockMinutes(when);
    const deadline = Date.now() + 240_000;
    while ((await session.gameMinutes(page)) < wanted) {
      if (Date.now() > deadline) fail(`the clock did not reach ${clockText(wanted)} in four minutes`);
      await page.waitForTimeout(100);
    }
  };
  const stops = ['midnight', 'beforeDawn', 'afterDawn'];
  const visit = async (page, label) => {
    const shots = {};
    for (const name of stops) {
      await session.reach(page, HOME_STOPS[name]);
      await session.still(page);
      shots[name] = await session.screenshot(page, `${label}-${name}`);
    }
    return shots;
  };

  const town = await session.open(CLIP, { record: true, clock: 'paused' });
  const { page } = town;
  await takeView(session, page, BUILD_VIEW);
  await session.reach(page, BUILD_STOPS.marked);
  for (const [key, pattern, from, to] of HOME_ORDERS) {
    await page.keyboard.press(key);
    await session.drag(page, from, to);
    const line = await said(page, pattern);
    session.check(`the ${key.slice(3)} order is given`, pattern.test(line), `the status line reads "${line}"`);
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('KeyH');
  for (const [index, spot] of HOME_SPOTS.entries()) {
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.up();
    const line = await said(page, /House site placed/);
    session.check(`house site ${index + 1} is placed`, /^House site placed/.test(line), `the status line reads "${line}"`);
    await page.mouse.move(spot.x + 200, spot.y + 150);
    await session.settle(page);
  }
  await page.keyboard.press('Escape');
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await page.keyboard.press('4');
  const deadline = Date.now() + 600_000;
  while ((await sites(page).count()) > 0) {
    if (Date.now() > deadline) fail('the two houses were not finished in ten minutes at 8×');
    await page.waitForTimeout(500);
  }
  await session.pause(page);
  const finished = await session.gameMinutes(page);
  session.check(
    'both houses are finished before the dusk of day 2',
    finished < clockMinutes(HOME_STOPS.dusk),
    `the last site label went at ${clockText(finished)}`,
  );
  await closer(page);
  await session.screenshot(page, 'households-homes');
  await session.reach(page, HOME_STOPS.dusk);
  const from = town.since();
  await runAt(page, '1', HOME_STOPS.walked);
  await runAt(page, '4', HOME_STOPS.night);
  await runAt(page, '1', HOME_STOPS.dawn);
  await session.pause(page);
  const to = town.since();
  const homes = await visit(page, 'households');
  await session.finishClips(town.context, page, [{ label: 'households-dusk-and-dawn', from, to, ...HOME_CLIP }]);
  seen.push(...town.errors);

  const others = {};
  for (const [label, search] of [['plain', ''], ['bare', '?swarm=off']]) {
    const opened = await session.open(CLIP, { search, clock: 'paused' });
    await takeView(session, opened.page, BUILD_VIEW);
    await closer(opened.page);
    others[label] = await visit(opened.page, label);
    await opened.context.close();
    seen.push(...opened.errors);
  }
  const housed = changedIn(homes.midnight, others.bare.midnight, CLIP.width, HOME_BOXES.camp);
  const everyone = changedIn(others.plain.midnight, others.bare.midnight, CLIP.width, HOME_BOXES.camp);
  const share = housed / everyone;
  session.check(
    'at midnight the two households without a home stand at the camp, and the two with one do not',
    share >= HOME_LIMITS.campShare[0] && share <= HOME_LIMITS.campShare[1],
    `the camp differs from the bare map in ${housed} pixels with two households at home and in ${everyone} with all 8 settlers there, ` +
      `a share of ${share.toFixed(2)}, needs ${HOME_LIMITS.campShare.join(' to ')}`,
  );
  const tunics = (png, box) => pixelsIn(png, CLIP.width, box, TUNIC_IN_SHADE).count;
  for (const house of ['upperHouse', 'leftHouse']) {
    const before = tunics(homes.beforeDawn, HOME_BOXES[house]);
    const after = tunics(homes.afterDawn, HOME_BOXES[house]);
    const without = tunics(others.plain.afterDawn, HOME_BOXES[house]);
    session.check(
      `at dawn the household of the ${house === 'upperHouse' ? 'upper' : 'left'} house comes out beside it`,
      before <= HOME_LIMITS.tunicsBefore && after >= HOME_LIMITS.tunicsAfter && without <= HOME_LIMITS.tunicsWithoutHomes,
      `${before} tunic pixels beside the house at ${clockText(clockMinutes(HOME_STOPS.beforeDawn))} and ${after} at ` +
        `${clockText(clockMinutes(HOME_STOPS.afterDawn))}, and ${without} in the same box on the page with no houses; needs at most ` +
        `${HOME_LIMITS.tunicsBefore}, at least ${HOME_LIMITS.tunicsAfter}, and at most ${HOME_LIMITS.tunicsWithoutHomes}`,
    );
  }
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

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

  // Settlers fell marked trees and quarry marked rock while the clock runs, so the marks would not last to winter.
  const wide = await session.open(WIDE, { search: '?swarm=off' });
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
      await expectMarks(view, `a refused house reads over ${where}, ${label}`, await session.screenshot(view, `orders-refused-${where}-${label}`), { blocks: REFUSED_AT_LEAST[where] });
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

/**
 * The `selecting` scenario selects what a player can read: a settler at work, a house site, the house it becomes, and
 * the camp. Settlers are found the way a player finds them, by the yellow of their tunics in a paused screenshot, and
 * the camp by its flame at night. The mark is the accent `#ffd27a` over the edge `#1b1f26`, drawn without light, so
 * both are counted by their exact colors, as what a selection adds to the same paused frame.
 */
const MARK_ACCENT = ([r, g, b]) => r >= 243 && Math.abs(g - 210) <= 12 && Math.abs(b - 122) <= 14;
const MARK_EDGE = ([r, g, b]) => Math.abs(r - 27) <= 8 && Math.abs(g - 31) <= 8 && Math.abs(b - 38) <= 8;
/** A click this far beside a settler's tunic still selects it. The game's reach is 16 pixels from the body. */
const SELECT_OFFSET = 10;
/** Pixels a press may travel before it is a drag. The game's limit is 5. */
const SELECT_DRAG = 80;
/** A click here is at least this far from every tunic, so it lands on bare ground. */
const BARE_CLEARANCE = 90;
/**
 * The follow runs at 4× from 08:15, when the marks go down, until the settler has done this many different things or
 * the clock reaches the stop, and reads the panel every `FOLLOW_POLL_MS`.
 */
const FOLLOW = { distinct: 5, until: { day: 1, time: '11:20' }, pollMs: 120 };
const SELECT_STOPS = {
  springMidnight: { day: 2, time: '00:00' },
  winterNoon: { day: 10, time: '12:00' },
  winterMidnight: { day: 11, time: '00:00' },
};
/** Where a click on the camp may land at the opening view: around the fire at 479, 266, well inside the camp's 2 m, 11 pixels at 120 m. */
const CAMP_FIRE = { x: 479, y: 266 };
const CAMP_AIM = { x: CAMP_FIRE.x - 8, y: CAMP_FIRE.y - 6, width: 16, height: 12 };
/**
 * A settler standing in the camp wins a click within 4 pixels of its body, so the scenario clicks the camp as a
 * player would, again when a settler took the click: first the blue tent, then the points around the fire farthest
 * from every lit tunic, at most this many times.
 */
const CAMP_TRIES = 6;
/** The dusty blue cloth of the tent behind the fire at the opening view, by day. */
const TENT_BLUE = ([r, g, b]) => b > r + 25 && b >= g && r > 70;
/** A turn of the camera by a right drag, so picking is tried at another camera yaw. */
const SELECT_TURN = 300;
const SELECT_CLIP = { crop: { x: 0, y: 0, width: 960, height: 540 }, width: 640, colors: 64 };
/**
 * The least that the mark adds to a paused frame, in pixels of each of its two colors. At its smallest the mark is a
 * ring of 12 pixels' radius with an accent band of 3 pixels, about 225 accent pixels, and an edge of 2 pixels on each
 * side. Tents, settlers, and the house hide part of it. On rj-firebat it added 144 and 164 by day on grass, 100 and
 * 100 on snow, 65 and 80 on the camp at spring midnight, and 65 and 77 on the camp at winter midnight.
 */
const MARK_LEAST = { accent: 40, edge: 40 };
/** The mark's center lies this near a tunic: it rings the selected settler. */
const MARK_ON_SETTLER = 30;
/** The mark's center moves at least this far while the settler walks to its work. */
const MARK_MOVES = 15;

/** Clusters of the pixels that `matches` accepts, in cells of 12 pixels, leaving out the `skip` boxes. Largest first. */
function spotsOf(png, { width, height }, matches, skip = []) {
  const pixels = ffmpeg(['-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const cell = 12;
  const columns = Math.ceil(width / cell);
  const cells = new Map();
  const skipped = (x, y) => skip.some((box) => box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (!matches([pixels[i], pixels[i + 1], pixels[i + 2]]) || skipped(x, y)) continue;
      const key = Math.floor(y / cell) * columns + Math.floor(x / cell);
      const found = cells.get(key) ?? { count: 0, x: 0, y: 0 };
      found.count += 1;
      found.x += x;
      found.y += y;
      cells.set(key, found);
    }
  }
  const spots = [];
  const seen = new Set();
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    const spot = { count: 0, x: 0, y: 0 };
    const open = [start];
    seen.add(start);
    while (open.length > 0) {
      const key = open.pop();
      const found = cells.get(key);
      spot.count += found.count;
      spot.x += found.x;
      spot.y += found.y;
      for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
          const next = key + dy * columns + dx;
          if (cells.has(next) && !seen.has(next) && Math.abs((next % columns) - (key % columns)) <= 1) {
            seen.add(next);
            open.push(next);
          }
        }
      }
    }
    spots.push({ count: spot.count, x: spot.x / spot.count, y: spot.y / spot.count });
  }
  return spots.sort((a, b) => b.count - a.count);
}

/** The points of `box`, in steps of 2 pixels, from the one farthest from every one of `points` to the nearest. */
function clearestIn(box, points) {
  const aims = [];
  for (let y = box.y; y <= box.y + box.height; y += 2) {
    for (let x = box.x; x <= box.x + box.width; x += 2) {
      aims.push({ x, y, clearance: points.reduce((least, point) => Math.min(least, Math.hypot(point.x - x, point.y - y)), Infinity) });
    }
  }
  return aims.sort((a, b) => b.clearance - a.clearance);
}

function selectionDriver(session) {
  const panel = (page) => page.getByRole('region', { name: 'Selection' });
  /** The panel as one round trip, so a frame from the worker cannot change it between two reads. */
  const reads = async (page) => {
    const found = await panel(page).evaluateAll((nodes) => {
      const node = nodes.find((candidate) => !candidate.hidden);
      if (!node) return null;
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { title: node.querySelector('h2')?.textContent.trim() ?? '', note: node.querySelector('p')?.textContent.trim() ?? null, rows };
    });
    return found;
  };
  const text = (read) => (read ? [read.title, read.note, ...Object.entries(read.rows).map(([name, value]) => `${name}: ${value}`)].filter(Boolean).join('; ') : 'no panel');
  const boxOf = async (locator) => ((await locator.count()) > 0 && (await locator.first().isVisible()) ? locator.first().boundingBox() : null);
  /** The interface boxes that pixel searches leave out and that the panel must not cover. */
  const uiBoxes = async (page) => ({
    clock: await boxOf(page.getByRole('region', { name: 'Clock' })),
    toolbar: await boxOf(page.getByRole('toolbar', { name: 'Orders' })),
    stockpiles: await boxOf(page.getByRole('status', { name: 'Stockpiles' })),
    hints: await boxOf(page.getByRole('complementary', { name: 'Camera controls' })),
    status: await boxOf(page.getByRole('status', { name: 'Order' })),
    selection: await boxOf(panel(page)),
  });
  const skipOf = (boxes) => Object.values(boxes).filter(Boolean);
  const tunics = async (page, png) => spotsOf(png, page.viewportSize(), UNIT_COLORS.villagers, skipOf(await uiBoxes(page)));
  const tunicPixels = async (page, png) => {
    const { width, height } = page.viewportSize();
    const pixels = ffmpeg(['-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const found = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 3;
        if (UNIT_COLORS.villagers([pixels[i], pixels[i + 1], pixels[i + 2]])) found.push({ x, y });
      }
    }
    return found;
  };
  const markOf = (page, png, boxes) => {
    const skip = skipOf(boxes);
    const accent = spotsOf(png, page.viewportSize(), MARK_ACCENT, skip);
    const count = accent.reduce((sum, spot) => sum + spot.count, 0);
    const center = count > 0 ? { x: accent.reduce((sum, s) => sum + s.x * s.count, 0) / count, y: accent.reduce((sum, s) => sum + s.y * s.count, 0) / count } : null;
    const edge = spotsOf(png, page.viewportSize(), MARK_EDGE, skip).reduce((sum, spot) => sum + spot.count, 0);
    return { accent: count, edge, center };
  };
  /** Clicks without moving between press and release, as a player clicks. */
  const click = async (page, at) => {
    await page.mouse.click(at.x, at.y);
    await session.still(page);
    return reads(page);
  };
  /** Selects the settler whose tunic shows most, clicking `offset` pixels to its right, from a paused frame. */
  const clickSettler = async (page, label, offset = SELECT_OFFSET) => {
    const png = await session.screenshot(page, label);
    const spots = await tunics(page, png);
    if (spots.length === 0) return { spot: null, read: null, png };
    const spot = spots[0];
    return { spot, read: await click(page, { x: spot.x + offset, y: spot.y }), png };
  };
  /** A point of the world far from every tunic and from every interface box. */
  const bareSpot = async (page, png) => {
    const spots = await tunics(page, png);
    const boxes = skipOf(await uiBoxes(page));
    const { width, height } = page.viewportSize();
    for (const at of [{ x: width / 2, y: height * 0.22 }, { x: width * 0.3, y: height * 0.3 }, { x: width * 0.7, y: height * 0.3 }, { x: width * 0.3, y: height * 0.75 }, { x: width * 0.7, y: height * 0.75 }]) {
      const clear = spots.every((spot) => Math.hypot(spot.x - at.x, spot.y - at.y) >= BARE_CLEARANCE);
      const free = boxes.every((box) => at.x < box.x - 20 || at.x > box.x + box.width + 20 || at.y < box.y - 20 || at.y > box.y + box.height + 20);
      if (clear && free) return at;
    }
    return null;
  };
  const apart = (boxes) => {
    const { selection, ...rest } = boxes;
    const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    const others = Object.entries(rest).filter(([, box]) => box);
    const ok = Boolean(selection) && others.every(([, box]) => disjoint(selection, box));
    const describe = (box) => (box ? `${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'missing');
    return { ok, detail: [`panel ${describe(selection)}`, ...others.map(([name, box]) => `${name} ${describe(box)}`)].join('; ') };
  };
  return { panel, reads, text, uiBoxes, skipOf, tunics, tunicPixels, markOf, click, clickSettler, bareSpot, apart };
}

/**
 * Whether a panel is a settler's: its title is the settler's name, and only a settler's panel has the Sex and
 * Household rows. Before households the title was the word Settler.
 */
const settlerPanel = (read) =>
  Boolean(read?.title) && ['Man', 'Woman'].includes(read.rows?.Sex) && /^Household \d+/.test(read.rows?.Household ?? '');

SCENARIOS.selecting = async (session) => {
  const seen = [];
  const sites = siteDriver(session);
  const { reads, text, uiBoxes, skipOf, tunics, tunicPixels, markOf, click, clickSettler, bareSpot, apart } = selectionDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const fitsApart = async (page, what) => {
    const { ok, detail } = apart(await uiBoxes(page));
    session.check(`at 960x540 the ${what} panel covers no other panel`, ok, detail);
  };
  const markAdded = (page, before, after, boxes) => {
    const was = markOf(page, before, boxes);
    const now = markOf(page, after, boxes);
    return { accent: now.accent - was.accent, edge: now.edge - was.edge, center: now.center };
  };
  const expectMark = (where, mark) =>
    session.check(
      `${where} the mark shows in both of its colors`,
      mark.accent >= MARK_LEAST.accent && mark.edge >= MARK_LEAST.edge,
      `the selection adds ${mark.accent} accent and ${mark.edge} edge pixels, needs ${MARK_LEAST.accent} and ${MARK_LEAST.edge}`,
    );

  // A settler at work, a site, and the house it becomes, on one recorded page.
  const work = await session.open(CLIP, { record: true, clock: 'paused' });
  const { page } = work;
  await session.reach(page, BUILD_STOPS.marked);
  for (const { name, pattern, line } of await sites.markWork(page)) {
    session.check(`a ${name} drag marks its tiles`, pattern.test(line), `the status line reads "${line}"`);
  }
  await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await page.mouse.wheel(0, BUILD_CLOSER);
  await session.still(page);
  const followFrom = work.since();
  const unselected = await session.screenshot(page, 'selecting-before');
  const picked = await clickSettler(page, 'selecting-settler-aim');
  session.check(
    `at ${await at(page)} a click ${SELECT_OFFSET} px beside a settler selects it`,
    settlerPanel(picked.read),
    `${picked.spot ? `tunic at ${picked.spot.x.toFixed(0)},${picked.spot.y.toFixed(0)}` : 'no tunic found'}; the panel reads "${text(picked.read)}"`,
  );
  const firstBoxes = await uiBoxes(page);
  const firstShot = await session.screenshot(page, 'selecting-settler-start');
  const firstMark = markAdded(page, unselected, firstShot, firstBoxes);
  const firstTunics = await tunics(page, firstShot);
  const ringed = (mark, spots) => (mark.center ? Math.min(...spots.map((spot) => Math.hypot(spot.x - mark.center.x, spot.y - mark.center.y))) : Infinity);
  expectMark(`at ${await at(page)}, by day over the grass,`, firstMark);
  session.check(
    'the mark rings the selected settler',
    ringed(firstMark, firstTunics) <= MARK_ON_SETTLER,
    `the mark's center lies ${ringed(firstMark, firstTunics).toFixed(0)} px from the nearest tunic, needs at most ${MARK_ON_SETTLER}`,
  );

  const readings = [];
  await page.keyboard.press('3');
  const deadline = Date.now() + 240_000;
  const stopAt = clockMinutes(FOLLOW.until);
  for (;;) {
    const read = await reads(page);
    const doing = read?.rows.Doing;
    if (doing && readings.at(-1)?.doing !== doing) readings.push({ doing, carries: read.rows.Carries });
    const distinct = new Set(readings.map((reading) => reading.doing)).size;
    if (distinct >= FOLLOW.distinct || (await session.gameMinutes(page)) >= stopAt || Date.now() > deadline || !read) break;
    await page.waitForTimeout(FOLLOW.pollMs);
  }
  await session.pause(page);
  await session.still(page);
  const followTo = work.since();
  const followShot = await session.screenshot(page, 'selecting-settler');
  const followRead = await reads(page);
  const followBoxes = await uiBoxes(page);
  const followMark = markOf(page, followShot, followBoxes);
  const doings = readings.map((reading) => reading.doing);
  session.check(
    'the settler panel follows what the settler does',
    new Set(doings).size >= 3 && doings.some((doing) => /^Walking to /.test(doing)) && doings.some((doing) => /^(Chopping a tree|Quarrying stone|Building a house)$/.test(doing)),
    `it read, in order: ${doings.join(' > ') || 'nothing'}`,
  );
  const carriesMatch = ({ doing, carries }) => {
    const held = /^Carrying (a log|stone) /.exec(doing);
    return held ? carries === (held[1] === 'a log' ? '1 log' : '1 stone') : carries === 'Nothing';
  };
  session.check(
    'the Carries row agrees with what the settler is doing at every reading',
    readings.length > 0 && readings.every(carriesMatch),
    readings.map((reading) => `${reading.doing} / ${reading.carries}`).join(', ') || 'no readings',
  );
  const followTunics = await tunics(page, followShot);
  const moved = followMark.center && firstMark.center ? Math.hypot(followMark.center.x - firstMark.center.x, followMark.center.y - firstMark.center.y) : 0;
  session.check(
    `at ${await at(page)} the mark has followed the settler`,
    moved >= MARK_MOVES && ringed(followMark, followTunics) <= MARK_ON_SETTLER,
    `the mark moved ${moved.toFixed(0)} px, needs ${MARK_MOVES}; its center lies ${ringed(followMark, followTunics).toFixed(0)} px from the nearest tunic, needs at most ${MARK_ON_SETTLER}`,
  );
  await page.waitForTimeout(1000);
  const pausedRead = await reads(page);
  session.check('while paused the settler panel holds still', text(pausedRead) === text(followRead), `"${text(followRead)}" then "${text(pausedRead)}"`);
  await fitsApart(page, 'settler');

  await session.reach(page, BUILD_STOPS.placed);
  const placed = await sites.placeHouse(page, BUILD_SPOTS.closerHouse);
  session.check('a House click places the site and leaves the selection alone', /^House site placed/.test(placed.line) && settlerPanel(await reads(page)), `the status line reads "${placed.line}"; the panel reads "${text(await reads(page))}"`);
  const siteRead = await click(page, BUILD_SPOTS.closerHouse);
  session.check(
    `at ${await at(page)} a click on the site selects it and its panel reads what has arrived`,
    siteRead?.title === 'House site' && siteRead.rows.Logs === '0/12' && siteRead.rows.Stone === '0/6' && siteRead.rows.Work === 'Waiting for materials' && siteRead.rows.Builders === '0',
    `the panel reads "${text(siteRead)}"`,
  );
  await sites.runUntil(page, 'got half its work done', (label) => label?.percent >= 50);
  const siteFrom = work.since();
  await session.screenshot(page, 'selecting-site');
  const half = { label: await sites.reads(page), read: await reads(page) };
  const builders = Number(half.read?.rows.Builders);
  session.check(
    `at ${await at(page)} the site panel agrees with the site's label and counts the builders`,
    half.read?.title === 'House site' && half.read.rows.Logs === '12/12' && half.read.rows.Stone === '6/6' && half.read.rows.Work === `${half.label?.percent}%` && builders >= 1 && builders <= 4,
    `the label reads "${half.label?.text ?? 'nothing'}"; the panel reads "${text(half.read)}"`,
  );
  await fitsApart(page, 'site');
  await sites.runUntil(page, 'was finished', (label) => label === null);
  const houseShot = await session.screenshot(page, 'selecting-house');
  const houseRead = await reads(page);
  session.check(
    `at ${await at(page)} the selected site has become a house in the panel`,
    houseRead?.title === 'House' && houseRead.note === 'A finished house.',
    `the panel reads "${text(houseRead)}"`,
  );
  const houseMark = markOf(page, houseShot, await uiBoxes(page));
  session.check(
    'the mark rings the house',
    houseMark.accent >= MARK_LEAST.accent && houseMark.center && Math.hypot(houseMark.center.x - BUILD_SPOTS.closerHouse.x, houseMark.center.y - BUILD_SPOTS.closerHouse.y) <= 40,
    `${houseMark.accent} accent pixels centered at ${houseMark.center ? `${houseMark.center.x.toFixed(0)},${houseMark.center.y.toFixed(0)}` : 'nowhere'}, the house at ${BUILD_SPOTS.closerHouse.x},${BUILD_SPOTS.closerHouse.y}`,
  );
  await page.keyboard.press('Escape');
  await session.still(page);
  const cleared = await reads(page);
  session.check('Escape clears the selection', cleared === null, `the panel reads "${text(cleared)}"`);
  const reclicked = await click(page, BUILD_SPOTS.closerHouse);
  session.check('a click on the finished house selects the house', cleared === null && reclicked?.title === 'House', `after Escape the panel reads "${text(cleared)}", after the click "${text(reclicked)}"`);
  const siteTo = work.since() + 1;
  await page.waitForTimeout(1000);
  await session.finishClips(work.context, page, [
    { label: 'selecting-settler', from: followFrom, to: followTo, ...SELECT_CLIP },
    { label: 'selecting-site-to-house', from: siteFrom, to: siteTo, ...SELECT_CLIP },
  ]);
  seen.push(...work.errors);

  // A cancelled site clears its selection, and one Escape puts a tool away before the next clears the selection.
  const cancel = await session.open(CLIP, { clock: 'paused' });
  await takeView(session, cancel.page, BUILD_VIEW);
  await sites.placeHouse(cancel.page, BUILD_SPOTS.house);
  const chosen = await click(cancel.page, BUILD_SPOTS.house);
  await cancel.page.keyboard.press('KeyH');
  await cancel.page.mouse.click(BUILD_SPOTS.house.x, BUILD_SPOTS.house.y);
  const refused = await sites.said(cancel.page, /Another house stands in the way/);
  const withTool = await reads(cancel.page);
  await cancel.page.keyboard.press('Escape');
  const afterOneEscape = await reads(cancel.page);
  session.check(
    'with House active a click on the site places nothing and selects nothing, and one Escape puts the tool away and keeps the selection',
    chosen?.title === 'House site' && /Another house stands in the way/.test(refused) && withTool?.title === 'House site' && afterOneEscape?.title === 'House site' && !(await cancel.page.getByRole('button', { name: 'House', pressed: true }).count()),
    `selected "${text(chosen)}"; the status line read "${refused}"; with the tool "${text(withTool)}"; after Escape "${text(afterOneEscape)}"`,
  );
  await cancel.page.keyboard.press('Delete');
  await session.drag(cancel.page, { x: BUILD_SPOTS.house.x - 25, y: BUILD_SPOTS.house.y - 25 }, { x: BUILD_SPOTS.house.x + 25, y: BUILD_SPOTS.house.y + 25 });
  const removed = await sites.said(cancel.page, /^Orders removed/);
  await cancel.page.keyboard.press('Escape');
  await session.still(cancel.page);
  session.check('cancelling the selected site clears the selection', /^Orders removed/.test(removed) && (await reads(cancel.page)) === null, `the status line read "${removed}"; the panel reads "${text(await reads(cancel.page))}"`);
  await cancel.context.close();
  seen.push(...cancel.errors);

  // The camp, chosen at noon, when the settlers have wandered off it, and kept to midnight, and the mark by day, at night, and on snow, from the opening view.
  const camp = await session.open(CLIP);
  const c = camp.page;
  const measureMark = async (where, label) => {
    const withMark = await session.screenshot(c, `selecting-${label}`);
    const boxes = await uiBoxes(c);
    await c.keyboard.press('Escape');
    await session.still(c);
    const without = await session.screenshot(c, `selecting-${label}-unselected`);
    expectMark(where, markAdded(c, without, withMark, boxes));
  };
  const selectCamp = async () => {
    const png = await session.screenshot(c, `selecting-camp-aim-${(await at(c)).replace(/\D/g, '')}`);
    const tent = spotsOf(png, CLIP, TENT_BLUE, []).find((spot) => Math.hypot(spot.x - CAMP_FIRE.x, spot.y - CAMP_FIRE.y) <= 24);
    const near = await tunicPixels(c, png);
    const aims = [...(tent ? [{ x: Math.round(tent.x), y: Math.round(tent.y) }] : []), ...clearestIn(CAMP_AIM, near)].slice(0, CAMP_TRIES);
    for (const [index, aim] of aims.entries()) {
      const read = await click(c, aim);
      if (read?.title === 'Camp') return { aim, read, tries: index + 1 };
    }
    return { aim: null, read: await reads(c), tries: aims.length };
  };
  const morning = await selectCamp();
  const morningAt = await at(c);
  session.check(
    `at ${morningAt} a click on the camp selects the camp`,
    morning.read?.title === 'Camp' && /^\d$/.test(morning.read.rows['Settlers here'] ?? ''),
    `${morning.aim ? `clicked ${morning.aim.x},${morning.aim.y}` : 'no click selected the camp'} after ${morning.tries} of at most ${CAMP_TRIES} clicks; the panel reads "${text(morning.read)}"`,
  );
  await session.reach(c, SELECT_STOPS.springMidnight);
  await session.still(c);
  const springRead = await reads(c);
  session.check(
    'the camp stays selected until midnight, and its panel then counts all 8 settlers there',
    springRead?.title === 'Camp' && springRead.rows['Settlers here'] === '8',
    `selected at ${morningAt}; at ${await at(c)} the panel reads "${text(springRead)}"`,
  );
  await fitsApart(c, 'camp');
  await measureMark('at spring midnight', 'camp');

  await session.reach(c, SELECT_STOPS.winterNoon);
  await session.still(c);
  const snowPick = await clickSettler(c, 'selecting-winter-aim');
  session.check('at winter noon a click beside a settler selects it', settlerPanel(snowPick.read), `the panel reads "${text(snowPick.read)}"`);
  await measureMark('at winter noon, over snow,', 'winter-noon');
  const winterCamp = await selectCamp();
  session.check('at winter noon a click on the camp selects it again', winterCamp.read?.title === 'Camp', `after ${winterCamp.tries} of at most ${CAMP_TRIES} clicks the panel reads "${text(winterCamp.read)}"`);
  await session.reach(c, SELECT_STOPS.winterMidnight);
  await session.still(c);
  const winterRead = await reads(c);
  session.check('at winter midnight the camp panel counts all 8 settlers there', winterRead?.title === 'Camp' && winterRead.rows['Settlers here'] === '8', `the panel reads "${text(winterRead)}"`);
  await measureMark('at winter midnight', 'winter-midnight');

  await c.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await c.mouse.wheel(0, READ_WHEELS.far);
  await session.still(c);
  const farPng = await session.screenshot(c, 'selecting-pick-farthest');
  const firelit = spotsOf(farPng, CLIP, FIRELIT, skipOf(await uiBoxes(c)))[0];
  const farRead = firelit ? await click(c, firelit) : null;
  session.check(
    'at the farthest zoom a click on the firelit camp selects one of the settlers ringed there',
    settlerPanel(farRead),
    `${firelit ? `firelit ground of ${firelit.count} px at ${firelit.x.toFixed(0)},${firelit.y.toFixed(0)}` : 'no firelit ground found'}; the panel reads "${text(farRead)}"`,
  );
  await camp.context.close();
  seen.push(...camp.errors);

  // Picking at the opening view and at the nearest zoom turned, a bare click, and a drag.
  const views = await session.open(CLIP, { clock: 'paused' });
  const v = views.page;
  const pickIn = async (name) => {
    const { spot, read, png } = await clickSettler(v, `selecting-pick-${name.replace(' ', '-')}`);
    session.check(
      `at the ${name} view a click ${SELECT_OFFSET} px beside a settler selects it`,
      settlerPanel(read),
      `${spot ? `tunic of ${spot.count} px at ${spot.x.toFixed(0)},${spot.y.toFixed(0)}` : 'no tunic found'}; the panel reads "${text(read)}"`,
    );
    const bare = await bareSpot(v, png);
    const cleared = bare ? await click(v, bare) : 'no bare spot';
    session.check(`at the ${name} view a click on bare ground clears the selection`, cleared === null, bare ? `clicked ${bare.x.toFixed(0)},${bare.y.toFixed(0)}; the panel reads "${text(cleared)}"` : 'no spot lies 90 px from every tunic');
    return spot;
  };
  const opening = await pickIn('opening');
  if (opening) {
    const before = await session.screenshot(v, 'selecting-drag-before');
    await session.drag(v, opening, { x: opening.x + SELECT_DRAG, y: opening.y + SELECT_DRAG / 2 });
    await session.still(v);
    const after = await session.screenshot(v, 'selecting-drag-after');
    session.check('a drag that starts on a settler moves the camera and selects nothing', (await reads(v)) === null && difference(before, after) > 2, `the panel reads "${text(await reads(v))}"; mean pixel difference ${difference(before, after).toFixed(2)}`);
  }
  await v.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await v.mouse.wheel(0, READ_WHEELS.near);
  await session.still(v);
  await session.drag(v, { x: CLIP.width / 2 - SELECT_TURN / 2, y: CLIP.height / 2 }, { x: CLIP.width / 2 + SELECT_TURN / 2, y: CLIP.height / 2 }, 'right');
  await session.still(v);
  await pickIn('nearest turned');
  await views.context.close();
  seen.push(...views.errors);
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
    const { browser, renderer } = scenario.gpu ? await launchGpuBrowser() : { browser: await launchBrowser() };
    evidence.browser = renderer ? `${browser.version()} on ${renderer}` : browser.version();
    try {
      await scenario(createSession(browser, instance, dir, evidence, Boolean(scenario.gpu)));
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
