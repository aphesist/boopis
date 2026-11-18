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
