/* feedforward: how the agent reads decision words in the composer. The catalog (patterns, options, guesses) comes from
   the provider; this file is the reading itself: which words are decisions, what each is taken to mean, which ones
   were confirmed or dropped. */
import { data } from '../../data';
import type { DecisionKind, DecisionOption } from '../../data';

export interface Hit { kind: string; start: number; end: number; text: string }
interface Reading { value: string; confirmed: boolean; dropped: boolean }
export interface Mark { text: string; kind: string; confirmed: boolean }
export interface Item { label: string; kind: string; text: string }
export interface GovernanceView { governed: boolean; smart: boolean; model: string }

const catalog = (): readonly DecisionKind[] => data().feedforward.catalog();
const kindOf = (id: string): DecisionKind => catalog().find((k) => k.id === id) as DecisionKind;

/** the options of a path decision come from the path: this folder, the whole tree, with its tests */
function pathOptions(t: string): DecisionOption[] {
  const p = t.split('/'), o: DecisionOption[] = [{ value: t, label: t, mono: true, desc: 'Only this folder', assume: '>' + t }];
  if (p.length > 1) o.push({ value: p[0] as string, label: p[0] as string, mono: true, desc: 'The whole ' + p[0] + ' tree', assume: '>' + p[0] });
  o.push({ value: t + '+tests', label: t + ' and its tests', mono: true, desc: 'Tests may change too', assume: '>' + t + ' + tests' });
  return o;
}
export const optionsFor = (k: DecisionKind, text: string): readonly DecisionOption[] => k.options ?? pathOptions(text);
function guess(k: DecisionKind, text: string): string {
  for (const [re, v] of k.guess) if (new RegExp(re, 'i').test(text)) return v;
  return k.fallback === 'self' ? text : k.fallback;
}
/** the cost assumption: governed starts on a model, ungoverned pins one */
export function costAssume(g: GovernanceView, costVal: string | null): string {
  if (!g.governed) return '>ungoverned, pinned to ' + g.model;
  if (!g.smart) return '>governed starts on ' + g.model.split(' ')[0];
  const cost = kindOf('cost');
  return '>governed starts on ' + ((cost.options ?? []).find((x) => x.value === costVal) ?? (cost.options ?? [])[0])?.start;
}

export function makeReader(gov: () => GovernanceView) {
  const readings = new Map<string, Reading>();
  function hits(text: string): Hit[] {
    const out: Hit[] = [];
    for (const k of catalog()) {
      const re = new RegExp(k.pattern, 'gi'); let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const mm = m;
        if (out.some((h) => mm.index < h.end && mm.index + mm[0].length > h.start)) continue;
        out.push({ kind: k.id, start: m.index, end: m.index + m[0].length, text: m[0] });
        if (k.single) break;
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }
  function reading(kind: string, text: string): Reading {
    const key = kind + '|' + text.toLowerCase();
    let r = readings.get(key);
    if (!r) { r = { value: guess(kindOf(kind), text), confirmed: false, dropped: false }; readings.set(key, r); }
    return r;
  }
  return {
    reading,
    clear: (): void => readings.clear(),
    marks: (text: string): Mark[] => hits(text).filter((h) => !reading(h.kind, h.text).dropped).map((h) => ({ text: h.text, kind: h.kind, confirmed: reading(h.kind, h.text).confirmed })),
    /* the assumptions, as items for the composer's row: each points back to the word it reads */
    items(text: string): Item[] {
      const out: Item[] = []; let cost: string | null = null, costHit: Hit | null = null;
      const hs = hits(text);
      hs.forEach((h) => {
        const r = reading(h.kind, h.text); if (r.dropped) return;
        if (h.kind === 'cost') { cost = r.value; costHit = h; return; }
        const o = optionsFor(kindOf(h.kind), h.text).find((x) => x.value === r.value);
        if (o && o.assume && !out.some((x) => x.label === o.assume)) out.push({ label: o.assume, kind: h.kind, text: h.text });
      });
      const g = gov();
      if (catalog().length && (hs.length || !g.governed || !g.smart)) out.push({ label: costAssume(g, cost), kind: costHit ? 'cost' : 'governance', text: costHit ? (costHit as Hit).text : '' });
      /* a live build reads decisions with the mock's catalog only as a preview, and says so on the row */
      if (out.length && data().info.live) out.push({ label: '>preview: not read by the agent', kind: 'preview', text: '' });
      return out;
    }
  };
}
export type Reader = ReturnType<typeof makeReader>;
export { kindOf };
