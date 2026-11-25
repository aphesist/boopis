/* Who is at work, in the real rooms (the kit's presence wired by modules/bots/presence.ts), on the mock provider: a bot's own chat
   thinking, in a tool, waiting for the owner; a group with two thinking, three doing different things, a lead first, a message
   held while they work, a member also on a kanban task, and the room scrolled away so the pill carries it. "the dock, the sidebar
   and the chat agree" fails when any place draws the bot with another face. The two "watch" states are still until a message is
   sent (the clips send one): the mock then plays a real turn. The component's own states: chat/presence. */
import type { AppCtx, ProviderSpec, State, Story } from '../../types';
import { liveShaped, withActivity, withKanbanWorker, withQueue, withWorking } from '../../live-bots';
import { facesDisagree, firstMessages, withBotAt } from '../../live-presence';

const MOCK = { url: '/v6/__index.html', note: 'the mock opens on the session; its Bots tab is alt+2' };
const st = (tags: State['tags'], provider: ProviderSpec, setup: (c: AppCtx) => Promise<void>, extra: Partial<State> = {}): State => ({ tags, app: { provider, setup }, ...extra });
const bots = async (c: AppCtx): Promise<void> => { c.hx.setState({ tab: 'bots' }); await c.wait(500); };
const pick = (id: string) => async (c: AppCtx): Promise<void> => { await bots(c); c.hx.emit('hx:bot-select', { id, from: 'lab' }); await c.wait(700); };
const openGroup = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-group-rows > [data-kit~="ListRow"]'); await c.wait(700); };
const openPaper = async (c: AppCtx): Promise<void> => { await bots(c); await c.click('.bt-group-rows > [data-kit~="ListRow"]:nth-of-type(2)'); await c.wait(700); };
const own = (id: string, patch: Parameters<typeof withBotAt>[2]): ProviderSpec => ({ simulate: false, patch: (p) => withBotAt(liveShaped(p, true), id, patch) });
const grp = (patch: ProviderSpec['patch']): ProviderSpec => ({ fixtures: ['groups'], simulate: false, ...(patch ? { patch } : {}) });
const paper = (patch: ProviderSpec['patch']): ProviderSpec => ({ fixtures: ['groups', 'paper-past'], simulate: false, ...(patch ? { patch } : {}) });

const story: Story = {
  id: 'chat/presence-rooms', title: 'Who is at work, in the rooms', area: 'bots', kind: 'surface', covers: ['surface:bots-room', 'surface:bots-group'], scope: '#hx-view-bots', mock: MOCK,
  states: {
    "a bot's chat: thinking": st(['typical'], own('atlas', { state: 'thinking', activity: '' }), pick('atlas')),
    "a bot's chat: in a tool": st(['variant'], own('atlas', { state: 'working', activity: 'reading factcheck.md' }), pick('atlas')),
    "a bot's chat: needs your approval": st(['variant', 'owner'], { simulate: false, patch: (p) => withBotAt(p, 'nina', {}) }, pick('nina')),
    'the dock, the sidebar and the chat agree': st(['owner'], own('kai', { state: 'compute', activity: 'in the terminal' }), async (c) => {
      await pick('kai')(c);
      const bad = facesDisagree('kai');
      if (bad.length) throw new Error('the places that draw kai disagree: ' + bad.join('; '));
    }, { scope: '#hx-app', note: 'the roster, the header, the presence entry and the dock wear one face, from ui.botState' }),
    "a bot's chat: at 125%": st(['size'], own('atlas', { state: 'working', activity: 'reading factcheck.md' }), pick('atlas'), { zoom: 1.25 }),
    'a group: two thinking': st(['typical', 'owner'], grp((p) => withWorking(liveShaped(p))), openGroup),
    'a group: three doing different things': st(['variant'], paper((p) => withActivity(firstMessages(liveShaped(p), 2), [{ at: 0, status: 'running', tool: 'read_file' }, { at: 1, status: 'running' }, { at: 2, status: 'running', tool: 'terminal' }])), openPaper),
    'a group: a lead answers first': st(['variant'], grp((p) => { const q = withActivity(liveShaped(p), [{ at: 0, status: 'running' }, { at: 1, status: 'queued' }, { at: 2, status: 'queued' }]); return { ...q, groups: { ...q.groups, snapshot: () => { const s = q.groups.snapshot(); return { ...s, groups: s.groups.map((g) => ({ ...g, ...(g.members[0] ? { lead: g.members[0].id } : {}) })) }; } } }; }), openGroup),
    'a group: a message held while they work': st(['variant'], grp((p) => withQueue(liveShaped(p), ['and could you add the changelog to the notes?'], 2)), openGroup),
    'a group: one also on a kanban task': st(['variant'], grp((p) => withActivity(withKanbanWorker(liveShaped(p), 'review the render'), [{ at: 0, status: 'running', tool: 'patch' }, { at: 1, status: 'running' }])), openGroup),
    'a group: six at work': st(['many'], paper((p) => withActivity(firstMessages(liveShaped(p), 2), [0, 1, 2, 3, 4, 5].map((at) => ({ at, status: 'running' as const, tool: ['read_file', 'terminal', 'web_search', 'patch', 'execute_code', 'web_extract'][at] ?? null })))), openPaper),
    'a group: scrolled away while two think': st(['scroll'], paper((p) => withActivity(liveShaped(p), [{ at: 0, status: 'running' }, { at: 1, status: 'running', tool: 'read_file' }])), async (c) => {
      await openPaper(c);
      /* the bots' own rounds fold into one huddle, which leaves the thread shorter than the window: opened, it scrolls again */
      document.querySelector<HTMLElement>('#hx-view-bots .bt-group .bt-huddle-entry .ui-disclosure')?.click();
      await c.wait(400);
      const sc = document.querySelector<HTMLElement>('#hx-view-bots .bt-group .bt-scroll');
      if (sc) sc.scrollTop = 0;
      await c.wait(500);
      if (document.querySelector<HTMLElement>('#hx-view-bots .bt-group .bt-presence-pill')?.hidden !== false) throw new Error('the pill does not show while the presence entry is out of view');
    }),
    "a bot's chat: watch a turn": st(['variant'], { simulate: true, patch: (p) => liveShaped(p, true) }, pick('atlas'), { note: 'still until a message is sent; the clips send one and the mock plays the turn' }),
    'a group: watch them answer': st(['variant'], { fixtures: ['groups'], simulate: true, patch: (p) => liveShaped(p) }, openGroup, { note: 'still until a message is sent; the clips send "@all" and the members answer in turn' })
  }
};
export default story;
