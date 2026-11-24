/* Dock (21.2 row 41, 21.4; LAB-v7: row, compact, open (stack, card); rest, hover, focus, a card open, needs you). With no bot of
   your own the dock is not drawn (21.4), so that state is the session's, not the kit's. */
import { kit } from '@boopis/ui';
import { line, stage } from '../../story';
import type { Story } from '../../types';
import { BOOPIS, HEX, IRIS, KAI, MOSS, NINA } from './_bots';

const BOTS = [{ ...NINA, needs: true }, { ...KAI, working: true }, { ...BOOPIS }, { ...MOSS }, { ...IRIS }, { ...HEX, resting: true }];
const ASK = { bot: NINA, ask: 'Deploy 0.2.0 to staging?', command: 'boopis deploy staging --tag 0.2.0', answers: [{ label: 'Hold to allow once', primary: true, hold: true }, { label: 'Always for staging' }, { label: 'Deny', keys: 'esc' }] };
const at = (d: HTMLElement): HTMLElement => { const w = document.createElement('div'); w.className = 'k7-lab-dock'; w.append(d); return w; };
export default {
  id: 'kit/dock', title: 'Dock', area: 'dock', kind: 'component', covers: ['kit.dock'],
  states: {
    typical: stage(['typical'], ({ root }) => { line(root, at(kit.dock({ bots: BOTS }))); }, { width: 760 }),
    hover: stage(['hover'], ({ root }) => { line(root, at(kit.dock({ bots: BOTS, hover: 'kai' }))); }, { width: 760 }),
    focus: stage(['focus'], ({ root }) => { line(root, at(kit.dock({ bots: BOTS, focus: 'boopis' }))); }, { width: 760 }),
    many: stage(['many'], ({ root }) => { line(root, at(kit.dock({ bots: BOTS, more: 13 }))); }, { width: 760 }),
    compact: stage(['variant'], ({ root }) => { line(root, at(kit.dock({ kind: 'compact', bots: BOTS }))); }, { width: 760 }),
    'asks open': stage(['open'], ({ root }) => { line(root, at(kit.dock({ kind: 'open', bots: BOTS, open: { kind: 'stack', asks: [ASK, { bot: MOSS, ask: 'The WebKit job flaked twice. Quarantine it?', answers: [{ label: 'Quarantine', primary: true }, { label: 'Retry once more' }, { label: 'Leave it' }] }] } }))); }, { width: 760 }),
    'card open': stage(['open'], ({ root }) => { line(root, at(kit.dock({ kind: 'open', bots: BOTS, current: 'nina', open: { kind: 'card', bot: { ...NINA, needs: true }, log: [{ kind: 'user', text: 'Ship 0.2.0 when the notes are in.' }, { kind: 'agent', text: 'The notes are in. Staging is ready.' }], ask: ASK } }))); }, { width: 760 }),
    long: stage(['long'], ({ root }) => { line(root, at(kit.dock({ bots: [{ id: 'cassiopeia-staging-deploy-guardian', name: 'cassiopeia-staging-deploy-guardian', shape: 'star', color: '#e8b04a', needs: true }, ...BOTS.slice(1, 4)], hover: 'cassiopeia-staging-deploy-guardian' }))); }, { width: 760 })
  }
} satisfies Story;
