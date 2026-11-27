/* Item marks: what a store item or a connector is, at a glance (the owner, 23 November 2026: "we need more visuals. logos, right
   now it's just text"). One tile for every place that lists installable things (the Store's rows and its item page, Settings >
   Connectors, the session's Connectors section): the mark of the service a connector connects to; for a skill or plugin, its
   publisher's mark when the source proves the publisher; a mod's glyph; else letters of its own name.

   The tile is the kit's ListRow item tile (`k7-lrow__mark`; the pane's Card row draws the mark alone): `itemTile` is what it holds,
   the one rule every row of an installable thing draws. The v6 tile (`ui-imark`) and publisher line (`ui-pub`) had no app users at
   step 9 of the repass and went. The mark is in its brand's colours (the owner, 23 November 2026, ADR-0040 amended for these
   surfaces): `color.light` on the light tiles, `color.dark` on the dark ones, each the brand's own colour where it holds 3:1 there,
   else its own hue with the lightness moved until it does, or the theme's ink (`--text`) for a one-colour brand (the owner, 27
   November 2026), chosen by the scheme through `light-dark()`. Letters are board 15's (`core/letters.ts`), never a look-alike logo.

   Evidence, never a guess (invariant 5): a connector gets a service's mark from what it runs when that names a listed service (its
   address's host, the package or image it starts), else from what it is called (its id in boopis's collection or its own name, as one
   key: `connectorKey`; the owner, 27 November 2026: an installed "github" shows GitHub's mark as the collection's row does) or a store
   item's home page host, as `vendor/service-marks/map.json` lists; a skill, plugin or mod gets its publisher's mark only when its source
   proved who published it and that name is listed exactly (a claimed name proves nothing: anyone can write "Anthropic" in a marketplace
   of their own). The marks are Simple Icons' files (CC0), unchanged (vendor/service-marks/README.md). The mark is always aria-hidden: it
   sits beside the name it stands for. */
import { esc } from '../core/dom';
import { letters } from '../core/letters';
import { icon } from './icons';
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

/** a connector's name or id as one key: case, a scope, separators and the words "mcp" and "server" aside ("GitHub", "github",
    "github-mcp", "@acme/github-mcp-server" are one; "Google Drive" and "google-drive" are one) */
export function connectorKey(name: string): string {
  const base = name.trim().toLowerCase().replace(/^boopis:/, '').replace(/^@[^/]+\//, '');
  const words = base.split(/[^a-z0-9]+/).filter((w) => w && w !== 'mcp' && w !== 'server');
  return words.join('');
}
const CONNECTOR_KEYS = new Map<string, ReadonlySet<string>>(ENTRIES.map((e) => [e.id, new Set(e.connectors.map(connectorKey))]));

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
  const coll = connectorKey(ref.collection ?? '');
  const urlHost = hostOf(ref.url), homeHost = hostOf(ref.homepage);
  const pkgs = [ref.command ?? '', ...(ref.args ?? [])].map(packageOf).filter(Boolean);
  /* what it runs outranks what it is called: an address or a package that names a listed service decides; one that names none
     leaves the name to decide (an installed "github" behind a proxy or a fork is still GitHub to the person who named it so) */
  for (const e of ENTRIES) {
    if (urlHost && e.hosts.includes(urlHost)) return MARKS.get(e.id) ?? null;
    if (pkgs.some((p) => e.packages.includes(p))) return MARKS.get(e.id) ?? null;
  }
  for (const e of ENTRIES) {
    if (coll && CONNECTOR_KEYS.get(e.id)?.has(coll)) return MARKS.get(e.id) ?? null;
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

/** one or two letters from a name: the one rule is core/letters.ts (the kit's ListRow tiles and this file's monogram tile) */
export { monogram } from '../core/letters';

/* the colours come from the map (data, like a bot's look), as two properties the stylesheet picks between by the scheme */
/* "ink": a one-colour brand drawn in the theme's text colour, so it follows the theme as the words beside it do */
const paint = (c: string): string => (c === 'ink' ? 'var(--text)' : esc(c));
const svgOf = (m: ServiceMark, cls: string): string =>
  '<svg class="' + cls + '" viewBox="' + esc(m.viewBox) + '" fill="currentColor" data-brand style="--mk-l:' + paint(m.light) + ';--mk-d:' + paint(m.dark) + '" aria-hidden="true" focusable="false">' + m.body + '</svg>';

/** the brand's mark alone, in its colours for the scheme, for a tile drawn elsewhere (the kit's ListRow item tile: the Store, Settings ›
    Connectors, the pane's connector rows; the owner, 27 November: "the real brand logos in colour"); null when there is no known mark
    (the tile then shows its letters) */
export function brandMarkHTML(ref: ItemRef): string | null {
  const t = tileMarkOf(ref);
  return t ? svgOf(t.mark, 'k7-brandmark').replace('<svg ', '<svg data-mark="' + esc(t.mark.id) + '" data-mark-of="' + t.of + '" ') : null;
}

/** what an item's tile in the kit's ListRow or Card row holds, the one rule for every place that lists installable things (the Store's
    rows, its item page and Installed, Settings › Connectors installed and from the collection, the pane's connector rows, the first
    run's offer): a mod's glyph; else its brand's mark in colour; else board 15's letters (`core/letters.ts`), from `letterName` when
    given (an installed connector from the collection is lettered by the collection's name) */
export function itemTile(ref: ItemRef, letterName?: string): { markHTML: string } | { markText: string } {
  if (ref.kind === 'mod') return { markHTML: icon('mod') };
  const m = brandMarkHTML(ref);
  return m ? { markHTML: m } : { markText: letters(letterName ?? ref.name) };
}
