import { WebGLRenderer } from 'three';
import { bindCameraInput } from './render/cameraInput';
import { createSwarm } from './render/swarm';
import { createWorld } from './render/world';
import { generateMap } from './sim/mapgen';
import { parseSeed } from './sim/seed';
import { BENCHMARK_POPULATION, type Population } from './sim/sim';
import { mountClock } from './ui/clock';
import { showControlsHint } from './ui/controlsHint';
import './ui/style.css';
import type { SimFrame, ToSim } from './worker';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.domElement.id = 'world';
document.body.append(renderer.domElement);

const params = new URLSearchParams(window.location.search);
const map = generateMap(parseSeed(params.get('seed')));
const population: Population = params.get('swarm') === 'off' ? { villagers: 0, monsters: 0 } : BENCHMARK_POPULATION;
const { scene, rig, show } = createWorld(map);
const swarm = createSwarm(map, population);
scene.add(...swarm.meshes);
const camera = rig.camera;
bindCameraInput(renderer.domElement, rig);
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
sim.addEventListener('message', ({ data }: MessageEvent<SimFrame>) => {
  tick = data.tick;
  swarm.show(data);
});
sim.postMessage({ kind: 'start', map, population } satisfies ToSim);
