/* The approved boards as lab stories (docs/design/v7/boards; tests/lab/boards.json maps each board to its story): each state boots the
   whole app, the real modules, on the board's own content (board-fixtures.ts), in the state the board draws. `pnpm lab:board <board>`
   draws the board from its source beside this state and measures the difference; a screen is done when they are the same, dark
   and light. Later boards add a fixture, a state here and a row in boards.json. */
import type { AppCtx, State, Story } from '../../types';
import { board11, board12, board12Held, board17, boardDock, boardS17, boardS20, boardS23, boardS33, boardS37, boardS41 } from '../../board-fixtures';
import type { DockBoard } from '../../board-fixtures';

const MOCK = { url: '/__boards/screen.html?s=bot11', note: 'the approved v7 board itself, drawn from its source' };

const bots: Story = {
  id: 'boards/bots', title: 'Boards: the Bots tab', area: 'bots', kind: 'page', covers: ['page:board-11', 'page:board-12'], mock: MOCK,
  states: {
    '11 a bot\'s chat, the rail, the details': {
      tags: ['typical', 'owner'],
      note: 'board 11: the rail with kai open, the title pill, the thread with its approval waiting, the one-row composer and its line, the details pane',
      app: {
        provider: { sessions: 'none', patch: board11 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'bots', left: 'rail', right: 'open' });
          await c.wait(300);
          c.hx.emit('hx:bot-select', { id: 'kai', from: 'lab' });
          await c.wait(900);
        }
      },
      /* the board draws the last reply with its hover actions showing */
      force: [{ sel: '#hx-view-bots .bt-log > [data-hx-turn][data-kind="bot"]', state: 'hover' }]
    } satisfies State,
    '12 a group room, the sidebar open': {
      tags: ['variant', 'owner'],
      note: 'board 12: the open Bots sidebar (the "+", the boopis bot, the bots\' rows, the room\'s row open, you, Store, Settings), the title pill with the members, the room\'s thread (mentions, bylines and gutter orbs, the system line, the message to you, the approval, who is replying) and the one-row composer with its line',
      app: {
        provider: { sessions: 'none', patch: board12 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'bots', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('#hx-list-bots [data-gid="room-release"]');
          await c.wait(900);
        }
      }
    } satisfies State,
    '12 a message held': {
      tags: ['variant', 'owner'],
      note: 'board K02-12: a message written while members reply is held over the composer (the kit\'s Queue, held): the clock, "1 message waits until the discussion ends", Send now',
      app: {
        provider: { sessions: 'none', patch: board12Held },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'bots', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('#hx-list-bots [data-gid="room-release"]');
          await c.wait(900);
        }
      }
    } satisfies State,
    '17 a bot working': {
      tags: ['variant', 'owner'],
      note: 'board 17: kai works through five steps: the task\'s row open on its steps, the shell\'s row, the file, the status line; no details pane, the composer 720',
      app: {
        provider: { sessions: 'none', patch: board17 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'bots', left: 'rail', right: 'closed' });
          await c.wait(300);
          c.hx.emit('hx:bot-select', { id: 'kai', from: 'lab' });
          await c.wait(900);
        }
      }
    } satisfies State
  }
};

const sessions: Story = {
  id: 'boards/sessions', title: 'Boards: the Sessions tab', area: 'composer', kind: 'page', covers: ['page:board-S17', 'page:board-S20', 'page:board-S23', 'page:board-S33', 'page:board-S37', 'page:board-S41'], mock: { url: '/__boards/screen.html?s=newSess&mk=a&usage=1', note: MOCK.note },
  states: {
    'S17 a new session': {
      tags: ['typical', 'owner'],
      note: 'board S17: the open sidebar as an inbox, the logomark and the greeting, the launch row, Waiting on you, the limit notice, the composer and its hint line, the dock',
      app: {
        provider: { patch: boardS17 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(900);
        }
      }
    } satisfies State,
    'S37 no model': {
      tags: ['variant', 'owner'],
      note: 'board S37: no model is signed in: the mark asleep, "+ Choose a model" in the launch row, the block that says what boopis needs and offers Claude, ChatGPT, Gemini and More, the sessions waiting on you, "Choose a model to start" in the composer',
      app: {
        provider: { patch: boardS37 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(900);
        }
      }
    } satisfies State,
    'S41 no project': {
      tags: ['empty', 'owner'],
      note: 'board S41: nothing yet: "No sessions yet" in the sidebar, the mark, "Add a folder to start", Add a project, and the same words in the composer',
      app: {
        provider: { patch: boardS41 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(900);
        }
      }
    } satisfies State,
    'S20 running, supervised': {
      tags: ['variant', 'owner'],
      note: 'board S20: a running turn in Supervised: the model\'s mark in the gutter, the work line, the change waiting on its tool row (Decline, Always allow this session, Hold to allow once), the status line at rest, feedback typed in the composer with its marks, the session\'s line',
      app: {
        provider: { patch: boardS20 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(900);
          (document.activeElement as HTMLElement | null)?.blur();   /* the board draws the composer at rest */
        }
      }
    } satisfies State,
    'S23 a finished turn': {
      tags: ['variant', 'owner'],
      note: 'board S23: the turn ended: "Worked for 59s: ...", the answer with its guess marked, the changed files with Open diff, the checkpoint row (Checkpoint 3, Undo, Edit from here, Fork; the model, the time, the cost), the lapsed blank as a question with its answers',
      app: {
        provider: { patch: boardS23 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(900);
          (document.activeElement as HTMLElement | null)?.blur();   /* the board draws the composer at rest */
        }
      }
    } satisfies State,
    'S33 a setting changed': {
      tags: ['variant', 'owner'],
      note: 'board S33: a setting changed between two turns: one line in the thread (the sliders glyph, "Settings changed: continued with Auto-accept edits", its extra cost in mono), then the next message and its turn at work; the composer\'s line says the new step',
      app: {
        provider: { patch: boardS33 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(900);
          (document.activeElement as HTMLElement | null)?.blur();   /* the board draws the composer at rest */
        }
      }
    } satisfies State
  }
};

/* the dock's key screens (dockv7.js `screen`, boards dock/K01 to K08): the session at work, and the dock in the state each draws */
const openSession = async (c: AppCtx): Promise<void> => {
  c.hx.setState({ tab: 'session', left: 'open', right: 'closed', dockCentred: false, dockCompact: false });
  await c.wait(300);
  await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
  await c.wait(900);
  (document.activeElement as HTMLElement | null)?.blur();   /* the boards draw the composer at rest */
};
const k = (kind: DockBoard, note: string, then?: (c: AppCtx) => Promise<void>, more: Partial<State> = {}): State => ({
  tags: ['variant', 'owner'], note,
  app: { provider: { patch: boardDock(kind) }, setup: async (c: AppCtx) => { await openSession(c); if (then) { await then(c); await c.wait(700); } } },
  ...more
});
const dock: Story = {
  id: 'boards/dock', title: 'Boards: the dock', area: 'dock', kind: 'page', covers: ['page:board-K01', 'page:board-K02', 'page:board-K03', 'page:board-K04', 'page:board-K05', 'page:board-K06', 'page:board-K07', 'page:board-K08'], mock: { url: '/__boards/screen.html?s=dockv7&k=rest', note: MOCK.note },
  states: {
    'K01 at rest, a session running': k('rest', 'board K01: the row under the composer: nina needs you (the amber flag, the ask pill), kai works, the others rest'),
    'K02 a bot hovered': k('rest', 'board K02: nina hovered: 52, kai beside her 46, the end slot names her and her state', async (c) => { c.hx.dock()?.hover(c.$('#hx-dock .k7-dock__orb[data-bot="nina"]').getBoundingClientRect().left + 20); }),
    'K03 the asks open': k('asks', 'board K03: the stack of asks over the row, 640 by 432; the session\'s composer has stepped aside', async (c) => { c.hx.dock()?.openAsks(); }),
    'K04 a bot\'s card': k('rest', 'board K04: nina\'s card: her head, her last messages (yours in her fill), her ask, her composer; the row under it, nina marked', async (c) => { c.hx.dock()?.openSession('nina'); }),
    'K05 many bots': k('many', 'board K05: nineteen bots: the six that fit, then "13 more"'),
    'K06 no bots': k('none', 'board K06: no bot of your own: no dock, and the composer 24 from the window\'s foot'),
    'K07 centred in the window': k('rest', 'board K07: "Keep the dock centred in the window": on the window\'s middle, not the session\'s column', async (c) => { c.hx.setState({ dockCentred: true }); }),
    'K08 compact when idle': k('rest', 'board K08: "Compact dock when idle", idle: 48 tall, bots of 24, the ask pill small', async (c) => { c.hx.setState({ dockCompact: true }); c.hx.dock()?.setMode('compact'); })
  }
};

export default [bots, sessions, dock];
