/* AskCard (21.2 row 9; LAB-v7: standalone (bot approval), attached, question, choices, lapsed blank; asked, needs you, answered
   (collapsed), lapsed, hold-to-allow in progress). */
import { kit } from '@boopis/ui';
import { fill, forced, stage } from '../../story';
import type { Story } from '../../types';
import { NINA } from './_bots';

const approval = stage(['typical', 'variant'], ({ root }) => { fill(root, kit.askCard({ bot: NINA, ask: 'Run the deploy to staging', sub: 'Rule: “Ask before deploys”', command: 'fly deploy --app billing-staging' })); }, { width: 560 });
export default {
  id: 'kit/ask-card', title: 'AskCard', area: 'composer', kind: 'component', covers: ['kit.askCard'],
  states: {
    typical: approval,
    ...forced(approval, '[data-kit~="AskCard"] [data-kit~="Chip"]'),
    asked: stage(['variant'], ({ root }) => { fill(root, kit.askCard({ bot: NINA, state: 'asked', ask: 'Run the deploy to staging', answers: [{ label: 'Allow once', primary: true }, { label: 'Deny', keys: 'esc' }] })); }, { width: 560 }),
    'hold to allow in progress': stage(['active'], ({ root }) => { const c = kit.askCard({ bot: NINA, ask: 'Run the deploy to staging', sub: 'Rule: “Ask before deploys”' }); (c.querySelector('[data-hold]') as HTMLElement).style.setProperty('--hold', '.5'); fill(root, c); }, { width: 560 }),
    attached: stage(['variant'], ({ root }) => { fill(root, kit.toolRow({ kind: 'command', tool: 'Terminal', target: 'rm -rf build', state: 'waiting', model: 'claude-sonnet-4.5', ask: { model: 'claude-sonnet-4.5', who: 'Claude asks', ask: 'Delete the build folder', answers: [{ label: 'Allow once', primary: true }, { label: 'Deny', keys: 'esc' }] } })); }, { width: 560 }),
    question: stage(['variant'], ({ root }) => { fill(root, kit.askCard({ variant: 'question', model: 'claude-sonnet-4.5', ask: 'Which environment should I deploy to?', choices: ['staging', 'production', 'preview'] })); }, { width: 560 }),
    choices: stage(['variant'], ({ root }) => { fill(root, kit.askCard({ variant: 'choices', bot: NINA, state: 'asked', ask: 'Which region?', choices: ['Frankfurt', 'Virginia', 'Singapore'], chosen: 1 })); }, { width: 560 }),
    'lapsed blank': stage(['expired'], ({ root }) => { fill(root, kit.askCard({ variant: 'lapsed', state: 'lapsed', model: 'claude-sonnet-4.5', ask: 'Which environment should I deploy to?', sub: 'I went on with my guess: staging', choices: ['staging', 'production'] })); }, { width: 560 }),
    answered: stage(['success'], ({ root }) => { fill(root, kit.askCard({ bot: NINA, state: 'answered', ask: 'Run the deploy to staging', receipt: 'allowed once' })); fill(root, kit.askCard({ variant: 'question', state: 'answered', model: 'claude-sonnet-4.5', ask: 'Which environment? production', receipt: 'sent as a correction' })); }, { width: 560 }),
    long: stage(['long'], ({ root }) => { fill(root, kit.askCard({ bot: NINA, ask: 'Run the database migration that renames invoices_v2 to invoices and backfills every row before the quarterly close', sub: 'Rule: “Ask before anything touches the production database or its backups”' })); }, { width: 440 })
  }
} satisfies Story;
