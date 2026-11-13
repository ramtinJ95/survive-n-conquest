#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  if (result.status !== 0) fail(`ffmpeg ${args.join(' ')} failed: ${result.stderr ?? result.error}`);
  return result.stdout;
}

function pixel(png, x, y) {
  return [...ffmpeg(['-i', png, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function toGif(video, gif) {
  const palette = 'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer';
  ffmpeg(['-i', video, '-vf', palette, gif]);
  rmSync(video);
}

function createSession(browser, instance, dir, evidence) {
  const check = (name, ok, detail) => evidence.checks.push({ name, ok, detail });
  const capture = (file) => {
    evidence.files.push(file);
    return join(dir, file);
  };
  return {
    check,

    async open(viewport, { record = false } = {}) {
      const context = await browser.newContext({
        viewport,
        ...(record && { recordVideo: { dir, size: viewport } }),
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
      await page.goto(instance.url);
      await this.settle(page);
      return { context, page, errors };
    },

    async settle(page) {
      await page.locator(WORLD).waitFor();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    },

    async screenshot(page, label) {
      const path = capture(`${label}.png`);
      await page.screenshot({ path });
      return path;
    },

    async finishClip(context, page, label) {
      await page.close();
      await context.close();
      toGif(await page.video().path(), capture(`${label}.gif`));
    },

    async expectFillsViewport(page, viewport) {
      const box = await page.locator(WORLD).boundingBox();
      const fills = box?.x === 0 && box.y === 0 && box.width === viewport.width && box.height === viewport.height;
      check(`world fills ${viewport.width}x${viewport.height}`, fills, JSON.stringify(box));
    },

    expectSkyAndGround(png, viewport) {
      const x = Math.floor(viewport.width / 2);
      const sky = pixel(png, x, 4);
      const ground = pixel(png, x, viewport.height - 5);
      check('sky fills the top edge', distance(sky, SKY_RGB) < 12, `top ${sky}, sky ${SKY_RGB}`);
      const lit = distance(ground, SKY_RGB) > 40 && Math.max(...ground) > 40;
      check('lit ground fills the bottom edge', lit, `bottom ${ground}`);
    },
  };
}

const SCENARIOS = {
  async 'empty-scene'(session) {
    const wide = { width: 1280, height: 720 };
    const narrow = { width: 960, height: 600 };
    const { context, page, errors } = await session.open(wide, { record: true });
    await page.waitForTimeout(800);
    await session.expectFillsViewport(page, wide);
    session.expectSkyAndGround(await session.screenshot(page, 'empty-scene-1280x720'), wide);
    await page.setViewportSize(narrow);
    await session.settle(page);
    await page.waitForTimeout(800);
    await session.expectFillsViewport(page, narrow);
    session.expectSkyAndGround(await session.screenshot(page, 'empty-scene-960x600'), narrow);
    await page.setViewportSize(wide);
    await session.settle(page);
    await page.waitForTimeout(800);
    await session.finishClip(context, page, 'empty-scene-resize');
    session.check('no page errors', errors.length === 0, errors.join(' | ') || 'none');
  },
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
