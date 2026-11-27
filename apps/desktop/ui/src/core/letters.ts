/* An item's tile letters (board 15: "C7", "GH", "LN"): the one rule for the Store's rows and Settings › Connectors, so a connector
   shows the same two letters in both. Pure: no DOM. */

const SMALL = new Set(['a', 'an', 'the', 'and', 'of', 'for', 'to', 'with', 'in', 'on', 'by']);
/** one or two letters from a name: the first letters of its first two words (small words skipped while others remain), one
    letter for a one-word name; from `fallback` (an id) when the name has no letter or digit. The same name always gives the same
    letters. */
export function monogram(name: string, fallback = ''): string {
  const words = (s: string): string[] => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let w = words(name);
  if (!w.length) w = words(fallback.replace(/^[^:]*:/, ''));
  if (!w.length) return '?';
  const big = w.filter((x) => !SMALL.has(x.toLowerCase()));
  const use = big.length ? big : w;
  const first = (s: string): string => [...s][0] ?? '';
  return (first(use[0] ?? '') + (use.length > 1 ? first(use[1] ?? '') : '')).toUpperCase();
}

/** board 15's tile letters: two, from the first two words, or a one-word name's first letter and the next capital or digit, else its
    next consonant ("Context7" C7, "GitHub" GH, "Linear" LN). A connector installed from the collection is drawn under the collection's
    name (`letters(entry.name)`), so "github" and "GitHub" share one tile. */
export function letters(name: string): string {
  const m = monogram(name);
  if (m.length > 1 || !name.trim()) return m;
  const rest = [...name.trim().slice(1)];
  const next = rest.find((c) => /[A-Z0-9]/.test(c)) ?? rest.find((c) => /[bcdfghjklmnpqrstvwxz]/i.test(c)) ?? '';
  return (m + next).toUpperCase();
}
