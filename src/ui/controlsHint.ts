import './controlsHint.css';

const CONTROLS = [
  ['W A S D', 'move'],
  ['Q E', 'turn'],
  ['R F', 'tilt'],
  ['Z X', 'zoom'],
  ['Drag', 'move'],
  ['Right-drag', 'turn'],
  ['Scroll', 'zoom'],
] as const;

/** Shows the camera controls and the seed of the map in a corner of the window. */
export function showControlsHint(seed: number): void {
  const hint = document.createElement('aside');
  hint.id = 'controls-hint';
  hint.setAttribute('aria-label', 'Camera controls');
  for (const [keys, action] of CONTROLS) {
    const entry = document.createElement('span');
    const key = document.createElement('kbd');
    key.textContent = keys;
    entry.append(key, ` ${action}`);
    hint.append(entry);
  }
  const label = document.createElement('span');
  label.className = 'seed';
  label.textContent = `Seed ${seed}`;
  hint.append(label);
  document.body.append(hint);
}
