import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, type PerspectiveCamera, Vector3 } from 'three';
import { type TileMap, heightAt } from '../sim/map';

/** Where the mark goes: a ring of this radius in meters around a map position in tiles. */
export interface MarkPlace {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

const SEGMENTS = 64;
const LIFT = 0.06;
const ACCENT = { meters: 0.08, pixels: 3 };
const EDGE = { meters: 0.05, pixels: 2 };
/** A mark at the farthest zoom still stands this many pixels out from what it marks. */
const MIN_RADIUS_PX = 12;

function ring(color: string, renderOrder: number): Mesh<BufferGeometry, MeshBasicMaterial> {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3));
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  const material = new MeshBasicMaterial({
    color,
    toneMapped: false,
    fog: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/**
 * A ring on the ground around the selected thing: an accent band over a dark
 * band, so it reads on snow and on grass, by day and at night. Each point of the
 * ring follows the ground, so a house in front hides its back arc.
 */
export function createSelectionMark(map: TileMap) {
  const dark = ring('#1b1f26', 1);
  const accent = ring('#ffd27a', 2);
  const half = map.size / 2;
  const center = new Vector3();

  const lay = (mesh: Mesh, x: number, y: number, inner: number, outer: number) => {
    const position = mesh.geometry.getAttribute('position') as BufferAttribute;
    const array = position.array as Float32Array;
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (let side = 0; side < 2; side++) {
        const r = side === 0 ? inner : outer;
        const px = x + r * cos;
        const py = y + r * sin;
        const at = (i * 2 + side) * 3;
        array[at] = px - half;
        array[at + 1] = heightAt(map, px, py) + LIFT;
        array[at + 2] = py - half;
      }
    }
    position.needsUpdate = true;
    mesh.visible = true;
  };

  return {
    meshes: [dark, accent] as const,
    /** Lays the mark around a place, or hides it for null. Call once a frame, after the camera moved and before the scene renders. */
    show(place: MarkPlace | null, camera: PerspectiveCamera, viewportHeight: number): void {
      if (!place) {
        dark.visible = false;
        accent.visible = false;
        return;
      }
      const { x, y } = place;
      camera.updateMatrixWorld();
      center.set(x - half, heightAt(map, x, y), y - half).applyMatrix4(camera.matrixWorldInverse);
      const depth = Math.max(-center.z, camera.near);
      const perMeter = viewportHeight / (2 * depth * Math.tan((camera.fov * Math.PI) / 360));
      const radius = Math.max(place.radius, MIN_RADIUS_PX / perMeter);
      const band = Math.max(ACCENT.meters, ACCENT.pixels / perMeter) / 2;
      const edge = Math.max(EDGE.meters, EDGE.pixels / perMeter);
      lay(dark, x, y, radius - band - edge, radius + band + edge);
      lay(accent, x, y, radius - band, radius + band);
    },
  };
}
