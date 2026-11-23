// How late each order of a firewood year can be given before a settler dies: `bun scripts/firewood-room.ts <year> <order> [step hours] [max hours]`.
// It puts that one order off by each step in turn, the others as the year gives them, and prints one line for each delay.
// The order is an order's label in the year's rows, or `houses` for all four houses at once.
import { TICKS_PER_DAY } from '../src/sim/calendar';
import { PLANS, later, ordersOf, playYear, slackOf } from './firewood-years';

const [name = 'near-houses-late-shed', order = 'woodshed', stepHours = '2', maxHours = '96'] = process.argv.slice(2);
const plan = PLANS[name];
if (!plan) throw new Error(`no year named ${name}`);
const hour = TICKS_PER_DAY / 24;
const matches = (label: string) => (order === 'houses' ? label.startsWith('house ') : label === order);
if (!ordersOf(plan).some((o) => matches(o.label))) throw new Error(`no order ${order}; the orders are ${ordersOf(plan).map((o) => o.label).join(', ')}`);
let deaths = 0;
for (let hours = 0; hours <= Number(maxHours) && deaths < 3; hours += Number(stepHours)) {
  const orders = ordersOf(plan).map((o) => (matches(o.label) ? { ...o, when: later(o.when, hours * hour) } : o));
  try {
    const { row } = playYear({ title: name, orders });
    const given = row.given.flatMap((g) => {
      const [, time, label] = /^(d\d+ \d\d:\d\d) (.+?)(?: \(|: )/.exec(g) ?? [];
      return label && matches(label) ? [time!] : [];
    });
    const slack = slackOf(row);
    if (row.living < 8 || row.missed > 0 && row.died.length > 0) deaths += 1;
    console.log(
      `${order} +${hours} h | given ${[...new Set(given)].join(', ')} | living ${row.living} | meals ${row.meals} of ${row.mealsDue} | barn ${row.barnAtEnd} | ` +
        `least slack ${slack.least} | slack ${slack.byDusk.join('; ')} | winter arrivals ${row.winterArrivals.join(' ')} | fires ${row.fires.join(' ')} | died ${row.died.join('; ') || 'nobody'}`,
    );
  } catch (e) {
    console.log(`${order} +${hours} h | refused: ${(e as Error).message.split('refused at ')[1]?.slice(0, 120)}`);
    deaths += 1;
  }
}
