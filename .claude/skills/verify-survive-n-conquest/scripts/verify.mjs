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

/**
 * The boxes, in page pixels, of every visible element over the world that
 * paints a background: the panels, the toolbar, the clock, and the hints.
 */
function interfaceBoxes(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((node) => node.id !== 'world' && !node.closest('canvas'))
      .filter((node) => {
        const style = getComputedStyle(node);
        return style.visibility !== 'hidden' && style.display !== 'none' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
      })
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0)
      .map(({ x, y, width, height }) => ({ x, y, width, height })),
  );
}

/**
 * The mean color of the pixels of a screenshot of a page of `size` that lie
 * outside every box, so that a reading of the world's light does not move
 * when a panel grows.
 */
function meanColorOutside(png, size, boxes) {
  const pixels = ffmpeg(['-i', png, '-vf', `scale=${size.width}:${size.height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const covered = new Uint8Array(size.width * size.height);
  for (const box of boxes) {
    for (let y = Math.max(Math.floor(box.y), 0); y < Math.min(Math.ceil(box.y + box.height), size.height); y++) {
      covered.fill(1, y * size.width + Math.max(Math.floor(box.x), 0), y * size.width + Math.min(Math.ceil(box.x + box.width), size.width));
    }
  }
  const sum = [0, 0, 0];
  let count = 0;
  for (let pixel = 0; pixel < covered.length; pixel++) {
    if (covered[pixel] === 1) continue;
    for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[pixel * 3 + channel];
    count++;
  }
  return sum.map((total) => total / count);
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
function changedPixels(pngA, pngB, width, threshold = SETTLER_THRESHOLD, skip = null) {
  const a = ffmpeg(['-i', pngA, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const b = ffmpeg(['-i', pngB, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const xs = [];
  const ys = [];
  for (let i = 0; i < a.length; i += 3) {
    const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (delta <= threshold) continue;
    const px = (i / 3) % width;
    const py = Math.floor(i / 3 / width);
    if (skip && px >= skip.x && px < skip.x + skip.width && py >= skip.y && py < skip.y + skip.height) continue;
    xs.push(px);
    ys.push(py);
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
 * palette of every step. `decimate` drops every frame that repeats the one before and shows each frame that is left
 * once, so a paused stop passes in one frame. With `decimate`, `speed` keeps one of every `speed` frames that are left.
 */
function toGif(video, gif, { from = 0, to, width = GIF_STEPS[0].width, crop, colors = 256, speed = 1, decimate = false } = {}) {
  const span = to === undefined ? [] : ['-t', (to - from).toFixed(2)];
  const cut = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : '';
  for (const step of GIF_STEPS.filter((step) => step.width <= width)) {
    const pace = decimate ? `mpdecimate,setpts=N/${step.fps * speed}/TB,` : speed === 1 ? '' : `setpts=PTS/${speed},`;
    const palette = `${cut}${pace}fps=${step.fps},scale=${step.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${Math.min(step.colors, colors)}:stats_mode=diff[p];[b][p]paletteuse=dither=none`;
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
      // The clock runs from the first frame, and the first frames can take seconds, so a paused page pauses as soon as
      // its speed controls show, at the opening minute.
      if (clock === 'paused') {
        await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
        await this.pause(page);
      }
      await this.settle(page);
      await page.getByRole('status', { name: 'Date' }).filter({ hasText: /^Day / }).waitFor();
      if (clock !== 'paused') await start(page);
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
/**
 * The URL setting that opens the camp with enough food for the settlers to live to winter, for the scenarios that
 * run past the dusk of day 6, when the 24 food of a new game have run out and every settler has starved. A player
 * opens the game without it.
 */
const FED = '?food=200';
const SEEDS = ['7', '2026'];
/** The game opens with 8 settlers. This opens it with the benchmark load of 1500 villagers and 3000 monsters instead. */
const SWARM = '?swarm=on';
/** Deer move between two pictures a check compares, so a page whose check needs the same scene twice leaves them out. */
const NO_DEER = 'deer=off';
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
      const color = meanColorOutside(stop.png, CLIP, await interfaceBoxes(paused.page));
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

  const bare = await session.open(WIDE, { search: `?swarm=off&${NO_DEER}` });
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
  let panel = null;
  const visit = async (search, label) => {
    const opened = await session.open(CLIP, { search, clock: 'paused' });
    await zoomToCamp(opened.page);
    panel ??= await opened.page.getByRole('status', { name: 'Stockpiles' }).boundingBox();
    const shots = {};
    for (const [name, when] of stops) {
      await session.reach(opened.page, when);
      await session.still(opened.page);
      shots[name] = await session.screenshot(opened.page, `${label}-${name}`);
    }
    await opened.context.close();
    return { shots, errors: opened.errors };
  };
  const settled = await visit(`?${NO_DEER}`, 'settlers');
  const bare = await visit(`?swarm=off&${NO_DEER}`, 'bare');
  // The Stockpiles panel is left out: the food at the camp falls as the settlers eat and stays at 24 on the bare map.
  const at = Object.fromEntries(stops.map(([name]) => [name, changedPixels(bare.shots[name], settled.shots[name], CLIP.width, SETTLER_THRESHOLD, panel)]));
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

  const rock = await session.open(CLIP, { record: true, clock: 'paused', search: `?${NO_DEER}` });
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

  const bare = await session.open(CLIP, { search: `?swarm=off&${NO_DEER}`, clock: 'paused' });
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
const LOOK_CLIP = { crop: { x: 60, y: 40, width: 560, height: 420 }, width: 560, colors: 64 };
/** Pixels the land is dragged up once the house is placed, so the near view holds the camp below the house. */
const LOOK_PAN = 40;
/**
 * Pixels the land is dragged west in the same drag, so the house and the camp stand west of the winter readiness
 * panel, which from the first day of autumn covers the page from x 464 to 792 and from y 108 to 234 at 960 by 540.
 * Before the panel the drag was straight up and the house's box lay under it: at the winter noon it read 140 thatch
 * pixels against the 1900 needed. In a run with this drag the near view at noon on day 2 moved the house's thatch by
 * (-150, -24) pixels and the midnight flame by (-187, -22), and the boxes below moved with them.
 */
const LOOK_SHIFT = 105;
/** Wheel pixels from the nearest view of 14 m out to the near view of 22 m, and from there back to the 31 m the house is placed from. */
const LOOK_NEAR_WHEEL = Math.log(22 / 14) / 0.0015;
const LOOK_BACK_WHEEL = Math.log(31.1 / 22) / 0.0015;
/**
 * The boxes are in clip pixels of the near view: the house up to its ridge, the fire in the middle of the camp, the
 * camp with all the ground that the fire lights, and the land clear of the panels.
 */
const LOOK_BOXES = {
  house: { x: 305, y: 126, width: 115, height: 125 },
  fire: { x: 253, y: 308, width: 50, height: 50 },
  camp: { x: 203, y: 258, width: 145, height: 153 },
  land: { x: 0, y: 60, width: 640, height: 420 },
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

  const town = await session.open(CLIP, { record: true, search: FED, clock: 'paused' });
  const { page } = town;
  const notice = await page.locator('.models-notice').allTextContents();
  session.check('the game draws the models, not stand-in shapes', notice.length === 0, notice.join(' ') || 'no notice on the page');
  await session.reach(page, BUILD_STOPS.marked);
  await markWork(page);
  await zoom(page, BUILD_CLOSER);
  await session.reach(page, BUILD_STOPS.placed);
  await placeHouse(page, BUILD_SPOTS.closerHouse);
  await session.drag(page, { x: CLIP.width / 2, y: CLIP.height / 2 + LOOK_PAN / 2 }, { x: CLIP.width / 2 - LOOK_SHIFT, y: CLIP.height / 2 - LOOK_PAN / 2 });
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

/**
 * The hunger scenario's stops on seed 7 with no orders. The camp's 24 food last the dusks of days 1 to 3, so the clip
 * runs from just before the last meal, at the spring dusk of day 3 at 19:12, at 8× until the settlement has died out
 * at the summer dusk of day 6 at 20:24. The settler's panel is read by day, when a settler is easy to click, on the
 * days between its first and its third missed meal.
 */
const HUNGER_STOPS = {
  firstDusk: { day: 1, time: '22:00' },
  secondDusk: { day: 2, time: '22:00' },
  lastMeal: { day: 3, time: '18:55' },
  oneMissed: { day: 5, time: '12:00' },
  twoMissed: { day: 6, time: '12:00' },
};
const HUNGER_SEARCH = '?seed=7';
const HUNGER_NAMES = ['Merek', 'Elsi', 'Ulvar', 'Ysa', 'Jorrin', 'Fenna', 'Dorran', 'Nella'];
/** The clip leaves out the camera controls at the bottom and plays 3 times as fast as it was recorded, so three game days at 8× take about 40 s. */
const HUNGER_CLIP = { crop: { x: 0, y: 0, width: 960, height: 496 }, width: 640, colors: 48, speed: 3 };
/** Wheel pixels from the opening view of about 120 m in to about 49 m, so the settlers at the camp show in the clip. */
const HUNGER_WHEEL = -600;
/** Wall seconds the clip may take at 8× from the last meal to the end: three days and a bit at 38 s a day, with room for a slow pylon. */
const HUNGER_RUN_MS = 420_000;

function hungerDriver(session) {
  const stockpiles = (page) => page.getByRole('status', { name: 'Stockpiles' });
  const news = (page) => page.getByRole('log', { name: 'Settlement news' });
  const diedOut = (page) => page.getByRole('alertdialog', { name: 'The settlement has died out' });
  const food = async (page) =>
    stockpiles(page).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { camp: Number(rows['Barn and camp food']), homes: Number(rows['Food in homes']) };
    });
  const lines = async (page) => (await news(page).count()) > 0 ? news(page).locator('p').allTextContents() : [];
  return { stockpiles, news, diedOut, food, lines };
}

SCENARIOS.hunger = async (session) => {
  const seen = [];
  const { diedOut, food, lines } = hungerDriver(session);
  const { reads, text, tunics, click } = selectionDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));

  const town = await session.open(CLIP, { record: true, search: HUNGER_SEARCH, clock: 'paused' });
  const { page } = town;
  const opening = await food(page);
  session.check('the camp opens with 24 food and the homes with none', opening.camp === 24 && opening.homes === 0, `at ${await at(page)} the Stockpiles panel reads ${opening.camp} food at the camp and ${opening.homes} in homes`);
  for (const [stop, left] of [['firstDusk', 16], ['secondDusk', 8]]) {
    await session.reach(page, HUNGER_STOPS[stop]);
    const read = await food(page);
    session.check(`after the dusk of day ${HUNGER_STOPS[stop].day} the camp holds ${left} food`, read.camp === left, `at ${await at(page)} the panel reads ${read.camp} food at the camp`);
  }
  await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await page.mouse.wheel(0, HUNGER_WHEEL);
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);
  await session.reach(page, HUNGER_STOPS.lastMeal);
  const beforeLast = await food(page);
  session.check('before the last meal the camp holds 8 food', beforeLast.camp === 8, `at ${await at(page)} the panel reads ${beforeLast.camp}`);

  const from = town.since();
  const heard = new Map();
  const camps = [];
  await page.keyboard.press('4');
  const deadline = Date.now() + HUNGER_RUN_MS;
  while ((await diedOut(page).count()) === 0 || !(await diedOut(page).isVisible())) {
    if (Date.now() > deadline) fail(`the settlement had not died out ${HUNGER_RUN_MS / 1000} s after the last meal at 8×`);
    for (const line of await lines(page)) if (!heard.has(line)) heard.set(line, await at(page));
    camps.push((await food(page)).camp);
    await page.waitForTimeout(250);
  }
  for (const line of await lines(page)) if (!heard.has(line)) heard.set(line, await at(page));
  const to = town.since() + 3;
  const ended = await session.gameMinutes(page);
  await page.waitForTimeout(3000);
  const later = await session.gameMinutes(page);
  session.check('the clock stops when the settlement has died out', later === ended, `the clock read ${clockText(ended)} when the message showed and ${clockText(later)} 3 s later`);
  session.check('the settlement dies out at the dusk of day 6', clockText(ended).startsWith('day 6 2'), `the message showed at ${clockText(ended)}`);
  await session.screenshot(page, 'hunger-died-out');
  const message = (await diedOut(page).textContent()).trim();
  session.check('the message says that the settlement has died out and offers a new map', /died out/.test(message) && (await diedOut(page).getByRole('button', { name: 'New map' }).count()) === 1, `the dialog reads "${message}"`);

  const said = [...heard.entries()].map(([line, when]) => `"${line}" by ${when}`);
  const named = (pattern) => HUNGER_NAMES.filter((name) => [...heard.keys()].some((line) => pattern.test(line) && line.includes(name)));
  const hungry = named(/went hungry/);
  const starved = named(/starved/);
  session.check('the news names all 8 settlers as they go hungry', hungry.length === 8, `named ${hungry.join(', ') || 'nobody'}; heard ${said.join('; ')}`);
  session.check('the news names all 8 settlers as they starve', starved.length === 8, `named ${starved.join(', ') || 'nobody'}`);
  session.check('the camp is empty from the last meal on', camps.slice(-1)[0] === 0 && camps.every((left, i) => i === 0 || left <= camps[i - 1]), `the camp read ${[...new Set(camps)].join(', ')} food while the clock ran`);

  await diedOut(page).getByRole('button', { name: 'New map' }).click();
  await page.getByRole('status', { name: 'Date' }).filter({ hasText: /^Day 1/ }).waitFor();
  await session.settle(page);
  const fresh = await food(page);
  const seed = new URL(page.url()).searchParams.get('seed');
  session.check('New map opens a new map with 24 food at the camp', fresh.camp === 24 && seed !== '7' && (await diedOut(page).count()) === 0, `the page opened seed ${seed} with ${fresh.camp} food at the camp`);
  await session.finishClips(town.context, page, [{ label: 'hunger-last-meal-to-death', from, to, ...HUNGER_CLIP }]);
  seen.push(...town.errors);

  const panel = await session.open(CLIP, { search: HUNGER_SEARCH, clock: 'paused' });
  await session.reach(panel.page, HUNGER_STOPS.oneMissed);
  await session.still(panel.page);
  const aim = await session.screenshot(panel.page, 'hunger-settler-aim');
  let picked = { read: null };
  for (const spot of (await tunics(panel.page, aim)).slice(0, 8)) {
    const read = await click(panel.page, { x: spot.x, y: spot.y });
    picked = { spot, read };
    if (settlerPanel(read)) break;
  }
  session.check(`at ${await at(panel.page)} a settler that missed its first meal reads hungry`, picked.read?.rows['Missed meals'] === '1, hungry', `the panel reads "${text(picked.read)}"`);
  await session.screenshot(panel.page, 'hunger-settler-panel');
  await session.reach(panel.page, HUNGER_STOPS.twoMissed);
  const second = await reads(panel.page);
  session.check(`at ${await at(panel.page)} the same settler has missed two meals`, second?.title === picked.read?.title && second?.rows['Missed meals'] === '2, hungry', `the panel reads "${text(second)}"`);
  await panel.context.close();
  seen.push(...panel.errors);
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/**
 * The eating scenario. On seed 7 the camp opens empty, with `?food=0`, and the player gives #27's first-year orders at
 * 08:12 on day 1: the forager's hut on (136, 127) and a Chop on each of its four log trees, from the view of `foraging`.
 * The hut stands by midday, its two foragers bring food in that afternoon and put it down at dusk, so 6 settlers miss
 * their first meal. On day 2 the foragers' units reach the camp in the morning. Which settlers go hungry depends on the
 * minute the orders land, and a page reaches its first pause anywhere from 08:06 to 08:09 as it loads, so the scenario
 * runs the clock to 08:12 before it gives them. A run on `main` then makes the same settlers hungry as a run on this
 * build. The scenario selects the first hungry settler a click finds. `EATING_SETTLER` and `EATING_PAIR_TIME` in the
 * environment select a settler by name and move the stop of the pair, so a run on an older build reads the same
 * settler at the same time.
 */
const EATING_SEARCH = '?seed=7&food=0';
/** The settler to select, by name. Left out, the scenario selects the first hungry settler a click finds. */
const EATING_SETTLER = process.env.EATING_SETTLER ?? null;
const EATING_STOPS = {
  orders: { day: 1, time: '08:12' },
  look: [{ day: 2, time: '07:30' }, { day: 2, time: '08:00' }, { day: 2, time: '08:30' }],
  last: { day: 2, time: '15:00' },
  pair: { day: 2, time: process.env.EATING_PAIR_TIME ?? '15:30' },
};
/** Game minutes between two reads of the panel while the settler may set out, so a walk of a few tiles shows at two stops at least. */
const EATING_STEP = 3;
/** Wall seconds of the recording kept before the walk starts and after the meal. */
const EATING_MARGIN = 2;
const EATING_CLIP = { crop: { x: 0, y: 0, width: 760, height: 490 }, width: 640, colors: 48 };
const EATING_WALK = 'Walking to the camp to eat';

SCENARIOS.eating = async (session) => {
  const { reads, text, uiBoxes, skipOf, tunicPixels, click } = selectionDriver(session);
  const { food } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const play = await session.open(CLIP, { record: true, search: EATING_SEARCH, clock: 'paused' });
  const { page } = play;
  await takeForageView(session, page);
  await session.reach(page, EATING_STOPS.orders);
  const opening = await food(page);
  session.check('the camp opens with no food', opening.camp === 0, `at ${await at(page)} the Stockpiles panel reads ${opening.camp} food at the camp`);
  await page.keyboard.press('KeyC');
  for (const spot of FORAGE_SPOTS.trees) await page.mouse.click(spot.x, spot.y);
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await page.keyboard.press('KeyG');
  await page.mouse.move(FORAGE_SPOTS.hut.x, FORAGE_SPOTS.hut.y, { steps: 3 });
  await page.mouse.click(FORAGE_SPOTS.hut.x, FORAGE_SPOTS.hut.y);
  await page.keyboard.press('Escape');
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  const siteCount = await page.getByRole('status', { name: "Forager's hut site" }).count();
  session.check("the player's orders place the hut site", siteCount === 1, `${siteCount} forager's hut site labels at ${await at(page)}`);

  // Settlers who stand together make one patch of tunic, so the clicks aim at the fullest cells of 12 pixels.
  const select = async (shot) => {
    const png = await session.screenshot(page, shot);
    const boxes = skipOf(await uiBoxes(page));
    const cells = new Map();
    for (const { x, y } of await tunicPixels(page, png)) {
      if (boxes.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) continue;
      const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const cell = cells.get(key) ?? { count: 0, x: 0, y: 0 };
      cells.set(key, { count: cell.count + 1, x: cell.x + x, y: cell.y + y });
    }
    for (const cell of [...cells.values()].sort((a, b) => b.count - a.count).slice(0, 16)) {
      const read = await click(page, { x: cell.x / cell.count, y: cell.y / cell.count });
      clicked.push(`${shot}: ${read?.title ?? 'nothing'} ${read?.rows?.['Missed meals'] ?? ''}`);
      if (settlerPanel(read) && read.rows['Missed meals'] === '1, hungry' && (EATING_SETTLER === null || read.title === EATING_SETTLER)) return read;
    }
    return null;
  };
  const clicked = [];
  let hungry = null;
  for (const stop of EATING_STOPS.look) {
    await session.reach(page, stop);
    await session.still(page);
    hungry = await select(`eating-aim-${stop.time.replace(':', '')}`);
    if (hungry) break;
  }
  if (!hungry) fail(`no click found ${EATING_SETTLER ?? 'a hungry settler'} by ${clockText(clockMinutes(EATING_STOPS.look.at(-1)))}: ${clicked.join('; ')}`);
  const panel = page.getByRole('region', { name: 'Selection' });
  const width = async () => (await panel.boundingBox())?.width ?? 0;
  const widths = [await width()];
  const name = hungry.title;
  session.check(`${name} missed the meal of the first dusk and reads hungry`, hungry.rows['Missed meals'] === '1, hungry', `at ${await at(page)} the panel reads "${text(hungry)}"`);
  await session.screenshot(page, 'eating-hungry');
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);

  const seen = [];
  let walking = null;
  let fed = null;
  let from = null;
  let to = null;
  let now = await session.gameMinutes(page);
  while (!fed && now < clockMinutes(EATING_STOPS.last)) {
    await session.reach(page, clockAt(now + EATING_STEP));
    now = await session.gameMinutes(page);
    const read = await reads(page);
    const camp = (await food(page)).camp;
    seen.push(`${clockText(now)} ${read?.rows.Doing} (${read?.rows['Missed meals']}, camp ${camp})`);
    if (read?.title !== name) break;
    if (!walking && read.rows.Doing === EATING_WALK) {
      walking = { read, camp, when: now };
      from = play.since() - EATING_MARGIN - 3;
      widths.push(await width());
      await session.screenshot(page, 'eating-walking');
    }
    if (read.rows['Missed meals'] === 'None') {
      fed = { read, when: now };
      widths.push(await width());
      await session.screenshot(page, 'eating-fed');
      to = play.since() + EATING_MARGIN;
    }
  }
  session.check(
    `with food at the camp by day, ${name} walks there to eat`,
    walking !== null && walking.camp > 0,
    walking ? `at ${clockText(walking.when)} the panel reads "${text(walking.read)}" and the camp holds ${walking.camp}` : `never read "${EATING_WALK}": ${seen.join('; ')}`,
  );
  session.check(
    `${name} eats at the camp by day, which clears the missed meal`,
    fed !== null && walking !== null && fed.when > walking.when && fed.when < clockMinutes({ day: 2, time: '18:00' }),
    fed ? `at ${clockText(fed.when)} the panel reads "${text(fed.read)}"` : `still hungry at ${clockText(now)}: ${seen.join('; ')}`,
  );
  session.check('the panel keeps its width while the settler walks to eat', widths.every((value) => Math.abs(value - widths[0]) < 1), `widths ${widths.map((value) => value.toFixed(1)).join(', ')} px`);
  session.check('the panel read at each stop', seen.length > 0, seen.join('; '));

  await session.reach(page, EATING_STOPS.pair);
  const pair = await reads(page);
  session.check(`at ${await at(page)} ${name}'s panel reads no missed meal`, pair?.title === name && pair.rows['Missed meals'] === 'None', `the panel reads "${text(pair)}"`);
  await session.screenshot(page, 'eating-pair');
  if (from !== null && to !== null) await session.finishClips(play.context, page, [{ label: 'eating-walk-to-eat', from: Math.max(from, 0), to, ...EATING_CLIP }]);
  else await play.context.close();
  session.check('no page errors', play.errors.length === 0, play.errors.join(' | ') || 'none');
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
  // At 08:00 all 8 settlers stand in the camp's 2 m, so at the opening view a click beside one lands among the others,
  // and at the nearest view it lands on the camp, where a settler wins a click only within 4 px of its body. By 09:00
  // every one has walked out of it, and the nearest view picks there.
  nearest: { day: 1, time: '09:00' },
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
      // A control's buttons sit beside its value, so a row reads only the value before them.
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.firstChild?.textContent.trim() ?? '';
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
    news: await boxOf(page.getByRole('log', { name: 'Settlement news' })),
    readiness: await boxOf(page.getByRole('status', { name: 'Winter readiness' })),
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

/**
 * The longest reading of each settler row, by its label: the tailor's idle words, the longest `Doing`, under the
 * longest of the settlers' names, in a household of two. A row missing from here keeps the reading it has, so a new
 * row adds its height to the measured copy. A household member who died adds ` (died)` and a third line to
 * `Household`, and with these readings that panel reaches above the Stockpiles panel's bottom.
 */
const SETTLER_LONGEST = {
  Doing: "Idle, no hide in a stockpile within 30 tiles of the tailor's hut",
  Carries: '1 firewood',
  Job: 'Woodcutter',
  Sex: 'Woman',
  Household: 'Household 4, with Haldor',
  Home: 'None, sleeps at the camp',
  'Missed meals': '2, hungry',
  'Cold nights': '2, cold, clothed',
};

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
  const longest = await page.getByRole('region', { name: 'Selection' }).evaluate((node, readings) => {
    const copy = node.cloneNode(true);
    copy.removeAttribute('aria-label');
    for (const name of copy.querySelectorAll('dt')) {
      const value = name.nextElementSibling?.firstChild;
      if (value && readings[name.textContent.trim()] !== undefined) value.textContent = readings[name.textContent.trim()];
    }
    node.after(copy);
    const { x, y, width, height } = copy.getBoundingClientRect();
    const fit = { box: { x, y, width, height }, shown: copy.clientHeight, holds: copy.scrollHeight, rows: copy.querySelectorAll('dt').length };
    copy.remove();
    return fit;
  }, SETTLER_LONGEST);
  const stockpilesBox = (await uiBoxes(page)).stockpiles;
  session.check(
    'at 960x540 the settler panel, with every row at its longest reading, stays clear of the Stockpiles panel and shows every row',
    Boolean(stockpilesBox) && longest.box.y >= stockpilesBox.y + stockpilesBox.height && longest.holds <= longest.shown,
    `the panel of ${longest.rows} rows would be ${longest.box.width.toFixed(0)}x${longest.box.height.toFixed(0)} from y ${longest.box.y.toFixed(0)}, its rows taking ${longest.holds} px; the Stockpiles panel ends at y ${stockpilesBox ? (stockpilesBox.y + stockpilesBox.height).toFixed(0) : 'missing'}`,
  );

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
  const camp = await session.open(CLIP, { search: FED });
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
  await session.reach(v, SELECT_STOPS.nearest);
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

/**
 * The `foraging` scenario plays the first year's hut of `src/sim/firstYear.ts` through the page, on seed 7 with the
 * camp's own 24 food: the forager's hut anchored on (136, 127), east of the camp at the forest's edge, and a Chop on
 * each of the four trees whose 8 logs build it. The view looks east from 23 m over the camp to the hut and the forest's
 * edge the foragers work on day 2, so a settler stands about 28 pixels tall and no tree stands between the camp and the
 * hut. `scripts/aim.ts` found the spots, each tile's center at that view, where the game's picker takes that tile:
 * `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7 '{"wheel":-1100,"turn":{"x":424,"y":20},"target":[132.5,126.5]}'
 * '[[136,127],[137,129],[138,130],[134,131],[135,134],[136.5,127.5,1.2]]'`. The roof spot is 1.2 m over the hut's middle.
 */
const FORAGE_VIEW = { wheel: -1100, turn: { x: 424, y: 20 }, pan: { x: 42, y: 90 } };
const FORAGE_SPOTS = {
  hut: { x: 505, y: 189 },
  roof: { x: 519, y: 154 },
  trees: [{ x: 555, y: 170 }, { x: 578, y: 152 }, { x: 615, y: 221 }, { x: 688, y: 211 }],
};
const FORAGE_SEARCH = '?seed=7';
/**
 * The orders land at the paused tick a few minutes after 08:00. With them given at 08:00, the hut stood at 12:18 in
 * `scripts/first-year.ts`, and Ysa and Jorrin took its places. The camp gains a unit for each one picked, 8 on day 2.
 */
const FORAGE_FINISHED = { after: { day: 1, time: '11:30' }, before: { day: 1, time: '13:30' } };
const FORAGE_STOPS = { dawn: { day: 2, time: '05:00' }, dusk: { day: 2, time: '19:00' } };
const FORAGE_RISE = 4;
/** The fewest pixels of the green that previews a fitting site, as `orders` asks of a house. */
const FORAGE_PREVIEW_FITS = 30;
/**
 * The clip keeps the clock, the Stockpiles panel, the panel of the forager it follows, the camp, the hut, and the
 * forest's edge the foragers work on day 2. Played at twice its speed with 32 colors it took 3.3 MB, inside the 4 MB a
 * clip of the stage's demo set may take, where 48 colors took 4.2 MB.
 */
const FORAGE_CLIP = { crop: { x: 0, y: 0, width: 760, height: 490 }, width: 560, colors: 32, speed: 2 };
const FORAGER_DOING = /^(Walking to a tree to forage|Foraging|Carrying food to the camp|Looking for forage)$/;

/** Takes `view`, `FORAGE_VIEW` unless given, from the opening view at the `CLIP` size: a wheel zoom, a right drag that turns and tilts, and a drag that pans. */
async function takeForageView(session, page, view = FORAGE_VIEW) {
  const middle = { x: CLIP.width / 2, y: CLIP.height / 2 };
  const { wheel, turn, pan } = view;
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, wheel);
  await session.still(page);
  for (const [move, button] of [[turn, 'right'], [pan, 'left']]) {
    const from = { x: middle.x - move.x / 2, y: middle.y - move.y / 2 };
    await session.drag(page, from, { x: from.x + move.x, y: from.y + move.y }, button);
    await session.still(page);
  }
}

SCENARIOS.foraging = async (session) => {
  const seen = [];
  const { said } = siteDriver(session);
  const { reads, text, uiBoxes, skipOf, tunicPixels, click } = selectionDriver(session);
  const { food, lines } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const label = (page) => page.getByRole('status', { name: "Forager's hut site" });
  const jobs = async (page) =>
    page.getByRole('status', { name: 'Stockpiles' }).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { withJob: Number(rows['Settlers with a job']), withoutJob: Number(rows['Settlers with no job']) };
    });
  const panelReads = async (page, done) => {
    const deadline = Date.now() + 10_000;
    let read = await reads(page);
    while (!done(read) && Date.now() < deadline) {
      await page.waitForTimeout(100);
      read = await reads(page);
    }
    return read;
  };
  const clickHut = async (page) => {
    let read = null;
    for (const spot of [FORAGE_SPOTS.roof, FORAGE_SPOTS.hut]) {
      read = await click(page, spot);
      if (read?.title === "Forager's hut") break;
    }
    return read;
  };
  // Settlers who stand together make one patch of tunic, so the clicks aim at the fullest cells of 12 pixels instead.
  const clickForager = async (page, shot) => {
    const png = await session.screenshot(page, shot);
    const boxes = skipOf(await uiBoxes(page));
    const cells = new Map();
    for (const { x, y } of await tunicPixels(page, png)) {
      if (boxes.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) continue;
      const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const cell = cells.get(key) ?? { count: 0, x: 0, y: 0 };
      cells.set(key, { count: cell.count + 1, x: cell.x + x, y: cell.y + y });
    }
    let read = null;
    for (const cell of [...cells.values()].sort((a, b) => b.count - a.count).slice(0, 12)) {
      read = await click(page, { x: cell.x / cell.count, y: cell.y / cell.count });
      if (read?.rows?.Job === 'Forager') return read;
    }
    return read;
  };
  const named = (value) => (value ?? '').split(' and ').filter(Boolean);

  const play = await session.open(CLIP, { record: true, search: FORAGE_SEARCH, clock: 'paused' });
  const { page } = play;
  await takeForageView(session, page);
  const opening = { food: await food(page), jobs: await jobs(page) };
  session.check(
    'a new game opens with 24 food at the camp and all 8 settlers without a job',
    opening.food.camp === 24 && opening.jobs.withJob === 0 && opening.jobs.withoutJob === 8,
    `at ${await at(page)} the Stockpiles panel reads ${opening.food.camp} food at the camp, ${opening.jobs.withJob} settlers with a job and ${opening.jobs.withoutJob} with none`,
  );
  await page.keyboard.press('KeyC');
  const chopped = [];
  for (const spot of FORAGE_SPOTS.trees) {
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.up();
    chopped.push(await said(page, /^1 tree marked for felling/));
    await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
    await said(page, /Drag over trees/);
  }
  session.check('a Chop click on each of the four trees marks one tree', chopped.every((line) => /^1 tree marked for felling/.test(line)), chopped.map((line) => `"${line}"`).join(', '));
  const toolbar = await page.getByRole('toolbar', { name: 'Orders' }).boundingBox();
  await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + 2);
  await page.keyboard.press('KeyG');
  const toolPressed = await page.getByRole('button', { name: "Forager's hut", exact: true, pressed: true }).count();
  const hint = await said(page, /forager's hut on 2 by 2 tiles/);
  await page.mouse.move(FORAGE_SPOTS.hut.x, FORAGE_SPOTS.hut.y, { steps: 3 });
  const fits = await said(page, /Click to place the forager's hut site here/);
  await session.still(page);
  const preview = session.orderPixels(await session.screenshot(page, 'foraging-hut-preview'), CLIP.width, toolbar);
  session.check('a hut that fits previews green over its tiles', preview.fits >= FORAGE_PREVIEW_FITS, `${preview.fits} pixels of the fits color, needs ${FORAGE_PREVIEW_FITS}`);
  await page.mouse.down();
  await page.mouse.up();
  const placed = await said(page, /^Forager's hut site placed/);
  session.check(
    "G picks the Forager's hut tool, which previews and places a hut site with a click",
    toolPressed === 1 && /forager's hut on 2 by 2 tiles/.test(hint) && /Click to place the forager's hut site here/.test(fits) && /^Forager's hut site placed/.test(placed),
    `${toolPressed ? 'the tool is pressed' : 'no tool is pressed'}; the status line read "${hint}", then "${fits}", then "${placed}"`,
  );
  await page.keyboard.press('Escape');
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);
  const siteLabel = (await label(page).count()) === 1 ? (await label(page).innerText()).replace(/\s+/g, ' ') : null;
  session.check(
    "the hut site's label reads 0 of 8 logs, no stone, and waits for materials",
    siteLabel !== null && /Logs\s*0\/8/.test(siteLabel) && !/Stone/.test(siteLabel) && /Waiting for materials/.test(siteLabel),
    `the label reads "${siteLabel ?? 'nothing'}"`,
  );
  await session.screenshot(page, 'foraging-site');

  await page.keyboard.press('4');
  const deadline = Date.now() + 240_000;
  while ((await label(page).count()) > 0) {
    if (Date.now() > deadline) fail('the hut site still stood four minutes after the orders at 8×');
    await page.waitForTimeout(100);
  }
  const finished = await session.gameMinutes(page);
  await session.pause(page);
  await session.still(page);
  session.check(
    `the hut is finished on day 1 between ${FORAGE_FINISHED.after.time} and ${FORAGE_FINISHED.before.time}`,
    finished >= clockMinutes(FORAGE_FINISHED.after) && finished <= clockMinutes(FORAGE_FINISHED.before),
    `the label was gone at ${clockText(finished)}; paused at ${await at(page)}`,
  );

  const hut = await clickHut(page);
  const hired = named(hut?.rows?.Foragers);
  session.check(
    `at ${await at(page)} the hut's panel says what it does and names its two foragers, with both places filled`,
    hut?.title === "Forager's hut" && /within 20 tiles/.test(hut.note ?? '') && hired.length === 2 && hut.rows.Places === '2 of 2',
    `the panel reads "${text(hut)}"`,
  );
  await session.screenshot(page, 'foraging-hut-panel');
  const hiredJobs = await jobs(page);
  session.check(
    'the Stockpiles panel counts 2 settlers with a job and 6 with none',
    hiredJobs.withJob === 2 && hiredJobs.withoutJob === 6,
    `${hiredJobs.withJob} with a job, ${hiredJobs.withoutJob} with none`,
  );
  const hiredNews = await lines(page);
  session.check(
    'the news names the two settlers who became foragers',
    hiredNews.some((line) => /became foragers\.$/.test(line) && hired.every((name) => line.includes(name))),
    `the news reads ${hiredNews.map((line) => `"${line}"`).join(', ') || 'nothing'}`,
  );

  await page.getByRole('button', { name: 'Fewer places' }).click();
  const fewer = await panelReads(page, (read) => read?.rows?.Places === '1 of 2');
  const fewerJobs = await jobs(page);
  const freed = hired.find((name) => !named(fewer?.rows?.Foragers).includes(name));
  const fewerNews = await lines(page);
  session.check(
    'Fewer places frees the forager that came last and leaves one place filled',
    fewer?.rows?.Places === '1 of 2' && named(fewer.rows.Foragers).length === 1 && named(fewer.rows.Foragers)[0] === hired[0] && fewerJobs.withJob === 1 && fewerJobs.withoutJob === 7,
    `the panel reads "${text(fewer)}"; the Stockpiles panel counts ${fewerJobs.withJob} with a job and ${fewerJobs.withoutJob} with none`,
  );
  session.check(
    'the news says the freed forager left the hut',
    freed !== undefined && fewerNews.some((line) => line.endsWith(`${freed} left the forager's hut.`)),
    `the news reads ${fewerNews.map((line) => `"${line}"`).join(', ') || 'nothing'}`,
  );
  await page.getByRole('button', { name: 'More places' }).click();
  const more = await panelReads(page, (read) => read?.rows?.Places === '2 of 2');
  const moreJobs = await jobs(page);
  session.check(
    'More places fills the place again by the nearest settler without a job',
    more?.rows?.Places === '2 of 2' && named(more.rows.Foragers).length === 2 && moreJobs.withJob === 2 && moreJobs.withoutJob === 6,
    `the panel reads "${text(more)}"; the Stockpiles panel counts ${moreJobs.withJob} with a job and ${moreJobs.withoutJob} with none`,
  );
  const foragers = named(more?.rows?.Foragers);
  await page.keyboard.press('Escape');

  await session.reach(page, FORAGE_STOPS.dawn);
  await session.still(page);
  const forager = await clickForager(page, 'foraging-forager-aim');
  session.check(
    `at ${await at(page)} a forager's panel reads its job and what it does`,
    forager?.rows?.Job === 'Forager' && foragers.includes(forager.title) && FORAGER_DOING.test(forager.rows.Doing ?? ''),
    `the panel reads "${text(forager)}"`,
  );
  const whole = await page.getByRole('region', { name: 'Selection' }).evaluate((node) => ({ shown: node.clientHeight, holds: node.scrollHeight }));
  session.check(
    "at 960x540 the forager's panel shows every one of its rows",
    whole.holds <= whole.shown,
    `the panel is ${whole.shown} px tall and its rows take ${whole.holds} px`,
  );
  await session.screenshot(page, 'foraging-forager-panel');
  const dawn = { at: await at(page), food: await food(page) };
  const from = play.since();
  await session.reach(page, FORAGE_STOPS.dusk);
  await session.still(page);
  const to = play.since();
  const dusk = { at: await at(page), food: await food(page), jobs: await jobs(page), forager: await reads(page) };
  await session.screenshot(page, 'foraging-dusk');
  session.check(
    `the food at the camp rises by at least ${FORAGE_RISE} from ${dawn.at} to ${dusk.at}`,
    dusk.food.camp - dawn.food.camp >= FORAGE_RISE,
    `the camp held ${dawn.food.camp} food at ${dawn.at} and ${dusk.food.camp} at ${dusk.at}`,
  );
  session.check(
    'the two foragers keep their places through the day',
    dusk.jobs.withJob === 2 && dusk.forager?.title === forager?.title && dusk.forager?.rows?.Job === 'Forager',
    `${dusk.jobs.withJob} settlers with a job at ${dusk.at}; the followed forager's panel reads "${text(dusk.forager)}"`,
  );
  await session.finishClips(play.context, page, [{ label: 'foraging-day', from, to, ...FORAGE_CLIP }]);
  seen.push(...play.errors);
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/**
 * The `storing` scenario plays a barn on seed 7 through the page, with the camp's own 24 food: a forager's hut anchored
 * on (136, 127), a barn on (134, 127) between it and the camp, so every tree the hut reaches lies nearer the barn than
 * the camp, and a house on (137, 123), nearer the barn than the camp. A Chop drag over the trees from (137, 129) to
 * (145, 139) and a Quarry drag over the rock from (121, 114) to (122, 115) give their 36 logs and 12 stone. The orders
 * go in from a view of 42 m that holds the rock, the camp, and the forest's edge, and the scenario reads the buildings
 * from 23 m, the view of the foraging clip. `scripts/aim.ts` found the spots:
 * `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7 '{"wheel":-700,"turn":{"x":424,"y":20},"target":[131.5,125.5]}'
 * '[[137,129],[145,139],[121,114],[122,115],[136,127],[134,127],[137,123],[135,123],[135,131],[133,119]]'` and, after a
 * further wheel of `STORE_CLOSER`, the same command with a wheel of -1100 and the target [131.48, 125.48], with the
 * roofs 1.6 m and 1.0 m over the barn's and the house's middles and the camp center. In `scripts/first-year.ts` terms the barn stood at day 2 14:41, the
 * house at day 3 08:59, and on day 4 the camp held 11 food from dawn to dusk while the barn rose from 4 to 16.
 */
const STORE_SEARCH = '?seed=7';
const STORE_ORDER_VIEW = { wheel: -700, turn: { x: 424, y: 20 }, pan: { x: 39, y: 38 } };
const STORE_CLOSER = -400;
const STORE_ORDERS = {
  chop: [{ x: 537, y: 200 }, { x: 659, y: 131 }],
  quarry: [{ x: 266, y: 379 }, { x: 291, y: 367 }],
  hut: { x: 509, y: 212 },
  barn: { x: 510, y: 233 },
  house: { x: 452, y: 207 },
};
const STORE_SPOTS = {
  barn: [{ x: 548, y: 160 }, { x: 547, y: 177 }, { x: 533, y: 204 }],
  house: [{ x: 444, y: 130 }, { x: 443, y: 109 }, { x: 432, y: 163 }],
  // Around the camp center at (546, 352), since a click on a settler sleeping at the camp selects the settler.
  camp: [0, 1, 2, 3, 4, 5, 6, 7].flatMap((step) => [12, 20].map((radius) => ({ x: 546 + Math.round(radius * Math.cos((step * Math.PI) / 4)), y: 352 + Math.round(radius * Math.sin((step * Math.PI) / 4)) }))),
};
const STORE_STOPS = {
  night: { day: 3, time: '23:00' },
  beforeDawn: { day: 4, time: '03:25' },
  morning: { day: 4, time: '07:00' },
  evening: { day: 4, time: '18:30' },
};
/**
 * The clip runs across the dawn of day 4 at 2×, so a carrier moves under a tile between two drawn frames. Just after
 * the dawn at 03:36 the household of the house stands at its door, so a click on a tunic in `HOUSE_DOORS` selects one of
 * its members, and the clip follows it to the barn and back. The crop keeps the clock, the Stockpiles panel, the
 * followed settler's panel, the house, the barn, the forest's edge, and the camp.
 */
const STORE_SELECT_AT = { day: 4, time: '03:42' };
const STORE_CLIP_UNTIL = { day: 4, time: '06:30' };
const HOUSE_DOORS = { x: 370, y: 80, width: 170, height: 140 };
/** A tunic in the light of 03:42, before sunrise: it read 138, 80, 9 at the house's door, where daylight's test needs red over 170. */
const DAWN_TUNIC = ([r, g, b]) => r > 110 && g > 0.5 * r && g < 0.72 * r && b < 0.15 * r;
const STORE_CLIP = { crop: { x: 0, y: 0, width: 760, height: 490 }, width: 560, colors: 32 };
const STORE_RISE = 3;
/**
 * The ground page: `?food=8` and four forager's huts, on (136, 127), (135, 123), (135, 131), and (133, 119), whose
 * eight places take every settler, so nobody without a job is left to carry food from the ground. With 30 seconds of
 * work for a unit the camp fills on day 4, so the units the foragers hold are put down at the dusk of day 3. With the
 * orders at the paused opening, 08:00, 4 units lie on (132, 132), (134, 125), (134, 121), and (136, 120) on the
 * morning of day 4, and none after the dawn of day 5, the second after they were put down. From 10:30 on day 4 the
 * foragers carry their own units past the camp, so the stops come before that, at 10:20 on day 4 and on day 5.
 */
const GROUND_SEARCH = '?seed=7&food=8';
const GROUND_HUTS = [{ x: 509, y: 212 }, { x: 451, y: 230 }, { x: 569, y: 219 }, { x: 392, y: 261 }];
const GROUND_STOPS = { lying: { day: 4, time: '10:20' }, gone: { day: 5, time: '10:20' } };
/**
 * The lit top of the sack of a unit of food, `foodShape` in `src/render/shapes.ts`, which read 205, 166, 100 at noon
 * on day 3. A sack in shade does not match, and neither does it under the summer noon sun.
 */
const FOOD_SACK = ([r, g, b]) => Math.abs(r - 205) <= 8 && Math.abs(g - 166) <= 8 && Math.abs(b - 100) <= 8;
/**
 * At 10:20 on day 4 the sun lights 3 of the 4 sacks, at about 372, 228, 475, 208, and 672, 240, and they read 37, 35,
 * and 39 pixels; the fourth lies in a hut's shade. The box holds the three and leaves out the panels, whose text has
 * pixels of that color. It read 115 pixels then and 4 at 10:20 on day 5. `lying` is two sacks' worth.
 */
const GROUND_BOX = { x: 350, y: 190, width: 350, height: 230 };
const GROUND_SACKS = { lying: 70, gone: 10 };

SCENARIOS.storing = async (session) => {
  const seen = [];
  const { said } = siteDriver(session);
  const { reads, text, click } = selectionDriver(session);
  const { food } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const middle = { x: CLIP.width / 2, y: CLIP.height / 2 };
  const takeView = async (page, { wheel, turn, pan }) => {
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.wheel(0, wheel);
    await session.still(page);
    for (const [move, button] of [[turn, 'right'], [pan, 'left']]) {
      const from = { x: middle.x - move.x / 2, y: middle.y - move.y / 2 };
      await session.drag(page, from, { x: from.x + move.x, y: from.y + move.y }, button);
      await session.still(page);
    }
  };
  const away = async (page) => {
    const toolbar = await page.getByRole('toolbar', { name: 'Orders' }).boundingBox();
    await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + 2);
  };
  const markArea = async (page, key, [from, to], done) => {
    await away(page);
    await page.keyboard.press(key);
    await session.drag(page, from, to, 'left');
    return said(page, done);
  };
  const placeAt = async (page, key, spot, done, picked = () => {}) => {
    await away(page);
    if (key) await page.keyboard.press(key);
    await picked();
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    return said(page, done);
  };
  const readOne = async (page, spots, title) => {
    let read = null;
    for (const spot of spots) {
      read = await click(page, spot);
      if (read?.title === title) return read;
    }
    return read;
  };
  const count = (read) => Number(/^(\d+) of \d+$/.exec(read?.rows?.Food ?? '')?.[1] ?? NaN);
  const stores = async (page) => {
    const barn = await readOne(page, STORE_SPOTS.barn, 'Barn');
    const camp = await readOne(page, STORE_SPOTS.camp, 'Camp');
    const house = await readOne(page, STORE_SPOTS.house, 'House');
    await page.keyboard.press('Escape');
    return { at: await at(page), barn: count(barn), camp: count(camp), house: count(house), reads: [barn, camp, house], totals: await food(page) };
  };
  const words = (read) => `barn ${read.barn}, camp ${read.camp}, house ${read.house}; the Stockpiles panel reads ${read.totals.camp} in barns and camp and ${read.totals.homes} in homes`;
  const labelsGone = async (page, names, minutes) => {
    const deadline = Date.now() + minutes * 60_000;
    const gone = {};
    while (names.some((name) => gone[name] === undefined)) {
      if (Date.now() > deadline) fail(`${names.filter((name) => gone[name] === undefined).join(' and ')} still stood ${minutes} minutes after the orders at 8×`);
      for (const name of names) if (gone[name] === undefined && (await page.getByRole('status', { name }).count()) === 0) gone[name] = await session.gameMinutes(page);
      await page.waitForTimeout(100);
    }
    return gone;
  };

  const play = await session.open(CLIP, { record: true, search: STORE_SEARCH, clock: 'paused' });
  const { page } = play;
  await takeView(page, STORE_ORDER_VIEW);
  const orders = [
    await markArea(page, 'KeyC', STORE_ORDERS.chop, /trees? marked for felling/),
    await markArea(page, 'KeyM', STORE_ORDERS.quarry, /rock tiles? marked for quarrying/),
    await placeAt(page, 'KeyG', STORE_ORDERS.hut, /^Forager's hut site placed/),
  ];
  let barnTool = 0;
  let barnHint = '';
  orders.push(
    await placeAt(page, 'KeyB', STORE_ORDERS.barn, /^Barn site placed/, async () => {
      barnTool = await page.getByRole('button', { name: 'Barn', exact: true, pressed: true }).count();
      barnHint = await said(page, /barn site on 3 by 3 tiles/);
    }),
  );
  orders.push(await placeAt(page, 'KeyH', STORE_ORDERS.house, /^House site placed/));
  session.check(
    'B picks the Barn tool, which places a barn site with a click',
    barnTool === 1 && /barn site on 3 by 3 tiles/.test(barnHint) && /^Barn site placed/.test(orders[3]),
    `${barnTool ? 'the Barn tool is pressed' : 'no Barn tool is pressed'}; the status line read "${barnHint}", then "${orders[3]}"`,
  );
  session.check(
    'the Chop and Quarry drags mark trees and rock, and the hut, the barn, and the house sites are placed',
    /marked for felling/.test(orders[0]) && /marked for quarrying/.test(orders[1]) && /^Forager's hut site placed/.test(orders[2]) && /^House site placed/.test(orders[4]),
    orders.map((line) => `"${line}"`).join(', '),
  );
  await page.keyboard.press('Escape');
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);
  const barnLabel = (await page.getByRole('status', { name: 'Barn site' }).innerText()).replace(/\s+/g, ' ');
  session.check(
    "the barn site's label reads 0 of 16 logs, 0 of 6 stone, and waits for materials",
    /Logs\s*0\/16/.test(barnLabel) && /Stone\s*0\/6/.test(barnLabel) && /Waiting for materials/.test(barnLabel),
    `the label reads "${barnLabel}"`,
  );
  await session.screenshot(page, 'storing-sites');
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, STORE_CLOSER);
  await session.still(page);

  await page.keyboard.press('4');
  const gone = await labelsGone(page, ["Forager's hut site", 'Barn site'], 12);
  await session.pause(page);
  await session.still(page);
  session.check(
    'the settlers build the hut and the barn',
    gone["Forager's hut site"] !== undefined && gone['Barn site'] !== undefined,
    `the hut's label went at ${clockText(gone["Forager's hut site"])} and the barn's at ${clockText(gone['Barn site'])}; paused at ${await at(page)}`,
  );
  const built = await readOne(page, STORE_SPOTS.barn, 'Barn');
  session.check(
    `at ${await at(page)} the barn's panel says what it is and reads its food against its 120`,
    built?.title === 'Barn' && /Food in it keeps/.test(built.note ?? '') && /^\d+ of 120$/.test(built.rows.Food ?? ''),
    `the panel reads "${text(built)}"`,
  );
  await session.screenshot(page, 'storing-barn-panel');
  await page.keyboard.press('Escape');

  await session.reach(page, STORE_STOPS.night);
  await session.still(page);
  const night = await stores(page);
  await session.reach(page, STORE_STOPS.beforeDawn);
  await session.still(page);
  const from = play.since();
  const runTo = async (target) => {
    await page.keyboard.press('2');
    while ((await session.gameMinutes(page)) < clockMinutes(target)) await page.waitForTimeout(50);
    await session.pause(page);
    await session.still(page);
  };
  await runTo(STORE_SELECT_AT);
  const doors = ffmpeg(['-i', await session.screenshot(page, 'storing-doors'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const cells = new Map();
  for (let y = HOUSE_DOORS.y; y < HOUSE_DOORS.y + HOUSE_DOORS.height; y++) for (let x = HOUSE_DOORS.x; x < HOUSE_DOORS.x + HOUSE_DOORS.width; x++) {
    const i = (y * CLIP.width + x) * 3;
    if (!DAWN_TUNIC([doors[i], doors[i + 1], doors[i + 2]])) continue;
    const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
    const cell = cells.get(key) ?? { count: 0, x: 0, y: 0 };
    cells.set(key, { count: cell.count + 1, x: cell.x + x, y: cell.y + y });
  }
  let follow = null;
  for (const cell of [...cells.values()].sort((a, b) => b.count - a.count).slice(0, 8)) {
    follow = await click(page, { x: cell.x / cell.count, y: cell.y / cell.count });
    if (follow?.rows?.Home === 'A house') break;
  }
  session.check(
    `at ${await at(page)} a click beside the house selects a member of the household that lives there`,
    follow?.rows?.Home === 'A house',
    `the panel reads "${text(follow)}"`,
  );
  await runTo(STORE_CLIP_UNTIL);
  const to = play.since();
  await session.reach(page, STORE_STOPS.morning);
  await session.still(page);
  const morning = await stores(page);
  session.check(
    `from ${night.at} to ${morning.at} the household with the house takes food from the barn: the house's food rises while the camp's stays`,
    morning.house > night.house && morning.camp === night.camp,
    `at ${night.at} ${words(night)}; at ${morning.at} ${words(morning)}`,
  );
  await session.reach(page, STORE_STOPS.evening);
  await session.still(page);
  const evening = await stores(page);
  await session.screenshot(page, 'storing-evening');
  session.check(
    `from ${morning.at} to ${evening.at} the barn's food rises by at least ${STORE_RISE} in its panel while the camp's does not rise`,
    evening.barn - morning.barn >= STORE_RISE && evening.camp <= morning.camp,
    `at ${morning.at} ${words(morning)}; at ${evening.at} ${words(evening)}`,
  );
  session.check(
    "the Stockpiles panel totals the barn's and the camp's food as one and the house's as another",
    [night, morning, evening].every((read) => read.totals.camp === read.barn + read.camp && read.totals.homes === read.house),
    [night, morning, evening].map((read) => `at ${read.at} ${words(read)}`).join('; '),
  );
  await session.finishClips(play.context, page, [{ label: 'storing-barn-to-house', from, to, ...STORE_CLIP }]);
  seen.push(...play.errors);

  const ground = await session.open(CLIP, { search: GROUND_SEARCH, clock: 'paused' });
  const g = ground.page;
  await takeView(g, STORE_ORDER_VIEW);
  const groundOrders = [await markArea(g, 'KeyC', STORE_ORDERS.chop, /trees? marked for felling/)];
  // A second press of G would put the tool away, so only the first hut picks it.
  for (const [index, spot] of GROUND_HUTS.entries()) groundOrders.push(await placeAt(g, index === 0 ? 'KeyG' : null, spot, /^Forager's hut site placed/));
  session.check(
    'the ground page places four huts, whose eight places take every settler',
    groundOrders.slice(1).every((line) => /^Forager's hut site placed/.test(line)),
    groundOrders.map((line) => `"${line}"`).join(', '),
  );
  await g.keyboard.press('Escape');
  await g.mouse.move(middle.x, middle.y);
  await g.mouse.wheel(0, STORE_CLOSER);
  await session.still(g);
  await g.mouse.move(CLIP.width - 5, CLIP.height - 5);
  const jobsOf = async () =>
    g.getByRole('status', { name: 'Stockpiles' }).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { withJob: Number(rows['Settlers with a job']), withoutJob: Number(rows['Settlers with no job']) };
    });
  await session.reach(g, GROUND_STOPS.lying);
  await session.still(g);
  const lyingJobs = await jobsOf();
  const lying = await session.screenshot(g, 'storing-ground-lying');
  await session.reach(g, GROUND_STOPS.gone);
  await session.still(g);
  const goneShot = await session.screenshot(g, 'storing-ground-gone');
  const sacks = (png) => {
    const pixels = ffmpeg(['-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let found = 0;
    for (let y = GROUND_BOX.y; y < GROUND_BOX.y + GROUND_BOX.height; y++) {
      for (let x = GROUND_BOX.x; x < GROUND_BOX.x + GROUND_BOX.width; x++) {
        const i = (y * CLIP.width + x) * 3;
        if (FOOD_SACK([pixels[i], pixels[i + 1], pixels[i + 2]])) found++;
      }
    }
    return found;
  };
  session.check(
    `at ${clockText(clockMinutes(GROUND_STOPS.lying))} every settler holds a job, so nobody carries food from the ground`,
    lyingJobs.withJob === 8 && lyingJobs.withoutJob === 0,
    `${lyingJobs.withJob} settlers with a job and ${lyingJobs.withoutJob} with none`,
  );
  const before = sacks(lying);
  const after = sacks(goneShot);
  session.check(
    `food that nobody carried lies on the ground at ${clockText(clockMinutes(GROUND_STOPS.lying))} and is gone by ${clockText(clockMinutes(GROUND_STOPS.gone))}`,
    before >= GROUND_SACKS.lying && after <= GROUND_SACKS.gone,
    `${before} pixels of sack tops in the box around the camp at ${clockText(clockMinutes(GROUND_STOPS.lying))}, needs ${GROUND_SACKS.lying}; ${after} at ${clockText(clockMinutes(GROUND_STOPS.gone))}, needs at most ${GROUND_SACKS.gone}`,
  );
  await ground.context.close();
  seen.push(...ground.errors);
  session.check('no page errors', seen.length === 0, seen.join(' | ') || 'none');
};

/**
 * The `hunting` scenario plays a hunter's lodge on seed 7 through the page, with the camp's own 24 food and no
 * forager's hut, so every unit that enters a store on day 2 comes from a kill. A Chop drag over the trees from
 * (141, 100) to (150, 112) and a Quarry drag over the rock from (124, 105) to (125, 108) give the logs and the stone,
 * and the barn goes on (134, 108). Once the barn stands, the lodge goes on (129, 100), at the north meadow's southern
 * edge, so the deer nearest its hunters graze in the meadow and the barn is the store nearest their kills. The orders
 * go in from 42 m from the south. The flight is watched from 23 m looking east over the meadow, the distance of the
 * foraging clip, where north is to the left, and the hunt from 23 m looking west over the lodge. `scripts/aim.ts`
 * found the spots: `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7
 * '{"wheel":-700,"turn":{"x":0,"y":20},"target":[137,110]}' '[[141,100],[150,112],[124,105],[125,108],[134,108]]'`,
 * then `'{"wheel":-1100,"turn":{"x":424,"y":20},"target":[128,99]}'` with the tiles
 * '[[129,100],[129.5,100.5,1.2],[129.5,100.5,0.5],[135,109,1.6],[135,109,0.8]]' for the lodge, its roof and wall, and
 * the barn's roof and wall, and `'{"wheel":-1100,"turn":{"x":-300,"y":50},"target":[131,102]}'` with the tiles
 * '[[135,109,1.6],[135,109,0.8]]'. Each later view is the difference of two of these: the near view's pan of 820, 0
 * from the opening less the order view's of 509, 179 at the same zoom and turn, and the hunt view's of -613, -332 less
 * -728, -303 at the near view's target.
 */
const HUNT_SEARCH = '?seed=7';
const HUNT_ORDER_VIEW = { wheel: -700, turn: { x: 0, y: 20 }, pan: { x: -265, y: 116 } };
const HUNT_CLOSER = { wheel: -400, turn: { x: 424, y: 0 }, pan: { x: 311, y: -179 } };
/**
 * The hunt's view looks west over the lodge to the meadow and the lake, so the trees at the meadow's western edge stand
 * behind the deer and not in front of them, and the barn lies to the left. It is a turn of the near view about its
 * look-at point and a pan to (131, 102).
 */
const HUNT_VIEW = { wheel: 0, turn: { x: -724, y: 30 }, pan: { x: 115, y: -29 } };
const HUNT_ORDERS = {
  chop: [{ x: 605, y: 208 }, { x: 675, y: 368 }],
  quarry: [{ x: 369, y: 161 }, { x: 357, y: 210 }],
  barn: { x: 460, y: 248 },
};
const HUNT_SPOTS = {
  lodge: { x: 520, y: 238 },
  lodgeRoof: [{ x: 535, y: 202 }, { x: 534, y: 217 }],
  barnRoof: [{ x: 741, y: 84 }, { x: 735, y: 102 }],
  huntBarnRoof: [{ x: 205, y: 236 }, { x: 214, y: 251 }],
};
/**
 * Deer 11 of seed 7 walks south toward the quarry on the morning of day 2 and runs north from the settler who
 * quarries there. In `src/sim` terms it starts to flee at 05:55 to 05:57 from (128.6, 100.1), 6.1 tiles from her, for
 * every delay of the orders from 5 to 90 ticks, and stops at about (132, 89) by 06:16. The stops come every 2 game
 * minutes from 05:40 to 06:20.
 */
const FLIGHT_STOPS = Array.from({ length: 21 }, (_, step) => clockAt(clockMinutes({ day: 2, time: '05:40' }) + 2 * step));
/**
 * The coat of `deerShape` in `src/render/shapes.ts`, 0x9b6a3d. In the light of 06:04 on day 2 it read 89, 58, 31 lit
 * and 74, 46, 23 in shade, and its legs 43, 26, 13. A settler's skin, 131, 94, 67, has too little green over blue.
 */
const DEER_COAT = ([r, g, b]) => r >= 55 && r >= 1.3 * g && r <= 1.85 * g && g >= 1.6 * b && g <= 2.5 * b;
/** The least and the most pixels of coat a deer shows at 23 m. A deer read 219 to 533; tree trunks read about 250 but stand still. */
const DEER_PIXELS = { least: 120, most: 900 };
/** A tunic in the light of the morning of day 2: it read 147, 109, 21 and 126, 92, 15 at 05:56, where daylight's test needs red over 170. */
const MORNING_TUNIC = ([r, g, b]) => r > 100 && g > 0.6 * r && g < 0.8 * r && b < 0.18 * r;
/**
 * At the near view a tile of the meadow, from (124, 84) to (136, 101), is at most 33 pixels across, so a move of
 * `HUNT_TILE_PX` pixels is at least one tile. The nearest row is the widest.
 */
const HUNT_TILE_PX = 34;
/** Tiles a deer walks in a game minute as it wanders: 0.8 a second, and a day of 1440 minutes takes 300 seconds at 1×. */
const DEER_WALK_PER_MINUTE = 0.8 * (300 / MINUTES_PER_DAY);
/** The chained steps of a flight the check needs, each faster than a deer walks, and the most a deer may jump between two stops. */
const FLIGHT = { steps: 3, jump: 120, settlerPx: 220 };
const HUNT_FINISHED = { after: { day: 2, time: '06:00' }, before: { day: 2, time: '18:00' } };
const HUNT_UNTIL = { day: 2, time: '19:05' };
const HUNTER_DOING = /^(Stalking a deer|Aiming at a deer|Walking to a kill to pick up food|Carrying food to (a barn|the camp)|Looking for deer|Idle, no deer within 40 tiles of the lodge|Idle, waiting for room in a store)$/;
/** The view the follow keeps the hunter near, inside the clip's crop. */
const HUNT_AIM_AT = { x: 500, y: 270 };
const HUNT_RECENTRE = 150;
const HUNT_AT_BARN = 160;
/** Game minutes the follow runs before it pauses to look where the hunter went. A hunter walks about 1.5 tiles a second. */
const HUNT_LOOK_EVERY = 12;
/** While the hunter stalks or aims, the follow frames it with the deer nearest it within this many pixels, a deer showing at least `least` pixels of coat. */
const HUNT_FRAME_DEER = 360;
const HUNT_DEER_PIXELS = { least: 60 };
const HUNT_CLIP = { crop: { x: 0, y: 0, width: 800, height: 490 }, width: 480, colors: 32, decimate: true, speed: 1.5 };
const FLIGHT_CLIP = { crop: { x: 216, y: 0, width: 584, height: 400 }, width: 560, colors: 32, decimate: true };
/** The flight clip runs from the deer's walk toward the quarry to the end of its run, right of the Stockpiles panel. */
const FLIGHT_CUT = { from: { day: 2, time: '05:48' }, to: { day: 2, time: '06:18' } };

SCENARIOS.hunting = async (session) => {
  const middle = { x: CLIP.width / 2, y: CLIP.height / 2 };
  const { said } = siteDriver(session);
  const { reads, text, uiBoxes, skipOf, markOf, click } = selectionDriver(session);
  const { food, lines } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const play = await session.open(CLIP, { record: true, search: HUNT_SEARCH, clock: 'paused' });
  const { page } = play;
  // Drags in pieces of at most 250 pixels about the middle, so no piece starts on the toolbar or a panel.
  const move = async ({ wheel, turn, pan }) => {
    await page.mouse.move(middle.x, middle.y);
    if (wheel) {
      await page.mouse.wheel(0, wheel);
      await session.still(page);
    }
    for (const [step, button] of [[turn, 'right'], [pan, 'left']]) {
      const pieces = Math.ceil(Math.hypot(step.x, step.y) / 250);
      for (let piece = 0; piece < pieces; piece++) {
        const part = { x: step.x / pieces, y: step.y / pieces };
        const from = { x: middle.x - part.x / 2, y: middle.y - part.y / 2 };
        await session.drag(page, from, { x: from.x + part.x, y: from.y + part.y }, button);
      }
      await session.still(page);
    }
  };
  const away = async () => {
    const toolbar = await page.getByRole('toolbar', { name: 'Orders' }).boundingBox();
    await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + 2);
  };
  const readOne = async (spots, title) => {
    let read = null;
    for (const spot of spots) {
      read = await click(page, spot);
      if (read?.title === title) return read;
    }
    return read;
  };
  const count = (read) => Number(/^(\d+) of \d+$/.exec(read?.rows?.Food ?? '')?.[1] ?? NaN);
  const jobs = async () =>
    page.getByRole('status', { name: 'Stockpiles' }).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { withJob: Number(rows['Settlers with a job']), withoutJob: Number(rows['Settlers with no job']) };
    });
  const labelGone = async (name, minutes) => {
    const deadline = Date.now() + minutes * 60_000;
    while ((await page.getByRole('status', { name }).count()) > 0) {
      if (Date.now() > deadline) fail(`the ${name} still stood ${minutes} minutes after its order at 8×`);
      await page.waitForTimeout(100);
    }
    return session.gameMinutes(page);
  };

  await move(HUNT_ORDER_VIEW);
  const orders = [];
  for (const [key, spots, done] of [['KeyC', HUNT_ORDERS.chop, /trees? marked for felling/], ['KeyM', HUNT_ORDERS.quarry, /rock tiles? marked for quarrying/]]) {
    await away();
    await page.keyboard.press(key);
    await session.drag(page, ...spots, 'left');
    orders.push(await said(page, done));
  }
  await away();
  await page.keyboard.press('KeyB');
  await page.mouse.move(HUNT_ORDERS.barn.x, HUNT_ORDERS.barn.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  orders.push(await said(page, /^Barn site placed/));
  await page.keyboard.press('Escape');
  session.check(
    'the Chop and Quarry drags mark trees and rock, and the barn site is placed',
    /marked for felling/.test(orders[0]) && /marked for quarrying/.test(orders[1]) && /^Barn site placed/.test(orders[2]),
    orders.map((line) => `"${line}"`).join(', '),
  );
  await move(HUNT_CLOSER);
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);

  const frames = [];
  const cut = {};
  for (const stop of FLIGHT_STOPS) {
    await session.reach(page, stop);
    await session.still(page);
    for (const [end, time] of Object.entries(FLIGHT_CUT)) if (clockMinutes(time) === clockMinutes(stop)) cut[end] = play.since();
    const png = await session.screenshot(page, `hunting-flight-${stop.time.replace(':', '')}`);
    const skip = skipOf(await uiBoxes(page));
    frames.push({
      minutes: await session.gameMinutes(page),
      deer: spotsOf(png, CLIP, DEER_COAT, skip).filter((spot) => spot.count >= DEER_PIXELS.least && spot.count <= DEER_PIXELS.most),
      settlers: spotsOf(png, CLIP, MORNING_TUNIC, skip),
    });
  }
  // A flight is a chain of deer spots across stops, each step faster than a deer walks and in about the same direction.
  const fast = (from, to, minutes) => Math.hypot(to.x - from.x, to.y - from.y) / HUNT_TILE_PX > DEER_WALK_PER_MINUTE * (minutes + 1);
  const nearest = (spots, point) => spots.reduce((best, spot) => (!best || Math.hypot(spot.x - point.x, spot.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? spot : best), null);
  let flight = null;
  for (let start = 0; start + FLIGHT.steps < frames.length && !flight; start++) {
    for (const first of frames[start].deer) {
      const chain = [first];
      for (let index = start + 1; index < frames.length; index++) {
        const last = chain[chain.length - 1];
        const next = nearest(frames[index].deer, last);
        if (!next || Math.hypot(next.x - last.x, next.y - last.y) > FLIGHT.jump || !fast(last, next, frames[index].minutes - frames[index - 1].minutes)) break;
        if (chain.length > 1) {
          const before = chain[chain.length - 2];
          if ((last.x - before.x) * (next.x - last.x) + (last.y - before.y) * (next.y - last.y) <= 0) break;
        }
        chain.push(next);
      }
      if (chain.length > FLIGHT.steps) {
        flight = { start, chain };
        break;
      }
    }
  }
  if (flight) {
    const { start, chain } = flight;
    const end = start + chain.length - 1;
    const from = chain[0];
    const to = chain[chain.length - 1];
    const settler = nearest(frames[start].settlers, from);
    const settlerLater = settler && nearest(frames[end].settlers, settler);
    const minutes = frames[end].minutes - frames[start].minutes;
    const tiles = Math.hypot(to.x - from.x, to.y - from.y) / HUNT_TILE_PX;
    const before = settler ? Math.hypot(settler.x - from.x, settler.y - from.y) : Infinity;
    const after = settlerLater ? Math.hypot(settlerLater.x - to.x, settlerLater.y - to.y) : 0;
    session.check(
      'a deer runs from a settler near it faster than a deer walks',
      settler !== null && before <= FLIGHT.settlerPx && after > before && tiles > DEER_WALK_PER_MINUTE * (minutes + 1),
      `from ${clockText(frames[start].minutes)} to ${clockText(frames[end].minutes)} a deer ran from ${Math.round(from.x)},${Math.round(from.y)} to ${Math.round(to.x)},${Math.round(to.y)} in ${chain.length - 1} steps, at least ${tiles.toFixed(1)} tiles in ${minutes} game minutes, where a walking deer covers at most ${(DEER_WALK_PER_MINUTE * (minutes + 1)).toFixed(1)}; the nearest settler stood ${Math.round(before)} pixels from it at the start, needs at most ${FLIGHT.settlerPx}, and ${Math.round(after)} at the end`,
    );
  } else {
    session.check('a deer runs from a settler near it faster than a deer walks', false, `no chain of ${FLIGHT.steps} fast steps in ${frames.length} stops; deer spots per stop ${frames.map((frame) => frame.deer.length).join(', ')}`);
  }
  // The deer that ran stands where its run ended at the last stop, clear of every settler, and a click on its coat leaves no panel.
  const last = frames[frames.length - 1];
  const ran = flight && nearest(last.deer, flight.chain[flight.chain.length - 1]);
  const lone = ran && Math.hypot(ran.x - flight.chain[flight.chain.length - 1].x, ran.y - flight.chain[flight.chain.length - 1].y) <= 60 && last.settlers.every((settler) => Math.hypot(settler.x - ran.x, settler.y - ran.y) > 60) ? ran : null;
  const onDeer = lone ? await click(page, lone) : undefined;
  session.check(
    'a click on a deer selects nothing',
    lone !== null && onDeer === null,
    lone ? `a click at ${Math.round(lone.x)},${Math.round(lone.y)}, the middle of the coat of the deer that ran, ${onDeer ? `opened "${text(onDeer)}"` : 'left no panel'}` : 'the deer that ran was not found clear of the settlers at the last stop',
  );

  await page.keyboard.press('4');
  const barnAt = await labelGone('Barn site', 6);
  await session.pause(page);
  await session.still(page);
  await away();
  await page.keyboard.press('KeyL');
  const lodgeTool = await page.getByRole('button', { name: "Hunter's lodge", exact: true, pressed: true }).count();
  const lodgeHint = await said(page, /hunter's lodge on 2 by 2 tiles/);
  await page.mouse.move(HUNT_SPOTS.lodge.x, HUNT_SPOTS.lodge.y, { steps: 3 });
  const fits = await said(page, /Click to place the hunter's lodge site here/);
  await page.mouse.down();
  await page.mouse.up();
  const placed = await said(page, /^Hunter's lodge site placed/);
  session.check(
    `once the barn stands, at ${await at(page)}, L picks the Hunter's lodge tool, which places a lodge site with a click`,
    lodgeTool === 1 && /hunter's lodge on 2 by 2 tiles/.test(lodgeHint) && /Click to place the hunter's lodge site here/.test(fits) && /^Hunter's lodge site placed/.test(placed),
    `the barn's label went at ${clockText(barnAt)}; ${lodgeTool ? 'the tool is pressed' : 'no tool is pressed'}; the status line read "${lodgeHint}", then "${fits}", then "${placed}"`,
  );
  await page.keyboard.press('Escape');
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);
  const site = page.getByRole('status', { name: "Hunter's lodge site" });
  const siteLabel = (await site.count()) === 1 ? (await site.innerText()).replace(/\s+/g, ' ') : null;
  session.check(
    "the lodge site's label reads 0 of 8 logs, 0 of 4 stone, and waits for materials",
    siteLabel !== null && /Logs\s*0\/8/.test(siteLabel) && /Stone\s*0\/4/.test(siteLabel) && /Waiting for materials/.test(siteLabel),
    `the label reads "${siteLabel ?? 'nothing'}"`,
  );

  await page.keyboard.press('4');
  const lodgeAt = await labelGone("Hunter's lodge site", 6);
  await session.pause(page);
  await session.still(page);
  session.check(
    `the lodge is finished on day 2 between ${HUNT_FINISHED.after.time} and ${HUNT_FINISHED.before.time}`,
    lodgeAt >= clockMinutes(HUNT_FINISHED.after) && lodgeAt <= clockMinutes(HUNT_FINISHED.before),
    `the label was gone at ${clockText(lodgeAt)}; paused at ${await at(page)}`,
  );
  const lodge = await readOne(HUNT_SPOTS.lodgeRoof, "Hunter's lodge");
  const hunters = (lodge?.rows?.Hunters ?? '').split(' and ').filter(Boolean);
  session.check(
    `at ${await at(page)} the lodge's panel says what it does and names its two hunters, with both places filled`,
    lodge?.title === "Hunter's lodge" && /hunt deer within 40 tiles/.test(lodge.note ?? '') && hunters.length === 2 && lodge.rows.Places === '2 of 2',
    `the panel reads "${text(lodge)}"`,
  );
  await session.screenshot(page, 'hunting-lodge-panel');
  const hired = { jobs: await jobs(), news: await lines(page) };
  session.check(
    'the Stockpiles panel counts 2 settlers with a job, and the news names the two who became hunters',
    hired.jobs.withJob === 2 && hired.jobs.withoutJob === 6 && hired.news.some((line) => /became hunters\.$/.test(line) && hunters.every((name) => line.includes(name))),
    `${hired.jobs.withJob} with a job and ${hired.jobs.withoutJob} with none; the news reads ${hired.news.map((line) => `"${line}"`).join(', ') || 'nothing'}`,
  );
  const barnBefore = await readOne(HUNT_SPOTS.barnRoof, 'Barn');
  const totalBefore = await food(page);
  await page.keyboard.press('Escape');
  await move(HUNT_VIEW);
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);

  // The hunters stand at the lodge's corners when it is finished. A click on the fullest cells of tunic pixels finds one.
  const findHunter = async () => {
    const png = await session.screenshot(page, 'hunting-hunter-aim');
    const skip = skipOf(await uiBoxes(page));
    for (const spot of spotsOf(png, CLIP, UNIT_COLORS.villagers, skip).slice(0, 12)) {
      const read = await click(page, { x: spot.x + SELECT_OFFSET / 2, y: spot.y });
      if (read?.rows?.Job === 'Hunter') return read;
    }
    return null;
  };
  let hunter = await findHunter();
  for (let tries = 0; !hunter && tries < 4; tries++) {
    await page.keyboard.press('Escape');
    await session.reach(page, clockAt((await session.gameMinutes(page)) + 3));
    await session.still(page);
    hunter = await findHunter();
  }
  session.check(
    `at ${await at(page)} a hunter's panel reads its job and what a hunter does`,
    hunter?.rows?.Job === 'Hunter' && hunters.includes(hunter.title) && HUNTER_DOING.test(hunter.rows.Doing ?? ''),
    `the panel reads "${text(hunter)}"`,
  );
  const name = hunter?.title;

  // A main-button drag moves the ground by the drag, wherever it starts, so the drags start at the middle in pieces.
  const panned = { x: 0, y: 0 };
  const panBy = async (by) => {
    const pieces = Math.ceil(Math.hypot(by.x, by.y) / 250);
    for (let piece = 0; piece < pieces; piece++) {
      const part = { x: Math.round(by.x / pieces), y: Math.round(by.y / pieces) };
      await session.drag(page, middle, { x: middle.x + part.x, y: middle.y + part.y });
      panned.x += part.x;
      panned.y += part.y;
    }
    await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
    await session.still(page);
  };
  // Keeps the hunter, and while it stalks or aims the deer nearest it, near `HUNT_AIM_AT`.
  const follow = async (label, doing) => {
    const png = await session.screenshot(page, label);
    const boxes = await uiBoxes(page);
    const ring = markOf(page, png, boxes);
    if (!ring.center) return null;
    const seen = { x: ring.center.x - panned.x, y: ring.center.y - panned.y };
    let focus = ring.center;
    if (/deer/.test(doing ?? '')) {
      const deer = spotsOf(png, CLIP, DEER_COAT, skipOf(boxes)).filter((spot) => spot.count >= HUNT_DEER_PIXELS.least && spot.count <= DEER_PIXELS.most);
      const prey = deer.reduce((best, spot) => {
        const away = Math.hypot(spot.x - ring.center.x, spot.y - ring.center.y);
        return away <= HUNT_FRAME_DEER && (!best || away < best.away) ? { ...spot, away } : best;
      }, null);
      if (prey) focus = { x: (ring.center.x + prey.x) / 2, y: (ring.center.y + prey.y) / 2 };
    }
    if (Math.hypot(focus.x - HUNT_AIM_AT.x, focus.y - HUNT_AIM_AT.y) >= HUNT_RECENTRE) await panBy({ x: HUNT_AIM_AT.x - focus.x, y: HUNT_AIM_AT.y - focus.y });
    return seen;
  };
  // Runs at 2× while the hunter stalks and aims and at 4× while it walks with the food, until its panel reads something
  // else or for at most `minutes`, and pauses there.
  const runWhileDoing = async (doing, minutes) => {
    const until = (await session.gameMinutes(page)) + minutes;
    await page.keyboard.press(/^(Walking to a kill|Carrying food)/.test(doing) ? '3' : '2');
    for (;;) {
      const read = await reads(page);
      if (read?.title !== name || read.rows.Doing !== doing || (await session.gameMinutes(page)) >= until) break;
      await page.waitForTimeout(60);
    }
    await session.pause(page);
    await session.still(page);
    return reads(page);
  };
  const hunt = [];
  let huntFrom = null;
  let read = hunter;
  let delivered = null;
  for (let stop = 0; read?.title === name && (await session.gameMinutes(page)) < clockMinutes(HUNT_UNTIL); stop++) {
    const step = { at: await at(page), doing: read.rows.Doing, carries: read.rows.Carries, camp: (await food(page)).camp };
    hunt.push(step);
    if (huntFrom === null && read.rows.Doing === 'Stalking a deer') huntFrom = play.since();
    step.seen = await follow(`hunting-follow-${String(stop).padStart(2, '0')}`, read.rows.Doing);
    if (delivered) {
      delivered.seen = step.seen;
      break;
    }
    const next = await runWhileDoing(read.rows.Doing, HUNT_LOOK_EVERY);
    if (/^Carrying food to/.test(read.rows.Doing) && next?.rows?.Doing !== read.rows.Doing) {
      delivered = { at: await at(page), from: read.rows.Doing, carries: next?.rows?.Carries, campBefore: step.camp, campAfter: (await food(page)).camp };
    }
    read = next;
  }
  const huntTo = play.since();
  const seenDoing = hunt.map((step) => step.doing);
  const order = ['Stalking a deer', 'Aiming at a deer', 'Walking to a kill to pick up food', 'Carrying food to a barn'];
  const firsts = order.map((doing) => seenDoing.indexOf(doing));
  const steps = hunt.map((step) => `${step.at} "${step.doing}"`).join(', ');
  // Tree crowns can hide the ring for a stop, so each part of the hunt needs the ring in view at one stop at least.
  const lost = hunt.filter((step) => !step.seen).map((step) => step.at);
  const unseen = order.filter((doing) => !hunt.some((step) => step.doing === doing && step.seen));
  session.check(
    `the clip finds ${name ?? 'the hunter'}'s selection ring at a paused stop of each part of the hunt: stalking, aiming, walking to the kill and carrying`,
    hunt.length > 0 && unseen.length === 0,
    `${unseen.length ? `no ring while ${unseen.join(', ')}; ` : ''}the ring shows at ${hunt.length - lost.length} of ${hunt.length} stops${lost.length ? `, hidden at ${lost.join(', ')}` : ''}`,
  );
  session.check(
    `${name ?? 'the hunter'}'s panel reads the hunt at paused stops: stalking, aiming, walking to the kill, and carrying its food to a barn, in that order`,
    firsts.every((index) => index >= 0) && firsts.every((index, place) => place === 0 || index > firsts[place - 1]) && hunt.every((step) => HUNTER_DOING.test(step.doing ?? '')),
    steps,
  );
  session.check(
    'the hunter carries the food 1 unit at a time',
    hunt.some((step) => /^Carrying food/.test(step.doing ?? '')) && hunt.filter((step) => /^Carrying food/.test(step.doing ?? '')).every((step) => step.carries === '1 food'),
    hunt.filter((step) => /^Carrying food/.test(step.doing ?? '')).map((step) => `${step.at} carries ${step.carries}`).join(', ') || 'no stop read a carrier',
  );
  await page.keyboard.press('Escape');
  await panBy({ x: -panned.x, y: -panned.y });
  const barnAfter = await readOne(HUNT_SPOTS.huntBarnRoof, 'Barn');
  const totalAfter = await food(page);
  await session.screenshot(page, 'hunting-barn-after');
  const barnSpot = HUNT_SPOTS.huntBarnRoof[0];
  const fromBarn = delivered?.seen ? Math.round(Math.hypot(delivered.seen.x - barnSpot.x, delivered.seen.y - barnSpot.y)) : null;
  session.check(
    `when ${name ?? 'the hunter'} stops carrying, its hands are empty, it stands within ${HUNT_AT_BARN} px of the barn's roof, and Barn and camp food has gone up`,
    delivered?.from === 'Carrying food to a barn' && delivered.carries === 'Nothing' && fromBarn !== null && fromBarn <= HUNT_AT_BARN && delivered.campAfter > delivered.campBefore,
    delivered
      ? `at ${delivered.at} it carries "${delivered.carries}", its ring is ${fromBarn ?? 'not found'} px from the roof, and the total went from ${delivered.campBefore} to ${delivered.campAfter} since the last carrying stop`
      : 'it never stopped carrying',
  );
  session.check(
    `the food of the kill rises in the barn's panel and in the Barn and camp food total, from ${clockText(lodgeAt)} to ${delivered?.at ?? 'the end'}`,
    delivered?.from === 'Carrying food to a barn' && count(barnAfter) > count(barnBefore) && totalAfter.camp > totalBefore.camp,
    `the barn's panel read "${barnBefore?.rows?.Food}" and then "${barnAfter?.rows?.Food}"; Barn and camp food read ${totalBefore.camp} and then ${totalAfter.camp}`,
  );

  await session.finishClips(play.context, page, [
    { label: 'hunting-deer-runs', ...cut, ...FLIGHT_CLIP },
    { label: 'hunting-hunt', from: huntFrom ?? cut.to, to: huntTo, ...HUNT_CLIP },
  ]);
  session.check('no page errors', play.errors.length === 0, play.errors.join(' | ') || 'none');
};

/**
 * The `firewood` scenario plays a woodshed on seed 7 through the page, with the camp's own 24 food and no other
 * building, so every log of the five chopped trees goes to the shed: 6 build it and its woodcutter splits the other 4
 * into 8 firewood. The woodshed goes on (136, 127), at the forest's edge east of the camp where the foraging scenario
 * puts its hut, the stockpile on (131, 131) to (132, 132), 5 tiles south-west of the shed and in front of the camp, and
 * the Chop clicks on the four trees of the foraging scenario and on (139, 130). The view is the foraging clip's, 23 m
 * looking east from the camp, so the woodcutter's walk from the stockpile to the shed's door on (135, 128) crosses open
 * ground in front of the shed. `scripts/aim.ts` found the spots: `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7
 * '{"wheel":-1100,"turn":{"x":424,"y":20},"target":[132.5,126.5]}'
 * '[[136,127],[137,129],[138,130],[134,131],[135,134],[139,130],[131,131],[132,132],[135,128],[136.5,127.5,1.0],[136.5,127.5,0.5],[131.5,131.5,0.01]]'`,
 * with the roof spots 1.0 m and 0.5 m over the shed's middle and the stockpile's middle just over the ground. In
 * `src/sim` runs with the orders 5 to 90 ticks after the start, the shed stood at 11:48 to 12:34, its woodcutter walked
 * 14 to 27 game minutes to the stockpile, carried the log for 14 to 15 and split it for 48, and it stopped with 8
 * firewood and no log left at 17:23 to 18:07, before the dusk at 19:12.
 */
const FIREWOOD_SEARCH = '?seed=7';
const FIREWOOD_SPOTS = {
  shed: { x: 505, y: 189 },
  roof: [{ x: 519, y: 159 }, { x: 518, y: 169 }],
  trees: [{ x: 555, y: 170 }, { x: 578, y: 152 }, { x: 615, y: 221 }, { x: 688, y: 211 }, { x: 575, y: 135 }],
  stockpile: [{ x: 626, y: 290 }, { x: 651, y: 267 }],
  stockpileMiddle: { x: 638, y: 278 },
  door: { x: 532, y: 205 },
  camp: [{ x: 513, y: 384 }, { x: 505, y: 386 }, { x: 521, y: 386 }, { x: 513, y: 392 }],
};
/** A felled tree gives 2 logs, the shed takes 6, and a split log gives 2 firewood. */
const FIREWOOD_LOGS = { perTree: 2, shed: 6, firewoodPerLog: 2 };
const FIREWOOD_FINISHED = { after: { day: 1, time: '11:00' }, before: { day: 1, time: '13:30' } };
/** The follow starts with a walk to the stockpile by then. */
const FIREWOOD_FOLLOW_BY = { day: 1, time: '16:00' };
/** At the dusk of day 1, 19:12, the woodcutter walks to the camp, and its panel and the shed's say so instead. */
const FIREWOOD_UNTIL = { day: 1, time: '19:05' };
/**
 * The most pixels the woodcutter's ring stands from the stockpile's middle when it starts to carry the log, its 4 tiles
 * about 25 pixels from the middle and the walk of the few game minutes the pause takes about 30 more, and from the
 * shed's door, a tile about 25 to 30 pixels across, while it splits.
 */
const FIREWOOD_AT = { stockpile: 70, door: 45 };
/**
 * Game minutes between the stops that read the stores. A settler without a job carries each unit from the shed to the
 * camp, and while it walks, the unit is in neither store, so a stop can find the shed and the camp short by the units
 * in hands. Nothing else takes firewood out of either store before the first cold night, and the camp's 12 hold all 8,
 * so once the last carrier is in, the two hold 2 for each log split, and keep it. The stops run until they read that:
 * after the split, 2 more, or a further 2 for each later log split, and after the woodcutter stops, all 8. In `src/sim`
 * runs with the orders at 08:13 to 08:18, both units of the first split were in a store again 26 to 79 game minutes
 * after it. A game minute is about 0.21 s at 1×, and a carry from the shed to the camp takes about 16 game minutes.
 */
const FIREWOOD_STORED = { step: 5 };
/**
 * The search for the woodcutter: at most `clicks` clicks on one paused frame, none within `besidePx` of a click that
 * opened another settler, and `tries` more frames 3 game minutes apart. The shed's builders stand at its corners when
 * it is finished, and a woodcutter that starts from a far corner walks behind the shed, out of sight from this view.
 * On rj-firebat one stayed hidden from 12:06 to 12:21 and came out past the shed at 12:24.
 */
const FIREWOOD_SEEK = { tries: 10, clicks: 16, besidePx: 20 };
const FIREWOOD_CLIP = { crop: { x: 0, y: 0, width: 760, height: 490 }, width: 560, colors: 32, decimate: true };
const FETCHING_LOG = 'Walking to a stockpile for a log';
const CARRYING_LOG = 'Carrying a log to the woodshed';
const SPLITTING_LOG = 'Splitting a log';
const NO_LOG = 'Idle, no log in a stockpile within 30 tiles of the woodshed';
const WOODCUTTER_DOING = new RegExp(
  `^(${[FETCHING_LOG, CARRYING_LOG, 'Walking to the woodshed to split a log', SPLITTING_LOG, 'Looking for a log', NO_LOG, 'Idle, the woodshed is full', 'Idle, the building sites need the logs'].join('|')})$`,
);
const TOOLBAR_TOOLS = ['Chop', 'Quarry', 'Stockpile', 'House', "Forager's hut", 'Barn', "Hunter's lodge", 'Woodshed', "Tailor's hut", 'Cancel'];

SCENARIOS.firewood = async (session) => {
  const { said } = siteDriver(session);
  const { reads, text, uiBoxes, skipOf, tunicPixels, markOf, click, apart } = selectionDriver(session);
  const { lines } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const describe = (box) => (box ? `${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'missing');
  const stockpiles = async (page) =>
    page.getByRole('status', { name: 'Stockpiles' }).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { logs: Number(rows.Logs), firewood: Number(rows['Firewood in stores']), withJob: Number(rows['Settlers with a job']), withoutJob: Number(rows['Settlers with no job']) };
    });
  const firewoodOf = (read) => Number(/^(\d+) of 40$/.exec(read?.rows?.Firewood ?? '')?.[1] ?? NaN);
  const campFirewoodOf = (read) => Number(/^(\d+) of 12$/.exec(read?.rows?.Firewood ?? '')?.[1] ?? NaN);

  const play = await session.open(CLIP, { record: true, search: FIREWOOD_SEARCH, clock: 'paused' });
  const { page } = play;
  const away = async () => {
    const toolbar = await page.getByRole('toolbar', { name: 'Orders' }).boundingBox();
    await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + 2);
  };
  const clickShed = async () => {
    let read = null;
    for (const spot of FIREWOOD_SPOTS.roof) {
      read = await click(page, spot);
      if (read?.title === 'Woodshed') break;
    }
    return read;
  };
  // Settlers without a job carry firewood from the shed to the camp while the households sleep there, so the shed's
  // firewood is read with the camp's. The shed is selected again after, because the runs that follow read its panel.
  const readCamp = async () => {
    let read = null;
    for (const spot of FIREWOOD_SPOTS.camp) {
      read = await click(page, spot);
      if (read?.title === 'Camp') break;
    }
    await clickShed();
    return read;
  };
  // Settlers who stand together make one patch of tunic, so the clicks aim at the fullest cells of 12 pixels instead,
  // and pass over the cells beside a click that opened another settler, whose tunic fills several of them.
  const opened = [];
  const clickWoodcutter = async (shot) => {
    const png = await session.screenshot(page, shot);
    const boxes = skipOf(await uiBoxes(page));
    const cells = new Map();
    for (const { x, y } of await tunicPixels(page, png)) {
      if (boxes.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) continue;
      const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const cell = cells.get(key) ?? { count: 0, x: 0, y: 0 };
      cells.set(key, { count: cell.count + 1, x: cell.x + x, y: cell.y + y });
    }
    const others = [];
    let clicks = 0;
    for (const cell of [...cells.values()].sort((a, b) => b.count - a.count)) {
      const aim = { x: cell.x / cell.count, y: cell.y / cell.count };
      if (others.some((spot) => Math.hypot(spot.x - aim.x, spot.y - aim.y) < FIREWOOD_SEEK.besidePx)) continue;
      if (clicks++ >= FIREWOOD_SEEK.clicks) break;
      const read = await click(page, aim);
      if (read?.rows?.Job === 'Woodcutter') return read;
      if (read?.rows?.Job) others.push(aim);
      opened.push(read?.title || 'nothing');
    }
    opened.push(`at ${await at(page)}`);
    return null;
  };

  await takeForageView(session, page);
  const opening = await stockpiles(page);
  session.check(
    'a new game opens with no shed and camp firewood and all 8 settlers without a job',
    opening.firewood === 0 && opening.withJob === 0 && opening.withoutJob === 8,
    `at ${await at(page)} the Stockpiles panel reads ${opening.firewood} shed and camp firewood, ${opening.withJob} settlers with a job and ${opening.withoutJob} with none`,
  );
  await page.keyboard.press('KeyC');
  const chopped = [];
  for (const spot of FIREWOOD_SPOTS.trees) {
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.up();
    chopped.push(await said(page, /^1 tree marked for felling/));
    await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
    await said(page, /Drag over trees/);
  }
  session.check(
    `a Chop click on each of the ${FIREWOOD_SPOTS.trees.length} trees marks one tree`,
    chopped.every((line) => /^1 tree marked for felling/.test(line)),
    chopped.map((line) => `"${line}"`).join(', '),
  );
  await away();
  await page.keyboard.press('KeyP');
  await session.drag(page, ...FIREWOOD_SPOTS.stockpile);
  const piled = await said(page, /tiles? joins? the stockpile zone/);
  session.check('a Stockpile drag adds the 4 tiles in front of the camp', /^4 tiles join the stockpile zone/.test(piled), `the status line reads "${piled}"`);
  await away();
  await page.keyboard.press('KeyK');
  const shedTool = page.getByRole('button', { name: 'Woodshed', exact: true, pressed: true });
  const toolPressed = await shedTool.count();
  const face = toolPressed === 1 ? await shedTool.locator('.order-tool-label').textContent() : null;
  const hint = await said(page, /woodshed on 2 by 2 tiles/);
  await page.mouse.move(FIREWOOD_SPOTS.shed.x, FIREWOOD_SPOTS.shed.y, { steps: 3 });
  const fits = await said(page, /Click to place the woodshed site here/);
  await page.mouse.down();
  await page.mouse.up();
  const placed = await said(page, /^Woodshed site placed/);
  session.check(
    'K picks the Woodshed tool, whose button reads Shed, which places a woodshed site with a click',
    toolPressed === 1 && face === 'Shed' && /woodshed on 2 by 2 tiles/.test(hint) && /Click to place the woodshed site here/.test(fits) && /^Woodshed site placed/.test(placed),
    `${toolPressed ? `the tool is pressed and its button reads "${face}"` : 'no tool is pressed'}; the status line read "${hint}", then "${fits}", then "${placed}"`,
  );
  await page.keyboard.press('Escape');
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);
  const label = page.getByRole('status', { name: 'Woodshed site' });
  const siteLabel = (await label.count()) === 1 ? (await label.innerText()).replace(/\s+/g, ' ') : null;
  session.check(
    "the woodshed site's label reads 0 of 6 logs, no stone, and waits for materials",
    siteLabel !== null && /Logs\s*0\/6/.test(siteLabel) && !/Stone/.test(siteLabel) && /Waiting for materials/.test(siteLabel),
    `the label reads "${siteLabel ?? 'nothing'}"`,
  );
  await session.screenshot(page, 'firewood-site');

  await page.keyboard.press('4');
  const deadline = Date.now() + 240_000;
  while ((await label.count()) > 0) {
    if (Date.now() > deadline) fail('the woodshed site still stood four minutes after the orders at 8×');
    await page.waitForTimeout(100);
  }
  const finished = await session.gameMinutes(page);
  await session.pause(page);
  await session.still(page);
  session.check(
    `the woodshed is finished on day 1 between ${FIREWOOD_FINISHED.after.time} and ${FIREWOOD_FINISHED.before.time}`,
    finished >= clockMinutes(FIREWOOD_FINISHED.after) && finished <= clockMinutes(FIREWOOD_FINISHED.before),
    `the label was gone at ${clockText(finished)}; paused at ${await at(page)}`,
  );
  const shed = await clickShed();
  const name = shed?.rows?.Woodcutter;
  session.check(
    `at ${await at(page)} the woodshed's panel says what it does, names its woodcutter with its one place filled, and reads its firewood and what the woodcutter does`,
    shed?.title === 'Woodshed' &&
      /carries logs from the stockpiles within 30 tiles and splits each into 2 firewood/.test(shed.note ?? '') &&
      Boolean(name) && name !== 'Nobody' && !name.includes(' and ') &&
      shed.rows.Places === '1 of 1' && /^\d+ of 40$/.test(shed.rows.Firewood ?? '') && WOODCUTTER_DOING.test(shed.rows.Doing ?? ''),
    `the panel reads "${text(shed)}"`,
  );
  await session.screenshot(page, 'firewood-shed-panel');
  const hired = { totals: await stockpiles(page), news: await lines(page) };
  session.check(
    'the Stockpiles panel counts 1 settler with a job and 7 with none, and the news names the woodcutter',
    hired.totals.withJob === 1 && hired.totals.withoutJob === 7 && Boolean(name) && hired.news.some((line) => line.endsWith(`${name} became a woodcutter.`)),
    `${hired.totals.withJob} with a job and ${hired.totals.withoutJob} with none; the news reads ${hired.news.map((line) => `"${line}"`).join(', ') || 'nothing'}`,
  );
  await page.keyboard.press('Escape');
  await session.still(page);

  let woodcutter = await clickWoodcutter('firewood-woodcutter-aim');
  for (let tries = 0; !woodcutter && tries < FIREWOOD_SEEK.tries; tries++) {
    await page.keyboard.press('Escape');
    await session.reach(page, clockAt((await session.gameMinutes(page)) + 3));
    await session.still(page);
    woodcutter = await clickWoodcutter('firewood-woodcutter-aim');
  }
  session.check(
    `at ${await at(page)} the woodcutter's panel reads its job and what a woodcutter does`,
    woodcutter?.rows?.Job === 'Woodcutter' && woodcutter.title === name && WOODCUTTER_DOING.test(woodcutter.rows.Doing ?? ''),
    `the panel reads "${text(woodcutter)}"${opened.length ? `; the clicks before it opened ${opened.join(', ')}` : ''}`,
  );
  await session.screenshot(page, 'firewood-woodcutter-panel');

  // Runs at 1× while the woodcutter walks and at 2× while it splits, until its panel reads something else or for at
  // most `minutes`, and pauses there.
  const runWhileDoing = async (doing, minutes) => {
    const until = (await session.gameMinutes(page)) + minutes;
    await page.keyboard.press(doing === SPLITTING_LOG ? '2' : '1');
    for (;;) {
      const read = await reads(page);
      if (read?.title !== name || read.rows.Doing !== doing || (await session.gameMinutes(page)) >= until) break;
      await page.waitForTimeout(60);
    }
    await session.pause(page);
    await session.still(page);
    return reads(page);
  };
  let read = woodcutter;
  while (read?.title === name && read.rows.Doing !== FETCHING_LOG && (await session.gameMinutes(page)) < clockMinutes(FIREWOOD_FOLLOW_BY)) {
    read = await runWhileDoing(read.rows.Doing, 120);
  }
  const followFrom = play.since();
  const follow = [];
  const ready = read?.rows?.Doing === FETCHING_LOG;
  for (let stop = 0; ready && read?.title === name; stop++) {
    const png = await session.screenshot(page, `firewood-follow-${String(stop).padStart(2, '0')}`);
    const step = { at: await at(page), doing: read.rows.Doing, carries: read.rows.Carries, firewood: (await stockpiles(page)).firewood, ring: markOf(page, png, await uiBoxes(page)).center };
    follow.push(step);
    const split = follow.some((seen) => seen.doing === SPLITTING_LOG);
    if ((split && step.doing !== SPLITTING_LOG) || (await session.gameMinutes(page)) >= clockMinutes(FIREWOOD_UNTIL)) break;
    read = await runWhileDoing(read.rows.Doing, 120);
  }
  const followTo = play.since();
  const order = [FETCHING_LOG, CARRYING_LOG, SPLITTING_LOG];
  const firsts = order.map((doing) => follow.findIndex((step) => step.doing === doing));
  session.check(
    `${name ?? 'the woodcutter'}'s panel follows one log at paused stops: walking to a stockpile for it, carrying it to the woodshed, and splitting it, in that order`,
    firsts.every((index, place) => index >= 0 && (place === 0 || index > firsts[place - 1])) && follow.every((step) => WOODCUTTER_DOING.test(step.doing ?? '')),
    follow.map((step) => `${step.at} "${step.doing}"`).join(', ') || `no stop; the panel read "${text(read)}"`,
  );
  const carrying = follow.filter((step) => step.doing === CARRYING_LOG);
  const emptyHanded = follow.filter((step) => step.doing === FETCHING_LOG || step.doing === SPLITTING_LOG);
  session.check(
    'the woodcutter carries 1 log at a time, and nothing on its way to the stockpile or while it splits',
    carrying.length > 0 && carrying.every((step) => step.carries === '1 log') && emptyHanded.every((step) => step.carries === 'Nothing'),
    follow.map((step) => `${step.at} carries ${step.carries}`).join(', ') || 'no stop',
  );
  const lost = follow.filter((step) => !step.ring).map((step) => step.at);
  session.check(
    `the clip finds ${name ?? 'the woodcutter'}'s selection ring at every paused stop`,
    follow.length > 0 && lost.length === 0,
    `the ring shows at ${follow.length - lost.length} of ${follow.length} stops${lost.length ? `, hidden at ${lost.join(', ')}` : ''}`,
  );
  const pickUp = carrying[0];
  const splitting = follow.find((step) => step.doing === SPLITTING_LOG);
  const apartFrom = (step, spot) => (step?.ring ? Math.round(Math.hypot(step.ring.x - spot.x, step.ring.y - spot.y)) : null);
  const fromPile = apartFrom(pickUp, FIREWOOD_SPOTS.stockpileMiddle);
  const fromDoor = apartFrom(splitting, FIREWOOD_SPOTS.door);
  session.check(
    `${name ?? 'the woodcutter'} picks the log up at the stockpile and splits it at the woodshed's door`,
    fromPile !== null && fromPile <= FIREWOOD_AT.stockpile && fromDoor !== null && fromDoor <= FIREWOOD_AT.door,
    `at ${pickUp?.at ?? 'no carrying stop'} its ring is ${fromPile ?? 'not found'} px from the stockpile's middle, needs at most ${FIREWOOD_AT.stockpile}; ` +
      `at ${splitting?.at ?? 'no splitting stop'} it is ${fromDoor ?? 'not found'} px from the door, needs at most ${FIREWOOD_AT.door}`,
  );
  const lastSplit = follow.findLast((step) => step.doing === SPLITTING_LOG);
  const done = follow[follow.length - 1];
  await page.keyboard.press('Escape');
  await session.still(page);
  const split = FIREWOOD_LOGS.firewoodPerLog * (FIREWOOD_SPOTS.trees.length * FIREWOOD_LOGS.perTree - FIREWOOD_LOGS.shed);
  // A unit of an earlier batch in someone's hands leaves the reading at the split odd; the stores held at least the
  // reading rounded up to whole batches, and they come back to whole batches once every carrier is in.
  const per = FIREWOOD_LOGS.firewoodPerLog;
  const base = Math.ceil((lastSplit?.firewood ?? NaN) / per) * per;
  const readStores = async () => {
    const camp = await readCamp();
    const shed = await reads(page);
    return { at: await at(page), shed, camp, total: (await stockpiles(page)).firewood, sum: firewoodOf(shed) + campFirewoodOf(camp) };
  };
  // Reads the stores at paused stops `FIREWOOD_STORED.step` game minutes apart until `enough` holds of a stop, or until `by`.
  const storesUntil = async (enough, by) => {
    const stops = [];
    for (;;) {
      const stop = await readStores();
      stops.push(stop);
      if ((stop.total === stop.sum && enough(stop.sum)) || (await session.gameMinutes(page)) >= by) return stops;
      await session.reach(page, clockAt((await session.gameMinutes(page)) + FIREWOOD_STORED.step));
      await session.still(page);
    }
  };
  const describeStops = (stops) => stops.map((stop) => `${firewoodOf(stop.shed)} and ${campFirewoodOf(stop.camp)}, a total of ${stop.total}, at ${stop.at}`).join('; ');
  const batchesOf = (more) => more >= per && base + more <= split && more % per === 0;
  const stored = await storesUntil((sum) => batchesOf(sum - base), clockMinutes(FIREWOOD_UNTIL));
  const reached = stored.at(-1);
  session.check(
    `when the split is done, the shed's and the camp's panels together, and the Firewood in stores total, read 2 more firewood, or a further 2 for each later log split`,
    Boolean(lastSplit) && done.doing !== SPLITTING_LOG && reached.total === reached.sum && batchesOf(reached.sum - base),
    `Firewood in stores read ${lastSplit?.firewood ?? 'nothing'} while it split at ${lastSplit?.at ?? 'no stop'} and ${done?.firewood ?? 'nothing'} when the split was done at ${done?.at ?? 'no stop'}; ` +
      `the shed and the camp held ${describeStops(stored)}; ` +
      `${batchesOf(reached.sum - base) ? `${reached.sum - base} more, ${(reached.sum - base) / per} logs' worth, at ${reached.at}` : 'never 2 more for each log split'}; the shed's panel then reads "${text(reached.shed)}" and the camp's "${text(reached.camp)}"`,
  );

  await page.keyboard.press('4');
  for (;;) {
    const now = await reads(page);
    if (now?.rows?.Doing === NO_LOG || (await session.gameMinutes(page)) >= clockMinutes(FIREWOOD_UNTIL)) break;
    await page.waitForTimeout(100);
  }
  await session.pause(page);
  await session.still(page);
  const stopped = await reads(page);
  const stoppedAt = await at(page);
  const stoppedTotals = await stockpiles(page);
  const allIn = await storesUntil((sum) => sum === split, clockMinutes(FIREWOOD_UNTIL));
  const last = allIn.at(-1);
  session.check(
    `at ${stoppedAt}, with no log left on the stockpile, the shed's panel says its woodcutter stopped for lack of logs, and the shed and the camp come to hold every log beyond the shed's ${FIREWOOD_LOGS.shed} split into ${split} firewood`,
    stopped?.title === 'Woodshed' && stopped.rows.Woodcutter === name && stopped.rows.Doing === NO_LOG && stoppedTotals.logs === 0 && last.sum === split && last.total === split,
    `the panel reads "${text(stopped)}"; the Stockpiles panel reads Logs ${stoppedTotals.logs}; the shed and the camp held ${describeStops(allIn)}; the camp's panel then reads "${text(last.camp)}"`,
  );
  await session.screenshot(page, 'firewood-shed-stopped');
  const shedPanel = apart(await uiBoxes(page));
  session.check("at 960x540 the woodshed's panel keeps clear of every other panel on the page", shedPanel.ok, shedPanel.detail);
  const whole = await page.getByRole('region', { name: 'Selection' }).evaluate((node) => ({ shown: node.clientHeight, holds: node.scrollHeight }));
  session.check("at 960x540 the woodshed's panel shows every one of its rows", whole.holds <= whole.shown, `the panel is ${whole.shown} px tall and its rows take ${whole.holds} px`);

  await away();
  await page.keyboard.press('KeyP');
  await said(page, /Drag over open ground/);
  await page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  await session.still(page);
  const toolbar = page.getByRole('toolbar', { name: 'Orders' });
  const boxes = {
    stockpiles: await page.getByRole('status', { name: 'Stockpiles' }).boundingBox(),
    clock: await page.getByRole('region', { name: 'Clock' }).boundingBox(),
    status: await page.getByRole('status', { name: 'Order' }).boundingBox(),
    toolbar: await toolbar.boundingBox(),
    hint: await page.getByRole('complementary', { name: 'Camera controls' }).boundingBox(),
  };
  const inside = (box) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= CLIP.width && box.y + box.height <= CLIP.height;
  const tools = await toolbar.getByRole('button').evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { name: node.getAttribute('aria-label'), box: { x, y, width, height } };
    }),
  );
  const toolsApart = tools.every(({ box }, index) => tools.every((other, place) => place === index || disjoint(box, other.box)));
  session.check(
    `the toolbar holds its ${TOOLBAR_TOOLS.length} tools, the Woodshed among them, each inside the page and clear of the others and of the clock, at ${CLIP.width}x${CLIP.height}`,
    tools.map((tool) => tool.name).join() === TOOLBAR_TOOLS.join() && tools.every(({ box }) => inside(box) && disjoint(box, boxes.clock)) && toolsApart,
    `${tools.map(({ name: tool, box }) => `${tool} ${describe(box)}`).join('; ')}; clock ${describe(boxes.clock)}`,
  );
  const others = Object.entries(boxes).filter(([part]) => part !== 'stockpiles');
  const firewoodShown = await page.getByRole('status', { name: 'Stockpiles' }).getByText('Firewood in stores', { exact: true }).isVisible();
  session.check(
    `the Stockpiles panel, with its Firewood in stores row, keeps clear of the clock, the status line, the toolbar, and the camera hint at ${CLIP.width}x${CLIP.height}`,
    inside(boxes.stockpiles) && others.every(([, box]) => box && disjoint(boxes.stockpiles, box)) && firewoodShown,
    `${Object.entries(boxes).map(([part, box]) => `${part} ${describe(box)}`).join('; ')}; the Firewood in stores row is ${firewoodShown ? 'shown' : 'missing'}`,
  );
  await session.screenshot(page, `firewood-${CLIP.width}x${CLIP.height}`);
  await page.keyboard.press('Escape');

  await session.finishClips(play.context, page, [{ label: 'firewood-split', from: followFrom, to: followTo, ...FIREWOOD_CLIP }]);
  session.check('no page errors', play.errors.length === 0, play.errors.join(' | ') || 'none');
};

/**
 * The `clothing` scenario plays a hunter's lodge and a tailor's hut on seed 7 through the page, beside the camp where
 * `scripts/clothing-year.ts` puts them: the lodge on (124, 129), the stockpile on (122, 126) to (124, 128), and the
 * tailor's hut on (126, 123). The Chop clicks mark the 8 trees nearest the camp, whose 16 logs build the two, and the
 * Quarry click the rock tile (122, 115), whose 8 stone hold the lodge's 4, so the settlers without a job have nothing
 * else to carry once both stand and take a kill's hide soon after it falls. The orders go in at 08:30 on day 1 with the
 * clock paused, from one view 36 m over the camp that shows the trees, the rock, the sites, and the stockpile.
 * `scripts/aim.ts` found the spots: `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7
 * '{"wheel":-800,"turn":{"x":-200,"y":40},"target":[128.5,126.5]}'
 * '[[137,129],[138,130],[134,131],[135,134],[138,132],[139,125],[139,124],[139,130],[124,129],[126,123],[122,126],[124,128],[122,115],[127,127],[126.5,123.5,1.2],[124.5,129.5,1.0],[123,127]]'`.
 * In `src/sim` runs with the orders at 08:30 to 08:32 the tailor's hut stood at 13:59 to 14:45 on day 1, the lodge at
 * 06:35 to 07:09 on day 2, the first kill fell at 08:30 to 09:59 on day 2, 25 to 35 tiles from the camp, a settler
 * without a job took its hide 0 to 3 game hours later and walked it in over 2 to 4 more, and the first piece of
 * clothing came on the morning of day 3.
 */
const CLOTHING_SEARCH = '?seed=7';
const CLOTHING_ORDERS_AT = { day: 1, time: '08:30' };
const CLOTHING_VIEW = { wheel: -800, turn: { x: -200, y: 40 }, pan: { x: -27, y: -7 } };
const CLOTHING_SPOTS = {
  trees: [{ x: 419, y: 414 }, { x: 396, y: 433 }, { x: 381, y: 360 }, { x: 318, y: 382 }, { x: 351, y: 433 }, { x: 508, y: 451 }, { x: 531, y: 452 }, { x: 394, y: 452 }],
  rock: { x: 661, y: 176 },
  stockpile: [{ x: 478, y: 182 }, { x: 445, y: 212 }],
  stockpileMiddle: { x: 461, y: 197 },
  lodge: { x: 428, y: 212 },
  lodgeRoof: [{ x: 418, y: 206 }],
  hut: { x: 532, y: 240 },
  hutRoof: [{ x: 525, y: 233 }, { x: 532, y: 240 }],
};
const CLOTHING_FINISHED = { hut: { after: { day: 1, time: '12:00' }, before: { day: 1, time: '17:30' } }, lodge: { after: { day: 1, time: '17:00' }, before: { day: 2, time: '11:00' } } };
/** The hunt, the hide's walk, and the tailor's piece each must be done by these times, or the scenario stops there. */
const CLOTHING_UNTIL = { kill: { day: 2, time: '18:00' }, hide: { day: 2, time: '19:05' }, piece: { day: 4, time: '19:05' }, stopped: { day: 5, time: '19:05' } };
const NO_HIDE = "Idle, no hide in a stockpile within 30 tiles of the tailor's hut";
const FETCHING_HIDE = 'Walking to a stockpile for a hide';
const CARRYING_HIDE = "Carrying a hide to the tailor's hut";
const MAKING = 'Making clothing';
const TAILOR_DOING = new RegExp(`^(${[FETCHING_HIDE, CARRYING_HIDE, "Walking to the tailor's hut to make clothing", MAKING, 'Looking for a hide', NO_HIDE, "Idle, the tailor's hut is full"].join('|')})$`);
/** What a settler without a job reads on its way to a kill's hide and on its way to the stockpile with it. */
const TO_HIDE = 'Walking to pick up a hide';
const WITH_HIDE = 'Carrying a hide to the stockpile';
/** Where the follows keep the one they follow, and how far it may stray before the view pans after it. */
const CLOTHING_AIM_AT = { x: 520, y: 290 };
const CLOTHING_RECENTRE = 140;
/** While the hide waits at the kill, the search clicks up to `clicks` tunics in view every `every` game minutes. */
const CLOTHING_SEEK = { every: 6, clicks: 12 };
/** The most pixels the carrier's ring stands from the stockpile's middle when it puts the hide down, its 9 tiles about 20 pixels each. */
const CLOTHING_AT_STOCKPILE = 60;
const CLOTHING_LOOK_EVERY = 12;
const CLOTHING_CLIPS = {
  kill: { crop: { x: 0, y: 0, width: 800, height: 490 }, width: 480, colors: 32, decimate: true },
  hide: { crop: { x: 0, y: 0, width: 800, height: 490 }, width: 480, colors: 32, decimate: true, speed: 2 },
  piece: { crop: { x: 0, y: 0, width: 800, height: 490 }, width: 480, colors: 32, decimate: true, speed: 4 },
};
const TOOLBAR_TEN = ['Chop', 'Quarry', 'Stockpile', 'House', "Forager's hut", 'Barn', "Hunter's lodge", 'Woodshed', "Tailor's hut", 'Cancel'];

SCENARIOS.clothing = async (session) => {
  const middle = { x: CLIP.width / 2, y: CLIP.height / 2 };
  const { said } = siteDriver(session);
  const { reads, text, uiBoxes, skipOf, tunicPixels, markOf, click, apart } = selectionDriver(session);
  const { lines } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const describe = (box) => (box ? `${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'missing');
  const stockpiles = async (page) =>
    page.getByRole('status', { name: 'Stockpiles' }).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { hides: Number(rows.Hides), logs: Number(rows.Logs), withJob: Number(rows['Settlers with a job']), withoutJob: Number(rows['Settlers with no job']) };
    });
  const clothingOf = (read) => Number(/^(\d+) of 8$/.exec(read?.rows?.Clothing ?? '')?.[1] ?? NaN);

  const play = await session.open(CLIP, { record: true, search: CLOTHING_SEARCH, clock: 'paused' });
  const { page } = play;
  const away = async () => {
    const toolbar = await page.getByRole('toolbar', { name: 'Orders' }).boundingBox();
    await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + 2);
  };
  const corner = () => page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  // Drags in pieces of at most 250 pixels about the middle, so no piece starts on the toolbar or a panel.
  const panned = { x: 0, y: 0 };
  const dragBy = async (by, button) => {
    const pieces = Math.ceil(Math.hypot(by.x, by.y) / 250);
    for (let piece = 0; piece < pieces; piece++) {
      const part = { x: Math.round(by.x / pieces), y: Math.round(by.y / pieces) };
      const from = { x: middle.x - part.x / 2, y: middle.y - part.y / 2 };
      await session.drag(page, from, { x: from.x + part.x, y: from.y + part.y }, button);
      if (button === 'left') {
        panned.x += part.x;
        panned.y += part.y;
      }
    }
    await corner();
    await session.still(page);
  };
  const clickOne = async (spots, title) => {
    let read = null;
    for (const spot of spots) {
      read = await click(page, spot);
      if (read?.title === title) return read;
    }
    return read;
  };
  const labelGone = async (name, minutes) => {
    const deadline = Date.now() + minutes * 60_000;
    while ((await page.getByRole('status', { name }).count()) > 0) {
      if (Date.now() > deadline) fail(`the ${name} still stood ${minutes} minutes after its order at 8×`);
      await page.waitForTimeout(100);
    }
    return session.gameMinutes(page);
  };
  // Settlers who stand together make one patch of tunic, so the clicks aim at the fullest cells of 12 pixels, and pass
  // over the cells beside a click that opened another settler.
  const seek = async (shot, wanted, { clicks = 16 } = {}) => {
    const png = await session.screenshot(page, shot);
    const boxes = skipOf(await uiBoxes(page));
    const cells = new Map();
    for (const { x, y } of await tunicPixels(page, png)) {
      if (boxes.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) continue;
      const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const cell = cells.get(key) ?? { count: 0, x: 0, y: 0 };
      cells.set(key, { count: cell.count + 1, x: cell.x + x, y: cell.y + y });
    }
    const others = [];
    let tries = 0;
    for (const cell of [...cells.values()].sort((a, b) => b.count - a.count)) {
      const aim = { x: cell.x / cell.count, y: cell.y / cell.count };
      if (others.some((spot) => Math.hypot(spot.x - aim.x, spot.y - aim.y) < 20)) continue;
      if (tries++ >= clicks) break;
      const read = await click(page, aim);
      if (wanted(read)) return read;
      if (read?.rows?.Job) others.push(aim);
    }
    await page.keyboard.press('Escape');
    return null;
  };
  // Keeps the one selected near `CLOTHING_AIM_AT`, and returns where its ring stands in the pixels of the order view.
  const follow = async (label) => {
    const png = await session.screenshot(page, label);
    const ring = markOf(page, png, await uiBoxes(page)).center;
    if (!ring) return null;
    const seen = { x: ring.x - panned.x, y: ring.y - panned.y };
    if (Math.hypot(ring.x - CLOTHING_AIM_AT.x, ring.y - CLOTHING_AIM_AT.y) >= CLOTHING_RECENTRE) await dragBy({ x: CLOTHING_AIM_AT.x - ring.x, y: CLOTHING_AIM_AT.y - ring.y }, 'left');
    return seen;
  };
  // Runs at `speed` until the selected panel's title or `Doing` changes, or for at most `minutes`, and pauses there.
  const runWhile = async (title, doing, minutes, speed) => {
    const until = (await session.gameMinutes(page)) + minutes;
    await page.keyboard.press(speed);
    for (;;) {
      const read = await reads(page);
      if (read?.title !== title || read.rows.Doing !== doing || (await session.gameMinutes(page)) >= until) break;
      await page.waitForTimeout(60);
    }
    await session.pause(page);
    await session.still(page);
    return reads(page);
  };

  await session.reach(page, CLOTHING_ORDERS_AT);
  const orderedAt = await session.gameMinutes(page);
  await page.mouse.move(middle.x, middle.y);
  await page.mouse.wheel(0, CLOTHING_VIEW.wheel);
  await session.still(page);
  await dragBy(CLOTHING_VIEW.turn, 'right');
  await dragBy(CLOTHING_VIEW.pan, 'left');
  panned.x = 0;
  panned.y = 0;
  const opening = await stockpiles(page);
  const hidesShown = await page.getByRole('status', { name: 'Stockpiles' }).getByText('Hides', { exact: true }).isVisible();
  session.check(
    'a new game opens with a Hides row at the top left that reads 0, and all 8 settlers without a job',
    hidesShown && opening.hides === 0 && opening.withJob === 0 && opening.withoutJob === 8,
    `at ${await at(page)} the Stockpiles panel ${hidesShown ? 'shows' : 'lacks'} a Hides row reading ${opening.hides}, ${opening.withJob} settlers with a job and ${opening.withoutJob} with none`,
  );

  const orders = [];
  await away();
  await page.keyboard.press('KeyC');
  for (const spot of CLOTHING_SPOTS.trees) {
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.up();
    orders.push(await said(page, /^1 tree marked for felling/));
    await corner();
    await said(page, /Drag over trees/);
  }
  await away();
  await page.keyboard.press('KeyM');
  await page.mouse.move(CLOTHING_SPOTS.rock.x, CLOTHING_SPOTS.rock.y);
  await page.mouse.down();
  await page.mouse.up();
  orders.push(await said(page, /^1 rock tile marked for quarrying/));
  await away();
  await page.keyboard.press('KeyP');
  await session.drag(page, ...CLOTHING_SPOTS.stockpile);
  orders.push(await said(page, /tiles? joins? the stockpile zone/));
  await away();
  await page.keyboard.press('KeyL');
  await page.mouse.move(CLOTHING_SPOTS.lodge.x, CLOTHING_SPOTS.lodge.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  orders.push(await said(page, /^Hunter's lodge site placed/));
  session.check(
    `at ${clockText(orderedAt)}, with the clock paused, a Chop click on each of the 8 trees marks one, a Quarry click marks the rock tile, a Stockpile drag adds 9 tiles, and a lodge site is placed`,
    orders.slice(0, 8).every((line) => /^1 tree marked for felling/.test(line)) &&
      /^1 rock tile marked for quarrying/.test(orders[8]) &&
      /^9 tiles join the stockpile zone/.test(orders[9]) &&
      /^Hunter's lodge site placed/.test(orders[10]),
    orders.map((line) => `"${line}"`).join(', '),
  );
  await away();
  await page.keyboard.press('KeyT');
  const tool = page.getByRole('button', { name: "Tailor's hut", exact: true, pressed: true });
  const toolPressed = await tool.count();
  const face = toolPressed === 1 ? await tool.locator('.order-tool-label').textContent() : null;
  const hint = await said(page, /tailor's hut on 2 by 2 tiles/);
  await page.mouse.move(CLOTHING_SPOTS.hut.x, CLOTHING_SPOTS.hut.y, { steps: 3 });
  const fits = await said(page, /Click to place the tailor's hut site here/);
  await page.mouse.down();
  await page.mouse.up();
  const placed = await said(page, /^Tailor's hut site placed/);
  session.check(
    "T picks the Tailor's hut tool, whose button reads Tailor, which places a tailor's hut site with a click",
    toolPressed === 1 && face === 'Tailor' && /makes clothing from hides/.test(hint) && /Click to place the tailor's hut site here/.test(fits) && /^Tailor's hut site placed/.test(placed),
    `${toolPressed ? `the tool is pressed and its button reads "${face}"` : 'no tool is pressed'}; the status line read "${hint}", then "${fits}", then "${placed}"`,
  );
  await page.keyboard.press('Escape');
  await corner();
  await session.still(page);
  const label = page.getByRole('status', { name: "Tailor's hut site" });
  const siteLabel = (await label.count()) === 1 ? (await label.innerText()).replace(/\s+/g, ' ') : null;
  session.check(
    "the tailor's hut site's label reads 0 of 8 logs, no stone, and waits for materials",
    siteLabel !== null && /Logs\s*0\/8/.test(siteLabel) && !/Stone/.test(siteLabel) && /Waiting for materials/.test(siteLabel),
    `the label reads "${siteLabel ?? 'nothing'}"`,
  );
  await session.screenshot(page, 'clothing-sites');

  await page.keyboard.press('4');
  const hutAt = await labelGone("Tailor's hut site", 6);
  await session.pause(page);
  await session.still(page);
  session.check(
    `the tailor's hut is finished on day 1 between ${CLOTHING_FINISHED.hut.after.time} and ${CLOTHING_FINISHED.hut.before.time}`,
    hutAt >= clockMinutes(CLOTHING_FINISHED.hut.after) && hutAt <= clockMinutes(CLOTHING_FINISHED.hut.before),
    `the label was gone at ${clockText(hutAt)}; paused at ${await at(page)}`,
  );
  // The tailor's first look for a hide comes on its next think tick, and its panel reads `Looking for a hide` until then.
  await session.reach(page, clockAt(hutAt + 3));
  await session.still(page);
  const hut = await clickOne(CLOTHING_SPOTS.hutRoof, "Tailor's hut");
  const name = hut?.rows?.Tailor;
  session.check(
    `at ${await at(page)} the tailor's hut's panel says what it does, names its tailor with its one place filled, reads 0 of 8 clothing, and says the tailor has no hide to fetch`,
    hut?.title === "Tailor's hut" &&
      /carries hides from the stockpiles within 30 tiles and makes 1 piece of clothing from each 2/.test(hut.note ?? '') &&
      Boolean(name) && name !== 'Nobody' && !name.includes(' and ') &&
      hut.rows.Places === '1 of 1' && hut.rows.Clothing === '0 of 8' && hut.rows.Doing === NO_HIDE,
    `the panel reads "${text(hut)}"`,
  );
  await session.screenshot(page, 'clothing-hut-no-hides');
  const hired = { totals: await stockpiles(page), news: await lines(page) };
  session.check(
    'the Stockpiles panel counts 1 settler with a job and 7 with none, and the news names the tailor',
    hired.totals.withJob === 1 && hired.totals.withoutJob === 7 && Boolean(name) && hired.news.some((line) => line.endsWith(`${name} became a tailor.`)),
    `${hired.totals.withJob} with a job and ${hired.totals.withoutJob} with none; the news reads ${hired.news.map((line) => `"${line}"`).join(', ') || 'nothing'}`,
  );
  await page.keyboard.press('Escape');
  await session.still(page);
  let tailor = await seek('clothing-tailor-aim', (read) => read?.rows?.Job === 'Tailor');
  for (let tries = 0; !tailor && tries < 8; tries++) {
    await session.reach(page, clockAt((await session.gameMinutes(page)) + 3));
    await session.still(page);
    tailor = await seek('clothing-tailor-aim', (read) => read?.rows?.Job === 'Tailor');
  }
  session.check(
    `at ${await at(page)} the tailor's panel reads its job, Tailor, and what a tailor does`,
    tailor?.rows?.Job === 'Tailor' && tailor.title === name && TAILOR_DOING.test(tailor.rows.Doing ?? ''),
    `the panel reads "${text(tailor)}"`,
  );
  await session.screenshot(page, 'clothing-tailor-panel');
  await page.keyboard.press('Escape');

  await page.keyboard.press('4');
  const lodgeAt = await labelGone("Hunter's lodge site", 8);
  await session.pause(page);
  await session.still(page);
  const lodge = await clickOne(CLOTHING_SPOTS.lodgeRoof, "Hunter's lodge");
  const hunters = (lodge?.rows?.Hunters ?? '').split(' and ').filter(Boolean);
  session.check(
    `the lodge is finished between day ${CLOTHING_FINISHED.lodge.after.day} ${CLOTHING_FINISHED.lodge.after.time} and day ${CLOTHING_FINISHED.lodge.before.day} ${CLOTHING_FINISHED.lodge.before.time}, and its panel names two hunters`,
    lodgeAt >= clockMinutes(CLOTHING_FINISHED.lodge.after) && lodgeAt <= clockMinutes(CLOTHING_FINISHED.lodge.before) && hunters.length === 2,
    `the label was gone at ${clockText(lodgeAt)}; the panel reads "${text(lodge)}"`,
  );
  await page.keyboard.press('Escape');
  await session.still(page);

  let hunter = await seek('clothing-hunter-aim', (read) => read?.rows?.Job === 'Hunter');
  for (let tries = 0; !hunter && tries < 6; tries++) {
    await session.reach(page, clockAt((await session.gameMinutes(page)) + 3));
    await session.still(page);
    hunter = await seek('clothing-hunter-aim', (read) => read?.rows?.Job === 'Hunter');
  }
  const hunterName = hunter?.title;
  const hunt = [];
  let read = hunter;
  let kill = null;
  let aimFrom = null;
  for (let stop = 0; read && read.title === hunterName && (await session.gameMinutes(page)) < clockMinutes(CLOTHING_UNTIL.kill); stop++) {
    const seen = await follow(`clothing-hunt-${String(stop).padStart(2, '0')}`);
    if (read.rows.Doing === 'Aiming at a deer' && hunt.at(-1)?.doing !== 'Aiming at a deer') aimFrom = play.since();
    hunt.push({ at: await at(page), doing: read.rows.Doing, seen });
    if (/^Carrying food to/.test(read.rows.Doing) && hunt.some((step) => step.doing === 'Walking to a kill to pick up food')) {
      kill = { at: await at(page), seen, png: await session.screenshot(page, 'clothing-kill'), to: play.since() };
      break;
    }
    read = await runWhile(hunterName, read.rows.Doing, CLOTHING_LOOK_EVERY, /^(Walking to a kill|Carrying food)/.test(read.rows.Doing) ? '2' : '4');
  }
  session.check(
    `${hunterName ?? 'a hunter'} hunts and kills a deer, walks to the kill, and picks its food up there`,
    kill !== null,
    hunt.map((step) => `${step.at} "${step.doing}"`).join(', ') || `no hunter found; the panel read "${text(hunter)}"`,
  );
  await page.keyboard.press('Escape');
  await dragBy({ x: -panned.x, y: -panned.y }, 'left');

  // The hide lies on the tile beside the kill, often under the trees. The settlers without a job wait near the camp, on
  // open ground, and one of them sets out for it: the search looks for it there, and the follow takes it to the hide and back.
  let carrier = null;
  const waited = [];
  for (let look = 0; kill && !carrier && (await session.gameMinutes(page)) < clockMinutes(CLOTHING_UNTIL.hide); look++) {
    carrier = await seek(`clothing-carrier-aim-${String(look).padStart(2, '0')}`, (seen) => seen?.rows?.Doing === TO_HIDE || seen?.rows?.Doing === WITH_HIDE, {
      clicks: CLOTHING_SEEK.clicks,
    });
    if (carrier) break;
    waited.push(await at(page));
    await session.reach(page, clockAt((await session.gameMinutes(page)) + CLOTHING_SEEK.every));
    await session.still(page);
  }
  const carrierName = carrier?.title;
  const hideFrom = play.since();
  const walk = [];
  read = carrier;
  let delivered = null;
  for (let stop = 0; read && read.title === carrierName && (await session.gameMinutes(page)) < clockMinutes(CLOTHING_UNTIL.hide); stop++) {
    const seen = await follow(`clothing-hide-${String(stop).padStart(2, '0')}`);
    const step = { at: await at(page), doing: read.rows.Doing, carries: read.rows.Carries, hides: (await stockpiles(page)).hides, seen };
    walk.push(step);
    if (walk.some((before) => before.doing === WITH_HIDE) && step.doing !== WITH_HIDE) {
      delivered = step;
      break;
    }
    read = await runWhile(carrierName, read.rows.Doing, CLOTHING_LOOK_EVERY, '2');
  }
  const hideTo = play.since();
  session.check(
    `after the kill a settler without a job, ${carrierName ?? 'nobody'}, walks out to a kill's hide and carries 1 hide to the stockpile`,
    carrier?.rows?.Job === 'None' &&
      walk.some((step) => step.doing === WITH_HIDE) &&
      walk.filter((step) => step.doing === WITH_HIDE).every((step) => step.carries === '1 hide') &&
      delivered?.carries === 'Nothing',
    `${waited.length ? `looked at the kill at ${waited.join(', ')}; ` : ''}${walk.map((step) => `${step.at} "${step.doing}" carries ${step.carries}`).join(', ') || `no carrier; the kill was at ${kill?.at ?? 'no kill'}`}`,
  );
  const lastCarry = walk.findLast((step) => step.doing === WITH_HIDE);
  const fromPile = delivered?.seen ? Math.round(Math.hypot(delivered.seen.x - CLOTHING_SPOTS.stockpileMiddle.x, delivered.seen.y - CLOTHING_SPOTS.stockpileMiddle.y)) : null;
  session.check(
    `${carrierName ?? 'the carrier'} puts the hide down on the stockpile, and the Hides total at the top left goes up by 1`,
    fromPile !== null && fromPile <= CLOTHING_AT_STOCKPILE && Boolean(lastCarry) && delivered.hides === lastCarry.hides + 1,
    `at ${delivered?.at ?? 'no delivery'} its ring is ${fromPile ?? 'not found'} px from the stockpile's middle, needs at most ${CLOTHING_AT_STOCKPILE}; Hides read ${lastCarry?.hides ?? 'nothing'} while it carried and ${delivered?.hides ?? 'nothing'} after`,
  );
  await page.keyboard.press('Escape');
  await dragBy({ x: -panned.x, y: -panned.y }, 'left');

  // With the hut's panel open, the follow reads its tailor through two hides and one piece of clothing.
  const hutRead = await clickOne(CLOTHING_SPOTS.hutRoof, "Tailor's hut");
  const pieceFrom = play.since();
  const work = [];
  read = hutRead;
  for (let stop = 0; read && read.title === "Tailor's hut" && (await session.gameMinutes(page)) < clockMinutes(CLOTHING_UNTIL.piece); stop++) {
    await session.screenshot(page, `clothing-tailor-${String(stop).padStart(2, '0')}`);
    work.push({ at: await at(page), doing: read.rows.Doing, clothing: clothingOf(read), hides: (await stockpiles(page)).hides });
    if (clothingOf(read) >= 1) break;
    const walking = read.rows.Doing === FETCHING_HIDE || read.rows.Doing === CARRYING_HIDE;
    read = await runWhile("Tailor's hut", read.rows.Doing, walking ? CLOTHING_LOOK_EVERY : 240, walking ? '1' : '4');
  }
  const pieceTo = play.since();
  const carries = work.filter((step, index) => step.doing === CARRYING_HIDE && work[index - 1]?.doing !== CARRYING_HIDE).length;
  const madeAt = work.findIndex((step) => step.clothing >= 1);
  const making = work.findIndex((step) => step.doing === MAKING);
  session.check(
    `with the tailor's hut's panel open, ${name ?? 'the tailor'} walks to the stockpile and carries hides to the hut one at a time, at least twice, makes clothing, and the panel reads 1 of 8 clothing`,
    work.every((step) => TAILOR_DOING.test(step.doing ?? '') || /^Walking to the camp|^Resting at the camp/.test(step.doing ?? '')) &&
      carries >= 2 &&
      making >= 0 &&
      madeAt > making &&
      work[madeAt].clothing === 1,
    work.map((step) => `${step.at} "${step.doing}" clothing ${step.clothing}, hides ${step.hides}`).join(', ') || `no stop; the panel read "${text(hutRead)}"`,
  );

  read = work.at(-1)?.clothing >= 1 ? await reads(page) : null;
  for (let stop = 0; read && read.title === "Tailor's hut" && read.rows.Doing !== NO_HIDE && (await session.gameMinutes(page)) < clockMinutes(CLOTHING_UNTIL.stopped); stop++) {
    read = await runWhile("Tailor's hut", read.rows.Doing, 240, '4');
  }
  const stopped = await reads(page);
  session.check(
    `at ${await at(page)}, after its first piece, which the tailor puts on before it looks for hides again, the tailor's hut's panel says its tailor has stopped for lack of hides and holds no clothing`,
    stopped?.title === "Tailor's hut" && stopped.rows.Tailor === name && stopped.rows.Doing === NO_HIDE && clothingOf(stopped) === 0,
    `the panel reads "${text(stopped)}"`,
  );
  await session.screenshot(page, 'clothing-hut-stopped');
  const hutPanel = apart(await uiBoxes(page));
  session.check("at 960x540 the tailor's hut's panel keeps clear of every other panel on the page", hutPanel.ok, hutPanel.detail);
  const whole = await page.getByRole('region', { name: 'Selection' }).evaluate((node) => ({ shown: node.clientHeight, holds: node.scrollHeight }));
  session.check("at 960x540 the tailor's hut's panel shows every one of its rows", whole.holds <= whole.shown, `the panel is ${whole.shown} px tall and its rows take ${whole.holds} px`);

  await page.keyboard.press('Escape');
  await away();
  await page.keyboard.press('KeyP');
  await said(page, /Drag over open ground/);
  await corner();
  await session.still(page);
  const toolbar = page.getByRole('toolbar', { name: 'Orders' });
  const boxes = {
    stockpiles: await page.getByRole('status', { name: 'Stockpiles' }).boundingBox(),
    clock: await page.getByRole('region', { name: 'Clock' }).boundingBox(),
    status: await page.getByRole('status', { name: 'Order' }).boundingBox(),
    toolbar: await toolbar.boundingBox(),
    hint: await page.getByRole('complementary', { name: 'Camera controls' }).boundingBox(),
  };
  const inside = (box) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= CLIP.width && box.y + box.height <= CLIP.height;
  const tools = await toolbar.getByRole('button').evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { name: node.getAttribute('aria-label'), box: { x, y, width, height } };
    }),
  );
  const toolsApart = tools.every(({ box }, index) => tools.every((other, place) => place === index || disjoint(box, other.box)));
  session.check(
    `the toolbar holds its ${TOOLBAR_TEN.length} tools, the Tailor's hut among them, each inside the page and clear of the others, of the clock, and of the camera hint, at ${CLIP.width}x${CLIP.height}`,
    tools.map((one) => one.name).join() === TOOLBAR_TEN.join() && tools.every(({ box }) => inside(box) && disjoint(box, boxes.clock) && disjoint(box, boxes.hint)) && toolsApart,
    `toolbar ${describe(boxes.toolbar)}; ${tools.map(({ name: one, box }) => `${one} ${describe(box)}`).join('; ')}; clock ${describe(boxes.clock)}; camera hint ${describe(boxes.hint)}`,
  );
  const others = Object.entries(boxes).filter(([part]) => part !== 'stockpiles');
  session.check(
    `the Stockpiles panel, with its Hides row, keeps clear of the clock, the status line, the toolbar, and the camera hint at ${CLIP.width}x${CLIP.height}`,
    inside(boxes.stockpiles) && others.every(([, box]) => box && disjoint(boxes.stockpiles, box)) && hidesShown,
    Object.entries(boxes).map(([part, box]) => `${part} ${describe(box)}`).join('; '),
  );
  await session.screenshot(page, `clothing-${CLIP.width}x${CLIP.height}`);
  await page.keyboard.press('Escape');

  const cuts = [];
  if (kill && aimFrom !== null) cuts.push({ label: 'clothing-kill', from: aimFrom, to: kill.to, ...CLOTHING_CLIPS.kill });
  if (delivered) cuts.push({ label: 'clothing-hide', from: hideFrom, to: hideTo, ...CLOTHING_CLIPS.hide });
  if (madeAt >= 0) cuts.push({ label: 'clothing-piece', from: pieceFrom, to: pieceTo, ...CLOTHING_CLIPS.piece });
  if (cuts.length > 0) await session.finishClips(play.context, page, cuts);
  session.check('no page errors', play.errors.length === 0, play.errors.join(' | ') || 'none');
};

/**
 * The cold scenario. On seed 7, fed by `FED` so that the settlers live to winter, the player gives every order at
 * 08:15 on day 1 from `COLD_ORDER_VIEW`: a Chop drag over 35 trees east of the camp, a Quarry drag over 2 rock tiles
 * north of it, a stockpile of 9 tiles, a woodshed on (126, 123), and houses on (121, 122) and (121, 127). That is 70
 * logs for the shed's 6, the houses' 24, and 40 to split, and 16 stone for the houses' 12. A page reaches its first
 * pause anywhere from 08:06 to 08:09 as it loads, so the scenario runs the clock to 08:15 before it gives them, and
 * the orders land within the same few ticks on every run. Then the wheel brings the camera in to the near view, which
 * looks at the same point, so the two houses and the camp's fire stand in one view. In `src/sim` runs of this layout
 * with the orders at 08:13 to 08:19, the second house stood by 15:31 on day 3, households 1 and 2 moved in, both houses
 * held 6 firewood and the camp 12 at 17:00 on day 10, the 4 settlers of households 3 and 4 had their first cold night
 * at 17:25 to 17:48, and they froze at 17:25 to 17:54 on day 12. Every pixel comes from `scripts/aim.ts`:
 * `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7 '{"wheel":-450,"turn":{"x":0,"y":0},"target":[124,125]}' '[[137,118],[147,135],[121,114],[122,115],[130,126],[132,128],[126,123],[121,122],[121,127]]'`
 * for the orders, and the same with `{"wheel":-1000,"turn":{"x":0,"y":0},"target":[123.99,125.04]}`, the look-at point
 * the order view's whole-pixel pan reaches, for the near view.
 */
const COLD_SEARCH = `?seed=7&${FED.slice(1)}`;
const COLD_ORDER_VIEW = { wheel: -450, turn: { x: 0, y: 0 }, pan: { x: 20, y: 31 } };
/** Wheel pixels from the order view's 61 m in to the near view of 27 m, toward the same look-at point. */
const COLD_CLOSER = -550;
/**
 * The drag that then moves the near view's look-at point to (127, 123), so the first house's roof and its fire's
 * sign stand west of the winter readiness panel, which from the first day of autumn covers the page from x 464 to 792
 * and from y 108 to 234 at 960 by 540. Before the panel the near view looked at (123.99, 125.04), and the sign box
 * of the first house lay under it. `scripts/aim.ts` puts the near view's pan at (46, 71) before and (-43, 73) after,
 * in the pixels of a drag at the settled near zoom, so the drag is (-89, 2) once the wheel's zoom has eased in. A drag
 * while it eases moves the view by the distance of that moment:
 * `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7 '{"wheel":-1000,"turn":{"x":0,"y":0},"target":[127,123]}' '[[121,122],[122,123,3],[121,127],[122,128,3],[126,123],[127,124],[127,127]]'`
 */
const COLD_NEAR_PAN = { from: { x: 480, y: 270 }, to: { x: 391, y: 272 } };
const COLD_ORDERS = {
  chop: [{ x: 640, y: 292 }, { x: 697, y: 454 }],
  quarry: [{ x: 512, y: 201 }, { x: 516, y: 211 }],
  stockpile: [{ x: 534, y: 310 }, { x: 544, y: 331 }],
  shed: { x: 511, y: 274 },
  houses: [{ x: 472, y: 246 }, { x: 443, y: 270 }],
};
/**
 * Spots of the near view after `COLD_NEAR_PAN`, each the spot of the view before it moved by the shift `scripts/aim.ts`
 * gives for the tile or roof point under it. Each house has the points a click may select it at, its roof and the tile in its middle, the
 * box over its roof where its fire's sign stands, and the box of the whole house, whose thatch in the winter morning
 * reads as tunic yellow, so the search for a settler passes over it. The camp has the points around its fire, which a
 * settler in the ring can take a click from.
 */
const COLD_SPOTS = {
  houses: [
    { clicks: [{ x: 370, y: 167 }, { x: 379, y: 206 }], sign: { x: 342, y: 106, width: 50, height: 55 }, body: { x: 325, y: 133, width: 95, height: 100 } },
    { clicks: [{ x: 280, y: 216 }, { x: 298, y: 258 }], sign: { x: 250, y: 153, width: 50, height: 55 }, body: { x: 230, y: 172, width: 110, height: 120 } },
  ],
  camp: [{ x: 427, y: 339 }, { x: 419, y: 341 }, { x: 435, y: 341 }, { x: 427, y: 347 }],
  shed: [{ x: 467, y: 230 }, { x: 462, y: 251 }],
};
const COLD_STOPS = {
  orders: { day: 1, time: '08:15' },
  built: { day: 4, time: '12:00' },
  before: { day: 10, time: '17:00' },
  after: { day: 10, time: '18:30' },
  morning: [{ day: 11, time: '08:00' }, { day: 11, time: '09:00' }, { day: 11, time: '10:00' }],
  secondBefore: { day: 11, time: '17:00' },
  secondAfter: { day: 11, time: '18:30' },
  lastBefore: { day: 12, time: '17:00' },
  last: { day: 12, time: '18:30' },
};
/** The news is read at 1× from each `before` stop to this many game minutes before its `after` stop, then `reach` pins the stop. */
const COLD_WATCH_UNTIL = 10;
/** The firewood a house's fire and the camp's fire burn on a winter night. */
const COLD_BURNS = { house: 2, camp: 4 };
/** The fewest flame pixels in a box when its fire burns, and the most when it does not. */
const COLD_FLAME = { least: 40, most: 5 };
/** The clip keeps the clock, the Stockpiles panel, the houses, the camp, and the news at the bottom right. */
const COLD_CLIP = { crop: { x: 0, y: 0, width: 960, height: 490 }, width: 640, colors: 48, decimate: true };

SCENARIOS.cold = async (session) => {
  const { said } = siteDriver(session);
  const { reads, text, uiBoxes, skipOf, tunicPixels, click } = selectionDriver(session);
  const { lines } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const play = await session.open(CLIP, { record: true, search: COLD_SEARCH, clock: 'paused' });
  const { page } = play;
  const away = () => page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  const stockpiles = async () =>
    page.getByRole('status', { name: 'Stockpiles' }).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = Number(name.nextElementSibling?.textContent.trim());
      return rows;
    });
  const firewoodOf = (read, limit) => Number(new RegExp(`^(\\d+) of ${limit}$`).exec(read?.rows?.Firewood ?? '')?.[1] ?? NaN);
  const namesIn = (list) => list.split(/, | and /).map((name) => name.replace(/ \(died\)$/, ''));
  const selectOne = async (spots, title) => {
    let read = null;
    for (const spot of spots) {
      read = await click(page, spot);
      if (read?.title === title) break;
    }
    await page.keyboard.press('Escape');
    await away();
    await session.still(page);
    return read;
  };
  /** Reads every panel the checks compare, from one paused frame, after a screenshot with nothing selected. */
  const readStop = async (label, shed = false) => {
    const png = await session.screenshot(page, label);
    const totals = await stockpiles();
    const houses = [];
    for (const house of COLD_SPOTS.houses) {
      const read = await selectOne(house.clicks, 'House');
      const household = /^Household (\d+): (.+)$/.exec(read?.rows?.Household ?? '');
      houses.push({
        read,
        firewood: firewoodOf(read, 6),
        household: household ? Number(household[1]) : null,
        names: household ? namesIn(household[2]) : [],
        died: household ? household[2].split(/ and /).filter((name) => name.endsWith('(died)')).length : null,
        flame: pixelsIn(png, CLIP.width, house.sign, FLAME).count,
      });
    }
    const camp = await selectOne(COLD_SPOTS.camp, 'Camp');
    const woodshed = shed ? await selectOne(COLD_SPOTS.shed, 'Woodshed') : null;
    return {
      at: await at(page),
      totals,
      houses,
      camp: { read: camp, firewood: firewoodOf(camp, 12) },
      shed: woodshed ? { read: woodshed, firewood: firewoodOf(woodshed, 40) } : null,
    };
  };
  const heard = new Set();
  const listen = async () => {
    for (const line of await lines(page)) heard.add(line);
  };
  /** Runs at 1× while it listens to the news, and pauses at `stop`. */
  const watchDusk = async (stop) => {
    const until = clockMinutes(stop) - COLD_WATCH_UNTIL;
    await page.keyboard.press('1');
    while ((await session.gameMinutes(page)) < until) {
      await listen();
      await page.waitForTimeout(250);
    }
    await session.reach(page, stop);
    await listen();
  };
  // A line of the news takes a new text as each settler joins it, so the names are those of every text it took.
  const told = (day, verb) => [
    ...new Set(
      [...heard].flatMap((line) => {
        const read = new RegExp(`^Day ${day}, \\d\\d:\\d\\d\\. (.+) ${verb}\\.$`).exec(line);
        return read ? namesIn(read[1]) : [];
      }),
    ),
  ];
  const houseText = (stop) => stop.houses.map((house, index) => `house ${index + 1} "${text(house.read)}"`).join('; ');

  await takeForageView(session, page, COLD_ORDER_VIEW);
  await session.reach(page, COLD_STOPS.orders);
  const orderedAt = await at(page);
  const given = [];
  for (const [key, tool, pattern, spots] of [
    ['KeyC', 'Chop', /^35 trees marked for felling/, COLD_ORDERS.chop],
    ['KeyM', 'Quarry', /^2 rock tiles marked for quarrying/, COLD_ORDERS.quarry],
    ['KeyP', 'Stockpile', /^9 tiles join the stockpile zone/, COLD_ORDERS.stockpile],
  ]) {
    await page.keyboard.press(key);
    await session.drag(page, ...spots);
    given.push({ tool, pattern, line: await said(page, pattern) });
    await page.keyboard.press('Escape');
  }
  for (const [key, tool, pattern, spot] of [
    ['KeyK', 'Woodshed', /^Woodshed site placed/, COLD_ORDERS.shed],
    ['KeyH', 'House', /^House site placed/, COLD_ORDERS.houses[0]],
    ['KeyH', 'House', /^House site placed/, COLD_ORDERS.houses[1]],
  ]) {
    await page.keyboard.press(key);
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    given.push({ tool, pattern, line: await said(page, pattern) });
    await page.keyboard.press('Escape');
    await away();
  }
  const sites = { sheds: await page.getByRole('status', { name: 'Woodshed site' }).count(), houses: await page.getByRole('status', { name: 'House site' }).count() };
  session.check(
    `at ${orderedAt} the orders mark 35 trees, 2 rock tiles, and 9 stockpile tiles, and place a woodshed site and two house sites`,
    given.every(({ pattern, line }) => pattern.test(line)) && sites.sheds === 1 && sites.houses === 2 && (await at(page)) === orderedAt,
    `${given.map(({ tool, line }) => `${tool}: "${line}"`).join(', ')}; ${sites.sheds} woodshed and ${sites.houses} house site labels at ${await at(page)}`,
  );
  await session.screenshot(page, 'cold-orders');
  await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await page.mouse.wheel(0, COLD_CLOSER);
  await away();
  await session.still(page);
  await session.drag(page, COLD_NEAR_PAN.from, COLD_NEAR_PAN.to);
  await away();
  await session.still(page);
  await session.screenshot(page, 'cold-view');

  await session.reach(page, COLD_STOPS.built);
  await session.still(page);
  const built = await readStop('cold-built');
  const siteLabels = await page.getByRole('status', { name: /site$/ }).count();
  session.check(
    `at ${built.at} both houses are finished and households 1 and 2 have moved in, one in each`,
    siteLabels === 0 && built.houses.map((house) => house.household).join() === '1,2' && built.houses.every((house) => house.names.length === 2 && house.died === 0),
    `${siteLabels} site labels; ${houseText(built)}`,
  );
  const housed = built.houses.flatMap((house) => house.names);
  const atCamp = HUNGER_NAMES.filter((name) => !housed.includes(name));
  session.check(
    'the house panels name 4 of the 8 settlers of seed 7, so the other 4 sleep at the camp',
    housed.length === 4 && new Set(housed).size === 4 && housed.every((name) => HUNGER_NAMES.includes(name)) && atCamp.length === 4,
    `in houses: ${housed.join(', ') || 'nobody'}; at the camp: ${atCamp.join(', ')}`,
  );

  await session.reach(page, COLD_STOPS.before);
  await session.still(page);
  const clipFrom = play.since();
  const before = await readStop('cold-before-dusk', true);
  session.check(
    `at ${before.at}, before the first winter dusk, each house holds 6 firewood and Firewood in homes is the sum of the two house panels`,
    before.houses.every((house) => house.firewood === 6) && before.totals['Firewood in homes'] === before.houses[0].firewood + before.houses[1].firewood,
    `Firewood in homes ${before.totals['Firewood in homes']}; ${houseText(before)}`,
  );
  session.check(
    `at ${before.at} Firewood in stores is the shed's firewood and the camp's, and the camp holds at least the ${COLD_BURNS.camp} its fire burns`,
    before.totals['Firewood in stores'] === before.shed.firewood + before.camp.firewood && before.camp.firewood >= COLD_BURNS.camp,
    `Firewood in stores ${before.totals['Firewood in stores']}; the shed's panel reads "${text(before.shed.read)}"; the camp's "${text(before.camp.read)}"`,
  );
  await listen();
  await watchDusk(COLD_STOPS.after);
  await session.still(page);
  const after = await readStop('cold-after-dusk');
  const clipTo = play.since();
  session.check(
    `at ${after.at}, after the first winter dusk, each house's fire has burnt ${COLD_BURNS.house} firewood and Firewood in homes reads ${2 * COLD_BURNS.house} less`,
    after.houses.every((house, index) => house.firewood === before.houses[index].firewood - COLD_BURNS.house) &&
      after.totals['Firewood in homes'] === before.totals['Firewood in homes'] - 2 * COLD_BURNS.house,
    `Firewood in homes ${before.totals['Firewood in homes']} at ${before.at} and ${after.totals['Firewood in homes']} at ${after.at}; ` +
      `house firewood ${before.houses.map((house) => house.firewood).join(' and ')}, then ${after.houses.map((house) => house.firewood).join(' and ')}`,
  );
  session.check(
    `at ${after.at} the camp's fire has burnt ${COLD_BURNS.camp} firewood`,
    after.camp.firewood === before.camp.firewood - COLD_BURNS.camp,
    `the camp's panel read "${text(before.camp.read)}" at ${before.at} and reads "${text(after.camp.read)}" at ${after.at}`,
  );
  session.check(
    `at ${after.at} a flame stands over the roof of each house, and none did at ${before.at}`,
    after.houses.every((house) => house.flame >= COLD_FLAME.least) && before.houses.every((house) => house.flame <= COLD_FLAME.most),
    after.houses.map((house, index) => `house ${index + 1} ${before.houses[index].flame} then ${house.flame} flame pixels`).join(', ') +
      `, needs at most ${COLD_FLAME.most} before and at least ${COLD_FLAME.least} after`,
  );
  const firstCold = told(10, 'had a cold night');
  session.check(
    'the news of the first winter dusk names the 4 settlers at the camp as having had a cold night, and none of the 4 in houses',
    firstCold.length === 4 && atCamp.every((name) => firstCold.includes(name)) && !housed.some((name) => firstCold.includes(name)),
    `heard ${[...heard].map((line) => `"${line}"`).join(', ') || 'nothing'}`,
  );

  let cold = null;
  const opened = [];
  for (const stop of COLD_STOPS.morning) {
    await session.reach(page, stop);
    await session.still(page);
    const png = await session.screenshot(page, `cold-aim-${stop.time.replace(':', '')}`);
    const boxes = [...skipOf(await uiBoxes(page)), ...COLD_SPOTS.houses.map((house) => house.body)];
    const cells = new Map();
    for (const { x, y } of await tunicPixels(page, png)) {
      if (boxes.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) continue;
      const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const cell = cells.get(key) ?? { count: 0, x: 0, y: 0 };
      cells.set(key, { count: cell.count + 1, x: cell.x + x, y: cell.y + y });
    }
    for (const cell of [...cells.values()].sort((a, b) => b.count - a.count).slice(0, 16)) {
      const read = await click(page, { x: cell.x / cell.count, y: cell.y / cell.count });
      opened.push(`${stop.time} ${read?.title ?? 'nothing'}${settlerPanel(read) ? ` (${read.rows.Home}, cold nights ${read.rows['Cold nights']})` : ''}`);
      if (settlerPanel(read) && read.rows.Home === 'None, sleeps at the camp') {
        cold = { read, at: await at(page) };
        break;
      }
    }
    if (cold) break;
    await page.keyboard.press('Escape');
  }
  session.check(
    `${cold ? `at ${cold.at} ` : ''}a settler of the camp, selected by a click after the first winter night, reads 1 cold night and cold`,
    cold?.read.rows['Cold nights'] === '1, cold' && atCamp.includes(cold.read.title),
    `${cold ? `the panel reads "${text(cold.read)}"` : 'no click selected a settler of the camp'}; the clicks opened ${opened.join(', ')}`,
  );
  await session.screenshot(page, 'cold-settler-panel');
  await page.keyboard.press('Escape');
  await away();

  await session.reach(page, COLD_STOPS.secondBefore);
  await listen();
  await watchDusk(COLD_STOPS.secondAfter);
  const secondCold = told(11, 'had a cold night');
  session.check(
    'the news of the second winter dusk names the same 4 settlers at the camp, and none in houses',
    secondCold.length === 4 && atCamp.every((name) => secondCold.includes(name)) && !housed.some((name) => secondCold.includes(name)),
    `heard ${[...heard].filter((line) => line.startsWith('Day 11,')).map((line) => `"${line}"`).join(', ') || 'nothing on day 11'}`,
  );

  await session.reach(page, COLD_STOPS.lastBefore);
  await listen();
  await watchDusk(COLD_STOPS.last);
  await session.still(page);
  const last = await readStop('cold-last-dusk');
  const froze = told(12, 'froze');
  session.check(
    'at the dusk of day 12, their third cold night in a row, the news says the 4 settlers at the camp froze, and nobody in a house',
    froze.length === 4 && atCamp.every((name) => froze.includes(name)) && !housed.some((name) => froze.includes(name)) && told(12, 'had a cold night').length === 0,
    `heard ${[...heard].filter((line) => line.startsWith('Day 12,')).map((line) => `"${line}"`).join(', ') || 'nothing on day 12'}`,
  );
  session.check(
    `at ${last.at} the Stockpiles panel counts 4 living settlers, and the house panels name their households with nobody dead`,
    last.totals['Settlers with a job'] + last.totals['Settlers with no job'] === 4 &&
      last.houses.every((house, index) => house.died === 0 && house.names.join() === built.houses[index].names.join()),
    `${last.totals['Settlers with a job']} with a job and ${last.totals['Settlers with no job']} with none; ${houseText(last)}`,
  );

  await session.finishClips(play.context, page, [{ label: 'cold-winter-dusk', from: clipFrom, to: clipTo, ...COLD_CLIP }]);
  session.check('no page errors', play.errors.length === 0, play.errors.join(' | ') || 'none');
};

/**
 * The wearing scenario. On seed 7, fed by `FED`, the player gives the orders of the cold scenario at 08:15 on day 1
 * from `COLD_ORDER_VIEW`, with a tailor's hut on (121, 122) and a hunter's lodge on (121, 127) where that scenario
 * places its two houses, and no house: the Chop drag, the Quarry drag, the stockpile, and the woodshed. That is 70 logs
 * for the shed's 6, the hut's 8, the lodge's 8, and the camp's firewood, and 16 stone for the lodge's 4. In `src/sim`
 * runs of this layout with the orders at 08:13 to 08:19, the tailor put the first piece on at its own door on day 3,
 * a settler walked from the camp for the second on day 3 to 5, 4 or 5 settlers wore clothing at the dusk of day 10,
 * the camp held 12 firewood at each winter dusk, and the settlers without clothing had a cold night there while those
 * with clothing were warm by the camp's fire. The near view is the cold scenario's, which keeps the hut, the camp, and
 * its fire in view. The hut's pixels come from `scripts/aim.ts` with the near view of `COLD_SPOTS`:
 * `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7 '{"wheel":-1000,"turn":{"x":0,"y":0},"target":[123.99,125.04]}' '[[121,122],[122,122],[122,123]]'`.
 */
const WEAR_SEARCH = COLD_SEARCH;
const WEAR_ORDERS = { ...COLD_ORDERS, tailor: COLD_ORDERS.houses[0], lodge: COLD_ORDERS.houses[1] };
const WEAR_SPOTS = { hut: [{ x: 470, y: 238 }, { x: 463, y: 217 }, { x: 482, y: 228 }], camp: [{ x: 527, y: 350 }, { x: 519, y: 352 }, { x: 535, y: 352 }, { x: 527, y: 358 }] };
const WEAR_STOPS = {
  orders: { day: 1, time: '08:15' },
  watch: { day: 2, time: '12:00' },
  lastWatch: { day: 7, time: '12:00' },
  noon: { day: 10, time: '12:00' },
  before: { day: 10, time: '17:00' },
  after: { day: 10, time: '18:30' },
  morning: [{ day: 11, time: '07:00' }, { day: 11, time: '07:30' }, { day: 11, time: '08:00' }, { day: 11, time: '09:00' }],
};
/** Game minutes between two reads of a settler whose walk the dusk cut short, while it rests at the camp. */
const WEAR_NIGHT_STEP = 30;
const WEAR_NIGHT = /^(Walking to the camp|Resting at the camp)$/;
/** Game minutes between two reads of a settler that walks to the hut, so a walk from the camp shows at several stops. */
const WEAR_STEP = 2;
/** The longest a walk from the camp to the hut and the piece put on there may take, in game minutes. */
const WEAR_WALK_MINUTES = 90;
/** Wall seconds of the recording kept before the walk is found and after the piece is put on. */
const WEAR_MARGIN = 2;
const WEAR_WALK = "Walking to the tailor's hut for clothing";
/** A settler's `Cold nights` row ends in these words while it wears clothing. */
const WEAR_WORN = ', clothed';
/** The clips keep the clock, the Stockpiles panel, the hut, the camp, the selection panel, and the news. */
const WEAR_CLIPS = {
  fetch: { crop: { x: 0, y: 0, width: 960, height: 490 }, width: 560, colors: 32, decimate: true },
  dusk: { crop: { x: 0, y: 0, width: 960, height: 490 }, width: 640, colors: 48, decimate: true },
};

SCENARIOS.wearing = async (session) => {
  const { said } = siteDriver(session);
  const { reads, text, uiBoxes, skipOf, tunicPixels, click } = selectionDriver(session);
  const { lines } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const play = await session.open(CLIP, { record: true, search: WEAR_SEARCH, clock: 'paused' });
  const { page } = play;
  const away = () => page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  const wears = (read) => (read?.rows?.['Cold nights'] ?? '').endsWith(WEAR_WORN);
  const nightsOf = (read) => (read?.rows?.['Cold nights'] ?? '').replace(WEAR_WORN, '');
  const clothingOf = (read) => Number(/^(\d+) of 8$/.exec(read?.rows?.Clothing ?? '')?.[1] ?? NaN);
  const firewoodOf = (read) => Number(/^(\d+) of 12$/.exec(read?.rows?.Firewood ?? '')?.[1] ?? NaN);
  const namesIn = (list) => list.split(/, | and /).map((name) => name.replace(/ \(died\)$/, ''));
  const selectOne = async (spots, title) => {
    let read = null;
    for (const spot of spots) {
      read = await click(page, spot);
      if (read?.title === title) return read;
    }
    return read;
  };
  const deselect = async () => {
    await page.keyboard.press('Escape');
    await away();
    await session.still(page);
  };
  /** Settlers who stand together make one patch of tunic, so the clicks aim at the fullest cells of 12 pixels, and each settler found keeps the point that selected it. */
  const settlersIn = async (shot, wanted = () => false, most = 16) => {
    const png = await session.screenshot(page, shot);
    const boxes = skipOf(await uiBoxes(page));
    const cells = new Map();
    for (const { x, y } of await tunicPixels(page, png)) {
      if (boxes.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height)) continue;
      const key = `${Math.floor(x / 12)},${Math.floor(y / 12)}`;
      const cell = cells.get(key) ?? { count: 0, x: 0, y: 0 };
      cells.set(key, { count: cell.count + 1, x: cell.x + x, y: cell.y + y });
    }
    const found = new Map();
    for (const cell of [...cells.values()].sort((a, b) => b.count - a.count).slice(0, most)) {
      const spot = { x: Math.round(cell.x / cell.count), y: Math.round(cell.y / cell.count) };
      const read = await click(page, spot);
      if (!settlerPanel(read) || found.has(read.title)) continue;
      found.set(read.title, { read, spot });
      if (wanted(read)) break;
    }
    return { png, found };
  };

  await takeForageView(session, page, COLD_ORDER_VIEW);
  await session.reach(page, WEAR_STOPS.orders);
  const orderedAt = await at(page);
  const given = [];
  for (const [key, tool, pattern, spots] of [
    ['KeyC', 'Chop', /^35 trees marked for felling/, WEAR_ORDERS.chop],
    ['KeyM', 'Quarry', /^2 rock tiles marked for quarrying/, WEAR_ORDERS.quarry],
    ['KeyP', 'Stockpile', /^9 tiles join the stockpile zone/, WEAR_ORDERS.stockpile],
  ]) {
    await page.keyboard.press(key);
    await session.drag(page, ...spots);
    given.push({ tool, pattern, line: await said(page, pattern) });
    await page.keyboard.press('Escape');
  }
  for (const [key, tool, pattern, spot] of [
    ['KeyK', 'Woodshed', /^Woodshed site placed/, WEAR_ORDERS.shed],
    ['KeyT', "Tailor's hut", /^Tailor's hut site placed/, WEAR_ORDERS.tailor],
    ['KeyL', "Hunter's lodge", /^Hunter's lodge site placed/, WEAR_ORDERS.lodge],
  ]) {
    await page.keyboard.press(key);
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    given.push({ tool, pattern, line: await said(page, pattern) });
    await page.keyboard.press('Escape');
    await away();
  }
  const labels = async (name) => page.getByRole('status', { name }).count();
  const sites = { shed: await labels('Woodshed site'), hut: await labels("Tailor's hut site"), lodge: await labels("Hunter's lodge site") };
  session.check(
    `at ${orderedAt} the orders mark 35 trees, 2 rock tiles, and 9 stockpile tiles, and place a woodshed site, a tailor's hut site, and a hunter's lodge site, and no house`,
    given.every(({ pattern, line }) => pattern.test(line)) && sites.shed === 1 && sites.hut === 1 && sites.lodge === 1 && (await labels('House site')) === 0 && (await at(page)) === orderedAt,
    `${given.map(({ tool, line }) => `${tool}: "${line}"`).join(', ')}; site labels ${JSON.stringify(sites)} at ${await at(page)}`,
  );
  await session.screenshot(page, 'wearing-orders');
  await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await page.mouse.wheel(0, COLD_CLOSER);
  await away();
  await session.still(page);

  await session.reach(page, WEAR_STOPS.watch);
  const hut = await selectOne(WEAR_SPOTS.hut, "Tailor's hut");
  session.check(
    `at ${await at(page)} the tailor's hut stands, names its tailor, and holds no clothing`,
    hut?.title === "Tailor's hut" && hut.rows.Tailor !== 'Nobody' && clothingOf(hut) === 0,
    `the panel reads "${text(hut)}"`,
  );
  const tailor = hut?.rows?.Tailor ?? null;

  // The hut's panel stays open at 4×, and each change of its clothing pauses the clock.
  const counts = [];
  let piece = null;
  let taken = null;
  let now = await session.gameMinutes(page);
  const watchHut = async () => {
    const start = clothingOf(await reads(page));
    await page.keyboard.press('4');
    for (;;) {
      const read = await reads(page);
      const minutes = await session.gameMinutes(page);
      if (read?.title !== "Tailor's hut" || clothingOf(read) !== start || minutes >= clockMinutes(WEAR_STOPS.lastWatch)) break;
      await page.waitForTimeout(80);
    }
    await session.pause(page);
    await session.still(page);
    const read = await reads(page);
    now = await session.gameMinutes(page);
    counts.push(`${clockText(now)} ${read?.rows?.Clothing}`);
    return { read, from: start, to: clothingOf(read) };
  };
  /** Clicks settlers until one walks to the hut, up to 4 times 2 game minutes apart, as a settler that takes a piece sets out on its next look for work. Returns to the hut's panel when none does. */
  const findWalker = async (pieces) => {
    for (let tries = 0; tries < 4; tries++) {
      const { found } = await settlersIn(`wearing-search-${String(now).padStart(5, '0')}-${tries}`, (read) => read.rows.Doing === WEAR_WALK);
      for (const [name, { read, spot }] of found) if (read.rows.Doing === WEAR_WALK) return { name, read, spot, at: now, from: play.since(), pieces };
      await session.reach(page, clockAt(now + WEAR_STEP));
      now = await session.gameMinutes(page);
    }
    await deselect();
    const read = await selectOne(WEAR_SPOTS.hut, "Tailor's hut");
    now = await session.gameMinutes(page);
    counts.push(`${clockText(now)} ${read?.rows?.Clothing}`);
    if (!taken && clothingOf(read) < pieces) {
      taken = { at: now, from: pieces, to: clothingOf(read), read };
      await session.screenshot(page, 'wearing-hut-taken');
    }
    return null;
  };
  const panel = page.getByRole('region', { name: 'Selection' });
  const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const dusks = [];
  let walker = null;
  let fetched = null;
  let layout = null;
  while (!fetched && now < clockMinutes(WEAR_STOPS.lastWatch)) {
    if (!walker) {
      const change = await watchHut();
      if (change.read?.title !== "Tailor's hut") break;
      if (change.to > change.from) {
        if (!piece) {
          piece = { at: now, read: change.read };
          await session.screenshot(page, 'wearing-hut-piece');
        }
        walker = await findWalker(change.to);
      } else if (change.to < change.from && !taken) {
        taken = { at: now, from: change.from, to: change.to, read: change.read };
        await session.screenshot(page, 'wearing-hut-taken');
      }
      continue;
    }
    // A walker is selected: its panel stays open while it walks, at stops 2 game minutes apart.
    if (!layout) {
      const boxes = await uiBoxes(page);
      layout = { boxes, fits: Boolean(boxes.selection && boxes.stockpiles) && !overlap(boxes.selection, boxes.stockpiles) && (await panel.evaluate((node) => node.scrollHeight <= node.clientHeight)) };
    }
    await session.screenshot(page, 'wearing-walking');
    const stops = [];
    const widths = [(await panel.boundingBox())?.width ?? 0];
    let after = null;
    let last = walker.read;
    let night = null;
    while (now < walker.at + WEAR_WALK_MINUTES) {
      await session.reach(page, clockAt(now + WEAR_STEP));
      now = await session.gameMinutes(page);
      const read = await reads(page);
      stops.push(`${clockText(now)} ${read?.rows?.Doing} / ${read?.rows?.['Cold nights']}`);
      if (read?.title !== walker.name) break;
      if (wears(read)) {
        after = { read, at: now };
        break;
      }
      if (WEAR_NIGHT.test(read.rows.Doing)) {
        night = { read, at: now };
        break;
      }
      last = read;
      widths.push((await panel.boundingBox())?.width ?? 0);
    }
    if (after) {
      widths.push((await panel.boundingBox())?.width ?? 0);
      await session.screenshot(page, 'wearing-worn');
      fetched = { walker, after, last, stops, widths, to: play.since() + WEAR_MARGIN };
      break;
    }
    if (!night) break;
    // The dusk ends the walk and frees the piece, which nobody takes by night. The night passes in long steps with the hut's panel open, until its tailor is out again.
    await session.screenshot(page, 'wearing-dusk-walk');
    await deselect();
    const hutRead = await selectOne(WEAR_SPOTS.hut, "Tailor's hut");
    const nightAt = await session.gameMinutes(page);
    counts.push(`${clockText(nightAt)} ${hutRead?.rows?.Clothing}`);
    let dawn = hutRead;
    while (WEAR_NIGHT.test(dawn?.rows?.Doing ?? '')) {
      await session.reach(page, clockAt(now + WEAR_NIGHT_STEP));
      now = await session.gameMinutes(page);
      dawn = await reads(page);
    }
    now = await session.gameMinutes(page);
    counts.push(`${clockText(now)} ${dawn?.rows?.Clothing}`);
    dusks.push({ walker, night, hut: hutRead, at: nightAt, stops });
    walker = clothingOf(dawn) > 0 ? await findWalker(clothingOf(dawn)) : null;
    dusks.at(-1).next = walker?.name ?? null;
  }
  for (const dusk of dusks) {
    session.check(
      `the dusk falls on ${dusk.walker.name}'s walk to the hut: it gives the walk up for the camp, and the piece waits in the hut through the night`,
      !wears(dusk.night.read) && clothingOf(dusk.hut) >= 1,
      `at ${clockText(dusk.night.at)} the panel reads "${text(dusk.night.read)}"; at ${clockText(dusk.at)}, in the night, the hut reads "${dusk.hut?.rows?.Clothing}", and the first settler found on its way for it the next morning is ${dusk.next ?? 'none'}`,
    );
  }
  if (!fetched) fail(`no settler put a piece on by ${clockText(now)}: ${counts.join('; ')}`);
  const { after, last, stops, widths } = fetched;
  walker = fetched.walker;
  const before = walker.read;
  session.check(
    `at ${clockText(walker.at)} ${walker.name}, selected by a click, walks to the tailor's hut for a piece, carries nothing, and wears no clothing`,
    before.rows.Doing === WEAR_WALK && before.rows.Carries === 'Nothing' && !wears(before),
    `the panel reads "${text(before)}"`,
  );
  const { boxes } = layout;
  session.check(
    `at ${CLIP.width}x${CLIP.height} the settler's panel, with its clothing beside its cold nights, keeps clear of the Stockpiles panel and shows every row`,
    layout.fits,
    `the settler's panel is ${boxes.selection?.width.toFixed(0)}x${boxes.selection?.height.toFixed(0)} from y ${boxes.selection?.y.toFixed(0)}, the Stockpiles panel ${boxes.stockpiles?.width.toFixed(0)}x${boxes.stockpiles?.height.toFixed(0)} from y ${boxes.stockpiles?.y.toFixed(0)}, ending at y ${boxes.stockpiles ? (boxes.stockpiles.y + boxes.stockpiles.height).toFixed(0) : 'missing'}`,
  );
  session.check(
    `${walker.name} walks to the hut's door, puts the piece on there, and its panel reads that it wears clothing and carries nothing`,
    last.rows.Doing === WEAR_WALK && after.read.rows.Carries === 'Nothing' && after.read.rows.Doing !== WEAR_WALK,
    `at ${clockText(after.at)} the panel reads "${text(after.read)}"; the stops: ${stops.join('; ')}`,
  );
  session.check('the panel keeps its width through the walk', widths.every((value) => Math.abs(value - widths[0]) < 1), `widths ${widths.map((value) => value.toFixed(1)).join(', ')} px`);
  const fetchFrom = walker.from;
  const fetchTo = fetched.to;
  await deselect();
  const hutAfter = await selectOne(WEAR_SPOTS.hut, "Tailor's hut");
  session.check(
    `at ${await at(page)} the tailor's hut's panel reads one piece fewer than when ${walker.name} set out for it`,
    clothingOf(hutAfter) === walker.pieces - 1,
    `${walker.pieces} of 8 at ${clockText(walker.at)}, then "${text(hutAfter)}"`,
  );
  if (!taken && clothingOf(hutAfter) === walker.pieces - 1) taken = { at: await session.gameMinutes(page), from: walker.pieces, to: clothingOf(hutAfter), read: hutAfter };
  session.check(
    "with the tailor's hut's panel open, the hut reads a piece as the tailor makes it, and one fewer when a settler takes it",
    piece !== null && taken !== null && taken.to === taken.from - 1 && taken.at > piece.at,
    `the hut's clothing at each change: ${counts.join('; ')}${tailor ? `; its tailor is ${tailor}` : ''}`,
  );
  await deselect();

  await session.reach(page, WEAR_STOPS.noon);
  await session.still(page);
  const noon = await settlersIn('wearing-pair', () => false, 24);
  const clothed = new Set([...noon.found].filter(([, { read }]) => wears(read)).map(([name]) => name));
  const bare = [...noon.found].filter(([, { read }]) => !wears(read));
  const dressed = [...noon.found].filter(([name]) => clothed.has(name));
  session.check(
    `at ${await at(page)} a click finds a settler who wears clothing and one who wears none in the same paused frame, at the near view`,
    dressed.length > 0 && bare.length > 0,
    [...noon.found].map(([name, { read, spot }]) => `${name} at (${spot.x}, ${spot.y}): ${read.rows['Cold nights']}`).join('; ') || 'no settler found',
  );
  await deselect();

  await session.reach(page, WEAR_STOPS.before);
  const duskFrom = play.since();
  const campBefore = await selectOne(WEAR_SPOTS.camp, 'Camp');
  await session.screenshot(page, 'wearing-before-dusk');
  await deselect();
  const heard = new Set();
  const listen = async () => {
    for (const line of await lines(page)) heard.add(line);
  };
  await page.keyboard.press('1');
  while ((await session.gameMinutes(page)) < clockMinutes(WEAR_STOPS.after) - COLD_WATCH_UNTIL) {
    await listen();
    await page.waitForTimeout(250);
  }
  await session.reach(page, WEAR_STOPS.after);
  await listen();
  await session.screenshot(page, 'wearing-news');
  const shown = await lines(page);
  const duskTo = play.since() + WEAR_MARGIN;
  const campAfter = await selectOne(WEAR_SPOTS.camp, 'Camp');
  await deselect();
  session.check(
    `at ${await at(page)} the camp's fire has burnt 4 firewood on the first winter night`,
    firewoodOf(campBefore) >= 4 && firewoodOf(campAfter) === firewoodOf(campBefore) - 4,
    `the camp's panel read "${text(campBefore)}" at 17:00 and "${text(campAfter)}" at 18:30`,
  );
  const cold = [
    ...new Set(
      [...heard].flatMap((line) => {
        const read = /^Day 10, \d\d:\d\d\. (.+) had a cold night\.$/.exec(line);
        return read ? namesIn(read[1]) : [];
      }),
    ),
  ];
  // A line shows for 30 s of wall time, so the check reads every text the line took while the scenario listened, and the stop at 18:30 only says whether it still shows.
  const told = [...heard].filter((line) => /^Day 10, \d\d:\d\d\. .+ had a cold night\.$/.test(line)).at(-1) ?? null;
  const stillShown = shown.includes(told);

  const morning = new Map();
  for (const stop of WEAR_STOPS.morning) {
    await session.reach(page, stop);
    await session.still(page);
    const { found } = await settlersIn(`wearing-morning-${stop.time.replace(':', '')}`, () => false, 24);
    for (const [name, value] of found) if (!morning.has(name)) morning.set(name, value.read);
    await deselect();
    if (morning.size >= 8) break;
  }
  // Clothing never comes off, so a settler that wore it at noon wore it at the dusk, and one without it on the morning after had none at the dusk.
  const unclothed = [...morning].filter(([, read]) => !wears(read)).map(([name]) => name);
  const bareAt = new Set([...bare.map(([name]) => name), ...unclothed]);
  session.check(
    'the news of the first winter dusk at the camp names the settlers without clothing as having had a cold night, and none of those who wear clothing',
    told !== null && cold.length > 0 && cold.every((name) => !clothed.has(name) && bareAt.has(name)) && unclothed.every((name) => cold.includes(name)),
    `the last text of the day 10 line: "${told ?? 'none'}", ${stillShown ? 'still' : 'no longer'} shown at ${clockText(clockMinutes(WEAR_STOPS.after))}; cold ${cold.join(', ') || 'nobody'}; wore clothing at noon of day 10 ${[...clothed].join(', ') || 'nobody'}; without clothing at noon of day 10 or on the morning after ${[...bareAt].join(', ') || 'nobody'}`,
  );
  const known = [...morning].filter(([name, read]) => clothed.has(name) || !wears(read));
  session.check(
    'on the morning after, each settler that wore clothing at the dusk reads no cold night, and each without reads 1 cold night',
    known.some(([name]) => clothed.has(name)) && known.some(([name]) => !clothed.has(name)) && known.every(([name, read]) => nightsOf(read) === (clothed.has(name) ? 'None' : '1, cold')),
    `${[...morning].map(([name, read]) => `${name}: Cold nights ${read.rows['Cold nights']}${clothed.has(name) ? ' (wore it at noon)' : ''}`).join('; ') || 'no settler found'}; ${morning.size} of 8 settlers found`,
  );

  await session.finishClips(play.context, page, [
    { label: 'wearing-fetch', from: Math.max(fetchFrom - WEAR_MARGIN, 0), to: fetchTo, ...WEAR_CLIPS.fetch },
    { label: 'wearing-dusk', from: duskFrom, to: duskTo, ...WEAR_CLIPS.dusk },
  ]);
  session.check('no page errors', play.errors.length === 0, play.errors.join(' | ') || 'none');
};

/**
 * The readiness scenario. On seed 7, fed by `FED`, the player gives the orders of the cold scenario at 08:30 on day 1
 * from `COLD_ORDER_VIEW`, with one house, on (121, 122): the Chop drag over 35 trees, the Quarry drag, the stockpile,
 * and the woodshed. 08:30 and not the cold scenario's 08:15, because a page that loads slowly first pauses as late as
 * 08:19. At 08:30 on day 7, the first day of autumn, it places the second house on (121, 127) from the near view,
 * and follows that house until it holds the 6 firewood of the winter's 3 nights. In `src/sim` runs of this
 * layout with the orders at 08:28 to 08:34 on both days, the shed held 40 firewood and the camp 12 on day 7, the
 * second house was finished at 13:41 to 13:48, it held 2 firewood by 15:29 to 15:53, which takes its household out of
 * `Cold tonight`, and 6 at 16:09 to 16:33. Its fire burned at the dusk of day 10. The pixels are those of the cold
 * scenario.
 */
const READY_STOPS = {
  orders: { day: 1, time: '08:30' },
  summer: { day: 6, time: '20:00' },
  autumn: { day: 7, time: '00:30' },
  second: { day: 7, time: '08:30' },
  tailor: { day: 4, time: '08:30' },
  yearRead: { day: 7, time: '07:30' },
  follow: ['13:00', '13:45', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'].map((time) => ({ day: 7, time })),
  winterNoon: { day: 10, time: '12:00' },
  before: { day: 10, time: '17:00' },
  after: { day: 10, time: '18:30' },
  morning: { day: 11, time: '08:00' },
};
/**
 * The year "wood and hides" of `bun scripts/winter-year.ts hides`, given through the toolbar from `HIDES_YEAR_VIEW`,
 * the cold scenario's order view moved to look at (125, 128), so every tile of the year lies clear of the panels. Its
 * commands, in the script's order, land at 08:30 on day 1, and its tailor's hut at 08:30 on day 4, once the lodge
 * stands: with the orders at 08:32 the lodge is not finished by 12:00 on day 3. In `src/sim` runs with the orders at
 * 08:27 to 08:34, the reading at 07:30 on day 7 is 0 of 4 households in a house, 0 of 0 houses, 8 cold tonight, and
 * the camp's fire out with 0 of 4 firewood in each, and 0 of 8 settlers in clothing in four runs and 1 of 8 in the
 * run at 08:30, whose tailor made its first piece before dawn. The check takes either. Every pixel comes from `scripts/aim.ts`:
 * `bun .claude/skills/verify-survive-n-conquest/scripts/aim.ts 7 '{"wheel":-450,"turn":{"x":0,"y":0},"target":[125,128]}' '<the year's tiles>'`,
 * and each picks its own tile.
 */
const HIDES_YEAR_VIEW = { wheel: -450, turn: { x: 0, y: 0 }, pan: { x: 27, y: 11 } };
const HIDES_YEAR_SAID = {
  KeyC: /^1 tree marked for felling/,
  KeyM: /^1 rock tile marked for quarrying/,
  KeyP: /^6 tiles join the stockpile zone/,
  KeyG: /^Forager's hut site placed/,
  KeyB: /^Barn site placed/,
  KeyL: /^Hunter's lodge site placed/,
  KeyH: /^House site placed/,
  KeyK: /^Woodshed site placed/,
  KeyT: /^Tailor's hut site placed/,
};
const HIDES_YEAR_ORDERS = [
  ['KeyG', { x: 595, y: 311 }],
  ['KeyC', { x: 597, y: 327 }, { x: 597, y: 327 }],
  ['KeyC', { x: 604, y: 338 }, { x: 604, y: 338 }],
  ['KeyC', { x: 554, y: 330 }, { x: 554, y: 330 }],
  ['KeyC', { x: 548, y: 359 }, { x: 548, y: 359 }],
  ['KeyB', { x: 629, y: 320 }],
  ['KeyC', { x: 594, y: 352 }, { x: 594, y: 352 }],
  ['KeyC', { x: 637, y: 307 }, { x: 637, y: 307 }],
  ['KeyC', { x: 641, y: 301 }, { x: 641, y: 301 }],
  ['KeyC', { x: 615, y: 341 }, { x: 615, y: 341 }],
  ['KeyC', { x: 648, y: 310 }, { x: 648, y: 310 }],
  ['KeyC', { x: 632, y: 336 }, { x: 632, y: 336 }],
  ['KeyC', { x: 578, y: 378 }, { x: 578, y: 378 }],
  ['KeyC', { x: 655, y: 284 }, { x: 655, y: 284 }],
  ['KeyM', { x: 521, y: 194 }, { x: 521, y: 194 }],
  ['KeyL', { x: 467, y: 276 }],
  ['KeyC', { x: 618, y: 359 }, { x: 618, y: 359 }],
  ['KeyC', { x: 660, y: 313 }, { x: 660, y: 313 }],
  ['KeyC', { x: 652, y: 271 }, { x: 652, y: 271 }],
  ['KeyC', { x: 639, y: 346 }, { x: 639, y: 346 }],
  ['KeyM', { x: 517, y: 184 }, { x: 517, y: 184 }],
  ['KeyH', { x: 479, y: 226 }],
  ['KeyH', { x: 451, y: 248 }],
  ['KeyP', { x: 466, y: 248 }, { x: 472, y: 271 }],
  ['KeyK', { x: 494, y: 248 }],
  ['KeyC', { x: 630, y: 362 }, { x: 630, y: 362 }],
  ['KeyC', { x: 668, y: 323 }, { x: 668, y: 323 }],
  ['KeyC', { x: 579, y: 401 }, { x: 579, y: 401 }],
  ['KeyC', { x: 677, y: 288 }, { x: 677, y: 288 }],
  ['KeyC', { x: 637, y: 376 }, { x: 637, y: 376 }],
  ['KeyC', { x: 681, y: 349 }, { x: 681, y: 349 }],
  ['KeyC', { x: 668, y: 374 }, { x: 668, y: 374 }],
  ['KeyC', { x: 708, y: 300 }, { x: 708, y: 300 }],
  ['KeyC', { x: 704, y: 333 }, { x: 704, y: 333 }],
  ['KeyC', { x: 697, y: 347 }, { x: 697, y: 347 }],
  ['KeyC', { x: 658, y: 396 }, { x: 658, y: 396 }],
  ['KeyC', { x: 686, y: 369 }, { x: 686, y: 369 }],
  ['KeyC', { x: 593, y: 430 }, { x: 593, y: 430 }],
  ['KeyC', { x: 682, y: 378 }, { x: 682, y: 378 }],
  ['KeyC', { x: 630, y: 422 }, { x: 630, y: 422 }],
  ['KeyC', { x: 720, y: 302 }, { x: 720, y: 302 }],
  ['KeyC', { x: 713, y: 344 }, { x: 713, y: 344 }],
  ['KeyC', { x: 711, y: 272 }, { x: 711, y: 272 }],
  ['KeyC', { x: 699, y: 373 }, { x: 699, y: 373 }],
  ['KeyC', { x: 726, y: 290 }, { x: 726, y: 290 }],
  ['KeyC', { x: 619, y: 440 }, { x: 619, y: 440 }],
  ['KeyC', { x: 733, y: 334 }, { x: 733, y: 334 }],
  ['KeyC', { x: 716, y: 370 }, { x: 716, y: 370 }],
  ['KeyC', { x: 722, y: 275 }, { x: 722, y: 275 }],
  ['KeyC', { x: 717, y: 263 }, { x: 717, y: 263 }],
  ['KeyC', { x: 709, y: 385 }, { x: 709, y: 385 }],
  ['KeyC', { x: 744, y: 308 }, { x: 744, y: 308 }],
  ['KeyC', { x: 747, y: 302 }, { x: 747, y: 302 }],
  ['KeyC', { x: 568, y: 472 }, { x: 568, y: 472 }],
  ['KeyC', { x: 751, y: 325 }, { x: 751, y: 325 }],
  ['KeyC', { x: 736, y: 272 }, { x: 736, y: 272 }],
  ['KeyM', { x: 537, y: 198 }, { x: 537, y: 198 }],
  ['KeyM', { x: 530, y: 187 }, { x: 530, y: 187 }],
];
const HIDES_YEAR_TAILOR = ['KeyT', { x: 517, y: 253 }];

/** The longest line the news can show, all 8 settlers named in one, as 5 lines of it fill the log. */
const READY_LONGEST_NEWS = 'Day 12, 17:56. Merek, Elsi, Ulvar, Ysa, Jorrin, Fenna, Dorran and Nella had a cold night.';
/**
 * The second house's anchor, (121, 127), in the near view after `COLD_NEAR_PAN`, placed from there so the camera
 * does not move: a drag back to the order view does not land on the same pixel, and its click once hit the woodshed.
 * `scripts/aim.ts` with the near view of `COLD_NEAR_PAN` puts the tile there and picks it.
 */
const READY_SECOND_HOUSE = { x: 298, y: 258 };
/** The window sizes at which the reading must keep clear of every other panel. */
const READY_SIZES = [CLIP, { width: 960, height: 600 }, WIDE];
/** The clip keeps the clock, the Stockpiles panel, the reading, the houses, the camp, and the house's panel at the bottom left, and leaves out the toolbar. */
const READY_CLIP = { crop: { x: 0, y: 0, width: 800, height: 490 }, width: 560, colors: 40, decimate: true, speed: 4 };

SCENARIOS.readiness = async (session) => {
  const { said } = siteDriver(session);
  const { reads, text, uiBoxes, click } = selectionDriver(session);
  const { lines } = hungerDriver(session);
  const at = async (page) => clockText(await session.gameMinutes(page));
  const play = await session.open(CLIP, { record: true, search: COLD_SEARCH, clock: 'paused' });
  const { page } = play;
  const away = () => page.mouse.move(CLIP.width - 5, CLIP.height - 5);
  const reading = () =>
    page.getByRole('status', { name: 'Winter readiness', includeHidden: true }).evaluate((node) => {
      const rows = {};
      for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
      return { shown: !node.hidden, title: node.querySelector('p')?.textContent.trim() ?? '', rows };
    });
  const readingText = (read) => (read.shown ? [read.title, ...Object.entries(read.rows).map(([name, value]) => `${name}: ${value}`)].join('; ') : 'hidden');
  const selectHouse = async (house) => {
    let read = null;
    for (const spot of house.clicks) {
      read = await click(page, spot);
      if (read?.title === 'House') break;
    }
    await away();
    await session.still(page);
    return read;
  };
  const place = async (key, pattern, spot) => {
    await page.keyboard.press(key);
    await page.mouse.move(spot.x, spot.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    const line = await said(page, pattern);
    await page.keyboard.press('Escape');
    await away();
    return line;
  };
  const heard = new Set();
  const listen = async () => {
    for (const line of await lines(page)) heard.add(line);
  };

  await takeForageView(session, page, COLD_ORDER_VIEW);
  await session.reach(page, READY_STOPS.orders);
  const orderedAt = await at(page);
  const given = [];
  for (const [key, tool, pattern, spots] of [
    ['KeyC', 'Chop', /^35 trees marked for felling/, COLD_ORDERS.chop],
    ['KeyM', 'Quarry', /^2 rock tiles marked for quarrying/, COLD_ORDERS.quarry],
    ['KeyP', 'Stockpile', /^9 tiles join the stockpile zone/, COLD_ORDERS.stockpile],
  ]) {
    await page.keyboard.press(key);
    await session.drag(page, ...spots);
    given.push({ tool, pattern, line: await said(page, pattern) });
    await page.keyboard.press('Escape');
  }
  given.push({ tool: 'Woodshed', pattern: /^Woodshed site placed/, line: await place('KeyK', /^Woodshed site placed/, COLD_ORDERS.shed) });
  given.push({ tool: 'House', pattern: /^House site placed/, line: await place('KeyH', /^House site placed/, COLD_ORDERS.houses[0]) });
  session.check(
    `at ${orderedAt} the orders mark 35 trees, 2 rock tiles, and 9 stockpile tiles, and place a woodshed site and one house site`,
    given.every(({ pattern, line }) => pattern.test(line)) &&
      (await page.getByRole('status', { name: 'House site' }).count()) === 1 &&
      (await at(page)) === orderedAt,
    `${given.map(({ tool, line }) => `${tool}: "${line}"`).join(', ')} at ${await at(page)}`,
  );
  const spring = await reading();
  session.check(`at ${orderedAt} in spring the reading of readiness is hidden`, !spring.shown, readingText(spring));
  await page.mouse.move(CLIP.width / 2, CLIP.height / 2);
  await page.mouse.wheel(0, COLD_CLOSER);
  await away();
  await session.still(page);
  await session.drag(page, COLD_NEAR_PAN.from, COLD_NEAR_PAN.to);
  await away();
  await session.still(page);

  await session.reach(page, READY_STOPS.summer);
  const summer = await reading();
  session.check(`at ${await at(page)}, the last evening of summer, the reading is hidden`, !summer.shown, readingText(summer));
  await session.reach(page, READY_STOPS.autumn);
  const autumn = await reading();
  session.check(
    `at ${await at(page)}, the first night of autumn, the reading shows with 3 cold nights to come and its four numbers`,
    autumn.shown && autumn.title === 'Winter readiness, 3 cold nights to come' &&
      ['Households in a house', 'Houses with firewood', 'Settlers in clothing', 'Cold tonight'].every((label) => label in autumn.rows),
    readingText(autumn),
  );

  await session.reach(page, READY_STOPS.second);
  await session.still(page);
  const first = await reading();
  await session.screenshot(page, 'readiness-autumn');
  session.check(
    `at ${await at(page)} on the first day of autumn, with one house stocked and 3 households at the camp, the reading counts 1 of 4 households housed, 1 of 1 houses with firewood, 0 of 8 in clothing, and 6 cold tonight, with the camp's fire lit`,
    first.rows['Households in a house'] === '1 of 4' && first.rows['Houses with firewood'] === '1 of 1' && first.rows['Settlers in clothing'] === '0 of 8' &&
      first.rows['Cold tonight'] === '6' && /^Lights, \d+ firewood$/.test(first.rows['Camp fire'] ?? ''),
    readingText(first),
  );
  const secondAt = await at(page);
  const secondLine = await place('KeyH', /^House site placed/, READY_SECOND_HOUSE);
  await session.still(page);
  session.check(
    `at ${secondAt} on day 7 the second house's site is placed with the clock paused`,
    /^House site placed/.test(secondLine) && (await page.getByRole('status', { name: 'House site' }).count()) === 1 && (await at(page)) === secondAt,
    `the status line reads "${secondLine}" at ${await at(page)}`,
  );

  let clipFrom = null;
  const follow = [];
  for (const stop of READY_STOPS.follow) {
    await session.reach(page, stop);
    clipFrom ??= play.since();
    const house = await selectHouse(COLD_SPOTS.houses[1]);
    const read = await reading();
    follow.push({ at: await at(page), house, read, firewood: house?.title === 'House' ? house.rows.Firewood : (house?.title ?? 'nothing') });
    if (read.rows['Houses with firewood'] === '2 of 2') break;
  }
  const clipTo = play.since();
  await session.screenshot(page, 'readiness-stocked');
  const followText = follow.map((step) => `${step.at}: house ${step.firewood}; ${step.read.rows['Households in a house']} housed, ${step.read.rows['Houses with firewood']} with firewood, ${step.read.rows['Cold tonight']} cold`).join(' | ');
  const finishedAt = follow.findIndex((step) => step.house?.title === 'House');
  const stockedAt = follow.findIndex((step) => step.read.rows['Houses with firewood'] === '2 of 2');
  session.check(
    'while the second house stands as a site the reading counts 1 of 1 houses; once finished, 2 of 4 households are housed and it counts 1 of 2 houses with firewood until its own holds 6',
    finishedAt > 0 &&
      follow.slice(0, finishedAt).every((step) => step.read.rows['Houses with firewood'] === '1 of 1' && step.read.rows['Households in a house'] === '1 of 4') &&
      follow.slice(finishedAt, stockedAt).every((step) => step.read.rows['Houses with firewood'] === '1 of 2' && step.read.rows['Households in a house'] === '2 of 4' && Number(/^(\d) of 6$/.exec(step.house.rows.Firewood)?.[1]) < 6),
    followText,
  );
  const last = follow[stockedAt];
  session.check(
    `at ${last?.at ?? 'no stop'} the last house holds 6 firewood and the reading counts 2 of 2 houses with firewood, and Cold tonight has fallen from 6 to 4`,
    Boolean(last) && last.house.rows.Firewood === '6 of 6' && last.read.rows['Cold tonight'] === '4' && last.read.rows['Households in a house'] === '2 of 4',
    followText,
  );
  await page.keyboard.press('Escape');
  await away();

  await session.reach(page, READY_STOPS.winterNoon);
  const noonHouse = await selectHouse(COLD_SPOTS.houses[1]);
  const noon = await reading();
  session.check(
    `at ${await at(page)}, the first winter day before any winter night, the house's panel reads No winter night yet beside its firewood`,
    noonHouse?.rows['Fire last night'] === 'No winter night yet' && /^\d of 6$/.test(noonHouse?.rows.Firewood ?? ''),
    `the panel reads "${text(noonHouse)}"; the reading "${readingText(noon)}"`,
  );
  await page.keyboard.press('Escape');
  await away();

  await session.reach(page, READY_STOPS.before);
  await session.still(page);
  const before = await reading();
  await listen();
  await page.keyboard.press('1');
  while ((await session.gameMinutes(page)) < clockMinutes(READY_STOPS.after) - COLD_WATCH_UNTIL) {
    await listen();
    await page.waitForTimeout(250);
  }
  await session.reach(page, READY_STOPS.after);
  await listen();
  const after = await reading();
  const namesIn = (list) => list.split(/, | and /);
  const told = [...new Set([...heard].flatMap((line) => namesIn(/^Day 10, \d\d:\d\d\. (.+) had a cold night\.$/.exec(line)?.[1] ?? '').filter(Boolean)))];
  session.check(
    `the ${before.rows['Cold tonight']} settlers the reading counts cold tonight at ${READY_STOPS.before.time} on day 10 are as many as the news names cold at that dusk`,
    before.rows['Cold tonight'] === '4' && told.length === 4,
    `the reading "${readingText(before)}"; heard ${[...heard].filter((line) => line.startsWith('Day 10,')).map((line) => `"${line}"`).join(', ') || 'nothing on day 10'}`,
  );
  session.check(
    `at ${await at(page)}, after the first winter dusk, the reading counts 2 cold nights to come and both houses still hold firewood for them`,
    after.title === 'Winter readiness, 2 cold nights to come' && after.rows['Houses with firewood'] === '2 of 2',
    readingText(after),
  );

  await session.reach(page, READY_STOPS.morning);
  const morning = await selectHouse(COLD_SPOTS.houses[1]);
  await session.screenshot(page, 'readiness-house-winter-morning');
  session.check(
    `at ${await at(page)}, the morning after the first winter night, the house's panel reads that its fire burned last night, beside its firewood`,
    morning?.rows['Fire last night'] === 'Burned' && /^\d of 6$/.test(morning?.rows.Firewood ?? ''),
    `the panel reads "${text(morning)}"`,
  );

  const layouts = [];
  for (const size of READY_SIZES) {
    await page.setViewportSize(size);
    await session.settle(page);
    const boxes = await uiBoxes(page);
    // The panel's max-height reads as an unresolved calc(), so the tallest box is measured with the panel stretched to it.
    const tallest = await page.getByRole('region', { name: 'Selection' }).evaluate((node) => {
      node.style.height = '100vh';
      const { x, y, width, height } = node.getBoundingClientRect();
      node.style.height = '';
      return { x, y, width, height };
    });
    await page.keyboard.press('KeyP');
    await said(page, /Drag over open ground/);
    boxes.status = await page.getByRole('status', { name: 'Order' }).boundingBox();
    await page.keyboard.press('Escape');
    // The news lines last 30 s of wall time, so the fullest log is a copy that holds its most lines at their longest.
    boxes.news = await page.getByRole('log', { name: 'Settlement news', includeHidden: true }).evaluate((node, line) => {
      const copy = node.cloneNode(false);
      copy.removeAttribute('aria-label');
      copy.hidden = false;
      for (let count = 0; count < 5; count++) copy.append(Object.assign(document.createElement('p'), { textContent: line }));
      node.after(copy);
      const { x, y, width, height } = copy.getBoundingClientRect();
      copy.remove();
      return { x, y, width, height };
    }, READY_LONGEST_NEWS);
    const { readiness, selection, ...rest } = boxes;
    const others = { ...rest, tallestSelection: tallest, selection };
    const disjoint = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    const inside = readiness && readiness.x >= 0 && readiness.y >= 0 && readiness.x + readiness.width <= size.width && readiness.y + readiness.height <= size.height;
    const describe = (box) => (box ? `${box.x.toFixed(0)},${box.y.toFixed(0)} ${box.width.toFixed(0)}x${box.height.toFixed(0)}` : 'missing');
    const ok = Boolean(inside) && Object.values(others).every((box) => !box || disjoint(readiness, box));
    const detail = [`readiness ${describe(readiness)}`, ...Object.entries(others).map(([name, box]) => `${name} ${describe(box)}`)].join('; ');
    layouts.push(detail);
    session.check(
      `at ${size.width}x${size.height} the reading, with its camp fire row, keeps clear of the clock, the toolbar, the Stockpiles panel, the camera hint, the status line, the house's panel, the news log with its 5 longest lines, and the tallest selection panel the page allows`,
      ok,
      detail,
    );
  }
  await page.setViewportSize(CLIP);
  await session.settle(page);
  await session.finishClips(play.context, page, [{ label: 'readiness-last-house', from: clipFrom, to: clipTo, ...READY_CLIP }]);

  const year = await session.open(CLIP, { search: '?seed=7', clock: 'paused' });
  const yearPage = year.page;
  await takeForageView(session, yearPage, HIDES_YEAR_VIEW);
  const giveYear = async (orders) => {
    const lines = [];
    for (const [key, from, to] of orders) {
      await yearPage.keyboard.press(key);
      if (to) await session.drag(yearPage, from, to);
      else {
        await yearPage.mouse.move(from.x, from.y, { steps: 3 });
        await yearPage.mouse.down();
        await yearPage.mouse.up();
      }
      lines.push(await said(yearPage, HIDES_YEAR_SAID[key]));
      await yearPage.keyboard.press('Escape');
    }
    await yearPage.mouse.move(CLIP.width - 5, CLIP.height - 5);
    return lines;
  };
  await session.reach(yearPage, READY_STOPS.orders);
  const yearAt = clockText(await session.gameMinutes(yearPage));
  const yearLines = await giveYear(HIDES_YEAR_ORDERS);
  const wrong = yearLines.filter((line, index) => !HIDES_YEAR_SAID[HIDES_YEAR_ORDERS[index][0]].test(line));
  const yearSites = await yearPage.getByRole('status', { name: /site$/ }).count();
  session.check(
    `at ${yearAt} the year's 6 sites stand as labels: the forager's hut, the barn, the hunter's lodge, two houses, and the woodshed`,
    yearSites === 6,
    `${yearSites} site labels`,
  );
  session.check(
    `at ${yearAt} the orders of the year "wood and hides" are given, ${HIDES_YEAR_ORDERS.length} of them, each as its status line says, with the clock paused`,
    wrong.length === 0 && clockText(await session.gameMinutes(yearPage)) === yearAt,
    wrong.length === 0 ? `${yearLines.length} orders, the last "${yearLines.at(-1)}", at ${clockText(await session.gameMinutes(yearPage))}` : `refused or unexpected: ${wrong.join(' | ')}`,
  );
  await session.reach(yearPage, READY_STOPS.tailor);
  const [tailorLine] = await giveYear([HIDES_YEAR_TAILOR]);
  session.check(`at ${clockText(await session.gameMinutes(yearPage))} the tailor's hut is placed`, /^Tailor's hut site placed/.test(tailorLine), `the status line reads "${tailorLine}"`);
  await session.reach(yearPage, READY_STOPS.yearRead);
  await session.still(yearPage);
  const yearRead = await yearPage.getByRole('status', { name: 'Winter readiness', includeHidden: true }).evaluate((node) => {
    const rows = {};
    for (const name of node.querySelectorAll('dt')) rows[name.textContent.trim()] = name.nextElementSibling?.textContent.trim() ?? '';
    return { shown: !node.hidden, title: node.querySelector('p')?.textContent.trim() ?? '', rows };
  });
  await session.screenshot(yearPage, 'readiness-wood-and-hides-autumn');
  session.check(
    `at ${clockText(await session.gameMinutes(yearPage))} on the first day of autumn in the year "wood and hides", the reading shows no household housed, no house, at most the tailor's first piece worn, all 8 cold, and the camp's fire out`,
    yearRead.shown && yearRead.rows['Households in a house'] === '0 of 4' && yearRead.rows['Houses with firewood'] === '0 of 0' &&
      /^[01] of 8$/.test(yearRead.rows['Settlers in clothing'] ?? '') && yearRead.rows['Cold tonight'] === '8' && yearRead.rows['Camp fire'] === 'Out, 0 of 4 firewood',
    readingText(yearRead),
  );
  await year.context.close();
  session.check('no page errors', play.errors.length === 0 && year.errors.length === 0, [...play.errors, ...year.errors].join(' | ') || 'none');
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
