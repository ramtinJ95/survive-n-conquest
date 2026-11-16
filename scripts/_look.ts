import { Building } from '../src/sim/buildings';
import { firstYearCommands, FIRST_YEAR_LOG_TREES } from '../src/sim/firstYear';
import { TileKind } from '../src/sim/map';
import { generateMap } from '../src/sim/mapgen';
import { siteRefusal } from '../src/sim/orders';
import { SETTLERS, applyCommand, createSim } from '../src/sim/sim';
const sim = createSim(generateMap(7), SETTLERS);
for (const c of firstYearCommands()) applyCommand(sim, c);
const { size } = sim.map; const cx = 127.5, cy = 127.5;
const ok: [number, number, number][] = [];
for (let y = 115; y < 141; y++) for (let x = 95; x < 150; x++) {
  const r = siteRefusal(sim.map, sim.orders, Building.Barn, x, y);
  if (!r) ok.push([x, y, Math.hypot(x + 0.5 - 137, y + 0.5 - 128)]);
}
ok.sort((a, b) => a[2] - b[2]); console.log('near hut', ok.slice(0, 8).map(([x, y, d]) => `(${x},${y}) ${d.toFixed(1)} camp ${Math.hypot(x + .5 - cx, y + .5 - cy).toFixed(1)}`));
console.log('far west', ok.filter(([x]) => x < 105).slice(0, 5).map(([x, y, d]) => `(${x},${y}) hut ${d.toFixed(1)} camp ${Math.hypot(x + .5 - cx, y + .5 - cy).toFixed(1)}`));
const used = new Set(FIRST_YEAR_LOG_TREES.map(([x, y]) => y * size + x));
const trees: [number, number, number][] = [];
for (let t = 0; t < size * size; t++) if (sim.map.trees[t] && sim.flow.next[t] !== -1 && !used.has(t)) { const x = t % size, y = Math.floor(t / size); trees.push([x, y, Math.hypot(x + .5 - cx, y + .5 - cy)]); }
trees.sort((a, b) => a[2] - b[2]); console.log('trees', trees.slice(0, 10).map(([x, y]) => `[${x}, ${y}]`).join(', '));
const rocks: [number, number, number][] = [];
for (let t = 0; t < size * size; t++) if (sim.map.kinds[t] === TileKind.Rock) { const x = t % size, y = Math.floor(t / size); rocks.push([x, y, Math.hypot(x + .5 - cx, y + .5 - cy)]); }
rocks.sort((a, b) => a[2] - b[2]); console.log('rocks', rocks.slice(0, 4).map(([x, y, d]) => `[${x}, ${y}] ${d.toFixed(1)}`).join(', '));
const houses: string[] = []; const taken: [number, number][] = [];
for (const [x, y] of [[121, 122], [121, 127], [121, 132], [117, 124], [117, 129], [125, 133], [125, 121]] as const) {
  const r = applyCommand(sim, { kind: 'place', building: Building.House, x, y });
  houses.push(`(${x},${y}) ${r?.ok ? 'ok' : JSON.stringify(r)}`);
}
console.log(houses.join(' | '));
console.log('trees 9-40', trees.slice(8, 40).map(([x, y]) => `[${x}, ${y}]`).join(', '));
