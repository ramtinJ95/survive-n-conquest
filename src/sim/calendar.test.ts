import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, dateAt, seasonAt, seasonIndexAt, tickOfDay, tickOfSeason } from './calendar';

const DAY = TICKS_PER_DAY;
const YEAR = 12 * DAY;
/** The game opens at 08:00, a third of the way through day 1, so the first midnight is two thirds of a day in. */
const FIRST_MIDNIGHT = (DAY * 2) / 3;
/** The tick at which a day of the first year starts, where day 2 is the first whole day. */
const startOfDay = (day: number) => FIRST_MIDNIGHT + (day - 2) * DAY;

describe('dateAt', () => {
  it.each([
    ['the first tick', 0, { day: 1, year: 1, part: 'Early', season: 'Spring', minuteOfDay: 480 }],
    ['noon of the first day', DAY / 6, { day: 1, year: 1, part: 'Early', season: 'Spring', minuteOfDay: 720 }],
    ['the last tick of the first day', FIRST_MIDNIGHT - 1, { day: 1, year: 1, part: 'Early', season: 'Spring', minuteOfDay: 1439 }],
    ['the first tick of the second day', FIRST_MIDNIGHT, { day: 2, year: 1, part: 'Mid', season: 'Spring', minuteOfDay: 0 }],
    ['the last tick of spring', startOfDay(4) - 1, { day: 3, year: 1, part: 'Late', season: 'Spring', minuteOfDay: 1439 }],
    ['the first tick of summer', startOfDay(4), { day: 4, year: 1, part: 'Early', season: 'Summer', minuteOfDay: 0 }],
    ['the first tick of autumn', startOfDay(7), { day: 7, year: 1, part: 'Early', season: 'Autumn', minuteOfDay: 0 }],
    ['the first tick of winter', startOfDay(10), { day: 10, year: 1, part: 'Early', season: 'Winter', minuteOfDay: 0 }],
    ['the last tick of the first year', startOfDay(13) - 1, { day: 12, year: 1, part: 'Late', season: 'Winter', minuteOfDay: 1439 }],
    ['the first tick of the second year', startOfDay(13), { day: 13, year: 2, part: 'Early', season: 'Spring', minuteOfDay: 0 }],
    ['mid summer of the tenth year', 9 * YEAR + startOfDay(5) + DAY / 4, { day: 113, year: 10, part: 'Mid', season: 'Summer', minuteOfDay: 360 }],
  ])('reads %s', (_, tick, date) => {
    expect(dateAt(tick)).toEqual(date);
  });

  it('takes 300 seconds of 1x play for one day and an hour for one year', () => {
    expect(dateAt(300 * 10)).toEqual({ ...dateAt(0), day: 2, part: 'Mid' });
    expect(dateAt(3600 * 10)).toEqual({ ...dateAt(0), day: 13, year: 2 });
  });
});

describe('the parts of a date', () => {
  it.each([
    ['the first tick', 0, { ofDay: DAY / 3, ofSeason: DAY / 3, season: 'Spring', index: 0 }],
    ['the first midnight', FIRST_MIDNIGHT, { ofDay: 0, ofSeason: DAY, season: 'Spring', index: 0 }],
    ['the last tick of spring', startOfDay(4) - 1, { ofDay: DAY - 1, ofSeason: 3 * DAY - 1, season: 'Spring', index: 0 }],
    ['the first tick of summer', startOfDay(4), { ofDay: 0, ofSeason: 0, season: 'Summer', index: 1 }],
    ['noon of late winter', startOfDay(12) + DAY / 2, { ofDay: DAY / 2, ofSeason: 2.5 * DAY, season: 'Winter', index: 3 }],
    ['the first tick of the second year', startOfDay(13), { ofDay: 0, ofSeason: 0, season: 'Spring', index: 0 }],
  ])('agree with the date at %s', (_, tick, parts) => {
    expect({
      ofDay: tickOfDay(tick),
      ofSeason: tickOfSeason(tick),
      season: seasonAt(tick),
      index: seasonIndexAt(tick),
    }).toEqual(parts);
  });
});
