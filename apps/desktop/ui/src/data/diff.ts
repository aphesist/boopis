/* A line diff for showing a change before it is saved (pure, unit-tested). Lines come out as the config diff card reads
   them: '+ added', '- removed', '  kept'; long runs of kept lines are cut to `context` lines each side and an ellipsis. */

/** the longest-common-subsequence table is quadratic: past this many lines each side the diff says the file is replaced */
const LIMIT = 2000;

export interface DiffOpts { context?: number }

export function lineDiff(before: string, after: string, opts: DiffOpts = {}): string {
  if (before === after) return '';
  const context = opts.context ?? 2;
  const a = split(before), b = split(after);
  if (a.length > LIMIT || b.length > LIMIT) return [...a.map((l) => '- ' + l), ...b.map((l) => '+ ' + l)].join('\n');
  const ops = diffOps(a, b);
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.t !== ' ') for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = true; });
  const out: string[] = [];
  let skipped = false;
  ops.forEach((o, i) => {
    if (keep[i]) { out.push(o.t + ' ' + o.l); skipped = false; } else if (!skipped) { out.push('  …'); skipped = true; }
  });
  return out.join('\n');
}
/** one line changed: the whole-value form for a single-line field (a role, a model) */
export const valueDiff = (before: string, after: string): string => (before === after ? '' : (before ? '- ' + before + '\n' : '') + '+ ' + after);

/** a text's lines; the empty text has none, and a trailing newline is not a line of its own */
function split(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}
interface Op { t: '+' | '-' | ' '; l: string }
function diffOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length, m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', l: a[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ t: '-', l: a[i]! }); i++; }
    else { ops.push({ t: '+', l: b[j]! }); j++; }
  }
  while (i < n) ops.push({ t: '-', l: a[i++]! });
  while (j < m) ops.push({ t: '+', l: b[j++]! });
  return ops;
}
