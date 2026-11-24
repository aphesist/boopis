/* Pane (21.2 row 3; LAB-v7: details (bot: Activity, Library; session), tools (Diff, Files, Terminal, PR, Side chat); open, overlay under
   900, resized). */
import { kit } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';
import { KAI } from './_bots';

const details = (): HTMLElement => kit.pane({ title: 'kai', bot: KAI, body:
  kit.html.sectionHead({ title: 'Upcoming' }) + kit.html.card({ variant: 'pane', rows: [{ label: 'Weekly changelog', value: 'Fri 09:00', control: kit.html.switch({ checked: true, label: 'Weekly changelog' }) }] }) +
  kit.html.sectionHead({ title: 'Work' }) + kit.html.card({ variant: 'pane', rows: [{ label: 'Model', value: 'Claude Sonnet 4.5' }, { label: 'Spend', value: '$0.37 of $0.60', mono: true }, { label: 'Workspace', value: '~/code/boopis', mono: true }] }) });
const LINES = [{ n: 41, sign: '-' as const, text: '  return Math.round(total / days * 100) / 100;' }, { n: 41, sign: '+' as const, text: '  const cents = Math.round(total * 100);' }];
export default {
  id: 'kit/pane', title: 'Pane', area: 'shell', kind: 'component', covers: ['kit.pane'],
  states: {
    typical: stage(['typical', 'variant'], ({ root }) => { line(root, details()); }, { width: 380 }),
    session: stage(['variant'], ({ root }) => { line(root, kit.pane({ title: 'Fix the flaky billing test', body: kit.html.card({ variant: 'pane', rows: [{ label: 'Branch', value: 'fix/billing', mono: true }, { label: 'How careful', value: 'Auto-accept edits' }, { label: 'Cost', value: '$1.12', mono: true }] }) })); }, { width: 380 }),
    tools: stage(['variant'], ({ root }) => { line(root, kit.pane({ variant: 'tools', tab: 'diff', body: kit.html.diffView({ path: 'src/billing.ts', lines: LINES }) })); }, { width: 560 }),
    'tools terminal with side chat': stage(['variant'], ({ root }) => { line(root, kit.pane({ variant: 'tools', tab: 'terminal', sideChat: true, body: kit.html.well({ kind: 'terminal', path: '~/code/boopis', branch: 'fix/billing', text: '$ pnpm test\n  1268 passed' }) })); }, { width: 560 }),
    overlay: stage(['variant'], ({ root }) => { line(root, kit.pane({ title: 'kai', bot: KAI, overlay: true, body: '' })); }, { width: 380 }),
    long: stage(['long'], ({ root }) => { line(root, kit.pane({ title: 'cassiopeia-staging-deploy-guardian', body: kit.html.card({ variant: 'pane', rows: [{ label: 'Workspace', value: '/home/someone/code/a-project/apps', mono: true }] }) })); }, { width: 380 })
  }
} satisfies Story;
