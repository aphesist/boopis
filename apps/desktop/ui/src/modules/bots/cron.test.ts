import { describe, expect, it } from 'vitest';
import { cronValid, cronWords, scheduleWords } from './cron';

describe('cron in plain words', () => {
  it.each([
    ['', 'only when asked'], ['0 * * * *', 'every hour'], ['15 * * * *', 'every hour at :15'], ['*/30 * * * *', 'every 30 minutes'], ['0 */4 * * *', 'every 4 hours'],
    ['0 2 * * *', 'every day at 02:00'], ['0 9 * * 1-5', 'weekdays at 09:00'], ['30 8 * * 0,6', 'weekends at 08:30'], ['0 9 * * 1', 'mondays at 09:00'], ['0 18 * * 5', 'fridays at 18:00']
  ])('%j reads as %s', (cron, words) => { expect(cronWords(cron)).toBe(words); });
  it('a schedule that is not five fields says what is missing', () => {
    expect(cronWords('0 9 * *')).toMatch(/^not a schedule yet/);
    expect(cronValid('0 9 * *')).toBe(false);
    expect(cronValid('0 9 * * 1-5')).toBe(true);
    expect(cronValid('')).toBe(true);
  });
  it('a valid but unusual schedule is shown as custom', () => { expect(cronWords('5 4 1 * *')).toBe('custom: 5 4 1 * *'); });
});

describe('a schedule as Hermes keeps it', () => {
  it.each([
    ['0 9 * * 1-5', 'weekdays at 09:00'], ['every 2h', 'every 2 hours'], ['every 1 hour', 'every hour'], ['every 15m', 'every 15 minutes'], ['every 3 days', 'every 3 days'],
    ['30m', 'once, in 30 minutes'], ['1h', 'once, in 1 hour'], ['2026-12-01T09:00:00', '2026-12-01T09:00:00'], ['', 'only when asked']
  ])('%j reads as %s', (s, words) => { expect(scheduleWords(s)).toBe(words); });
});
