/* Item marks: what a store item or a connector is, at a glance (the owner, 23 November 2026: "we need more visuals. logos, right
   now it's just text"). One tile for every place that lists installable things (the Store's rows and its item page, Settings >
   Connectors, the session's Connectors section): the mark of the service a connector connects to; for a skill, plugin or mod, its
   publisher's mark when the source proves the publisher; else a monogram of its own name. A publisher's mark also sits beside
   the publisher's name (`publisherHTML`), as a model's mark sits beside a model's name.

   Design system addition (docs/UI-COMPONENTS.md, "Item marks"): the tile is a raised square (`--bg-3`, a `--hair` line) with a
   continuous corner (`data-sq`), 24px in a row's lead (two-line rows, `.ui-row--item`; a settings row's `lead`) and 40px at the
   head of an item's page; its corner is the floor at 24 and `--r-s` at 40. The mark is in its brand's colours (the owner, 23
   November 2026, ADR-0040 amended for these surfaces): `color.light` on the light presets' tile, `color.dark` on the dark ones',
   each the brand's own colour where it holds 3:1 there and its one-colour black or white version where it does not, chosen by
   the scheme through `light-dark()`. The monogram is one or two letters in the mono face, never a look-alike logo.

   Evidence, never a guess (invariant 5): a connector gets a service's mark only from what it is or runs (its id in boopis's
   collection, its address's host, the package or image it starts, a store item's home page host), as `vendor/service-marks/
   map.json` lists; a skill, plugin or mod gets its publisher's mark only when its source proved who published it and that name
   is listed exactly (a claimed name proves nothing: anyone can write "Anthropic" in a marketplace of their own). The marks
   are Simple Icons' files (CC0), unchanged (vendor/service-marks/README.md). The tile is always aria-hidden: it sits beside the
   name it stands for. */
import { esc } from '../core/dom';
import mapFile from '../vendor/service-marks/map.json';

interface MarkEntry {
  id: string; name: string; svg: string; color: { light: string; dark: string; why: string };
  connectors: readonly string[]; hosts: readonly string[]; packages: readonly string[]; publishers: readonly string[];
}
/** a mark and its colours: `light` on a light preset's tile, `dark` on a dark preset's */
export interface ServiceMark { id: string; name: string; viewBox: string; body: string; light: string; dark: string }

const FILES = import.meta.glob('../vendor/service-marks/svg/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const ENTRIES = (mapFile as unknown as { marks: MarkEntry[] }).marks;

/** the file's own path(s), drawn in currentColor: the viewBox and everything inside <svg> but its <title> */
function parse(entry: MarkEntry): ServiceMark | null {
  const raw = FILES['../vendor/service-marks/svg/' + entry.svg];
  if (!raw) return null;
  const view = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 24 24';
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(raw)?.[1] ?? '';
  return { id: entry.id, name: entry.name, viewBox: view, body: inner.replace(/<title>[\s\S]*?<\/title>/g, '').trim(), light: entry.color.light, dark: entry.color.dark };
}
const MARKS = new Map<string, ServiceMark>();
for (const e of ENTRIES) { const m = parse(e); if (m) MARKS.set(e.id, m); }

/** every mark the kit carries (the lab draws them all) */
export const serviceMarks = (): ServiceMark[] => [...MARKS.values()];
export const serviceMark = (id: string): ServiceMark | null => MARKS.get(id) ?? null;

/** what an installable thing says about itself, as far as the data goes */
export interface ItemRef {
  /** its own name: the monogram's letters */
  name: string;
  /** a store item's kind: only a connector can be a service; absent means a connector the host listed (Settings) */
  kind?: string | undefined;
  /** its id in boopis's connector collection (a collection entry's id, a curated store item's `boopis:<id>`, or an installed
      connector named as the collection named it) */
  collection?: string | null | undefined;
  /** what it runs: a remote server's address, or a local command and its arguments */
  url?: string | null | undefined; command?: string | null | undefined; args?: readonly string[] | undefined;
  /** a store item's home page */
  homepage?: string | null | undefined;
  /** who published it, and whether its source proved that (a store item's provenance: any namespace proof but none) */
  publisher?: string | null | undefined; proven?: boolean | undefined;
}

const hostOf = (u: string | null | undefined): string => {
  if (!u) return '';
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};
/** `@scope/name@1.2.3` and `name@1.2.3` to the name; `ghcr.io/owner/image@sha256:…` and `image:tag` to the image */
export function packageOf(arg: string): string {
  const a = arg.trim();
  if (!a || a.startsWith('-')) return '';
  if (a.startsWith('@')) { const at = a.indexOf('@', 1); return at > 0 ? a.slice(0, at) : a; }
  const at = a.indexOf('@'); const base = at > 0 ? a.slice(0, at) : a;
  const slash = base.lastIndexOf('/'), colon = base.lastIndexOf(':');
  return colon > slash ? base.slice(0, colon) : base;
}

/** the service a connector connects to, from the evidence in `ref`; null for anything else (it gets its monogram) */
export function serviceMarkOf(ref: ItemRef): ServiceMark | null {
  if (ref.kind && ref.kind !== 'connector') return null;
  const coll = (ref.collection ?? '').toLowerCase();
  const urlHost = hostOf(ref.url), homeHost = hostOf(ref.homepage);
  const pkgs = [ref.command ?? '', ...(ref.args ?? [])].map(packageOf).filter(Boolean);
  /* what it runs outranks what it is called: an address or a package that names another service, or none, decides */
  const runs = !!urlHost || pkgs.length > 0;
  for (const e of ENTRIES) {
    if (urlHost && e.hosts.includes(urlHost)) return MARKS.get(e.id) ?? null;
    if (pkgs.some((p) => e.packages.includes(p))) return MARKS.get(e.id) ?? null;
  }
  if (runs) return null;
  for (const e of ENTRIES) {
    if (coll && e.connectors.includes(coll)) return MARKS.get(e.id) ?? null;
    if (homeHost && e.hosts.includes(homeHost)) return MARKS.get(e.id) ?? null;
  }
  return null;
}

/** a publisher's mark, by the publisher's exact name (case aside); null when the kit carries none */
export function publisherMarkOf(publisher: string | null | undefined): ServiceMark | null {
  const p = (publisher ?? '').trim().toLowerCase();
  if (!p) return null;
  const e = ENTRIES.find((x) => x.publishers.some((n) => n.toLowerCase() === p));
  return e ? MARKS.get(e.id) ?? null : null;
}

/** what an item's tile shows: a connector's service, else a proven publisher's mark (a skill, plugin or mod), else nothing (the
    monogram); `of` says which, so the row's words can say "by" the publisher */
export function tileMarkOf(ref: ItemRef): { mark: ServiceMark; of: 'service' | 'publisher' } | null {
  const s = serviceMarkOf(ref);
  if (s) return { mark: s, of: 'service' };
  if (ref.kind && ref.kind !== 'connector' && ref.proven) { const p = publisherMarkOf(ref.publisher); if (p) return { mark: p, of: 'publisher' }; }
  return null;
}

const SMALL = new Set(['a', 'an', 'the', 'and', 'of', 'for', 'to', 'with', 'in', 'on', 'by']);
/** one or two letters from a name: the first letters of its first two words (small words skipped while others remain), one
    letter for a one-word name; from `fallback` (an id) when the name has no letter or digit. Deterministic: the same name always
    gives the same letters. */
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

export type ItemMarkSize = 24 | 40;
export interface ItemMarkOpts { size?: ItemMarkSize | undefined; class?: string | undefined }

/* the colours come from the map (data, like a bot's look), as two properties the stylesheet picks between by the scheme */
const svgOf = (m: ServiceMark, cls: string): string =>
  '<svg class="' + cls + '" viewBox="' + esc(m.viewBox) + '" fill="currentColor" data-brand style="--mk-l:' + esc(m.light) + ';--mk-d:' + esc(m.dark) + '" aria-hidden="true" focusable="false">' + m.body + '</svg>';

/** the tile: the service's mark, else the monogram */
export function itemMarkHTML(ref: ItemRef, o: ItemMarkOpts = {}): string {
  const size = o.size ?? 24, t = tileMarkOf(ref), m = t?.mark ?? null;
  const cls = 'ui-imark' + (m ? '' : ' ui-imark--mono') + (o.class ? ' ' + esc(o.class) : '');
  return '<span class="' + cls + '" data-sq data-size="' + String(size) + '"' + (t ? ' data-mark="' + esc(t.mark.id) + '" data-mark-of="' + t.of + '"' : '') + ' aria-hidden="true">' +
    (m ? svgOf(m, 'ui-imark__svg') : '<span class="ui-imark__ini">' + esc(monogram(ref.name, ref.collection ?? '')) + '</span>') + '</span>';
}

/** the publisher's name, with its mark first when the kit carries one and the source proved the publisher (`proven`, true unless
    said): one unit that never wraps apart */
export function publisherHTML(publisher: string, o: { class?: string; proven?: boolean } = {}): string {
  const m = o.proven === false ? null : publisherMarkOf(publisher);
  return '<span class="ui-pub' + (o.class ? ' ' + esc(o.class) : '') + '"' + (m ? ' data-mark="' + esc(m.id) + '"' : '') + '>' + (m ? svgOf(m, 'ui-pub__mark') : '') + '<span class="ui-pub__name">' + esc(publisher) + '</span></span>';
}
