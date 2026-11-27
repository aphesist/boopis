/* ListRow (21.2 row 17; LAB-v7: session, bot, item, compact; rest, hover, current, needs you, working, long title). */
import { itemTile, kit, serviceMarks } from '@boopis/ui';
import { fill, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import { BOOPIS, KAI, LONG_BOT, MOSS, NINA, ORB3_MOTION } from '../../../lab/stories/kit/_bots';

const all = (): HTMLElement => {
  const w = document.createElement('div'); w.className = 'k7-list'; w.setAttribute('role', 'listbox'); w.setAttribute('aria-label', 'Rows');
  for (const r of [
    kit.listRow({ variant: 'session', title: 'Fix the flaky billing test', sub: 'boopis · 12 min', current: true }),
    kit.listRow({ variant: 'session', title: 'Release 0.2.0', sub: 'running', working: true }),
    kit.listRow({ variant: 'session', title: 'Deploy to staging', sub: 'waiting', needs: true, count: '1' }),
    kit.listRow({ variant: 'bot', title: 'kai', sub: 'Writing the changelog', bot: KAI, working: true }),
    kit.listRow({ variant: 'bot', title: 'nina', needs: 'Needs you: approve a deploy', bot: { ...NINA, state: 'needs', attention: 'approval' } }),
    kit.listRow({ variant: 'bot', title: 'moss', sub: 'asleep', bot: MOSS }),
    kit.listRow({ variant: 'compact', title: 'Deploy to staging', sub: 'nina asks to run the deploy', needs: true, count: '1' })
  ]) w.append(r);
  return w;
};
/** the Bots list as board K02 draws it; `current` marks the open one */
const botsList = (current = 'room'): HTMLElement => kit.list({ label: 'Bots', rows: [
  { variant: 'head', title: 'boopis', bot: BOOPIS, ink: true, current: current === 'boopis' },
  { variant: 'bot', title: 'kai', sub: 'Writing the changelog', bot: { ...KAI, state: 'working' }, working: true },
  { variant: 'bot', title: 'nina', needs: 'Needs you: approve a deploy', bot: { ...NINA, state: 'needs', attention: 'approval' } },
  { variant: 'bot', title: 'moss', sub: 'Found 2 flaky tests', bot: MOSS },
  { variant: 'bot', title: 'hex', sub: 'Asleep', bot: { ...MOSS, id: 'hex', name: 'hex', shape: 'hexagon', color: '#a6a6ab', state: 'sleeping' } },
  { variant: 'bot', title: 'release crew', sub: 'nina: the deploy is ready', leadHTML: kit.html.avatar({ variant: 'stack', members: [KAI, NINA, MOSS], size: 24, surface: '--bg-1', max: 4 }), current: current === 'room' }
] });
export default {
  id: 'kit/list-row', title: 'ListRow', area: 'components', kind: 'component', covers: ['kit.listRow', 'kit.list'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, all()); }, { width: 380, allow: { 'orb.edges': ORB3_MOTION } }),
    hover: stage(['hover'], ({ root }) => { fill(root, all()); }, { width: 380, force: [{ sel: '[data-kit~="ListRow"]', state: 'hover' }], allow: { 'orb.edges': ORB3_MOTION } }),
    long: stage(['long'], ({ root }) => {
      fill(root, kit.list({ label: 'Long rows', rows: [{ variant: 'session', title: 'Reconcile the invoices against the ledger before the quarterly close', sub: '/home/someone/code/billing' },
        { variant: 'bot', title: LONG_BOT.name, sub: 'Watching the staging deploy and its health checks', bot: LONG_BOT }] }));
    }, { width: 300 }),
    items: stage(['variant'], ({ root }) => { fill(root, kit.list({ label: 'Store', rows: [{ variant: 'item', title: 'GitHub', sub: 'Pull requests, issues and checks', markText: 'GH', action: 'Install' }, { variant: 'item', title: 'Linear', sub: 'Issues and projects', markText: 'LN', action: 'Install' }] })); }, { width: 380 }),

    /* board K02: the Bots list. The main bot at 44 over its name, rows of 28 orbs (working, needs you with the amber dot, at rest, asleep), a room's row with its members' stack */
    'the Bots list (board K02)': stage(['variant', 'owner'], ({ root }) => { fill(root, botsList()); }, { width: 300, allow: { 'orb.edges': ORB3_MOTION } }),
    'the Bots list: a row hovered, the head hovered': stage(['hover'], ({ root }) => { fill(root, botsList()); }, { width: 300, force: [{ sel: '[data-variant="bot"]:nth-child(3)', state: 'hover' }, { sel: '[data-variant="head"]', state: 'hover' }], allow: { 'orb.edges': ORB3_MOTION } }),
    'the Bots list: focus': stage(['focus'], ({ root }) => { fill(root, botsList()); }, { width: 300, force: [{ sel: '[data-variant="bot"]:nth-child(2)', state: 'focus' }], allow: { 'orb.edges': ORB3_MOTION } }),
    'the Bots list: pressed': stage(['active'], ({ root }) => { fill(root, botsList()); }, { width: 300, force: [{ sel: '[data-variant="bot"]:nth-child(2)', state: 'active' }], allow: { 'orb.edges': ORB3_MOTION } }),
    'the Bots list: the main bot open': stage(['variant'], ({ root }) => { fill(root, botsList('boopis')); }, { width: 300, allow: { 'orb.edges': ORB3_MOTION } }),
    'the Bots list: narrow, long names': stage(['long', 'size'], ({ root }) => {
      fill(root, kit.list({ label: 'Bots', rows: [
        { variant: 'head', title: 'boopis-the-one-that-runs-the-whole-team', bot: BOOPIS, ink: true },
        { variant: 'bot', title: LONG_BOT.name, needs: 'Needs you: approve the deploy of 0.2.0 to staging before five', bot: { ...LONG_BOT, state: 'needs', attention: 'approval' } },
        { variant: 'bot', title: 'release crew with a long name', sub: 'cassiopeia-staging-deploy-guardian: the deploy is ready', leadHTML: kit.html.avatar({ variant: 'stack', members: [KAI, NINA, MOSS, LONG_BOT, KAI], size: 24, surface: '--bg-1', max: 4 }) }] }));
    }, { width: 220 }),
    'no rows': stage(['empty'], ({ root }) => { fill(root, kit.list({ label: 'Bots', rows: [] })); }, { width: 300 }),
    /* an item's tile holds the kit's one rule (`itemTile`: the owner, 27 November, conflict 30): every brand mark the kit carries in its
       colour for the theme, a proven publisher's mark, a mod's glyph, and board 15's letters where no mark is known */
    'items: every brand mark': stage(['variant', 'many'], ({ root }) => {
      const ids: Record<string, string> = { googlechrome: 'chrome-devtools', brave: 'brave-search' };
      fill(root, kit.list({ label: 'Marks', rows: serviceMarks().filter((m) => !['google', 'anthropic', 'upstash'].includes(m.id)).map((m) => ({ variant: 'item' as const, title: m.name, sub: m.id, ...itemTile({ name: m.name, collection: ids[m.id] ?? m.id }) })) }));
    }, { width: 380 }),
    'items: publishers, a mod, letters': stage(['variant'], ({ root }) => {
      const rows = [
        { title: 'Frontend design', sub: 'Anthropic', ref: { name: 'Frontend design', kind: 'skill', publisher: 'Anthropic', proven: true } },
        { title: 'Release notes', sub: 'a claimed publisher', ref: { name: 'Release notes', kind: 'skill', publisher: 'Anthropic', proven: false } },
        { title: 'Pomodoro band', sub: 'a mod', ref: { name: 'Pomodoro band', kind: 'mod' } },
        { title: 'Context7', sub: 'no mark known', ref: { name: 'Context7', collection: 'context7' } },
        { title: 'Playwright', sub: 'no mark known', ref: { name: 'Playwright', collection: 'playwright' } }
      ];
      fill(root, kit.list({ label: 'Store', rows: rows.map((r) => ({ variant: 'item' as const, title: r.title, sub: r.sub, ...itemTile(r.ref) })) }));
    }, { width: 380 }),
    'archived: items with Restore': stage(['variant'], ({ root }) => { fill(root, kit.list({ label: 'Archived', rows: [{ variant: 'item', title: 'ledger', sub: 'Archived yesterday', action: 'Restore' }, { variant: 'item', title: 'night shift', sub: 'Group of kai and moss', markHTML: '', action: 'Restore' }] })); }, { width: 300 })
  }
} satisfies Story;
