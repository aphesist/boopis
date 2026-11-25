/* The approved boards as lab stories (docs/design/v7/boards; tests/lab/boards.json maps each board to its story): each state boots the
   whole app, the real modules, on the board's own content (board-fixtures.ts), in the state the board draws. `pnpm lab:board <board>`
   draws the board from its source beside this state and measures the difference; a screen is done when they are the same, dark
   and light. Later boards add a fixture, a state here and a row in boards.json. */
import type { AppCtx, State, Story } from '../../types';
import { board11, board12, board12Held, board17, boardS17 } from '../../board-fixtures';

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
  id: 'boards/sessions', title: 'Boards: the Sessions tab', area: 'composer', kind: 'page', covers: ['page:board-S17'], mock: { url: '/__boards/screen.html?s=newSess&mk=a&usage=1', note: MOCK.note },
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
    } satisfies State
  }
};

export default [bots, sessions];
