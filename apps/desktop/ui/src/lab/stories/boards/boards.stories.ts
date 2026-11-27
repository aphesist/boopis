/* The approved boards as lab stories (docs/design/v7/boards; tests/lab/boards.json maps each board to its story): each state boots the
   whole app, the real modules, on the board's own content (board-fixtures.ts), in the state the board draws. `pnpm lab:board <board>`
   draws the board from its source beside this state and measures the difference; a screen is done when they are the same, dark
   and light. Later boards add a fixture, a state here and a row in boards.json. */
import type { AppCtx, State, Story } from '../../types';
import { store } from '../../../data/store';
import type { Todo } from '../../../data/types';
import { board11, board12, board12Held, board17, boardDock, boardS17, boardS20, boardS23, boardS33, boardS36, boardS37, boardS38, boardS40, boardS41, board15, engineStopped } from '../../board-fixtures';
import type { DockBoard } from '../../board-fixtures';
import { fakeRules, fakeSpeech, withSettings } from '../../settings-fixtures';
import { saveChrome, saveLineHidden } from '../../../core/settings';

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
    /* derived from board S36 (no board draws these): the engine stopped while a bot's chat or a room is open */
    'the engine stopped, in a bot\'s chat (derived from S36)': {
      tags: ['error', 'owner'],
      note: 'derived from board S36: under a bot\'s thread, the same line, "boopis\'s engine stopped", with "Start it again"',
      app: {
        provider: { sessions: 'none', patch: engineStopped(board17) },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'bots', left: 'rail', right: 'closed' });
          await c.wait(300);
          c.hx.emit('hx:bot-select', { id: 'kai', from: 'lab' });
          await c.wait(900);
        }
      }
    } satisfies State,
    'the engine stopped, in a room (derived from S36)': {
      tags: ['error', 'owner'],
      note: 'derived from board S36: under a room\'s thread, the same line',
      app: {
        provider: { sessions: 'none', patch: engineStopped(board12) },
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
  id: 'boards/sessions', title: 'Boards: the Sessions tab', area: 'composer', kind: 'page', covers: ['page:board-S17', 'page:board-S20', 'page:board-S23', 'page:board-S33', 'page:board-S36', 'page:board-S37', 'page:board-S38', 'page:board-S40', 'page:board-S41'], mock: { url: '/__boards/screen.html?s=newSess&mk=a&usage=1', note: MOCK.note },
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
    'S36 the engine stopped': {
      tags: ['error', 'owner'],
      note: 'board S36: the engine stopped mid-session: after your message, one line in red, "boopis\'s engine stopped", with "Start it again"',
      app: {
        provider: { patch: boardS36 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(900);
          (document.activeElement as HTMLElement | null)?.blur();   /* the board draws the composer at rest */
        }
      }
    } satisfies State,
    'S38 the gate failed': {
      tags: ['error', 'owner'],
      note: 'board S38: the gate failed on the turn\'s change: the card with "Gate", "failed" in red and "Fix and retry", what the failing check printed, and what became of the change',
      app: {
        provider: { patch: boardS38 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(900);
          (document.activeElement as HTMLElement | null)?.blur();   /* the board draws the composer at rest */
        }
      }
    } satisfies State,
    'S40 the session\'s details': {
      tags: ['variant', 'owner'],
      note: 'board S40: the details pane beside a finished turn: the session\'s name with its overflow, the folder and the branch, Session (Model, Effort, How careful, Workspace) and Use (Context, Cost, Pull request)',
      app: {
        provider: { patch: boardS40 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(600);
          c.hx.setState({ right: 'open' });
          await c.wait(900);
          (document.activeElement as HTMLElement | null)?.blur();   /* the board draws the composer at rest */
        }
      }
    } satisfies State,
    /* derived (no board draws a session's tasks): the agent's own list on its running turn, as the kit's card of steps of board 17 */
    'a running turn with its tasks (derived from board 17)': {
      tags: ['variant'],
      note: 'derived from board 17\'s card ("Release 0.2.0, step 3 of 5"): the agent\'s list of tasks on the turn that works, the one being done with its dot',
      app: {
        provider: { patch: (p) => { const b = boardS20(p); return { ...b, details: { ...b.details, todos: store<readonly Todo[]>([['read the dock\'s stage and clip code', 'done'], ['centre the pages by layout', 'doing'], ['run the dock\'s tests', 'todo'], ['run the WebKit job', 'todo']]) } }; } },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(900);
          (document.activeElement as HTMLElement | null)?.blur();
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

/* Settings (boards 14 and S39): the dialog over the board's own screen. Board 14 is General over kai's chat (the rail, no dock); S39 is
   Sessions over a session at work, its scope on "This project". What the boards draw and the app does not have (S39's rows but How
   careful; 14's Under the composer words) is compared by the page's frame: the nav, the title and the scope, the sections' places */
const settingsOver = (section: string, then?: (c: AppCtx) => Promise<void>) => async (c: AppCtx): Promise<void> => {
  c.hx.emit('hx:open-settings', { section, from: 'lab' });
  await c.wait(700);
  if (then) { await then(c); await c.wait(500); }
  (document.activeElement as HTMLElement | null)?.blur();   /* the boards draw the dialog at rest */
};
const settings: Story = {
  id: 'boards/settings', title: 'Boards: Settings', area: 'settings', kind: 'page', covers: ['page:board-14', 'page:board-S39'], mock: { url: '/__boards/screen.html?s=settings', note: MOCK.note },
  states: {
    '14 settings, General': {
      tags: ['typical', 'owner'],
      /* board 14 draws both (rule 7): the nav 12 down and 8 in (kit.css `.setnav`, its rows at --r-nav), and the close a ghost 28 circle 10 in
         (`.d-close` with no fill) in the dialog's 14 corner */
      allow: { concentric: 'board 14 draws the nav 12 down and 8 in, and the ghost close 10 in from the 14 corner (kit.css .setnav, .d-close): REPASS rule 7' },
      note: 'board 14: the dialog over kai\'s chat: the nav with its icons (S39\'s order, Diagnostics last), General: Layout (Show the dock, When the sidebar collapses, Rail size, Show search, Search shows as), Under the composer (the line\'s items, checked), Appearance (Theme, Accent, Corners)',
      app: {
        provider: { sessions: 'none', patch: (p) => withSettings(board11(p), { rules: fakeRules(), speech: fakeSpeech() }) },
        setup: async (c: AppCtx) => {
          saveChrome({ rail: 'auto', search: true, searchAs: 'button' });
          saveLineHidden(['model', 'cost']);
          c.hx.setState({ tab: 'bots', left: 'rail', right: 'closed' });
          await c.wait(300);
          c.hx.emit('hx:bot-select', { id: 'kai', from: 'lab' });
          await c.wait(700);
          await settingsOver('general')(c);
        }
      }
    } satisfies State,
    'S39 settings, Sessions': {
      tags: ['variant', 'owner'],
      /* board S39 draws both, as 14 (rule 7): the nav 12 down and 8 in (kit.css `.setnav`, its rows at --r-nav), and the close a ghost 28 circle 10 in
         (`.d-close` with no fill) in the dialog's 14 corner */
      allow: { concentric: 'board 14 draws the nav 12 down and 8 in, and the ghost close 10 in from the 14 corner (kit.css .setnav, .d-close): REPASS rule 7' },
      note: 'board S39 (its scope picked on S04: a Segmented in the page head): Sessions over a session at work, "This project" chosen',
      app: {
        provider: { patch: (p) => withSettings(boardS20(p), { rules: fakeRules(), speech: fakeSpeech() }) },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'open', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]');
          await c.wait(900);
          await settingsOver('sessions', async (cc) => { await cc.click('#hx-settings [data-scope] [data-value="project"]'); })(c);
        }
      }
    } satisfies State
  }
};

/* the Store (board 15): the kit's wide Dialog over a session, its front page as the board draws it (board15 in board-fixtures.ts) */
const storeBoard: Story = {
  id: 'boards/store', title: 'Boards: the Store', area: 'store', kind: 'page', covers: ['page:board-15'], mock: { url: '/__boards/screen.html?s=store', note: MOCK.note },
  states: {
    '15 the store': {
      tags: ['typical', 'owner'],
      note: 'board 15: the Store over a session: its head ("3 installed"), the search, the kinds and "Reading sources 0 of 1", Recommended in two columns (Context7 hovered, GitHub installed so Open), Mods',
      /* board 15 draws the ghost close 10 in from the dialog's 14 corner (kit.css .d-close), as board 14 (rule 7) */
      allow: { concentric: 'board 15 draws the ghost close 10 in from the 14 corner (kit.css .d-close): REPASS rule 7' },
      force: [{ sel: '#hx-store [data-store-item-row="boopis:context7"]', state: 'hover' }],
      app: {
        provider: { patch: board15 },
        setup: async (c: AppCtx) => {
          c.hx.setState({ tab: 'session', left: 'rail', right: 'closed' });
          await c.wait(300);
          await c.click('[data-kit~="ListRow"][data-id="s17-dock"]').catch(() => undefined);
          await c.wait(500);
          c.hx.emit('hx:open-store', { screen: 'browse' });
          await c.wait(1500);
          (document.activeElement as HTMLElement | null)?.blur();   /* the board draws the dialog at rest */
        }
      }
    } satisfies State
  }
};

export default [bots, sessions, dock, settings, storeBoard];
