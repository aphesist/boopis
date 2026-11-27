/* The first run in the app (onboarding round 3): the Sessions part on the new session's canvas (O-S01, O-S03, O-S04), the hand-off (O-H01)
   and the boopis bot's part in its own chat (O-B01 to O-B09), each state the whole app on the board's content (board-fixtures.ts). The
   bot's part and the hand-off show only with a host that keeps their answers (`DataProvider.onboarding`): the fixture has one. */
import type { AppCtx, State, Story } from '../../types';
import { boardFirstRunBots, boardFirstRunCanvas, boardFirstRunNoFolder } from '../../board-fixtures';
import { writeLedger } from '../../../modules/onboarding/ledger';
import type { Ledger } from '../../../modules/onboarding/ledger';
import { botsAt, botsClock } from '../../../modules/onboarding/bots';
import type { BotsStep } from '../../../modules/onboarding/bots';
import { handoffClock } from '../../../modules/session/new';
import type { DataProvider } from '../../../data/provider';

const at = (h: number, m: number): Date => { const d = new Date(2026, 10, 27, h, m); return d; };
const canvas = (tags: State['tags'], note: string, ledger: Partial<Ledger>, patch: (p: DataProvider) => DataProvider = boardFirstRunCanvas): State => ({
  tags, note,
  app: {
    provider: { sessions: 'none', patch },
    setup: async (c: AppCtx) => {
      writeLedger({ sessions: 'done', bots: 'done', ...ledger });
      handoffClock.hold = true;
      c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
      await c.wait(900);
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }
});
const chat = (tags: State['tags'], note: string, step: BotsStep, o: Parameters<typeof botsAt>[1], time: Date, team = false): State => ({
  tags, note,
  app: {
    provider: { sessions: 'none', patch: boardFirstRunBots(team) },
    setup: async (c: AppCtx) => {
      writeLedger({ sessions: 'done', bots: 'todo' });
      botsClock.now = () => time; botsClock.hold = true; handoffClock.hold = true;
      botsAt(step, o);
      c.hx.setState({ tab: 'bots', left: 'open', right: 'closed' });
      await c.wait(300);
      c.hx.emit('hx:bot-select', { id: 'boopis', from: 'lab' });
      await c.wait(1200);
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }
});

export default {
  id: 'v7/first-run-app', title: 'First run: Sessions and the boopis bot', area: 'bots', kind: 'page', covers: ['page:first-run-app'],
  states: {
    'O-S01 add a folder': canvas(['empty', 'owner'], 'board O-S01 (S41\'s canvas): no folder yet', { sessions: 'careful' }, boardFirstRunNoFolder),
    'O-S03 how careful': canvas(['typical', 'owner'], 'board O-S03: the four steps, Auto-accept edits chosen and recommended', { sessions: 'careful' }),
    'O-S04 ready': canvas(['variant', 'owner'], 'board O-S04: the whole launch row and three ways to start', { sessions: 'ready' }),
    'O-H01 the hand-off': canvas(['variant', 'owner'], 'board O-H01: the countdown with Later', { sessions: 'done', bots: 'todo' }, boardFirstRunBots(false)),
    'O-B01 boopis greets you': chat(['typical', 'owner'], 'board O-B01', 'greet', {}, at(9, 42)),
    'O-B02 what bots are': chat(['variant', 'owner'], 'board O-B02', 'what', { you: 'Tell me what bots are first' }, at(9, 42)),
    'O-B03 the goals': chat(['variant', 'owner'], 'board O-B03', 'goals', { you: 'Got it', goals: ['Code and reviews'] }, at(9, 43)),
    'O-B03b two goals picked': chat(['variant', 'owner'], 'board O-B03b', 'goals', { you: 'Got it', goals: ['Code and reviews', 'Research and writing'] }, at(9, 43)),
    'O-B04 where bots work': chat(['variant', 'owner'], 'board O-B04', 'place', { you: 'Code and reviews, Research and writing', goals: ['Code and reviews', 'Research and writing'] }, at(9, 44)),
    'O-B05 your name': chat(['variant', 'owner'], 'board O-B05', 'name', { you: 'This computer, in a container' }, at(9, 43)),
    'O-B06 the starter team': chat(['variant', 'owner'], 'board O-B06', 'team', { you: 'Alex', name: 'Alex', goals: ['Code and reviews'] }, at(9, 45)),
    'O-B07 the approval rules': chat(['variant', 'owner'], 'board O-B07', 'rules', { you: 'Hold to build this team', plan: 'p-crew' }, at(9, 46), true),
    'O-B08 the build': chat(['success', 'owner'], 'board O-B08', 'built', { you: 'Keep these rules', plan: 'p-crew', built: 'Built at 09:47: 3 bots, 1 room, 1 routine (paused)' }, at(9, 47), true),
    'O-B09 reach': chat(['variant', 'owner'], 'board O-B09', 'reach', { plan: 'p-crew' }, at(9, 48), true)
  }
} satisfies Story;
