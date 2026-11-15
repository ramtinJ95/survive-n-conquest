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
/** Pale cut wood and cool grey stone, as the `paint` of the log and the stone in `assets/models.json` looks in spring daylight. */
const GOOD_COLORS = {
  logs: ([r, g, b]) => r > 150 && g > 0.72 * r && g < 0.9 * r && b > 0.45 * r && b < 0.7 * r,
  stone: ([r, g, b]) => g >= r && b >= g && b > r + 4 && Math.min(r, g, b) > 120 && Math.max(r, g, b) - Math.min(r, g, b) < 45,
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
 * On rj-firebat the grove box held 527 pin pixels before and 0 after, and 0 log pixels before and 192 after. The rock
 * box held 0 stone pixels before and 412 at the last stop, and 64 and 126 villager pixels at the two day stops. The camp
 * box differed from the bare map in 0 pixels by day and 501 at night. The marks' tint fell from 2976 to 1590 pixels
 * once the first row of the face was spent, and the settlers moved 15 pixels up the screen onto it.
 */
const GATHER_LEAST = { pins: 200, logs: 80, stone: 150, workers: 25, campAtNight: 200, tintLost: 0.25, climb: 6 };
const GATHER_MOST = { leftover: 10, goodsBefore: 10, campByDay: 20 };

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
  const atRock = (name) => pixelsIn(shots[name], CLIP.width, GATHER_VIEWS.rock.box, UNIT_COLORS.villagers);
  const camp = { working: atCamp('working'), night: atCamp('night'), back: atCamp('back') };
  const workers = { working: atRock('working').count, back: atRock('back').count };
  const when = Object.fromEntries(GATHER_STOPS.map(([name, stop]) => [name, stop.time ?? stop.to?.time]));
  session.check(
    `at ${when.working} the settlers quarry the rock face, away from the camp`,
    workers.working >= GATHER_LEAST.workers && camp.working <= GATHER_MOST.campByDay,
    `${workers.working} villager pixels at the rock face, needs ${GATHER_LEAST.workers}; ${camp.working} pixels at the camp differ from the bare map, needs at most ${GATHER_MOST.campByDay}`,
  );
  session.check(
    `at ${when.night} the settlers have left the work and stand at the camp`,
    camp.night >= GATHER_LEAST.campAtNight,
    `${camp.night} pixels at the camp differ from the bare map, needs ${GATHER_LEAST.campAtNight}`,
  );
  session.check(
    `at ${when.back} on day 2 the settlers are back at the rock face`,
    workers.back >= GATHER_LEAST.workers && camp.back <= GATHER_MOST.campByDay,
    `${workers.back} villager pixels at the rock face, needs ${GATHER_LEAST.workers}; ${camp.back} pixels at the camp differ from the bare map, needs at most ${GATHER_MOST.campByDay}`,
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
 * `GOOD_COLORS` matches the logs until 17:30 and no longer at 18:30, so every log count stops in daylight.
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
  morning: { day: 2, time: '07:00' },
  carried: { day: 2, time: '11:00' },
};
/**
 * On rj-firebat the grove box held 192 log pixels at 13:30 and 34 at 17:30, and the near stockpile's box 0, 114, and
 * 280 at 13:30, 15:00, and 17:30. Beside the full stockpile the carriers take the front logs first, and the 8 left lie
 * under the crowns at the back, where a model log shows 3 to 7 pixels as bright as `GOOD_COLORS.logs` asks. On the
 * owner's Mac the grove box held 77 pixels of `LOGS_IN_A_CLEARED_GROVE_BY_DAY` at 17:00 and 75 at 10:00 on day 2,
 * about 9 for each log. The grove at 17:30, with its last logs in the sun, held 38 of them against 36 of
 * `GOOD_COLORS.logs`. The route held 0 log pixels and differed from the bare map in 0 pixels before the far stockpile,
 * differed in 317 at 19:05 and in 149 at 21:00, and held 60 log pixels at 07:00 on day 2 and 0 at 11:00. The camp box
 * differed from the bare map in 377 pixels at 21:00.
 */
const HAUL_LEAST = { lying: 100, rising: 40, stacked: 150, noPlace: 40, routeByDusk: 100, droppedAtNight: 50, campAtNight: 150, droppedAtDawn: 25 };
const HAUL_MOST = { goodsBefore: 10, leftInGrove: 0.5, routeBefore: 20, routeCarried: 0.5 };
/** The wood of `GOOD_COLORS.logs`, lit or under a crown. The forest matches it too in the evening light. */
const LOGS_IN_A_CLEARED_GROVE_BY_DAY = ([r, g, b]) => r > 105 && g > 0.72 * r && g < 0.9 * r && b > 0.45 * r && b < 0.7 * r;
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
  const outside = { filled: shadedLogsIn(filled.png), stillFull: shadedLogsIn(stillFull.png) };
  session.check(
    `at ${when('full')} and at ${when('stillFull')} the logs with no place still lie in the grove`,
    outside.filled >= HAUL_LEAST.noPlace && outside.stillFull >= HAUL_LEAST.noPlace,
    `${outside.filled} and then ${outside.stillFull} log pixels in the grove, needs ${HAUL_LEAST.noPlace} both times`,
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
  const morning = await at(walk.page, HAUL_STOPS.morning, 'hauling-dawn-lying');
  const carried = await at(walk.page, HAUL_STOPS.carried, 'hauling-dawn-carried');
  await walk.context.close();
  seen.push(...walk.errors);

  const bare = await session.open(CLIP, { search: '?swarm=off', clock: 'paused' });
  await takeView(session, bare.page, GATHER_VIEWS.grove);
  const empty = {};
  for (const stop of ['farMarked', 'beforeDusk', 'night']) empty[stop] = (await at(bare.page, HAUL_STOPS[stop], `hauling-bare-${stop}`)).png;
  await bare.context.close();
  seen.push(...bare.errors);

  const onRoute = (stop, png, threshold) => changedIn(empty[stop], png, CLIP.width, HAUL_BOXES.route, threshold);
  const routeBefore = { logs: logsIn(route.png, HAUL_BOXES.route), changed: onRoute('farMarked', route.png) };
  session.check(
    `at ${when('farMarked')}, before the far stockpile, nothing lies on the route`,
    routeBefore.logs <= HAUL_MOST.goodsBefore && routeBefore.changed <= HAUL_MOST.routeBefore,
    `${routeBefore.logs} log pixels on the route, needs at most ${HAUL_MOST.goodsBefore}; ${routeBefore.changed} pixels differ from the bare map, needs at most ${HAUL_MOST.routeBefore}`,
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
  const routeLogs = { morning: logsIn(morning.png, HAUL_BOXES.route), carried: logsIn(carried.png, HAUL_BOXES.route) };
  session.check(
    `after dawn the settlers carry the dropped units on by ${when('carried')}`,
    routeLogs.morning >= HAUL_LEAST.droppedAtDawn && routeLogs.carried <= routeLogs.morning * HAUL_MOST.routeCarried && carried.totals.logs > nightTotals[0],
    `${routeLogs.morning} log pixels on the route at ${when('morning')} and ${routeLogs.carried} at ${when('carried')}, needs ${HAUL_LEAST.droppedAtDawn} and then at most ${HAUL_MOST.routeCarried * 100}% of them; Logs ${nightTotals[0]} at night and ${carried.totals.logs} at ${when('carried')}`,
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
 * The boxes are in clip pixels of the closer view: the nine tiles of the site up to the top of the roof, and the land
 * a tile or two around them, with the near edge of the stockpile. The walkers beside the house are those in `around`
 * and not in `site`.
 */
const BUILD_BOXES = {
  site: { x: 460, y: 195, width: 80, height: 120 },
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
/** Wheel pixels that reach the nearest view of 22 m and the farthest of 243 m from any view. */
const READ_WHEELS = { near: -3000, far: 3000 };
/** The thatch of the house roof, as it looks in the late afternoon: a dull gold, redder than a tunic and with less blue than timber. */
const HOUSE_ROOF = ([r, g, b]) => r > 85 && r < 170 && g > 0.64 * r && g < 0.78 * r && b < 0.28 * r;
/** The timber of a site's scaffold and of the walls that rise inside it, in the afternoon light. */
const SITE_TIMBER = ([r, g, b]) => r > 40 && r < 140 && g > 0.5 * r && g < 0.78 * r && b < 0.5 * r;
/** The label's text is near white, on a dark panel. */
const LABEL_INK = ([r, g, b]) => Math.min(r, g, b) > 200;
/**
 * On the owner's Mac the stockpile held 5 logs at 11:30. The site held 233 log and 40 stone pixels half supplied, and
 * 280 log pixels at half its work. Its box held 23 timber pixels half supplied and 1886 at half the work, 48 roof
 * pixels at half the work and 2198 once the house stood, and 0 log pixels. Beside the house stood 207, 218, and 9
 * villager pixels at the three stops of day 2, a carrier or two. Each label held 149 to 157 near-white text pixels.
 */
const BUILD_LEAST = { stocked: 1, logs: 80, stone: 25, timber: 40, roof: 1500, walkers: 150, ink: 60 };
const BUILD_MOST = { goodsBefore: 10, roofBefore: 100, goodsAfter: 10 };

function siteDriver(session) {
  const site = (page) => page.getByRole('status', { name: 'House site' });
  const order = (page) => page.getByRole('status', { name: 'Order' });
  const said = async (page, pattern) => {
    await order(page).filter({ hasText: pattern }).waitFor({ timeout: 15_000 }).catch(() => {});
    return (await order(page).textContent()) ?? '';
  };
  const reads = async (page) => {
    if ((await site(page).count()) === 0) return null;
    const text = await site(page).innerText();
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
  const goods = (shot) => ({ logs: count(shot.png, BUILD_BOXES.site, GOOD_COLORS.logs), stone: count(shot.png, BUILD_BOXES.site, GOOD_COLORS.stone) });
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
  const roof = { work: count(work.png, BUILD_BOXES.site, HOUSE_ROOF), done: count(done.png, BUILD_BOXES.site, HOUSE_ROOF) };
  session.check(
    `at ${done.at} the label is gone and the house stands on the site`,
    done.label === null && roof.work <= BUILD_MOST.roofBefore && roof.done >= BUILD_LEAST.roof,
    `${done.label ? `the label reads "${done.label.text}"` : 'no label'}; ${roof.work} roof pixels on the site at ${work.at} and ${roof.done} at ${done.at}, needs at most ${BUILD_MOST.roofBefore} and then ${BUILD_LEAST.roof}`,
  );
  session.check(
    `at ${done.at} no log is drawn on the house's tiles any more`,
    goodsAt.work.logs >= BUILD_LEAST.logs && goodsAt.done.logs <= BUILD_MOST.goodsAfter,
    `${goodsAt.work.logs} log pixels on the site at ${work.at} and ${goodsAt.done.logs} at ${done.at}, needs ${BUILD_LEAST.logs} and then at most ${BUILD_MOST.goodsAfter}`,
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
 * the camp. The views are read at the nearest and the farthest zoom: the first midnight, the next noon, and a noon and
 * a midnight of winter, which starts on day 10.
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
/** Pixels the land is dragged up once the house is placed, so the nearest view holds the camp below the house. */
const LOOK_PAN = 40;
/** Wheel pixels from the nearest view of 22 m back to the 31 m the house is placed from. */
const LOOK_BACK_WHEEL = Math.log(31.1 / 22) / 0.0015;
/** The boxes are in clip pixels of the nearest view: the house up to its ridge, the fire in the middle of the camp, and the land clear of the panels. */
const LOOK_BOXES = {
  house: { x: 460, y: 160, width: 90, height: 110 },
  fire: { x: 440, y: 330, width: 50, height: 50 },
  land: { x: 150, y: 60, width: 640, height: 420 },
};
/** The thatch of the house roof in daylight: a dull gold, redder than a villager's tunic and yellower than timber and soil. */
const THATCH = ([r, g, b]) => r > 120 && g > 0.6 * r && g < 0.8 * r && b > 0.15 * r && b < 0.4 * r;
/** The flame of the campfire, which the sun does not light: orange to yellow at full brightness at any hour. */
const FLAME = ([r, g, b]) => r > 200 && g > 90 && g < 220 && b < 110 && r > g + 30;
/**
 * On the owner's Mac the house held 2640 thatch pixels at noon in spring and 2930 in winter, against 293 on the site
 * before the house stood. The land held 1401 and 2732 villager pixels, and the fire 107 flame pixels at both
 * midnights, with none elsewhere. A frame took 22 to 24 draw calls with the settlers and with the swarm, against 20
 * to 22 before the models.
 */
const LOOK_LEAST = { thatch: 1500, settlers: 500, flame: 60 };
const LOOK_MOST = { flameElsewhere: 5, calls: 30 };

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
    for (const distance of ['near', 'far']) {
      await zoom(page, READ_WHEELS[distance]);
      await shot(page, `look-${name}-${distance}`);
    }
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
    const settlers = count(noon, LOOK_BOXES.land, UNIT_COLORS.villagers);
    session.check(`${noon} shows the settlers in their tunics`, settlers >= LOOK_LEAST.settlers, `${settlers} villager pixels, needs ${LOOK_LEAST.settlers}`);
    const fire = count(midnight, LOOK_BOXES.fire, FLAME);
    const elsewhere = count(midnight, LOOK_BOXES.land, FLAME) - fire;
    session.check(
      `${midnight} shows the fire burning at the camp, and nothing else as bright`,
      fire >= LOOK_LEAST.flame && elsewhere <= LOOK_MOST.flameElsewhere,
      `${fire} flame pixels at the fire and ${elsewhere} elsewhere, needs ${LOOK_LEAST.flame} and at most ${LOOK_MOST.flameElsewhere}`,
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
