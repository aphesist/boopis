/* Pane (21.2 row 3; LAB-v7: details (bot: Activity, Library; session), tools (Diff, Files, Terminal, PR, Side chat); open, overlay under
   900, resized). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../../lab/story';
import type { Story } from '../../../lab/types';
import { KAI, TEAM } from '../../../lab/stories/kit/_bots';

const details = (): HTMLElement => kit.pane({ title: 'kai', bot: KAI, body:
  kit.html.sectionHead({ title: 'Upcoming' }) + kit.html.card({ variant: 'pane', rows: [{ label: 'Weekly changelog', value: 'Fri 09:00', control: kit.html.switch({ checked: true, label: 'Weekly changelog' }) }] }) +
  kit.html.sectionHead({ title: 'Work' }) + kit.html.card({ variant: 'pane', rows: [{ label: 'Model', value: 'Claude Sonnet 4.5' }, { label: 'Spend', value: '$0.37 of $0.60', mono: true }, { label: 'Workspace', value: '~/code/boopis', mono: true }] }) });
const sessionPane = (): HTMLElement => kit.pane({ variant: 'session', title: 'Fix the dock\'s half paint', folder: 'boopis', branch: 'w32/dock-paint', more: true, body:
  '<h3 class="k7-pane__sec">Session</h3>' + kit.html.card({ variant: 'pane', rows: [{ label: 'Model', control: kit.html.selectorItem({ variant: 'field', label: 'Model', value: 'sonnet 5.5', icon: 'spark' }) }, { label: 'Effort', control: kit.html.selectorItem({ variant: 'field', label: 'Effort', value: 'Default' }) }, { label: 'How careful', control: kit.html.selectorItem({ variant: 'field', label: 'How careful', value: 'Auto-accept edits' }) }, { label: 'Workspace', value: 'worktree' }] }) +
  '<h3 class="k7-pane__sec">Use</h3>' + kit.html.card({ variant: 'pane', rows: [{ label: 'Context', value: '76k / 200k', mono: true, action: 'shows what fills it' }, { label: 'Cost', value: '$0.37 of $0.60', mono: true, action: 'changes the cap' }, { label: 'Pull request', value: '#412', valueHTML: '<span class="k7-row__link">#412</span>', action: 'opens it' }] }) });
const LINES = [{ n: 41, sign: '-' as const, text: '  return Math.round(total / days * 100) / 100;' }, { n: 41, sign: '+' as const, text: '  const cents = Math.round(total * 100);' }];
export default {
  id: 'kit/pane', title: 'Pane', area: 'shell', kind: 'component', covers: ['kit.pane'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, details()); }, { width: 380 }),
    /* board S40: a session's details: its name with its overflow, the folder and the branch, Session and Use */
    session: stage(['variant', 'owner'], ({ root }) => { line(root, sessionPane()); }, { width: 380 }),
    'session, no overflow, a long name': stage(['long'], ({ root }) => { line(root, kit.pane({ variant: 'session', title: 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close', folder: 'billing-api-with-a-long-folder-name', branch: 'w41/reconcile-the-invoices-backfill-against-the-ledger', body: '<h3 class="k7-pane__sec">Environment</h3>' + kit.html.card({ variant: 'pane', rows: [{ label: 'Folder', value: '/home/someone/code/a-project/apps/billing-api', mono: true }, { label: 'Harness', value: 'boopis engine v0.23.2 (pinned)', mono: true }] }) + '<p class="k7-pane__note">Not available in this version of boopis’s engine: compact, fork.</p>' })); }, { width: 380 }),
    'session, shared with a mod\'s pane (the strip)': stage(['variant'], ({ root }) => { line(root, kit.pane({ variant: 'session', title: 'Fix the dock\'s half paint', folder: 'boopis', branch: 'w32/dock-paint', more: true, strip: { label: 'Session details and mod panes', value: 'details', items: [{ value: 'details', label: 'Details' }, { value: 'tests', label: 'Tests' }, { value: 'usage', label: 'Token usage' }] }, body: '' })); }, { width: 380 }),
    'session: a selector hovered, the overflow focused': stage(['hover', 'focus'], ({ root }) => { line(root, sessionPane()); }, { width: 380, force: [{ sel: '.k7-sel', state: 'hover' }, { sel: '[data-pane-more]', state: 'focus' }] }),
    /* board S24's Diff, shown alone: no strip of tabs until a second tool exists; what it holds is said where the tabs would stand */
    'tools: one tool alone': stage(['variant', 'owner'], ({ root }) => { line(root, kit.pane({ variant: 'tools', tabs: false, label: 'Diff', summary: '2 files<span class="k7-files__counts k7-mono"><span data-tone="add">+14</span><span data-tone="del">−5</span></span>', body: kit.html.diffView({ path: 'src/billing.ts', lines: LINES, fold: true, open: true }) })); }, { width: 560 }),
    tools: stage(['variant'], ({ root }) => { line(root, kit.pane({ variant: 'tools', tab: 'diff', body: kit.html.diffView({ path: 'src/billing.ts', lines: LINES }) })); }, { width: 560 }),
    'tools terminal with side chat': stage(['variant'], ({ root }) => { line(root, kit.pane({ variant: 'tools', tab: 'terminal', sideChat: true, body: kit.html.well({ kind: 'terminal', path: '~/code/boopis', branch: 'fix/billing', text: '$ pnpm test\n  1268 passed' }) })); }, { width: 560 }),
    overlay: stage(['variant'], ({ root }) => { line(root, kit.pane({ title: 'kai', bot: KAI, overlay: true, body: '' })); }, { width: 380 }),
    long: stage(['long'], ({ root }) => { line(root, kit.pane({ title: 'cassiopeia-staging-deploy-guardian', body: kit.html.card({ variant: 'pane', rows: [{ label: 'Workspace', value: '/home/someone/code/a-project/apps', mono: true }] }) })); }, { width: 380 }),

    /* a room's details (no board draws one: it follows a bot's): the members' stack, the name, no Activity | Library, then the room's cards */
    'a room': stage(['variant'], ({ root }) => {
      line(root, kit.pane({ members: TEAM.slice(0, 3), title: 'release crew', label: 'release crew, details', body:
        '<h3 class="k7-pane__sec">Members</h3>' + kit.html.card({ variant: 'pane', rows: TEAM.slice(0, 3).map((b) => ({ label: b.name, action: 'opens its chat' })) }) +
        '<h3 class="k7-pane__sec">Room</h3>' + kit.html.card({ variant: 'pane', rows: [{ label: 'Name', control: kit.html.field({ id: 'k7-pane-room-name', value: 'release crew', ariaLabel: 'Group name' }) }, { label: 'Members', value: '3', action: 'changes who is in it' }, { label: 'Run limit', value: 'Default (10)', action: 'sets the most rounds a run may take' }, { label: 'Board', value: 'Open', action: 'shows its kanban board' }, { label: 'Archive', action: 'puts the room away' }] }) }));
    }, { width: 380 }),
    'a room: a row hovered, the name focused': stage(['hover', 'focus'], ({ root }) => {
      line(root, kit.pane({ members: TEAM, title: 'a room of six with a long name that is cut', body: '<h3 class="k7-pane__sec">Room</h3>' + kit.html.card({ variant: 'pane', rows: [{ label: 'Name', control: kit.html.field({ id: 'k7-pane-room-name-2', value: 'a room of six', ariaLabel: 'Group name' }) }, { label: 'Members', value: '6', action: 'changes who is in it' }] }) }));
    }, { width: 380, force: [{ sel: '.k7-row[data-action]', state: 'hover' }, { sel: '.k7-field__input', state: 'focus' }] })
  }
} satisfies Story;
