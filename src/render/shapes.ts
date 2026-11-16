import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  type Mesh,
  MeshLambertMaterial,
  type Object3D,
  Shape,
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

/** A unit of food, on the ground or in hands: a plain grain sack, with no model behind it. */
export const foodShape = (): BufferGeometry => colored(new BoxGeometry(0.34, 0.28, 0.3).translate(0, 0.14, 0), 0xc8a86b);

/**
 * The forager's hut, in meters: a low square of `courses` logs a side, of the
 * stockpiled logs' color, under a steep roof of eight sides in a darker shade
 * of the house's thatch. It is smaller than the house and its roof is a cone,
 * so the two tell apart at a glance.
 */
export const HUT_LOOK = { side: 1.7, log: 0.125, courses: 3, roof: 1.3, eave: 1.05, colors: { log: 0xd9b77e, timber: 0x5c3516, thatch: 0x7c5a25 } };

/** The forager's hut, with no model behind it, standing on the origin and centered on its footprint. */
export function hutShape(): BufferGeometry {
  const { side, log, courses, roof, eave, colors } = HUT_LOOK;
  const walls = 2 * log * courses;
  const along = side / 2 - log;
  const logs = Array.from({ length: courses }, (_, course) => {
    const y = log + 2 * log * course;
    const lengthwise = () => new CylinderGeometry(log, log, side + log, 6).rotateZ(Math.PI / 2);
    return [
      lengthwise().translate(0, y, along),
      lengthwise().translate(0, y, -along),
      lengthwise().rotateY(Math.PI / 2).translate(along, y, 0),
      lengthwise().rotateY(Math.PI / 2).translate(-along, y, 0),
    ];
  }).flat();
  return mergeGeometries([
    colored(new BoxGeometry(side - 2 * log, walls, side - 2 * log).translate(0, walls / 2, 0), colors.timber),
    ...logs.map((part) => colored(part, colors.log)),
    colored(new BoxGeometry(0.42, 0.6, 0.06).translate(0, 0.3, side / 2), colors.timber),
    colored(new ConeGeometry(eave, roof, 8).translate(0, walls + roof / 2, 0), colors.thatch),
  ]);
}

/**
 * The barn: red plank walls under a steep gable roof, with a pale door braced
 * with an X in its gable end, so it reads apart from the thatched house and
 * the round roof of the hut.
 */
export const BARN_LOOK = {
  width: 2.5,
  depth: 2.6,
  walls: 1.3,
  ridge: 2.25,
  roof: { thickness: 0.1, overhang: 0.18 },
  door: { width: 0.95, height: 1.05, brace: 0.07 },
  colors: { walls: 0x8e3b2a, roof: 0x4a3426, door: 0xe3d5b4, brace: 0x6b2a1e },
};

/** The barn, with no model behind it, standing on the origin and centered on its footprint, its door facing +z. */
export function barnShape(): BufferGeometry {
  const { width, depth, walls, ridge, roof, door, colors } = BARN_LOOK;
  const half = width / 2;
  const outline = new Shape();
  outline.moveTo(-half, 0);
  outline.lineTo(half, 0);
  outline.lineTo(half, walls);
  outline.lineTo(0, ridge);
  outline.lineTo(-half, walls);
  outline.closePath();
  const body = new ExtrudeGeometry(outline, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
  const rise = ridge - walls;
  const slope = Math.atan2(rise, half);
  const length = Math.hypot(half, rise) + roof.overhang;
  const plane = (side: 1 | -1) =>
    new BoxGeometry(length, roof.thickness, depth + 2 * roof.overhang)
      .translate(-side * (length / 2 - roof.overhang / 2), roof.thickness / 2, 0)
      .rotateZ(side * slope)
      .translate(0, ridge, 0);
  const front = depth / 2 + 0.02;
  const diagonal = Math.hypot(door.width, door.height);
  const brace = (turn: number) =>
    new BoxGeometry(diagonal, door.brace, 0.03).rotateZ(turn * Math.atan2(door.height, door.width)).translate(0, door.height / 2, front + 0.02);
  return mergeGeometries([
    colored(body, colors.walls),
    colored(plane(1), colors.roof),
    colored(plane(-1), colors.roof),
    colored(new BoxGeometry(door.width, door.height, 0.04).translate(0, door.height / 2, front), colors.door),
    colored(brace(1), colors.brace),
    colored(brace(-1), colors.brace),
  ]);
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
