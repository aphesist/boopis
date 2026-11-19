/* cron in plain words (pure, unit-tested) */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function cronWords(c: string | undefined): string {
  const t = (c ?? '').trim();
  if (!t) return 'only when asked';
  const p = t.split(/\s+/);
  if (p.length !== 5) return 'not a schedule yet: use five fields, minute hour day month weekday (0 9 * * 1-5 is weekdays at 09:00)';
  const [mi = '', h = '', dom = '', mon = '', dow = ''] = p, hh = (n: string | number): string => String(n).padStart(2, '0');
  if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'every ' + mi.slice(2) + ' minutes';
  if (/^\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return mi === '0' ? 'every hour' : 'every hour at :' + hh(mi);
  if (/^\d+$/.test(mi) && /^\*\/\d+$/.test(h) && dom === '*' && mon === '*' && dow === '*') return 'every ' + h.slice(2) + ' hours';
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && dom === '*' && mon === '*') {
    const time = hh(h) + ':' + hh(mi);
    if (dow === '*') return 'every day at ' + time;
    if (dow === '1-5') return 'weekdays at ' + time;
    if (dow === '0,6' || dow === '6,0') return 'weekends at ' + time;
    if (/^[0-6]$/.test(dow)) return DAYS[+dow] + 's at ' + time;
  }
  return 'custom: ' + t;
}
export const cronValid = (c: string | undefined): boolean => !/^not a/.test(cronWords(c));
export const CRON_PRESETS: ReadonlyArray<readonly [string, string]> = [['', 'Only when asked'], ['0 * * * *', 'Hourly'], ['0 2 * * *', 'Every night'], ['0 9 * * 1-5', 'Weekday mornings']];

/** A schedule as Hermes keeps it, in plain words. Hermes takes a cron expression, "every 2h", a delay ("30m": once, that
 *  long from now) or a timestamp; what is none of these is shown as it is, never guessed at. */
export function scheduleWords(schedule: string | null | undefined): string {
  const t = (schedule ?? '').trim();
  if (!t) return 'only when asked';
  if (t.split(/\s+/).length === 5) return cronWords(t);
  const unit = (u: string, n: number): string => { const w = /^m/i.test(u) ? 'minute' : /^h/i.test(u) ? 'hour' : 'day'; return w + (n === 1 ? '' : 's'); };
  const every = /^every\s+(\d+)\s*(m(?:in(?:ute)?s?)?|h(?:ours?|rs?)?|d(?:ays?)?)$/i.exec(t);
  if (every) { const n = Number(every[1]); return n === 1 ? 'every ' + unit(every[2] as string, n) : 'every ' + n + ' ' + unit(every[2] as string, n); }
  const once = /^(\d+)\s*(m(?:in(?:ute)?s?)?|h(?:ours?|rs?)?|d(?:ays?)?)$/i.exec(t);
  if (once) { const n = Number(once[1]); return 'once, in ' + n + ' ' + unit(once[2] as string, n); }
  return t;
}
