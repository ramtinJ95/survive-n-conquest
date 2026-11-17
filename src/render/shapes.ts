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

/** A split piece of firewood lying along x: a wedge, a third of a log cut lengthwise. */
const firewoodPiece = (length: number, radius: number) => new CylinderGeometry(radius, radius, length, 3).rotateZ(Math.PI / 2);

/** A unit of firewood, on the ground or in hands: three pale split pieces, two side by side and one on top, with no model behind it. */
export function firewoodShape(): BufferGeometry {
  const radius = 0.09;
  const piece = (x: number, y: number) => colored(firewoodPiece(0.48, radius).translate(0, y, x), 0xe8d2a2);
  return mergeGeometries([piece(-radius, radius / 2), piece(radius, radius / 2), piece(0, 1.4 * radius)]);
}

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

/**
 * The hunter's lodge: low walls of dark logs under a single-pitch roof of
 * hide that falls from the back to the door, with a hide stretched on a pole
 * frame beside the door. It is lower than the hut and its roof slopes one way,
 * so it reads apart from the house, the hut, and the barn.
 */
export const LODGE_LOOK = {
  side: 1.7,
  log: 0.1,
  front: 0.7,
  back: 1.3,
  roof: { thickness: 0.08, overhang: 0.16 },
  door: { width: 0.42, height: 0.56 },
  frame: { x: 0.52, width: 0.5, height: 0.72, pole: 0.05 },
  colors: { log: 0x6f5235, timber: 0x3f2a1a, roof: 0x4f3222, hide: 0xcfae80 },
};

/** The hunter's lodge, with no model behind it, standing on the origin and centered on its footprint, its door facing +z. */
export function lodgeShape(): BufferGeometry {
  const { side, log, front, back, roof, door, frame, colors } = LODGE_LOOK;
  const half = side / 2;
  // Drawn across the lodge with the door's side at -u, the outline turns a quarter about y so the door faces +z.
  const outline = new Shape();
  outline.moveTo(-half, 0);
  outline.lineTo(half, 0);
  outline.lineTo(half, back);
  outline.lineTo(-half, front);
  outline.closePath();
  const body = new ExtrudeGeometry(outline, { depth: side, bevelEnabled: false }).translate(0, 0, -half).rotateY(Math.PI / 2);
  const courses = Math.floor(front / (2 * log));
  const logs = Array.from({ length: courses }, (_, course) =>
    new CylinderGeometry(log, log, side + log, 6).rotateZ(Math.PI / 2).translate(0, log + 2 * log * course, half),
  );
  const slope = Math.atan2(back - front, side);
  const plane = new BoxGeometry(side + 2 * roof.overhang, roof.thickness, Math.hypot(side, back - front) + 2 * roof.overhang)
    .rotateX(slope)
    .translate(0, (front + back) / 2 + roof.thickness / 2, 0);
  const pole = (x: number) => new BoxGeometry(frame.pole, frame.height, frame.pole).translate(x, frame.height / 2, half + 0.12);
  return mergeGeometries([
    colored(body, colors.log),
    ...logs.map((part) => colored(part, colors.log)),
    colored(plane, colors.roof),
    colored(new BoxGeometry(door.width, door.height, 0.04).translate(-0.2, door.height / 2, half + log + 0.01), colors.timber),
    colored(pole(frame.x - frame.width / 2), colors.timber),
    colored(pole(frame.x + frame.width / 2), colors.timber),
    colored(new BoxGeometry(frame.width, frame.pole, frame.pole).translate(frame.x, frame.height - frame.pole / 2, half + 0.12), colors.timber),
    colored(new BoxGeometry(frame.width - frame.pole, frame.height - 0.22, 0.02).translate(frame.x, frame.height / 2 + 0.06, half + 0.12), colors.hide),
  ]);
}

/**
 * The woodshed: an open-fronted lean-to of dark posts under a single-pitch
 * roof that rises toward its open front, over a stack of pale split-log ends
 * that faces out. It has no walls on its front, so it reads apart from the
 * closed house, hut, barn, and lodge, and its roof falls the other way from the lodge's.
 */
export const WOODSHED_LOOK = {
  side: 1.8,
  post: 0.09,
  front: 1.3,
  back: 0.85,
  roof: { thickness: 0.07, overhang: 0.14 },
  stack: { width: 1.5, depth: 0.9, piece: 0.11, rows: 4 },
  colors: { timber: 0x4a3220, wall: 0x6e5034, roof: 0x5b4836, wood: 0xe8d2a2, backing: 0x8a6a45 },
};

/** The woodshed, with no model behind it, standing on the origin and centered on its footprint, its open side facing +z. */
export function woodshedShape(): BufferGeometry {
  const { side, post, front, back, roof, stack, colors } = WOODSHED_LOOK;
  const half = side / 2;
  const inner = half - post / 2;
  const postAt = (x: number, z: number, height: number) => new BoxGeometry(post, height, post).translate(x, height / 2, z);
  const posts = [postAt(-inner, inner, front), postAt(inner, inner, front), postAt(-inner, -inner, back), postAt(inner, -inner, back)];
  const slope = Math.atan2(front - back, side);
  const plane = new BoxGeometry(side + 2 * roof.overhang, roof.thickness, Math.hypot(side, front - back) + 2 * roof.overhang)
    .rotateX(-slope)
    .translate(0, (front + back) / 2 + roof.thickness / 2, 0);
  const across = Math.floor(stack.width / (2 * stack.piece));
  const pieces = Array.from({ length: across * stack.rows }, (_, index) => {
    const row = Math.floor(index / across);
    const column = index % across;
    const x = -stack.width / 2 + stack.piece * (2 * column + 1);
    const piece = firewoodPiece(stack.depth, stack.piece).rotateY(Math.PI / 2).rotateZ(index * 2.1);
    return colored(piece.translate(x, stack.piece * (1 + 1.7 * row), half - stack.depth / 2 - 0.02), colors.wood);
  });
  const stackHeight = stack.piece * (1.7 * stack.rows + 0.3);
  return mergeGeometries([
    colored(new BoxGeometry(side, back, 0.06).translate(0, back / 2, -half + 0.03), colors.wall),
    colored(new BoxGeometry(0.06, back, side).translate(-half + 0.03, back / 2, 0), colors.wall),
    colored(new BoxGeometry(0.06, back, side).translate(half - 0.03, back / 2, 0), colors.wall),
    ...posts.map((part) => colored(part, colors.timber)),
    colored(plane, colors.roof),
    colored(new BoxGeometry(stack.width, stackHeight, stack.depth - 0.06).translate(0, stackHeight / 2, half - stack.depth / 2 - 0.06), colors.backing),
    ...pieces,
  ]);
}

/**
 * A deer, about 1.2 m from nose to tail and facing +z: a tan-brown body on
 * four thin legs, a neck and head reaching forward and up, a pale tail, and
 * small antlers, so it reads as a deer and not as a settler from the game's camera.
 */
export const DEER_LOOK = {
  legs: 0.56,
  body: { width: 0.3, height: 0.34, length: 0.78 },
  colors: { coat: 0x9b6a3d, legs: 0x5e4129, tail: 0xf1e8d6, antler: 0xdccbaa, nose: 0x2c211a },
};

export function deerShape(): BufferGeometry {
  const { legs, body, colors } = DEER_LOOK;
  const back = legs + body.height;
  const leg = (x: number, z: number) => new BoxGeometry(0.07, legs, 0.07).translate(x, legs / 2, z);
  const antler = (side: 1 | -1) => [
    new BoxGeometry(0.03, 0.22, 0.03).rotateZ(side * -0.4).translate(side * 0.08, back + 0.5, 0.47),
    new BoxGeometry(0.025, 0.1, 0.025).rotateX(0.7).translate(side * 0.11, back + 0.53, 0.52),
  ];
  return mergeGeometries([
    colored(new BoxGeometry(body.width, body.height, body.length).translate(0, legs + body.height / 2, 0), colors.coat),
    ...[leg(-0.1, 0.28), leg(0.1, 0.28), leg(-0.1, -0.28), leg(0.1, -0.28)].map((part) => colored(part, colors.legs)),
    colored(new BoxGeometry(0.13, 0.4, 0.13).rotateX(0.55).translate(0, back + 0.1, 0.4), colors.coat),
    colored(new BoxGeometry(0.15, 0.15, 0.3).translate(0, back + 0.32, 0.55), colors.coat),
    colored(new BoxGeometry(0.08, 0.07, 0.04).translate(0, back + 0.3, 0.71), colors.nose),
    colored(new BoxGeometry(0.12, 0.14, 0.05).rotateX(-0.4).translate(0, back - 0.06, -body.length / 2 - 0.02), colors.tail),
    ...[...antler(1), ...antler(-1)].map((part) => colored(part, colors.antler)),
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
