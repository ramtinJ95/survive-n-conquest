import { WebGLRenderer } from 'three';
import { createWorld } from './render/world';
import './ui/style.css';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.domElement.id = 'world';
document.body.append(renderer.domElement);

const { scene, camera } = createWorld(window.innerWidth / window.innerHeight);

function fitToWindow() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

fitToWindow();
window.addEventListener('resize', fitToWindow);
renderer.setAnimationLoop(() => renderer.render(scene, camera));
