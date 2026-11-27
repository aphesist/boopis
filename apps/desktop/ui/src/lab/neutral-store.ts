/* The lab's store on neutral words. The mock store serves the real built-in sources (apps/shared/data/store-sources.json, which the
   host compiles in) and the stories add boopis's real recommended list: both carry real repository addresses, and the recommended
   list real people's names as publishers. No story, screenshot or fixture shows those (the repass's rule, 27 November): this wraps a
   store so every address becomes an example.com one and a person's name an example publisher. The app's own mock is not changed. */
import type { StoreProvider } from '../data/provider';
import type { InstallPlan, InstallReceipt, StoreBrowse, StoreDetail, StoreItem, StorePin, StoreSource, UpdateDiff } from '../data/types';

/** an address on a code host, or any other web address that names a real place, as an example.com one with its last part kept */
export function neutralUrl(u: string): string {
  const m = /^(?:remote:)?(?:https?:\/\/)?(?:www\.)?(github\.com|gitlab\.com|registry\.modelcontextprotocol\.io|[\w-]+\.(?:dev|io|sh|com))(\/[^\s]*)?$/i.exec(u.trim());
  if (!m || /(^|\.)example\.(com|test)$/i.test(m[1] ?? '')) return u;
  const last = (m[2] ?? '').split('/').filter(Boolean).pop() ?? '';
  return (u.startsWith('remote:') ? 'remote:' : '') + 'https://example.com/plugins' + (last ? '/' + last : '');
}
/** every address inside a sentence (a source's description, the host's reason a read failed) */
export const neutralText = (t: string): string => t
  .replace(/\b(?:https?:\/\/)?(?:www\.)?github\.com(?:\/[\w./-]*)?/gi, (x) => neutralUrl(x).replace(/^https:\/\//, ''))
  .replace(/\b[\w.-]*\.github(?:usercontent)?\.com\b/gi, 'api.example.com')
  .replace(/\bregistry\.modelcontextprotocol\.io\b/gi, 'example.com/registry')
  .replace(/\bclaude-plugins-official\b/g, 'a marketplace');
/** a publisher written as a person's name (two or three capitalised words) is an example publisher; a company keeps its name */
const person = (p: string): boolean => /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/.test(p.trim()) && !/\b(Inc|Labs|Org|Tools|Systems)\b/.test(p);
const pin = (p: StorePin | null | undefined): StorePin | null => (p ? { ...p, ...(p.repo ? { repo: neutralUrl(p.repo) } : {}) } : null);
export function neutralItem<T extends StoreItem>(i: T): T {
  const publisher = person(i.publisher) ? 'Example Org' : i.publisher;
  return {
    ...i, publisher, homepage: i.homepage ? neutralUrl(i.homepage) : i.homepage, pinned: pin(i.pinned), hosts: { ...i.hosts, hosts: i.hosts.hosts.map(neutralText) },
    provenance: { ...i.provenance, publisher: person(i.provenance.publisher ?? '') ? 'Example Org' : i.provenance.publisher, pinned: pin(i.provenance.pinned) ?? i.provenance.pinned, source_url: i.provenance.source_url ? neutralUrl(i.provenance.source_url) : i.provenance.source_url }
  };
}
const source = (s: StoreSource): StoreSource => ({ ...s, ...(s.url ? { url: neutralUrl(s.url) } : {}), ...(s.description ? { description: neutralText(s.description) } : {}), ...(s.error ? { error: neutralText(s.error) } : {}), ...(s.note ? { note: neutralText(s.note) } : {}) });
const page = (b: StoreBrowse): StoreBrowse => ({ ...b, items: b.items.map(neutralItem), ...(b.recommended ? { recommended: b.recommended.map(neutralItem) } : {}) });
const plan = (p: InstallPlan): InstallPlan => ({ ...p, pinned: pin(p.pinned) ?? p.pinned });
const receipt = (r: InstallReceipt): InstallReceipt => r;
const map = <T, U>(w: { get(): T; subscribe(fn: (v: T) => void): () => void }, f: (v: T) => U): { get(): U; subscribe(fn: (v: U) => void): () => void } =>
  ({ get: () => f(w.get()), subscribe: (fn) => w.subscribe((v) => { fn(f(v)); }) });

/** the store with every address and person's name neutral, as the stories show it */
export function neutralStore(s: StoreProvider): StoreProvider {
  return {
    ...s,
    sources: map(s.sources, (l: readonly StoreSource[]) => l.map(source)),
    installed: map(s.installed, (l: readonly InstallReceipt[]) => l.map(receipt)),
    updates: map(s.updates, (l: readonly UpdateDiff[]) => l),
    browse: async (f, c) => page(await s.browse(f, c)),
    search: async (q, f, c) => page(await s.search(q, f, c)),
    detail: async (id): Promise<StoreDetail> => { const d = await s.detail(id); return { ...d, item: neutralItem(d.item) }; },
    review: async (id, sc) => { const r = await s.review(id, sc); return { ...r, plan: plan(r.plan) }; },
    reviewUpdate: async (id) => { const r = await s.reviewUpdate(id); return { ...r, plan: plan(r.plan) }; },
    refresh: async (id) => (await s.refresh(id)).map(source),
    addSource: async (input) => source(await s.addSource(input))
  };
}
