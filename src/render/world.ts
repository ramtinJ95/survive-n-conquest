import {
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from 'three';
import { DEFAULT_MAP_SIZE } from '../sim/map';

export const SKY_COLOR = 0x9fc9e8;
const GROUND_COLOR = 0x6b8f4e;

export function createWorld(aspect: number) {
  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);

  const ground = new Mesh(
    new PlaneGeometry(DEFAULT_MAP_SIZE, DEFAULT_MAP_SIZE),
    new MeshStandardMaterial({ color: GROUND_COLOR }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const sun = new DirectionalLight(0xfff4e0, 2);
  sun.name = 'sun';
  sun.position.set(-60, 100, 40);
  scene.add(sun);

  const camera = new PerspectiveCamera(50, aspect, 0.5, 2000);
  camera.position.set(0, 90, 140);
  camera.lookAt(0, 0, 0);

  return { scene, camera };
}
