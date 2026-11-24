/* The kit's patterns (DESIGN-SYSTEM.md v7 21.2, "Patterns"; LAB-v7 section 2): compositions of kit components only, one story each.
   The Settings page is the Page story's settings state; the danger zone is the Card story's. */
import { kit } from '@boopis/ui';
import { fill, stage } from '../../story';
import type { Story } from '../../types';
import { NINA } from './_bots';

/* S41 A, the new session's canvas: the logomark, the greeting (plain text, no mark at rest), the launch row of SelectorItems, the
   inbox row in its one-line variant, the usage Notice above the composer and the composer with its line naming the keys */
const canvas = (noModel: boolean): HTMLElement => {
  const c = document.createElement('div'); c.className = 'k7-lab-canvas';
  const launch = document.createElement('div'); launch.className = 'k7-lab-launch';
  launch.append(kit.selectorItem({ variant: 'launch', label: 'Folder', value: 'boopis', icon: 'folder' }), kit.selectorItem({ variant: 'launch', label: 'Worktree', value: 'main', mono: true }),
    noModel ? kit.selectorItem({ variant: 'launch', label: 'Model', value: '+ Choose a model', need: true, chevron: false }) : kit.selectorItem({ variant: 'launch', label: 'Model', value: 'Claude Sonnet 4.5' }),
    kit.selectorItem({ variant: 'launch', label: 'Effort', value: 'Medium' }), kit.selectorItem({ variant: 'launch', label: 'How careful', value: 'Auto-accept edits', ticks: { of: 4, on: 2 } }));
  const hello = document.createElement('p'); hello.className = 'k7-lab-hello'; hello.textContent = 'What\'s next for boopis?';
  c.append(kit.avatar({ variant: 'logomark', ...(noModel ? { state: 'sleeping', label: 'boopis, asleep' } : {}) }), hello, launch,
    kit.sectionHead({ title: 'Waiting on you', count: '1' }), kit.list({ label: 'Waiting on you', rows: [{ variant: 'compact', title: 'Deploy to staging', sub: 'nina asks to run the deploy', needs: true, count: '1' }] }),
    kit.notice({ text: 'Approaching the weekly limit, 81% used, resets Wed 09:00', tone: 'owe', place: 'composer', actions: [{ label: 'Get more usage' }], dismiss: true }),
    kit.composer({ hint: 'Enter starts the session, ctrl Enter starts it in the background' }));
  return c;
};
export default {
  id: 'kit/patterns', title: 'Patterns', area: 'composer', kind: 'component', covers: ['pattern:new-session', 'pattern:setup-form', 'pattern:long-text'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { fill(root, canvas(false)); }, { width: 760 }),
    'no model': stage(['variant', 'empty'], ({ root }) => { fill(root, canvas(true)); }, { width: 760 }),
    'setup form (bot)': stage(['variant'], ({ root }) => {
      fill(root, kit.dialog({ title: 'New bot', body: kit.html.field({ id: 'sf-name', label: 'Name', value: 'nina' }) + kit.html.card({ rows: [{ label: 'Model', control: kit.html.selectorItem({ variant: 'field', label: 'Model', value: 'Claude Sonnet 4.5' }) }, { label: 'Project folder', control: kit.html.selectorItem({ variant: 'field', label: 'Project folder', value: '~/code/billing', mono: true }) }] }) +
        kit.html.menu({ label: 'How careful', variant: 'options', entries: [{ label: 'Supervised', meaning: 'Asks before every change', chosen: true }, { label: 'Auto-accept edits', meaning: 'Edits files, asks before commands' }, { label: 'Trusted', meaning: 'Runs what the gate allows' }, { label: 'Full access', meaning: 'Never asks' }] }),
        actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Create', variant: 'primary' }] }));
    }, { width: 640 }),
    'long-text editor': stage(['variant'], ({ root }) => {
      const head = document.createElement('div'); head.className = 'k7-lab-editor';
      head.append(kit.iconButton({ icon: 'back', label: 'Back', variant: 'floating' }), kit.titlePill({ title: 'nina: instructions', bot: NINA }), kit.button({ label: 'Save', variant: 'primary' }));
      fill(root, head, kit.field({ id: 'lt', kind: 'multiline', ariaLabel: 'Instructions', mono: true, rows: 10, value: 'You deploy the billing service.\n\nAsk before anything reaches production.\nWrite what you did in the room when you are done.' }));
    }, { width: 900 }),
    long: stage(['long'], ({ root }) => { fill(root, canvas(false)); }, { width: 420 })
  }
} satisfies Story;
