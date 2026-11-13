import { WebGLRenderer } from 'three';
import { bindCameraInput } from './render/cameraInput';
import { createWorld } from './render/world';
import { generateMap } from './sim/mapgen';
import { parseSeed } from './sim/seed';
import './ui/style.css';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.id = 'world';
document.body.append(renderer.domElement);

const map = generateMap(parseSeed(new URLSearchParams(window.location.search).get('seed')));
const { scene, rig } = createWorld(map);
const camera = rig.camera;
bindCameraInput(renderer.domElement, rig);

function fitToWindow() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

fitToWindow();
window.addEventListener('resize', fitToWindow);

const LONGEST_FRAME = 0.1;
let lastFrame = performance.now();
renderer.setAnimationLoop((now) => {
  rig.update(Math.min((now - lastFrame) / 1000, LONGEST_FRAME));
  lastFrame = now;
  renderer.render(scene, camera);
});
