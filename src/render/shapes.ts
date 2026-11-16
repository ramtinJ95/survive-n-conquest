import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  type Mesh,
  MeshLambertMaterial,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from '../../assets/models.json';

export type ShapeName = keyof typeof manifest.models;
const SHAPE_NAMES = Object.keys(manifest.models) as ShapeName[];

/**
 * Every shape the settlement is built from. Each is unshared triangles with a
 * color on every corner and no normals, in meters, standing on the origin and
 * centered on its footprint. A log lies along x.
 */
export type Shapes = Readonly<Record<ShapeName, BufferGeometry>>;

export interface Look {
  readonly shapes: Shapes;
  /** Why the game draws primitives in place of the models, for the player to read, or null when it draws the models. */
  readonly fallback: string | null;
}

/** The one material of everything built from `Shapes`: flat faces in their own colors, lit by the scene. */
export const shapeMaterial = () => new MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Strips a geometry down to unshared triangles in one color. */
export function colored(geometry: BufferGeometry, hex: number): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('normal');
  flat.deleteAttribute('uv');
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const color = new Color(hex);
  for (let corner = 0; corner < count; corner++) color.toArray(colors, corner * 3);
  return flat.setAttribute('color', new BufferAttribute(colors, 3));
}

/** The shapes the game drew before it had models, and still draws when the models are not installed. */
export function primitiveShapes(): Shapes {
  return {
    house: mergeGeometries([
      colored(new BoxGeometry(2.6, 1.9, 2.6).translate(0, 0.95, 0), 0xeadfc8),
      colored(new ConeGeometry(1.55 * Math.SQRT2, 1.4, 4).rotateY(Math.PI / 4).translate(0, 2.6, 0), 0x4b5363),
    ]),
    tent: colored(new ConeGeometry(0.8, 1.3, 4).rotateY(Math.PI / 4).translate(0, 0.65, 0), 0xd8d2c4),
    pot: colored(new CylinderGeometry(0.2, 0.15, 0.4, 6).translate(0, 0.2, 0), 0x3a3d42),
    fire: colored(new CylinderGeometry(0.45, 0.5, 0.12, 8).translate(0, 0.06, 0), 0x2b2724),
    barrel: colored(new CylinderGeometry(0.26, 0.26, 0.6, 8).translate(0, 0.3, 0), 0x7a5230),
    crate: colored(new BoxGeometry(0.5, 0.26, 0.5).translate(0, 0.13, 0), 0x9a7448),
    log: colored(new CylinderGeometry(0.15, 0.15, 0.9, 6).rotateZ(Math.PI / 2).translate(0, 0.15 * Math.cos(Math.PI / 6), 0), 0xd9b77e),
    stone: colored(new BoxGeometry(0.36, 0.36, 0.36).translate(0, 0.18, 0), 0xc9d1db),
  };
}

function plain(geometry: BufferGeometry): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const from = flat.getAttribute('color');
  const count = flat.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let corner = 0; corner < count; corner++) {
    colors[corner * 3] = from.getX(corner);
    colors[corner * 3 + 1] = from.getY(corner);
    colors[corner * 3 + 2] = from.getZ(corner);
  }
  return new BufferGeometry()
    .setAttribute('position', new BufferAttribute(Float32Array.from(flat.getAttribute('position').array), 3))
    .setAttribute('color', new BufferAttribute(colors, 3));
}

/** Takes the shapes out of a loaded models file, by the names in the manifest. Throws when the file lacks one. */
export function modelShapes(models: Object3D): Shapes {
  return Object.fromEntries(
    SHAPE_NAMES.map((name) => {
      const mesh = models.getObjectByName(name) as Mesh | undefined;
      if (!mesh?.geometry?.getAttribute('color')) throw new Error(`the models file has no colored mesh named "${name}"`);
      return [name, plain(mesh.geometry)];
    }),
  ) as Shapes;
}

const GLB_MAGIC = 0x46546c67;

/**
 * Reads the models file, or `null` when the server had none. A server that
 * answers every path with the page itself sends HTML here, which counts as
 * none. Without a file that holds every model, the game draws the primitives
 * and says why.
 */
export async function readShapes(file: ArrayBuffer | null): Promise<Look> {
  if (!file || file.byteLength < 4 || new DataView(file).getUint32(0, true) !== GLB_MAGIC) {
    return {
      shapes: primitiveShapes(),
      fallback: 'The models are not installed, so the game draws stand-in shapes. Clone the assets repository into game-assets/.',
    };
  }
  try {
    const { scene } = await new GLTFLoader().parseAsync(file, '');
    return { shapes: modelShapes(scene), fallback: null };
  } catch (error) {
    console.error(error);
    return {
      shapes: primitiveShapes(),
      fallback: `The models in game-assets/ do not match this build, so the game draws stand-in shapes: ${(error as Error).message}.`,
    };
  }
}

/** Fetches the models that the build serves beside the page. */
export async function loadShapes(): Promise<Look> {
  const file = await fetch(`${import.meta.env.BASE_URL}models.glb`)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .catch(() => null);
  return readShapes(file);
}
