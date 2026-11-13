import type { CameraDrive, CameraRig } from './cameraRig';

const KEYS: Record<string, [axis: keyof CameraDrive, sign: number]> = {
  KeyW: ['forward', 1],
  ArrowUp: ['forward', 1],
  KeyS: ['forward', -1],
  ArrowDown: ['forward', -1],
  KeyD: ['right', 1],
  ArrowRight: ['right', 1],
  KeyA: ['right', -1],
  ArrowLeft: ['right', -1],
  KeyQ: ['turn', 1],
  KeyE: ['turn', -1],
  KeyR: ['tilt', 1],
  KeyF: ['tilt', -1],
  KeyZ: ['zoom', 1],
  KeyX: ['zoom', -1],
};

/** The `buttons` value of a pointer event while only the main button is down. */
const PAN_BUTTONS = 1;
const RADIANS_PER_PIXEL = 0.005;
const ZOOM_PER_WHEEL_PIXEL = 0.0015;
const LINE_PIXELS = 16;

/**
 * Lets the player fly the camera. Keys pan, turn, tilt, and zoom while held. A
 * drag with the main button moves the ground, a drag with any other button
 * turns and tilts, and the wheel zooms.
 */
export function bindCameraInput(canvas: HTMLCanvasElement, rig: CameraRig): void {
  const held = new Set<string>();
  const steer = () => {
    for (const axis of Object.keys(rig.drive) as (keyof CameraDrive)[]) rig.drive[axis] = 0;
    for (const code of held) {
      const [axis, sign] = KEYS[code]!;
      rig.drive[axis] += sign;
    }
  };

  window.addEventListener('keydown', (event) => {
    if (!(event.code in KEYS) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    held.add(event.code);
    steer();
  });
  window.addEventListener('keyup', (event) => {
    if (held.delete(event.code)) steer();
  });
  window.addEventListener('blur', () => {
    held.clear();
    steer();
  });

  const last = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    last.x = event.clientX;
    last.y = event.clientY;
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last.x = event.clientX;
    last.y = event.clientY;
    if (event.buttons === PAN_BUTTONS) {
      const { across, into } = rig.groundPerPixel(canvas.clientHeight);
      rig.pan(-dx * across, dy * into);
    } else {
      rig.rotate(-dx * RADIANS_PER_PIXEL, dy * RADIANS_PER_PIXEL);
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE;
      const pixels = lines ? event.deltaY * LINE_PIXELS : event.deltaY;
      rig.zoom(Math.exp(pixels * ZOOM_PER_WHEEL_PIXEL));
    },
    { passive: false },
  );
}
