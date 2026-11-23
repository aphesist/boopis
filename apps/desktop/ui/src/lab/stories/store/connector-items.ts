/* boopis's real connector collection (`apps/shared/data/connectors.json`) as the mock store's items, the way the host's
   `boopis_connectors` serves them (store/normalize.rs): the id `boopis:<id>`, the name, publisher, description, licence, the
   source repository as the home page, the categories as tags, the keys of every variant, recommended and checked on the
   collection's date. A hosted-only connector is pinned to its address (`remote:<url>`), as `curated_pin` does. Built from
   the file the host compiles in, so a story shows the owner's real list, not an invented one. */
import fixtureFile from '../../../../../../shared/data/store.fixtures.json';
import collectionFile from '../../../../../../shared/data/connectors.json';
import type { StoreItem, StoreSecret } from '../../../data/types';
import type { ConnectorCatalogEntry } from '../../../host/connectors-bridge';

interface Credential { id: string; title: string; env?: string; host?: string; optional?: boolean }
interface Variant { id: string; label: string; default?: boolean; summary: string; transport: string; url?: string; command?: string; args?: string[]; credentials?: Credential[]; network?: { egress?: string[] | string } }
interface Entry { id: string; name: string; publisher: string; description: string; homepage: string; source: string; license: string; categories: string[]; verified: { date: string; version?: string; package?: string }; variants: Variant[] }
const FX = (fixtureFile as unknown as { items: StoreItem[] }).items;
export const COLLECTION = (collectionFile as unknown as { connectors: Entry[] }).connectors;

function build(e: Entry): StoreItem {
  const tmpl = structuredClone(FX.find((i) => i.id === 'boopis:firecrawl') ?? FX[0]!);
  const secrets = new Map<string, StoreSecret>();
  for (const v of e.variants) for (const c of v.credentials ?? []) if (!secrets.has(c.id)) secrets.set(c.id, { id: c.id, title: c.title, ...(c.env ? { env: c.env } : {}), ...(c.host ? { host: c.host } : {}), optional: !!c.optional });
  const hosts = [...new Set(e.variants.flatMap((v) => (Array.isArray(v.network?.egress) ? v.network.egress : [])))].sort();
  const local = e.variants.find((v) => v.transport === 'stdio');
  const remote = e.variants.find((v) => v.url);
  const pinned = local ? { type: 'version' as const, value: e.verified.version ?? 'pinned' } : { type: 'version' as const, value: 'hosted', repo: 'remote:' + (remote?.url ?? '') };
  return {
    ...tmpl, id: 'boopis:' + e.id, kind: 'connector', title: e.name, publisher: e.publisher, summary: e.description, license: e.license, homepage: e.source,
    version: e.verified.version ?? null, pinned, tier: 'recommended', source: 'boopis', verified: e.verified.date, tags: e.categories,
    hosts: hosts.length ? { basis: 'verified', hosts } : { basis: 'unknown', hosts: [] }, secrets: [...secrets.values()], removed: null,
    provenance: { ...tmpl.provenance, source: 'boopis', publisher: e.publisher, namespace_proof: 'curated', pinned, source_url: e.source, last_updated: e.verified.date }
  };
}

const egressWords = (g: string[] | string | undefined): string =>
  Array.isArray(g) ? g.join(', ') : g === 'none' ? 'Nothing: it does not use the network' : g === 'loopback' ? 'Only this computer (127.0.0.1)' : g === 'any' ? 'Any host: it is not limited' : g ?? '';

/** the collection as store items, in the collection's own order (most GitHub stars first; the file says how) */
export const connectorItems = (): StoreItem[] => COLLECTION.filter((e) => e.id !== 'firecrawl').map(build);

/** the collection as Settings > Connectors' catalogue (the host's `connector_catalog`: one entry per connector, its variants) */
export function collectionCatalog(): ConnectorCatalogEntry[] {
  return COLLECTION.map((e) => ({
    id: e.id, name: e.name, publisher: e.publisher, description: e.description, license: e.license, verified: e.verified.date,
    /* as catalog.rs: the default first, the egress in the install form's words, the pin of a local package */
    variants: [...e.variants].sort((a, b) => Number(!!b.default) - Number(!!a.default)).map((v, i) => ({
      id: v.id, label: v.label, summary: v.summary, default: e.variants.some((x) => x.default) ? !!v.default : i === 0,
      reaches: egressWords(v.network?.egress),
      pinned: v.transport === 'stdio' && e.verified.package && e.verified.version && (v.args ?? []).includes(e.verified.package + '@' + e.verified.version) ? e.verified.package + '@' + e.verified.version : null
    }))
  }));
}
