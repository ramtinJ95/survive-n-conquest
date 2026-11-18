import type { SimFrame } from '../frame';
import type { Readiness } from '../sim/readiness';
import './readiness.css';

/** The panel's title, which names the cold nights still to come, that a house's firewood is counted against. */
export function readinessTitle(reading: Readiness): string {
  return `Winter readiness, ${reading.nights} cold night${reading.nights === 1 ? '' : 's'} to come`;
}

/** The reading's rows, as label and value. The camp's fire is a row only while a household sleeps at the camp. */
export function readinessRows(reading: Readiness): readonly (readonly [string, string])[] {
  const rows: [string, string][] = [
    ['Households in a house', `${reading.housed} of ${reading.households}`],
    ['Houses with firewood', `${reading.stocked} of ${reading.houses}`],
    ['Settlers in clothing', `${reading.clothed} of ${reading.settlers}`],
    ['Cold tonight', String(reading.cold)],
  ];
  const { camp } = reading;
  if (camp) rows.push(['Camp fire', camp.lights ? `Lights, ${camp.firewood} firewood` : `Out, ${camp.firewood} of ${camp.burns} firewood`]);
  return rows;
}

/**
 * The panel that says how ready the settlement is for the cold nights still to
 * come, from the first day of autumn to the last winter dusk, and is hidden
 * the rest of the year.
 */
export function mountReadiness(root: HTMLElement) {
  const panel = document.createElement('section');
  panel.className = 'readiness';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-label', 'Winter readiness');
  const title = document.createElement('p');
  title.className = 'readiness-title';
  title.textContent = 'Winter readiness';
  const list = document.createElement('dl');
  panel.append(title, list);
  panel.hidden = true;
  root.append(panel);
  let shown = '';

  return {
    heard({ readiness }: SimFrame) {
      panel.hidden = readiness === null;
      if (!readiness) return;
      const rows = readinessRows(readiness);
      const text = [readinessTitle(readiness), ...rows.flat()].join('|');
      if (text === shown) return;
      shown = text;
      title.textContent = readinessTitle(readiness);
      list.replaceChildren(
        ...rows.flatMap(([label, value]) => {
          const name = document.createElement('dt');
          name.textContent = label;
          const read = document.createElement('dd');
          read.textContent = value;
          return [name, read];
        }),
      );
    },
  };
}
