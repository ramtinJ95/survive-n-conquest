import { dateAt } from '../sim/calendar';
import type { SimFrame } from '../worker';
import './diedOut.css';

/** The page's address with a new random seed and every other setting kept. */
export function newMapAddress(address: string, seed: number): string {
  const url = new URL(address);
  url.searchParams.set('seed', String(seed));
  return url.toString();
}

/** Tells the player that the settlement has died out, on the day it did, and offers a new map. */
export function mountDiedOut(root: HTMLElement) {
  let shown = false;
  return {
    /** Takes in a frame from the worker. */
    heard(data: SimFrame) {
      if (!data.over || shown) return;
      shown = true;
      const dialog = document.createElement('section');
      dialog.className = 'died-out';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-label', 'The settlement has died out');
      dialog.setAttribute('aria-describedby', 'died-out-text');
      const title = document.createElement('h2');
      title.textContent = 'The settlement has died out';
      const text = document.createElement('p');
      text.id = 'died-out-text';
      text.textContent = `Nobody is left. The settlement died out on day ${dateAt(Math.max(data.tick - 1, 0)).day}.`;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'New map';
      button.addEventListener('click', () => {
        window.location.assign(newMapAddress(window.location.href, crypto.getRandomValues(new Uint32Array(1))[0]!));
      });
      dialog.append(title, text, button);
      root.append(dialog);
      button.focus();
    },
  };
}
