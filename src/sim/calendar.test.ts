import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, dateAt } from './calendar';

const DAY = TICKS_PER_DAY;
const YEAR = 12 * DAY;

describe('dateAt', () => {
  it.each([
    ['the first tick', 0, { day: 1, year: 1, part: 'Early', season: 'Spring', minuteOfDay: 0 }],
    ['noon of the first day', DAY / 2, { day: 1, year: 1, part: 'Early', season: 'Spring', minuteOfDay: 720 }],
    ['the last tick of the first day', DAY - 1, { day: 1, year: 1, part: 'Early', season: 'Spring', minuteOfDay: 1439 }],
    ['the first tick of the second day', DAY, { day: 2, year: 1, part: 'Mid', season: 'Spring', minuteOfDay: 0 }],
    ['the last tick of spring', 3 * DAY - 1, { day: 3, year: 1, part: 'Late', season: 'Spring', minuteOfDay: 1439 }],
    ['the first tick of summer', 3 * DAY, { day: 4, year: 1, part: 'Early', season: 'Summer', minuteOfDay: 0 }],
    ['the first tick of autumn', 6 * DAY, { day: 7, year: 1, part: 'Early', season: 'Autumn', minuteOfDay: 0 }],
    ['the first tick of winter', 9 * DAY, { day: 10, year: 1, part: 'Early', season: 'Winter', minuteOfDay: 0 }],
    ['the last tick of the first year', YEAR - 1, { day: 12, year: 1, part: 'Late', season: 'Winter', minuteOfDay: 1439 }],
    ['the first tick of the second year', YEAR, { day: 13, year: 2, part: 'Early', season: 'Spring', minuteOfDay: 0 }],
    ['mid summer of the tenth year', 9 * YEAR + 4 * DAY + DAY / 4, { day: 113, year: 10, part: 'Mid', season: 'Summer', minuteOfDay: 360 }],
  ])('reads %s', (_, tick, date) => {
    expect(dateAt(tick)).toEqual(date);
  });

  it('takes 300 seconds of 1x play for one day and an hour for one year', () => {
    expect(dateAt(300 * 10).day).toBe(2);
    expect(dateAt(3600 * 10).year).toBe(2);
  });
});
