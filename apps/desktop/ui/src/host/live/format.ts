/* How numbers read in the panels. Dollars are the plugin's (`ledger.stats`); this only prints them. */
export function kTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const k = n / 1000;
  return (k < 100 ? k.toFixed(1).replace(/\.0$/, '') : String(Math.round(k))) + 'k';
}
/** "$0.37"; a cost under a cent keeps its significant digits so a cheap turn is not shown as free */
export function dollars(v: number): string {
  if (v > 0 && v < 0.01) return '$' + v.toPrecision(2);
  return '$' + v.toFixed(2);
}
export const UNKNOWN_COST = 'unknown';
