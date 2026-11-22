/* boopis's real recommended skills and plugins (`apps/shared/data/recommended.json`) as the mock store's items, for the stories that
   show the front page the way the host serves it: each kind most used first, the kinds taking turns, and the page of each item
   saying which count placed it and when it was read. Built from the same file the host compiles in, so a story shows what the
   owner would see, not an invented list. */
import fixtureFile from '../../../../../../shared/data/store.fixtures.json';
import listFile from '../../../../../../shared/data/recommended.json';
import type { StoreItem } from '../../../data/types';

interface Entry { id: string; name: string; publisher: string; description: string; license: string; repo: string; subdir?: string; commit: string; version?: string; categories: string[]; verified: { date: string }; popularity: { shown: string } }
interface List { popularity: { skills: { read: string }; plugins: { read: string } }; skills: Entry[]; plugins: Entry[] }
const FX = (fixtureFile as unknown as { items: StoreItem[] }).items;
const LIST = listFile as unknown as List;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateWords = (d: string): string => { const [y, m, day] = d.split('-'); return `${String(Number(day))} ${MONTHS[Number(m) - 1] ?? ''} ${y ?? ''}`; };

function build(kind: 'skill' | 'plugin', e: Entry, read: string): StoreItem {
  const tmpl = FX.find((i) => i.kind === kind && i.tier === 'recommended') ?? FX[0]!;
  const item = structuredClone(tmpl);
  const pinned = { type: 'commit' as const, value: e.commit, repo: e.repo };
  const dir = kind === 'skill' ? 'skills' : 'plugins';
  const home = `${e.repo}/tree/${e.commit}${e.subdir ? '/' + e.subdir : ''}`;
  const counted = kind === 'skill' ? `${e.popularity.shown} installs on skills.sh` : `${e.popularity.shown} installs in Anthropic's plugin directory`;
  return {
    ...item, id: `boopis:${dir}/${e.id}`, kind, title: e.name, publisher: e.publisher, summary: e.description, license: e.license, homepage: home,
    version: e.version ?? null, pinned, tier: 'recommended', source: 'boopis', verified: e.verified.date, tags: e.categories,
    components: kind === 'skill' ? { ...item.components, known: true, skills: 1, hooks: 0, scripts: 0 } : { ...item.components, known: false, skills: 0, hooks: 0, scripts: 0 },
    provenance: {
      ...item.provenance, source: 'boopis', publisher: e.publisher, namespace_proof: 'github', pinned, tree_sha256: null, source_url: home,
      last_updated: e.verified.date, source_tier: `checked by boopis and placed by its popularity: ${counted}, read ${dateWords(read)}`
    }
  };
}

/** the plugins and the skills, each most used first, taking turns (plugin, skill, plugin, skill, ...) as the host weaves them */
export function recommendedItems(): StoreItem[] {
  const plugins = LIST.plugins.map((e) => build('plugin', e, LIST.popularity.plugins.read));
  const skills = LIST.skills.map((e) => build('skill', e, LIST.popularity.skills.read));
  const out: StoreItem[] = [];
  for (let n = 0; n < Math.max(plugins.length, skills.length); n++) { if (plugins[n]) out.push(plugins[n]!); if (skills[n]) out.push(skills[n]!); }
  return out;
}
