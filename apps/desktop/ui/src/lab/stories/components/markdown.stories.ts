/* The markdown renderer (`ui.markdown`): what bots and agents write, drawn with the library's own parts. The same renderer draws
   the group room, a bot's own chat, Sessions and mods, so the states here are the ones every surface shares: blocks, inline
   styles, mentions (the bot's still orb in a capsule), links, a path the host found, fenced code (Copy, Wrap, folded past 14
   lines) and a table that scrolls sideways. `ui.copyText` is the Copy button's clipboard write. */
import { ui } from '@boopis/ui';
import type { MarkdownCtx, MdBot } from '@boopis/ui';
import { line, put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';

const BOTS: readonly MdBot[] = [
  { id: 'kai', name: 'kai', handle: 'kai', role: 'the lead', shape: 'circle', color: '#e8b04a', state: 'idle' },
  { id: 'nina', name: 'nina', handle: 'nina', role: 'research', shape: 'triangle', color: '#f23b5a', state: 'working' },
  { id: 'moss', name: 'moss', handle: 'moss', role: 'translation', shape: 'square', color: '#5aa7f2', state: 'idle' }
];
const CTX: MarkdownCtx = { mention: (h) => BOTS.find((b) => (b.handle ?? b.id).toLowerCase() === h.toLowerCase()) ?? null, everyone: BOTS };
const FIRST = [
  '**Research is in**, seven sources. The *hanging cauldron* is the household pot from about ~~1200~~ 1300 to 1450.',
  '',
  '- **Dates:** bronze for the rich, iron and clay for most',
  '- **Beat 3:** pottage was the daily meal ([household accounts](https://example.org/household-accounts-1340))',
  '  - grain, and what the garden gave',
  '',
  '> **After:** a pot hangs over the fire all day.',
  '',
  '### Next',
  '@nina check `episodes/cooking-pot/factcheck.md`, then @moss. @kai. is not a handle; @all please read it.'
].join('\n');
const CODE = ['```ts', ...Array.from({ length: 18 }, (_, i) => 'const beat' + (i + 1) + ' = prorateCents(invoice, ' + (i + 1) + '); // ' + LONG_TITLE), '```'].join('\n');
const SHORT_CODE = '```json\n{ "n": 5, "en": "A pot hangs over the fire all day." }\n```';
const TABLE = '| beat | en | pt | es |\n| --- | --- | --- | --- |\n| 5 | A pot hangs over the fire all day, and the cook adds whatever there is. | Um caldeirão fica sobre o fogo o dia todo. | Un caldero cuelga sobre el fuego todo el día. |';
const body = (text: string, ctx: MarkdownCtx = CTX) => ({ root }: { root: HTMLElement }): void => { const m = ui.markdown(text, ctx); m.style.maxWidth = '560px'; put(root, m); };

const typical = stage(['typical', 'variant'], body(FIRST), { width: 600, ground: 'frame' });

const story: Story = {
  id: 'components/markdown', title: 'Markdown', area: 'components', kind: 'component', covers: ['ui.markdown', 'ui.copyText'],
  states: {
    typical,
    'a path the host found': stage(['variant'], ({ root }) => {
      const m = ui.markdown('Saved in `episodes/cooking-pot/episode.json`, not in `nowhere/at/all.ts`.', CTX);
      ui.markdown.upgradePaths(m, new Map([['episodes/cooking-pot/episode.json', { path: 'episodes/cooking-pot/episode.json', abs: '/work/boopis/episodes/cooking-pot/episode.json', kind: 'file' as const }]]));
      put(root, m);
    }, { width: 600, ground: 'frame' }),
    'fenced code, folded': stage(['variant', 'scroll'], body(CODE), { width: 600, ground: 'frame', allow: { 'geometry.hscroll': 'fenced code scrolls sideways by default (R-scroll-7); Wrap turns it off' } }),
    'fenced code, short': stage(['variant'], body(SHORT_CODE), { width: 600, ground: 'frame' }),
    'a table': stage(['variant', 'scroll'], body(TABLE), { width: 420, ground: 'frame', allow: { 'geometry.hscroll': 'a wide table scrolls sideways inside its own area (R-scroll-7)' } }),
    'a mention of nobody': stage(['variant'], body('@nobody is not here, and `@nina` in code is code.'), { width: 600, ground: 'frame' }),
    empty: stage(['empty'], ({ root }) => { line(root, ui.markdown('', CTX)); }, { width: 600, ground: 'frame' }),
    long: stage(['long'], body('**' + LONG_TITLE + '** ' + UNBROKEN + ' https://billing-api.internal.example.com/v2/invoices/inv_01HZX9Q2Y7K3M8N4P6R5S0T1V2W3/reconcile?dry_run=true @kai'), { width: 320, ground: 'frame' })
  }
};
export default story;
