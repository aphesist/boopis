/* What a thread says of a turn's own course, and what a teammate or a routine asks, on the kit (REPASS.md 6e; the lead's design, no
   board draws them): they replace the v6 card kinds escalation, error, teammate and schedule (modules/cards/asks.ts). Each state on the
   thread it stands in: a session's for an escalation and a failed turn, a bot's for a teammate's ask and a routine's. */
import { put, stage } from '../../story';
import type { Story } from '../../types';
import { LONG_TITLE, UNBROKEN } from '../../fixtures';
import { OUTPUT } from '../../../data/mock-data';
import { escalationLine, failedTurn, routineAsk, teammateAsk } from '../../../modules/cards/asks';
import type { Escalation, FailedTurn, RoutineAsk, TeammateAsk } from '../../../modules/cards/asks';
import { asV7 } from '../../../modules/session/s0';
import { KAI, NINA, LONG_BOT } from '../kit/_bots';
import { reply, sessionThread } from '../composer/_thread';

const W = 720;
const botThread = (...parts: HTMLElement[]): HTMLElement => { const t = document.createElement('div'); t.className = 'k7-thread'; t.append(...parts); return asV7(t); };

const ESC: Escalation = { to: 'claude-sonnet-5-5', reason: 'after 2 failed gate runs on cheaper models' };
const CAPPED: Escalation = { ...ESC, to: 'claude-opus-5-5', capped: 'the session\'s $0.60 cap is reached' };
const escalation: Story = {
  id: 'cards/escalation', title: 'An escalation (SystemLine)', area: 'cards', kind: 'card', covers: ['ask:escalation'],
  states: {
    escalated: stage(['typical'], ({ root }) => { put(root, sessionThread(reply('The rounding test still fails on the cheaper models.', 'qwen3-coder'), escalationLine(ESC))); }, { width: W }),
    capped: stage(['error'], ({ root }) => { put(root, sessionThread(reply('The rounding test still fails.', 'claude-sonnet-5-5'), escalationLine(CAPPED))); }, { width: W }),
    long: stage(['long'], ({ root }) => { put(root, sessionThread(escalationLine({ to: 'claude-sonnet-5-5-20261101-extended-context', reason: LONG_TITLE }), escalationLine({ ...CAPPED, capped: LONG_TITLE }))); }, { width: 420 })
  }
};

const FAIL: FailedTurn = { gate: 'npm test', retryWith: 'claude-sonnet-5-5', output: OUTPUT.slice(0, 4).map((l) => l.trim()), note: 'The edit to invoice.ts was rolled back. Nothing else changed.', at: '09:52' };
const error: Story = {
  id: 'cards/error', title: 'A failed turn (S38\'s pattern)', area: 'cards', kind: 'card', covers: ['ask:error'],
  states: {
    failed: stage(['typical', 'error'], ({ root }) => { put(root, sessionThread(failedTurn(FAIL, 'failed', { retry: () => undefined }))); }, { width: W }),
    'retry hovered': stage(['hover'], ({ root }) => { put(root, sessionThread(failedTurn(FAIL, 'failed', { retry: () => undefined }))); }, { width: W, force: [{ sel: '[data-files]', state: 'hover' }] }),
    retrying: stage(['loading'], ({ root }) => { put(root, sessionThread(failedTurn(FAIL, 'retrying', { stop: () => undefined }))); }, { width: W }),
    passed: stage(['success'], ({ root }) => { put(root, sessionThread(failedTurn(FAIL, 'passed'))); }, { width: W }),
    'nothing printed': stage(['empty'], ({ root }) => { put(root, sessionThread(failedTurn({ gate: 'npm test' }, 'failed', { retry: () => undefined }))); }, { width: W }),
    long: stage(['long'], ({ root }) => { put(root, sessionThread(failedTurn({ ...FAIL, gate: UNBROKEN.slice(0, 40), output: [UNBROKEN, ...OUTPUT], note: LONG_TITLE }, 'failed', { retry: () => undefined }))); }, { width: 420 })
  }
};

const TEAM: TeammateAsk = { from: KAI, title: 'hands you a review', quote: 'invoice.ts:88 still divides before rounding. I fixed it in 9f3c1a2. Can you check it before nina deploys?', item: ['cents/proration · 9f3c1a2', '1 commit · 142 tests pass'] };
const teammate: Story = {
  id: 'cards/teammate', title: 'A teammate asks for help (AskCard)', area: 'cards', kind: 'card', covers: ['ask:teammate'],
  states: {
    asked: stage(['typical'], ({ root }) => { put(root, botThread(teammateAsk(TEAM, 'needs'))); }, { width: W }),
    'accept hovered': stage(['hover'], ({ root }) => { put(root, botThread(teammateAsk(TEAM, 'needs'))); }, { width: W, force: [{ sel: '[data-value="yes"]', state: 'hover' }] }),
    accepted: stage(['success'], ({ root }) => { put(root, botThread(teammateAsk(TEAM, 'yes'))); }, { width: W }),
    denied: stage(['disabled'], ({ root }) => { put(root, botThread(teammateAsk(TEAM, 'no'))); }, { width: W }),
    long: stage(['long'], ({ root }) => { put(root, botThread(teammateAsk({ from: LONG_BOT, title: LONG_TITLE, quote: UNBROKEN, item: [UNBROKEN] }, 'needs'))); }, { width: 420 })
  }
};

const ROUTINE: RoutineAsk = { from: NINA, name: 'Morning digest', when: 'Every weekday at 02:00', cost: 'about $0.08 a run', quote: 'overnight CI and your inbox, summed up before you start', next: 'tonight at 02:00' };
const schedule: Story = {
  id: 'cards/schedule', title: 'A routine proposed (AskCard)', area: 'cards', kind: 'card', covers: ['ask:schedule'],
  states: {
    asked: stage(['typical'], ({ root }) => { put(root, botThread(routineAsk(ROUTINE, 'needs'))); }, { width: W }),
    created: stage(['success'], ({ root }) => { put(root, botThread(routineAsk(ROUTINE, 'yes'))); }, { width: W }),
    'not now': stage(['disabled'], ({ root }) => { put(root, botThread(routineAsk(ROUTINE, 'no'))); }, { width: W }),
    long: stage(['long'], ({ root }) => { put(root, botThread(routineAsk({ ...ROUTINE, from: LONG_BOT, name: LONG_TITLE, quote: UNBROKEN }, 'needs'))); }, { width: 420 })
  }
};

export default [escalation, error, teammate, schedule] satisfies Story[];
