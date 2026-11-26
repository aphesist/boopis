/* Menu (21.2 row 5; LAB-v7: menu, quick menu, palette /, @, $, snooze, split-button menu, option menu; open, a row hover, a row
   focus, long names (truncate), flipped near the bottom). */
import { kit, ui } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';
import { KAI, NINA } from './_bots';

const STEPS = [
  { label: 'Supervised', meaning: 'Asks before every change', ticks: { of: 4, on: 1 } },
  { label: 'Auto-accept edits', meaning: 'Edits files, asks before commands', ticks: { of: 4, on: 2 }, chosen: true },
  { label: 'Trusted', meaning: 'Runs what the gate allows', ticks: { of: 4, on: 3 } },
  { label: 'Full access', meaning: 'Never asks', ticks: { of: 4, on: 4 } }
];
const menu = (): HTMLElement => kit.menu({ label: 'Session', entries: [
  { label: 'Rename', icon: 'pen' }, { label: 'Fork', icon: 'fork', keys: 'mod+shift+F' }, { label: 'Copy link', icon: 'copy' }, '-', { label: 'Archive', icon: 'archive' }, { label: 'Delete', icon: 'close', danger: true }
] });
const open = (variant: 'menu' | 'split', place?: 'above'): ReturnType<typeof stage> => stage(['open'], async ({ root, wait }) => {
  const b = kit.button({ label: variant === 'split' ? 'Commit' : 'Options', variant: variant === 'split' ? 'split' : 'secondary', menuLabel: 'Commit options' });
  line(root, b);
  const anchor = (b.querySelector('.k7-split__menu') ?? b) as HTMLElement;
  kit.openMenu(anchor, variant === 'split'
    ? { label: 'Commit options', variant: 'split', entries: [{ label: 'Commit and push' }, { label: 'Commit and open a PR' }, { label: 'Amend the last commit' }], align: 'end', ...(place ? { place } : {}) }
    : { label: 'Session', entries: [{ label: 'Rename', icon: 'pen' }, { label: 'Fork', icon: 'fork' }, '-', { label: 'Delete', icon: 'close', danger: true }], ...(place ? { place } : {}) });
  await wait(200);
}, { overlay: { anchor: variant === 'split' ? '.k7-split__menu' : '[data-kit~="Button"]', layer: '.k7-menu[data-floating]' } });
export default {
  id: 'kit/menu', title: 'Menu', area: 'components', kind: 'component', covers: ['kit.menu'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, menu()); }),
    'row hover': stage(['hover'], ({ root }) => { line(root, menu()); }, { force: [{ sel: '[data-kit~="MenuRow"]:nth-child(2)', state: 'hover' }] }),
    'row focus': stage(['focus'], ({ root }) => { line(root, menu()); }, { force: [{ sel: '[data-kit~="MenuRow"]:nth-child(2)', state: 'focus' }] }),
    quick: stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'Show under the composer', variant: 'quick', entries: [{ heading: 'Show under the composer' }, { label: 'Mode', checked: true }, { label: 'Smart', checked: true }, { label: 'Model', checked: false }, { label: 'Cost', checked: true }, { label: 'Context', checked: false }] })); }),
    'palette /': stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'Commands', variant: 'palette', query: '/', entries: [{ label: '/review', desc: 'Review the changes since the last commit' }, { label: '/test', desc: 'Run the tests and report what failed' }, { label: '/webapp-testing', desc: 'Drive the web app in a browser and check each flow' }] })); }, { width: 680 }),
    'palette @': stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'Mention', variant: 'palette', query: '@', entries: [{ label: 'kai', desc: 'docs and changelog', leadHTML: kit.html.avatar({ bot: KAI, size: 20 }) }, { label: 'nina', desc: 'deploys', leadHTML: kit.html.avatar({ bot: NINA, size: 20 }) }, { label: 'src/billing.ts', desc: 'a file', icon: 'file' }] })); }, { width: 680 }),
    'palette $': stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'Skills', variant: 'palette', query: '$', entries: [{ label: '$changelog', desc: 'Write the changelog from merged pull requests' }, { label: '$release', desc: 'Cut a release with notes' }] })); }, { width: 680 }),
    snooze: stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'Snooze', variant: 'snooze', entries: [{ label: 'In an hour', icon: 'clock' }, { label: 'This evening', icon: 'clock', desc: '18:00' }, { label: 'Tomorrow', icon: 'clock', desc: '09:00' }] })); }),
    /* who answers next (derived from board S19's rows): the model's mark and name, what it is on a second line, never cut; the effort under them */
    'options with marks: who answers next': stage(['variant', 'owner', 'long'], ({ root }) => {
      line(root, kit.menu({ label: 'Who answers next', variant: 'options', entries: [
        { label: 'Automatic (Smart)', meaning: 'Picks a tier for each message: the cheapest by default, a stronger one for design, debugging, code or a run that keeps failing', icon: 'spark', chosen: false },
        { label: 'Ask a council', meaning: 'Several models answer your next message, one combines them', icon: 'bots', keys: 'alt+C' },
        { heading: 'Anthropic' }, { label: 'Claude Haiku 5.5', meaning: 'Tier 1 of 3, the cheapest', leadHTML: ui.html.modelMark('claude-haiku-5-5', { size: 16, label: false }) }, { label: 'Claude Sonnet 5.5', meaning: 'Tier 2 of 3', chosen: true, leadHTML: ui.html.modelMark('claude-sonnet-5-5', { size: 16, label: false }) },
        { heading: 'OpenAI' }, { label: 'GPT 5.5', meaning: 'Not on the ladder', disabled: true, leadHTML: ui.html.modelMark('gpt-5.5', { size: 16, label: false }) },
        '-', { heading: 'Effort' }, { label: 'Low', checked: false, role: 'menuitemradio' }, { label: 'Medium', checked: true, role: 'menuitemradio' }, { label: 'High', checked: false, role: 'menuitemradio' },
        '-', { heading: 'Governed: your pick is where the ladder starts. The gate still moves it up when a run fails.' }
      ] }));
    }, { width: 420 }),
    'a list with descriptions': stage(['variant', 'owner'], ({ root }) => {
      line(root, kit.menu({ label: 'Who answers next', variant: 'list', entries: [
        { label: 'Automatic (Smart)', desc: 'Picks a tier for each message: the cheapest by default, a stronger one for design, debugging or code', checked: false, role: 'menuitemradio' },
        { label: 'Ask a council', desc: 'Several models answer your next message, one combines them', icon: 'bots', keys: 'alt+C' },
        { heading: 'Claude' }, { label: 'Claude Haiku 5.5', desc: 'Tier 1 of 3, the cheapest', checked: false, role: 'menuitemradio' }, { label: 'Claude Sonnet 5.5', desc: 'Tier 2 of 3', checked: true, role: 'menuitemradio' },
        '-', { heading: 'Effort' }, { label: 'Low', checked: false, role: 'menuitemradio' }, { label: 'Medium', checked: true, role: 'menuitemradio' }, { label: 'High', checked: false, role: 'menuitemradio' },
        '-', { heading: 'Your pick answers the next messages of this session. Automatic picks a tier for each message.' }
      ] }));
    }, { note: 'rows that say what they are beside their name, at the width boards S31 and S32 draw such lists (360): the name whole, the description cut where the row ends and whole in the row\'s tooltip; a session\'s "who answers next" with the effort under the models (derived)' }),
    'option menu': stage(['variant'], ({ root }) => { line(root, kit.menu({ label: 'How careful', variant: 'options', entries: STEPS })); }),
    open: open('menu'),
    'split-button menu': open('split'),
    'flipped near the bottom': stage(['open'], async ({ root, wait }) => {
      const pad = document.createElement('div'); pad.className = 'k7-lab-push'; root.append(pad);
      const b = kit.button({ label: 'Options' }); line(root, b);
      kit.openMenu(b, { label: 'Session', entries: [{ label: 'Rename', icon: 'pen' }, { label: 'Fork', icon: 'fork' }, { label: 'Archive', icon: 'archive' }] });
      await wait(200);
    }, { overlay: { anchor: '[data-kit~="Button"]', layer: '.k7-menu[data-floating]' } }),
    long: stage(['long'], ({ root }) => { line(root, kit.menu({ label: 'Skills', entries: [{ label: 'webapp-testing', desc: 'Drive the web app in a real browser and check each of its flows end to end' }, { label: 'changelog', desc: 'Write it' }] })); })
  }
} satisfies Story;
