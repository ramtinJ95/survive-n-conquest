import { WebGLRenderer } from 'three';
import { bindCameraInput } from './render/cameraInput';
import { createSwarm } from './render/swarm';
import { createWorld } from './render/world';
import { generateMap } from './sim/mapgen';
import { parseSeed } from './sim/seed';
import { populationFor } from './sim/sim';
import { mountClock } from './ui/clock';
import { showControlsHint } from './ui/controlsHint';
import { mountOrders } from './ui/orders';
import './ui/style.css';
import type { SimFrame, ToSim } from './worker';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.domElement.id = 'world';
document.body.append(renderer.domElement);

const params = new URLSearchParams(window.location.search);
const map = generateMap(parseSeed(params.get('seed')));
const population = populationFor(params.get('swarm'));
const { scene, rig, show, changeTiles, orders, marks, changeOrders } = createWorld(map);
const swarm = createSwarm(map, population);
scene.add(...swarm.meshes);
const camera = rig.camera;
showControlsHint(map.seed);

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
renderer.setAnimationLoop((now) => {
  rig.update(Math.min((now - lastFrame) / 1000, LONGEST_FRAME));
  lastFrame = now;
  show(tick);
  renderer.render(scene, camera);
});

const sim = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
mountClock(document.body, sim);
const toolbar = mountOrders(document.body, sim, { map, orders, canvas: renderer.domElement, camera, marks });
bindCameraInput(renderer.domElement, rig, toolbar.mainButtonPans);
sim.addEventListener('message', ({ data }: MessageEvent<SimFrame>) => {
  tick = data.tick;
  changeTiles(data.tiles);
  changeOrders(data.orders);
  toolbar.heard(data);
  swarm.show(data);
});
sim.postMessage({ kind: 'start', map, population } satisfies ToSim);
