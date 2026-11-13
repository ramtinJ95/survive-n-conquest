import { dateAt } from '../sim/calendar';
import { type Command, SPEEDS, type Speed } from '../sim/sim';
import type { ClockSnapshot } from '../worker';

const SPEED_KEYS: Readonly<Record<string, Speed>> = { Digit1: 1, Digit2: 2, Digit3: 4, Digit4: 8 };

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.textContent = text;
  return node;
}

function setText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

function formatTime(minuteOfDay: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
}

function button(label: string, text: string, shortcut: string, onPress: () => void): HTMLButtonElement {
  const node = element('button', { type: 'button', 'aria-label': label, 'aria-keyshortcuts': shortcut, 'aria-pressed': 'false', title: `${label} (${shortcut})` }, text);
  // A pointer press must not keep focus, or the next Space would press this button again instead of pausing.
  node.addEventListener('mousedown', (event) => event.preventDefault());
  node.addEventListener('click', onPress);
  return node;
}

export function mountClock(root: HTMLElement, worker: Worker) {
  const send = (command: Command) => worker.postMessage(command);
  const togglePause = () => send({ kind: 'togglePause' });

  const date = element('p', { class: 'clock-date', role: 'status', 'aria-label': 'Date' });
  const time = element('p', { class: 'clock-time', role: 'timer', 'aria-label': 'Time of day' });
  const pause = button('Pause', '❚❚', 'Space', togglePause);
  const speeds = SPEEDS.map((speed, index) =>
    button(`Speed ${speed}×`, `${speed}×`, String(index + 1), () => send({ kind: 'setSpeed', speed })),
  );
  const controls = element('div', { class: 'clock-controls', role: 'group', 'aria-label': 'Game speed' });
  controls.append(pause, ...speeds);
  const panel = element('section', { class: 'clock', 'aria-label': 'Clock' });
  panel.append(time, date, controls);
  root.append(panel);

  worker.addEventListener('message', ({ data }: MessageEvent<ClockSnapshot>) => {
    const { day, part, season, year, minuteOfDay } = dateAt(data.tick);
    setText(date, `Day ${day} · ${part} ${season} · Year ${year}`);
    setText(time, formatTime(minuteOfDay));
    panel.toggleAttribute('data-paused', data.paused);
    pause.setAttribute('aria-pressed', String(data.paused));
    speeds.forEach((node, index) => node.setAttribute('aria-pressed', String(SPEEDS[index] === data.speed)));
  });

  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const speed = SPEED_KEYS[event.code];
    if (speed !== undefined) {
      send({ kind: 'setSpeed', speed });
    } else if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      togglePause();
    }
  });
}
