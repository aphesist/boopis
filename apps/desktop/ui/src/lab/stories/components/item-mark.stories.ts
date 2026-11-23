/* Item marks (components/item-mark.ts; docs/UI-COMPONENTS.md, Item marks): the tile of an installable thing, its 24px and 40px
   sizes, every service mark the kit carries, monograms, a publisher's name with its mark, and the item row the Store and Settings >
   Connectors list with (its states: an end word, attention, a long name, hover, focus, pressed). */
import { ui, serviceMarks } from '@boopis/ui';
import { forced, line, list, put, stage } from '../../story';
import type { State, Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const MOCK = { url: '/v6/design-system/index.html#icons', crop: '#icons' };
const NOTE = 'a design-system addition for the redesign of the Store and Connectors (23 November 2026): the v6 mock has no item marks';
const cmp = (id: string, title: string, covers: string[], states: Story['states']): Story => ({ id: 'components/' + id, title, area: 'components', kind: 'component', covers, mock: { ...MOCK, note: NOTE }, states });

const rowsTypical: State = stage(['typical', 'variant'], ({ root }) => {
  list(root, [
    ui.html.itemRow({ ref: { name: 'GitHub', collection: 'github' }, title: 'GitHub', sub: 'Connector · Repositories, issues, pull requests and Actions on GitHub.', end: 'needs a key', value: 'github' }),
    ui.html.itemRow({ ref: { name: 'Frontend Design', kind: 'plugin', publisher: 'Anthropic', proven: true }, title: 'Frontend Design', sub: 'Plugin by Anthropic · A frontend design skill.', end: 'installed', value: 'fd' }),
    ui.html.itemRow({ ref: { name: 'Supabase Postgres Best Practices', kind: 'skill', publisher: 'Supabase', proven: true }, title: 'Supabase Postgres Best Practices', sub: 'Skill by Supabase · Postgres performance and schema guidance.', value: 'sb' }),
    ui.html.itemRow({ ref: { name: 'Old sync', kind: 'engine-plugin' }, title: 'Old sync', sub: 'Engine plugin by Example Org · not reviewed · A sync plugin its source took down.', end: 'taken down', endTone: 'attention', value: 'old' }),
    ui.html.itemRow({ ref: { name: 'Lint kit', kind: 'plugin' }, title: 'Lint kit', sub: 'Plugin by Example Org · Runs a linter after each edit.', end: 'update', endTone: 'busy', value: 'lint' }),
    ui.html.itemRow({ ref: { name: 'Exa', collection: 'exa' }, title: 'Exa', sub: 'Connector · Web search and page fetching.', value: 'exa' })
  ].join(''), 560).setAttribute('data-ui', 'rows');
  ui.hydrate(root);
}, { width: 600 });

export default [
  cmp('item-mark', 'Item mark', ['ui.itemMark'], {
    typical: stage(['typical', 'variant'], ({ root }) => {
      line(root, ...serviceMarks().filter((m) => m.id !== 'google' && m.id !== 'anthropic' && m.id !== 'vercel' && m.id !== 'upstash' && m.id !== 'modelcontextprotocol').map((m) => ui.itemMark({ name: m.name, collection: ({ googlechrome: 'chrome-devtools', brave: 'brave-search' } as Record<string, string>)[m.id] ?? m.id })));
      line(root, ...['Anthropic', 'Vercel', 'Supabase', 'Google', 'Upstash', 'Model Context Protocol'].map((publisher) => ui.itemMark({ name: 'A skill', kind: 'skill', publisher, proven: true })));
      line(root, ...['Firecrawl', 'Context7', 'Frontend Design', 'Sequential Thinking', 'pdf', 'Release notes'].map((name) => ui.itemMark({ name, kind: 'skill' })));
    }, { width: 600, note: 'brand colours on a raised tile (owner decision, 23 November 2026): a connector\'s service, a skill\'s or plugin\'s proven publisher, else a monogram of the name; a colour under 3:1 on the tile takes the brand\'s black or white version' }),
    'publisher not proven': stage(['variant'], ({ root }) => { line(root, ui.itemMark({ name: 'Anthropic helpers', kind: 'skill', publisher: 'Anthropic', proven: false }), ui.itemMark({ name: 'Tips', kind: 'skill', publisher: 'github.com', proven: true })); }, { note: 'a publisher name the source did not prove, or a code host, keeps the monogram' }),
    sizes: stage(['size'], ({ root }) => { line(root, ui.itemMark({ name: 'GitHub', collection: 'github' }), ui.itemMark({ name: 'GitHub', collection: 'github', size: 40 }), ui.itemMark({ name: 'Release notes', kind: 'skill' }), ui.itemMark({ name: 'Release notes', kind: 'skill', size: 40 })); }),
    long: stage(['long'], ({ root }) => { line(root, ui.itemMark({ name: LONG_TITLE }), ui.itemMark({ name: UNBROKEN, size: 40 })); }, { note: 'a long name is still two letters' }),
    'no letters': stage(['empty'], ({ root }) => { line(root, ui.itemMark({ name: '—', collection: '' }), ui.itemMark({ name: '***', collection: 'boopis:sql-review', size: 40 })); }, { note: 'a name with no letter takes its letters from the id, else a question mark' })
  }),
  cmp('publisher', 'Publisher', ['ui.publisher'], {
    typical: stage(['typical'], ({ root }) => { for (const p of ['Anthropic', 'Vercel', 'Supabase', 'Google (Chrome DevTools)', 'Model Context Protocol (reference servers)', 'Matt Pocock']) put(root, ui.publisher(p)); }, { width: 360, note: 'the mark leads where the kit carries one; a publisher without one is its name alone' }),
    long: stage(['long'], ({ root }) => { put(root, ui.publisher('Anthropic'), ui.publisher(LONG_TITLE), ui.publisher(UNBROKEN)); }, { width: 240 })
  }),
  cmp('item-row', 'Item row', ['ui.itemRow'], {
    typical: rowsTypical, ...forced(rowsTypical, '.ui-row--item'),
    long: stage(['long'], ({ root }) => {
      list(root, ui.html.itemRow({ ref: { name: LONG_TITLE, kind: 'skill' }, title: LONG_TITLE, sub: 'Skill by ' + UNBROKEN + ' · ' + LONG_TITLE, end: 'needs 2 keys', value: 'long' }), 320).setAttribute('data-ui', 'rows');
      ui.hydrate(root);
    }, { width: 360, note: 'the title and the line are cut with an ellipsis; the whole text is the row\'s accessible name' }),
    empty: stage(['empty'], ({ root }) => { list(root, ui.html.itemRow({ ref: { name: 'Loose skill', kind: 'skill' }, title: 'Loose skill', sub: '', value: 'none' }), 320); }, { width: 360, note: 'an item whose source gave no summary and that needs nothing: its name alone, the row keeps its height' })
  })
];
