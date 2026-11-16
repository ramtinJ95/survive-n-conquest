import { WebGLRenderer } from 'three';
import { bindCameraInput } from './render/cameraInput';
import { createSelectionMark } from './render/selectionMark';
import { loadShapes } from './render/shapes';
import { createSwarm } from './render/swarm';
import { tone } from './render/tone';
import { createWorld } from './render/world';
import { TICKS_PER_SECOND } from './sim/calendar';
import { generateMap } from './sim/mapgen';
import { parseSeed } from './sim/seed';
import { populationFor } from './sim/sim';
import { mountClock } from './ui/clock';
import { showControlsHint } from './ui/controlsHint';
import { mountOrders } from './ui/orders';
import { mountSelection } from './ui/selection';
import { mountSiteLabels } from './ui/sites';
import { mountStockpiles } from './ui/stockpiles';
import './ui/style.css';
import type { SimFrame, ToSim } from './worker';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
tone(renderer);
renderer.domElement.id = 'world';
document.body.append(renderer.domElement);

const params = new URLSearchParams(window.location.search);
const map = generateMap(parseSeed(params.get('seed')));
const population = populationFor(params.get('swarm'));
const look = await loadShapes();
const { scene, rig, show, camp, changeTiles, orders, marks, changeOrders } = createWorld(map, look.shapes);
const swarm = createSwarm(map, population, look.shapes, camp);
scene.add(...swarm.meshes);
const mark = createSelectionMark(map);
scene.add(...mark.meshes);
const camera = rig.camera;
showControlsHint(map.seed);
if (look.fallback) {
  const notice = document.createElement('p');
  notice.className = 'models-notice';
  notice.setAttribute('role', 'status');
  notice.textContent = look.fallback;
  document.body.append(notice);
  console.warn(look.fallback);
}

function fitToWindow() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

fitToWindow();
window.addEventListener('resize', fitToWindow);

const LONGEST_FRAME = 0.1;
let lastFrame = performance.now();
let tick = 0;
let ticksPerMs = 0;
let lastTickAt = lastFrame;
renderer.setAnimationLoop((now) => {
  rig.update(Math.min((now - lastFrame) / 1000, LONGEST_FRAME));
  lastFrame = now;
  toolbar.follow();
  show(tick, tick + Math.min(Math.max((now - lastTickAt) * ticksPerMs, 0), 1));
  selection.follow();
  renderer.render(scene, camera);
  siteLabels.follow();
});

const sim = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
mountClock(document.body, sim);
const toolbar = mountOrders(document.body, sim, { map, orders, canvas: renderer.domElement, camera, marks });
const selection = mountSelection(document.body, {
  map,
  orders,
  camp,
  canvas: renderer.domElement,
  camera,
  mark,
  mainButtonPans: toolbar.mainButtonPans,
});
const stockpiles = mountStockpiles(document.body, map, orders.claims);
const siteLabels = mountSiteLabels(document.body, map, orders, camera);
bindCameraInput(renderer.domElement, rig, toolbar.mainButtonPans);
sim.addEventListener('message', ({ data }: MessageEvent<SimFrame>) => {
  if (data.tick !== tick) lastTickAt = performance.now();
  tick = data.tick;
  ticksPerMs = data.paused ? 0 : (data.speed * TICKS_PER_SECOND) / 1000;
  changeTiles(data.tiles);
  changeOrders(data.orders);
  toolbar.heard(data);
  selection.heard(data);
  stockpiles.heard(data);
  siteLabels.heard(data);
  swarm.show(data);
});
sim.postMessage({ kind: 'start', map, population } satisfies ToSim);
