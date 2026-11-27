// @vitest-environment jsdom
/* Team chat in the Bots tab, and a live bot's composer, over the provider interface: the tests say what the user sees and what
   is asked of the provider, never how the engine answers (that is `host/live/groups.test.ts` and `bots.test.ts`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '@boopis/ui';
import { setProvider } from '../../data';
import type { Bot, BotInfo, BotsEvent, DataProvider, Group, GroupsSource } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { emitter } from '../../data/store';
import '../cards';
import { setState } from '../../core/state';
import { S } from './model';
import { registered } from '../../core/registry';
import './index';

const q = <T extends HTMLElement>(sel: string): T => { const n = document.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };
const tick = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(20); await tick(); };

let provider: DataProvider;
const calls: { fn: string; args: unknown[] }[] = [];
function spyGroups(g: GroupsSource): GroupsSource {
  const rec = <A extends unknown[], R>(fn: string, f: (...a: A) => R) => (...args: A): R => { calls.push({ fn, args }); return f(...args); };
  return { ...g, send: rec('send', g.send), unqueue: rec('unqueue', g.unqueue), sendNow: rec('sendNow', g.sendNow), stop: rec('stop', g.stop), create: rec('create', g.create), rename: rec('rename', g.rename), setMembers: rec('setMembers', g.setMembers), archive: rec('archive', g.archive), restore: rec('restore', g.restore), open: rec('open', g.open), setRoundLimit: rec('setRoundLimit', g.setRoundLimit) };
}
function mount(p: DataProvider): void {
  provider = p; setProvider(p);
  S.bots = []; S.rows.clear(); S.groupRows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null; S.groupSel = null; S.groups = []; S.groupThreads = {}; S.sheetOpen = false; S.sheetFor = null;
  document.body.replaceChildren();
  const list = document.createElement('div'), root = document.createElement('div'), shell = document.createElement('aside');
  shell.id = 'hx-right-shell';
  document.body.append(list, root, shell);
  Element.prototype.scrollIntoView = (): void => undefined;
  (Element.prototype as unknown as { animate: () => void }).animate = (): void => undefined;
  Element.prototype.scrollTo = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
  setState({ tab: 'bots', right: 'open' });   /* the details pane is open: a room's own controls are there */
}
/* the room's composer is the kit's: its text, its end button, what is typed into it */
const text = (): HTMLElement => q('.bt-group .k7-composer__text');
const type = (t: string): void => { const n = text(); n.textContent = t; n.dispatchEvent(new Event('input', { bubbles: true })); };
const typeAtCaret = (t: string): void => { const n = text(); n.focus(); n.textContent = t; const r = document.createRange(); r.setStart(n.firstChild as Node, t.length); r.collapse(true); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); n.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t.slice(-1) })); };
const endButton = (): HTMLButtonElement => q<HTMLButtonElement>('.bt-group .k7-composer [data-send]');
const stopButton = (): HTMLButtonElement => q<HTMLButtonElement>('.bt-group .k7-composer [data-stop]');
const openRoom = (): void => { q('.bt-group-rows [data-kit~="ListRow"]').click(); };
const paneRow = (name: string): HTMLElement => q('#hx-right-bots [data-room="' + name + '"]');
const withGroups = (): DataProvider => { const m = createMockProvider({ simulate: false, fixtures: ['groups'] }); return { ...m, groups: spyGroups(m.groups) }; };

beforeEach(() => {
  kit.notifyReset();
  calls.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });


describe('groups in the list', () => {
  it('lists each group under "Groups", by its name and who spoke last', () => {
    mount(withGroups());
    const rows = [...document.querySelectorAll('.bt-group-rows [data-kit~="ListRow"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('release crew');
    expect(rows[0]!.getAttribute('aria-label')).toMatch(/^release crew, /);
    expect(rows[0]!.querySelector('.ui-stack')).not.toBeNull();
    expect(q('.bt-groups [data-kit~="SectionHead"]').textContent).toBe('Groups');
    /* board K02 draws no New group under the rows: it is the sidebar's "+" (the shell's menu) and the palette's */
    expect(document.querySelector('.bt-groups button')).toBeNull();
  });
  it('a room\'s line is who spoke last and what they said', async () => {
    mount(withGroups());
    const { onGroupsEvent } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!, m = g.members[1]!;
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'text', id: 'l1', who: m.id, t: '10:05', text: 'the deploy is ready', round: 0 } });
    onGroupsEvent({ type: 'group', group: { ...g } });
    expect(q('.bt-group-rows [data-kit~="ListRow"] .k7-lrow__sub').textContent).toBe(m.name + ': the deploy is ready');
  });
  it('has no rows where there are no groups', () => {
    mount({ ...createMockProvider({ simulate: false }) });
    expect(document.querySelectorAll('.bt-group-rows [data-kit~="ListRow"]')).toHaveLength(0);
  });
});

describe('a bot that is not in the room, named in it', () => {
  beforeEach(async () => {
    (Range.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }); mount(withGroups()); openRoom(); await flush();
  });
  it('says so under a member’s message and offers it in that bot’s own chat, without sending it anywhere', async () => {
    const { onGroupsEvent } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!;
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'text', id: 'x1', who: g.members[0]!.id, t: '10:05', text: '@sol please confirm the tag. Thanks @kai.', round: 1, to: [] } });
    const note = q('.bt-group .bt-outside');
    expect(note.matches('[data-kit~="Notice"]')).toBe(true);
    expect(note.textContent).toContain("sol isn't in this room");
    expect(note.textContent).not.toContain('kai');
    q<HTMLButtonElement>('.bt-group .bt-outside button').click();
    expect(S.view).toBe('bot');
    expect(S.sel).toBe('sol');
    expect(S.composer!.value).toContain('> @sol please confirm the tag.');
    expect(calls.some((c) => c.fn === 'send')).toBe(false);
  });
  it('says so over the owner’s draft (the kit’s Notice), with the same action', () => {
    type('@sol are you there');
    const hint = q('.bt-group .bt-composer-zone [data-kit~="Notice"]');
    expect(hint.textContent).toContain("sol isn't in this room");
    expect(hint.querySelector('button')?.textContent).toBe('Send to sol');
    /* in the draft the bot that is not here is its muted chip, and the words are untouched */
    expect(text().querySelector('.k7-mention[data-out]')).not.toBeNull();
    expect(text().textContent).toBe('@sol are you there');
    hint.querySelector<HTMLButtonElement>('button')!.click();
    expect(S.sel).toBe('sol');
    expect(S.composer!.value).toBe('@sol are you there');
  });
});

describe('a group’s thread', () => {
  beforeEach(() => { mount(withGroups()); openRoom(); });
  it('opens in the room and reads its messages; the room has no header of its own', async () => {
    await flush();
    expect(calls.some((c) => c.fn === 'open')).toBe(true);
    expect(q('.bt-group').hidden).toBe(false);
    expect(q<HTMLElement>('.bt-room:not(.bt-group)').hidden).toBe(true);
    expect(document.querySelector('.bt-group header, .bt-group .bt-ghead')).toBeNull();
    expect(q('.bt-group .bt-log > [data-kit~="TimeSeparator"]')).toBe(q('.bt-group .bt-log').firstElementChild);
  });
  it('shows each message by the one who wrote it (its name and its orb in the gutter), and the user’s own as “You”', () => {
    const entries = [...document.querySelectorAll<HTMLElement>('.bt-group [data-hx-turn]')];
    expect(entries.length).toBe(4);
    expect(entries[0]!.getAttribute('aria-label')).toMatch(/^You/);
    expect(entries.slice(1).map((e) => e.querySelector('.k7-byline')?.textContent)).toEqual(['atlas', 'nina', 'kai'].map((n) => provider.bots.snapshot().bots.find((b) => b.id === n)!.name));
    expect(entries.slice(1).every((e) => !!e.querySelector('.k7-gutter__orb orb-avatar'))).toBe(true);
    /* whom an answer is for is in the turn's name (board 12 draws the member's name alone) */
    expect(entries[1]!.getAttribute('aria-label')).toContain(', to you');
  });
  it('sends what is written to the group, exactly as written', async () => {
    type('@nina what is left?');
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(calls.find((c) => c.fn === 'send')!.args).toEqual(['room-release', '@nina what is left?', 'when-done']);
    expect(text().textContent).toBe('');
  });
  it('ctrl Enter sends too: nothing typed is ever dropped', () => {
    type('ship it');
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(calls.filter((c) => c.fn === 'send').map((c) => c.args[1])).toEqual(['ship it']);
  });
  it('addresses a member with "@": the kit\'s Menu of the room\'s members (and the room) under its heading, and the pick is the member\'s chip in the text', async () => {
    const g = provider.groups.snapshot().groups[0]!;
    typeAtCaret('@');
    await flush();
    const menu = q('.k7-menu[data-floating]');
    expect(menu.querySelector('.k7-menu__head')?.textContent).toBe('Members');
    expect([...menu.querySelectorAll('[data-kit~="MenuRow"] .k7-mrow__name')].map((x) => x.textContent)).toEqual([...g.members.map((m) => m.name), 'all']);
    expect(menu.textContent).toContain('Only the bots you name answer. With no name, every member does.');
    [...menu.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')][1]!.click();
    await flush();
    expect(text().textContent).toBe('@' + g.members[1]!.handle + ' ');
    const chip = q('.bt-group .k7-composer__text [data-kit~="InlineChip"][data-kind="mention"]');
    expect(chip.getAttribute('contenteditable')).toBe('false');   /* one unit: the caret steps over it, one Backspace takes it out */
    expect(chip.getAttribute('data-words')).toBe('@' + g.members[1]!.handle);
    expect(chip.querySelector('.ui-orb')?.getAttribute('data-bot')).toBe(g.members[1]!.profile);
    expect(chip.querySelector('[data-name]')?.getAttribute('data-name')).toBe(g.members[1]!.name);
  });
  it('a mention typed by hand becomes its chip once something follows it, and the text sent is the words typed', () => {
    const g = provider.groups.snapshot().groups[0]!, h = g.members[0]!.handle;
    typeAtCaret('thanks @' + h);
    expect(text().querySelector('[data-kind="mention"]')).toBeNull();   /* still being typed at the caret */
    typeAtCaret('thanks @' + h + ' and @all');
    type('thanks @' + h + ' and @all, done');
    expect([...text().querySelectorAll('[data-kind="mention"]')].map((c) => c.getAttribute('data-words'))).toEqual(['@' + h, '@all']);
    expect(text().querySelector('[data-words="@all"] .ui-stack')).not.toBeNull();   /* the room, as its members' stack */
    text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(calls.find((c) => c.fn === 'send')!.args[1]).toBe('thanks @' + h + ' and @all, done');
  });
  it('the line under the composer says how many members, and pressing it starts a mention', async () => {
    const item = q('.bt-group .k7-composer__line [data-line="members"]');
    expect(item.textContent).toBe('3 members');
    item.click();
    expect(text().textContent).toBe('@');
  });
  it('says a draft’s "@kai." names nobody, and leaves it as text', async () => {
    const g = provider.groups.snapshot().groups[0]!, h = g.members[0]!.handle;
    type('thanks @' + h + '.');
    expect(text().querySelector('[data-kind="mention"]')).toBeNull();
    expect(q('.bt-group .bt-composer-zone [data-kit~="Notice"]').textContent).toBe('“@' + h + '.” names nobody: the “.” right after the name counts as part of it.');
  });
  it('shows who is replying at the thread\'s tail (the kit\'s StatusLine with the members\' stack), and says so to the screen reader', async () => {
    const first = provider.groups.snapshot().groups[0]!;
    const { onGroupsEvent } = await import('./group-room');
    onGroupsEvent({ type: 'group', group: { ...first, working: [first.members[0]!.id, first.members[1]!.id] } });
    const lines = [...document.querySelectorAll<HTMLElement>('.bt-group .bt-log > [data-kit~="StatusLine"]')];
    expect(lines).toHaveLength(1);
    const names = [first.members[0]!.name, first.members[1]!.name];
    expect(lines[0]!.querySelector('.k7-status__phrase')!.textContent).toBe(names[0] + ' and ' + names[1] + ' are replying');
    expect(lines[0]!.querySelectorAll('.ui-stack orb-avatar')).toHaveLength(2);
    expect(lines[0]!.getAttribute('role')).toBe('status');
    expect(lines[0]).toBe(q('.bt-group .bt-log').lastElementChild);
    /* one of them finishes: one name and its orb left; a reply lands above the line */
    onGroupsEvent({ type: 'group', group: { ...first, working: [first.members[1]!.id] } });
    expect(q('.bt-group .bt-log > [data-kit~="StatusLine"] .k7-status__phrase').textContent).toBe(names[1] + ' is replying');
    onGroupsEvent({ type: 'message', groupId: first.id, message: { kind: 'text', id: 'r1', who: first.members[0]!.id, t: '10:05', text: 'Done.', round: 0 } });
    expect(q('.bt-group .bt-log').lastElementChild?.matches('[data-kit~="StatusLine"]')).toBe(true);
    /* nobody left: the line goes */
    onGroupsEvent({ type: 'group', group: { ...first, working: [] } });
    expect(document.querySelector('.bt-group .bt-log > [data-kit~="StatusLine"]')).toBeNull();
  });
  it('a member that only waits its turn is said to be next', async () => {
    const { replyingWords } = await import('./group-room');
    expect(replyingWords(['kai', 'moss'], [])).toBe('kai and moss are replying');
    expect(replyingWords([], ['nina'])).toBe('nina is next');
    expect(replyingWords([], [])).toBe('');
  });
  it('a line the room says is the kit\'s SystemLine; a routine a member made leads with the clock, a paused talk offers to let it run on', async () => {
    const { onGroupsEvent } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!;
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'note', id: 'n1', t: '10:05', text: 'Created routine Weekly changelog', about: 'routine' } });
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'note', id: 'n2', t: '10:06', text: 'The discussion paused at its limit.', more: 'round-3' } });
    const [made, paused] = [...document.querySelectorAll<HTMLElement>('.bt-group .bt-log > [data-kit~="SystemLine"]')];
    expect(made!.textContent).toBe('Created routine Weekly changelog');
    expect(made!.querySelector('svg')).not.toBeNull();
    const more = vi.spyOn(provider.groups, 'continueTalk').mockResolvedValue(undefined);
    paused!.querySelector<HTMLButtonElement>('button')!.click();
    await flush();
    expect(more).toHaveBeenCalledWith(g.id, 'round-3');
  });
  it('a hand-off is the kit\'s hand-off line: the lead\'s orb, a chevron, the member it went to, or the members stacked (6f)', async () => {
    const { onGroupsEvent } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!;
    const [a, b, c] = g.members;
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'note', id: 'h1', t: '10:07', text: a!.name + ' gave this to ' + b!.name + '.', handoff: { from: a!.id, to: [b!.id] } } });
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'note', id: 'h2', t: '10:08', text: 'two', handoff: { from: a!.id, to: [b!.id, c?.id ?? b!.id] } } });
    const [one, two] = [...document.querySelectorAll<HTMLElement>('.bt-group .bt-log > [data-handoff]')];
    expect(one!.getAttribute('data-variant')).toBe('handoff');
    expect(one!.textContent).toBe(a!.name + ' gave this to ' + b!.name + '.');
    expect(one!.querySelectorAll('orb-avatar').length).toBe(2);
    expect(one!.querySelector('.k7-sys__chev')).not.toBeNull();
    expect(two!.querySelector('.k7-stack, [class*="stack"]')).not.toBeNull();
  });
  it('says that a member is also running a kanban task, which is a second session of the same bot', async () => {
    const { repaintRoom } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!;
    const member = S.bots.find((b) => b.id === g.members[0]!.profile)!;
    expect(document.querySelector('.bt-group .bt-composer-zone [data-kit~="Notice"]')).toBeNull();
    member.info = { profile: member.id, path: '', model: null, provider: null, skills: null, toolsets: null, mcpServers: null, jobs: null, sessions: null, soul: null, running: true, worker: { title: 'review the render' }, notes: {} };
    repaintRoom();
    expect(q('.bt-group .bt-composer-zone [data-kit~="Notice"]').textContent).toMatch(new RegExp(member.name + ' is also running a kanban task'));
    member.info = { ...member.info, worker: null };
    repaintRoom();
    expect(document.querySelector('.bt-group .bt-composer-zone [data-kit~="Notice"]')).toBeNull();
  });
});

describe('a member’s approval, in the room', () => {
  beforeEach(async () => { mount(withGroups()); openRoom(); await flush(); });
  const nina = (): Bot => S.bots.find((b) => b.id === 'nina')!;
  it('is drawn as the kit\'s AskCard under what that member last said, and deciding it is the bot\'s own approval', async () => {
    const card = q('.bt-group .bt-log > .bt-ask [data-kit~="AskCard"]');
    expect(card.textContent).toContain('nina asks');
    const turn = card.closest('.bt-ask')!.previousElementSibling as HTMLElement;
    expect(turn.dataset['who']).toBe('nina');
    const decide = vi.spyOn(provider.bots, 'decide');
    card.querySelector<HTMLElement>('[data-value="deny"]')!.click();
    expect(decide).toHaveBeenCalledWith('nina', expect.any(String), 'denied');
  });
  it('leaves the room once it is decided anywhere', async () => {
    const { repaintRoom } = await import('./group-room');
    const list = S.threads['nina']!, i = list.findIndex((m) => m.kind === 'approval' && !m.resolved);
    list[i] = { ...(list[i] as Extract<typeof list[number], { kind: 'approval' }>), resolved: 'approved' };
    nina().attention = null;
    repaintRoom();
    expect(document.querySelector('.bt-group .bt-ask')).toBeNull();
  });
});

describe('the room\'s details (the title pill opens them): what the room itself can be told', () => {
  beforeEach(async () => { mount(withGroups()); openRoom(); await flush(); });
  it('heads the pane with the members\' stack and the name, lists the members, and a member\'s row opens its chat', () => {
    const pane = q('#hx-right-bots [data-kit~="Pane"]');
    expect(pane.querySelector('.k7-pane__head .ui-stack')).not.toBeNull();
    expect(pane.querySelector('.k7-pane__name')?.textContent).toBe('release crew');
    expect(pane.querySelector('[data-kit~="Segmented"]')).toBeNull();   /* a room has no Activity | Library */
    const members = [...pane.querySelectorAll<HTMLElement>('[data-member]')];
    expect(members.map((m) => m.dataset['member'])).toEqual(['atlas', 'nina', 'kai']);
    members[2]!.click();
    expect(S.view).toBe('bot');
    expect(S.sel).toBe('kai');
  });
  it('renames with Enter in the Name field, and Esc leaves it as it was', async () => {
    const input = q<HTMLInputElement>('#hx-right-bots input[data-room="name"]');
    input.value = 'launch crew';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(calls.find((c) => c.fn === 'rename')!.args).toEqual(['room-release', 'launch crew']);
    expect(q('#hx-right-bots .k7-pane__name').textContent).toBe('launch crew');
    expect(q('.bt-group-rows [data-kit~="ListRow"]').textContent).toContain('launch crew');
    const again = q<HTMLInputElement>('#hx-right-bots input[data-room="name"]');
    again.value = 'x';
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(again.value).toBe('launch crew');
    expect(calls.filter((c) => c.fn === 'rename')).toHaveLength(1);
  });
  it('sets the most rounds a run may take, from the kit\'s Menu, and says what the default is', async () => {
    expect(paneRow('limit').textContent).toContain('Default (10)');
    paneRow('limit').click();
    await flush();
    const menu = q('.k7-menu[data-floating]');
    expect(menu.querySelector('.k7-menu__head')?.textContent).toBe('Most rounds a run may take');
    const items = [...menu.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
    expect(items.map((i) => i.querySelector('.k7-mrow__name')?.textContent)).toEqual(['Default (10)', '5', '20', '30', '60', '100']);
    expect(items.map((i) => !!i.querySelector('svg'))).toEqual([true, false, false, false, false, false]);   /* the one kept carries the check */
    items[2]!.click();
    await flush();
    expect(calls.filter((c) => c.fn === 'setRoundLimit').map((c) => c.args)).toEqual([[expect.any(String), 20]]);
    expect(paneRow('limit').textContent).toContain('20');
  });
  it('Members opens the form that makes the room again with another set', () => {
    paneRow('members').click();
    expect(q('.bt-new:not([hidden])').textContent).toMatch(/archives this one/);
  });
  it('archives it, drops it from the list and offers Undo', async () => {
    paneRow('archive').click();
    await flush();
    expect(calls.some((c) => c.fn === 'archive')).toBe(true);
    expect(document.querySelectorAll('.bt-group-rows [data-kit~="ListRow"]')).toHaveLength(0);
    expect(q('.bt-archived').textContent).toContain('release crew');
    expect(q('.k7-notify').textContent).toContain('Undo');
  });
});

describe('a message written while the members are working', () => {
  const first = (): Group => provider.groups.snapshot().groups[0]!;
  const busyWith = async (queued: readonly { id: string; text: string; t: string }[] = []): Promise<void> => {
    const { onGroupsEvent } = await import('./group-room');
    const g = first();
    const working = [g.members[0]!.id];
    Object.assign(S.groups[0]!, { working, busy: true, queued });
    onGroupsEvent({ type: 'group', group: { ...g, working, busy: true, queued } });
  };
  const held = (): HTMLElement => q('.bt-group .bt-composer-zone [data-kit~="Queue"]');
  beforeEach(() => { mount(withGroups()); openRoom(); });

  it('shows Stop beside the mic while the room works, and Queue on the primary circle once something is typed', async () => {
    expect(document.querySelector('.bt-group .k7-composer')?.hasAttribute('data-running')).toBe(false);
    await busyWith();
    expect(document.querySelector('.bt-group .k7-composer')?.hasAttribute('data-running')).toBe(true);
    expect(stopButton().getAttribute('aria-label')).toBe('Stop');
    type('and the changelog?');
    expect(endButton().getAttribute('aria-label')).toBe('Queue');
    type('');
    expect(endButton().getAttribute('aria-label')).toBe('Talk: set up a voice model first');   /* the voice circle again: no voice model is set up in the mock */
  });
  it('keeps what was typed when the room starts or stops working under it', async () => {
    type('half a thought');
    await busyWith();
    expect(text().textContent).toBe('half a thought');
  });
  it('sends it as "when done", never as a stop: the provider is asked to hold it, and nothing is stopped', async () => {
    await busyWith();
    type('and the changelog?');
    endButton().click();
    await flush();
    expect(calls.filter((c) => c.fn === 'send').map((c) => c.args)).toEqual([['room-release', 'and the changelog?', 'when-done']]);
    expect(calls.some((c) => c.fn === 'stop')).toBe(false);
  });
  it('Stop stops the room', async () => {
    await busyWith();
    stopButton().click();
    expect(calls.some((c) => c.fn === 'stop')).toBe(true);
  });
  it('shows a held message over the composer (the kit\'s Queue, held), and says what Send now does before it is pressed', async () => {
    expect(document.querySelector('.bt-group .bt-composer-zone [data-kit~="Queue"]')).toBeNull();
    await busyWith([{ id: 'q1', text: 'and the changelog?', t: '10:02' }]);
    expect(held().dataset['variant']).toBe('held');
    expect(held().querySelector('.k7-queue__text')?.textContent).toBe('1 message waits until the discussion ends');
    expect(held().querySelector('[data-queue="now"]')?.getAttribute('data-tip')).toBe('Waiting for atlas to finish. Send now stops that turn.');
    expect(held().querySelector('[data-queue="edit"]')?.getAttribute('aria-label')).toBe('Take back: and the changelog?');
    expect(held().closest('.bt-zone-slot')!.nextElementSibling).toBe(q('.bt-group .bt-composer'));
  });
  it('counts the held messages', async () => {
    await busyWith([{ id: 'q1', text: 'a', t: '10:02' }, { id: 'q2', text: 'b', t: '10:03' }]);
    expect(held().querySelector('.k7-queue__text')?.textContent).toBe('2 messages wait until the discussion ends');
  });
  it('sends a held message now: that is the one thing that stops the turns, and it is asked of the provider by the message', async () => {
    await busyWith([{ id: 'q1', text: 'and the changelog?', t: '10:02' }]);
    held().querySelector<HTMLElement>('[data-queue="now"]')!.click();
    await flush();
    expect(calls.filter((c) => c.fn === 'sendNow').map((c) => c.args)).toEqual([['room-release', 'q1']]);
    expect(calls.some((c) => c.fn === 'send')).toBe(false);
  });
  it('takes a held message back: its words return to the composer and it is no longer held', async () => {
    const m = createMockProvider({ simulate: true, fixtures: ['groups'] });
    mount({ ...m, groups: spyGroups(m.groups) });
    openRoom();
    const slot = q('.bt-group .bt-composer');
    slot.dispatchEvent(new CustomEvent('ui:send', { detail: { text: 'first' } }));
    await flush();
    slot.dispatchEvent(new CustomEvent('ui:send', { detail: { text: 'and the changelog?' } }));
    await flush();
    held().querySelector<HTMLElement>('[data-queue="edit"]')!.click();
    expect(calls.filter((c) => c.fn === 'unqueue')).toHaveLength(1);
    expect(text().textContent).toBe('and the changelog?');
    await flush();
    expect(document.querySelector('.bt-group .bt-composer-zone [data-kit~="Queue"]')).toBeNull();
  });
  it('hides the strip when the held message goes out', async () => {
    await busyWith([{ id: 'q1', text: 'x', t: '10:02' }]);
    const { onGroupsEvent } = await import('./group-room');
    const g = first();
    onGroupsEvent({ type: 'group', group: { ...g, working: [], busy: false, queued: [] } });
    expect(document.querySelector('.bt-group .bt-composer-zone [data-kit~="Queue"]')).toBeNull();
    expect(endButton().getAttribute('aria-label')).not.toBe('Stop');
  });
});

describe('making a group', () => {
  beforeEach(async () => { mount(withGroups()); const { emit } = await import('../../core/bus'); emit('hx:new-group', { from: 'test' }); });
  it('opens the form with every bot to pick, and cannot be made with fewer than two', () => {
    expect(q('.bt-new:not([hidden]) label[for="bt-group-name"]').textContent).toBe('Name');
    expect(document.querySelectorAll('.bt-new:not([hidden]) [data-member]').length).toBe(provider.bots.snapshot().bots.length);
    expect(q<HTMLButtonElement>('.bt-new:not([hidden]) [data-go]').disabled).toBe(true);
    q('.bt-new:not([hidden]) [data-member]').click();
    expect(q<HTMLButtonElement>('.bt-new:not([hidden]) [data-go]').disabled).toBe(true);
  });
  it('stops at six members', () => {
    const members = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) [data-member]')];
    members.forEach((m) => m.click());
    expect(members.filter((m) => m.getAttribute('aria-checked') === 'true')).toHaveLength(Math.min(6, members.length));
  });
  it('makes the group with the picked bots and opens it', async () => {
    const members = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) [data-member]')];
    members[0]!.click(); members[1]!.click();
    const name = q<HTMLInputElement>('.bt-new:not([hidden]) [data-group-name]');
    name.value = 'night shift';
    q<HTMLButtonElement>('.bt-new:not([hidden]) [data-go]').click();
    await flush();
    expect(calls.find((c) => c.fn === 'create')!.args).toEqual([{ name: 'night shift', bots: [members[0]!.dataset['member'], members[1]!.dataset['member']] }]);
    expect(S.view).toBe('group');
    expect(q('#hx-right-bots .k7-pane__name').textContent).toBe('night shift');
    expect(document.querySelectorAll('.bt-group-rows [data-kit~="ListRow"]')).toHaveLength(2);
  });
  it('says why when it is not made, and keeps the form', async () => {
    const m = createMockProvider({ simulate: false, fixtures: ['groups'] });
    mount({ ...m, groups: { ...m.groups, create: () => Promise.reject(new Error('The room worker is off.')) } });
    const { emit } = await import('../../core/bus'); emit('hx:new-group', { from: 'test' });
    const members = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) [data-member]')];
    members[0]!.click(); members[1]!.click();
    q<HTMLButtonElement>('.bt-new:not([hidden]) [data-go]').click();
    await flush();
    expect(q('.bt-new:not([hidden]) [data-group-error]').textContent).toContain('The room worker is off.');
  });
  it('changing members says it makes a new group and archives this one, then asks for it', async () => {
    openRoom(); await flush();
    paneRow('members').click();
    expect(q('.bt-new:not([hidden])').textContent).toMatch(/archives this one/);
    const picked = [...document.querySelectorAll<HTMLElement>('.bt-new:not([hidden]) [data-member]')].filter((m) => m.getAttribute('aria-checked') === 'true');
    expect(picked).toHaveLength(3);
    picked[2]!.click();
    q<HTMLButtonElement>('.bt-new:not([hidden]) [data-go]').click();
    await flush();
    expect(calls.find((c) => c.fn === 'setMembers')!.args[0]).toBe('room-release');
    expect((calls.find((c) => c.fn === 'setMembers')!.args[1] as string[]).length).toBe(2);
  });
  it('cannot be made where group chat cannot run, and says why', async () => {
    const m = createMockProvider({ simulate: false });
    mount({ ...m, groups: { ...m.groups, note: () => 'Group chat is not running in the engine. Restart boopis and try again.' } });
    const { emit } = await import('../../core/bus'); emit('hx:new-group', { from: 'test' });
    expect(q<HTMLButtonElement>('.bt-new:not([hidden]) [data-go]').disabled).toBe(true);
    expect(q('.bt-new:not([hidden])').textContent).toContain('not running');
  });
});

/* a live bot: it has `info`, a composer, and its recent sessions open as the thread */
const INFO: BotInfo = { profile: 'atlas', path: '/h/p/atlas', model: 'main/a', provider: 'main', skills: [], toolsets: [], mcpServers: [], jobs: [], sessions: [{ id: 's1', title: 'review billing', when: '5m', messages: 4, source: 'gui' }], soul: '', running: false, notes: {} };
function liveBot(p: DataProvider): { provider: DataProvider; events: ReturnType<typeof emitter<BotsEvent>>; sent: unknown[][]; opened: string[]; fresh: string[] } {
  const events = emitter<BotsEvent>();
  const sent: unknown[][] = [], opened: string[] = [], fresh: string[] = [];
  const base = p.bots.snapshot();
  const bots: Bot[] = base.bots.map((b) => ({ ...b, info: { ...INFO, profile: b.id }, attention: null }));
  const source = { ...p.bots, snapshot: () => ({ bots, threads: Object.fromEntries(bots.map((b) => [b.id, []])) }), subscribe: (fn: (e: BotsEvent) => void) => events.subscribe(fn), send: (...a: unknown[]) => { sent.push(a); }, admin: undefined,
    sessions: { open: (_b: string, s: string) => { opened.push(s); return Promise.resolve(); }, fresh: (b: string) => { fresh.push(b); }, current: () => null } } as unknown as DataProvider['bots'];
  return { provider: { ...p, info: { ...p.info, live: true }, bots: source }, events, sent, opened, fresh };
}
describe('a member’s message that addresses the person (@user, the engine’s handle for them in a room)', () => {
  beforeEach(async () => { mount(withGroups()); openRoom(); await flush(); });
  it('draws @user as the person’s capsule (the kit\'s "you"), washes the bubble, and says “to you” in the turn\'s name', async () => {
    const { onGroupsEvent } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!, [a, b] = g.members;
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'text', id: 'h1', who: a!.id, t: '10:05', text: '@' + b!.handle + ' the numbering is off by one.', round: 1, to: [b!.id] } });
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'text', id: 'h2', who: b!.id, t: '10:06', text: 'Fair, fixed.\n\n@user, the fixes are ready. Should I go ahead?', round: 1, to: [a!.id] } });
    const washed = [...document.querySelectorAll<HTMLElement>('.bt-group .k7-bubble[data-to-you]')];
    expect(washed).toHaveLength(1);
    expect(washed[0]!.querySelector('[data-kit~="InlineChip"][data-kind="you"]')?.textContent).toBe('you');
    expect(washed[0]!.closest<HTMLElement>('[data-hx-turn]')!.getAttribute('aria-label')).toContain('you');
    /* the members' own rounds are plain messages of the thread (no board folds them) */
    expect(q('.bt-group .k7-bubble .k7-mention[data-mention="' + b!.profile + '"]').tagName).toBe('BUTTON');
  });
  it('reads @user only in what a member writes: the person’s own message addresses nobody by it', async () => {
    const { onGroupsEvent } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!;
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'text', id: 'u1', who: 'you', t: '10:09', text: 'tell @user it is fine' } });
    const mine = [...document.querySelectorAll<HTMLElement>('.bt-group .bt-request')].pop()!;
    expect(mine.textContent).toBe('tell @user it is fine');
    expect(mine.querySelector('[data-kind="you"]')).toBeNull();
  });
  it('the jump button counts the messages below the fold and says when one is for the person; "NEW" marks where they start', async () => {
    const { onGroupsEvent } = await import('./group-room');
    const g = provider.groups.snapshot().groups[0]!, [a] = g.members;
    const sc = q('.bt-group .bt-scroll');
    Object.defineProperty(sc, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(sc, 'clientHeight', { configurable: true, value: 400 });
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'text', id: 'j1', who: a!.id, t: '10:07', text: 'Notes are up.', round: 0 } });
    onGroupsEvent({ type: 'message', groupId: g.id, message: { kind: 'text', id: 'j2', who: a!.id, t: '10:08', text: '@user can you approve the tag?', round: 1 } });
    const jump = q<HTMLButtonElement>('.bt-group .bt-jump');
    expect(jump.hidden).toBe(false);
    expect(jump.textContent).toContain('2 new messages, 1 for you');
    expect(q('.bt-group .bt-log > [data-kit~="TimeSeparator"][data-unread]').textContent).toBe('NEW');
    jump.click();
    expect(jump.hidden).toBe(true);
  });
});

describe('a bot’s own chat: "@" names a teammate', () => {
  it('offers the other bots in the kit\'s Menu over the composer, says that naming one brings it nowhere, and sets the one picked into the text as its chip', async () => {
    mount(withGroups());
    const { emit } = await import('../../core/bus');
    emit('hx:bot-select', { id: 'atlas', from: 'test' }); await flush();
    const c = S.composer!;
    c.setValue(''); c.input.focus();
    c.input.textContent = 'ask @n';
    const r = document.createRange(); r.setStart(c.input.firstChild!, 6); r.collapse(true); getSelection()!.removeAllRanges(); getSelection()!.addRange(r);
    c.input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'n' }));
    await flush();
    const menu = q('.k7-menu[data-floating]');
    expect(menu.querySelector('.k7-menu__head')?.textContent).toBe('Bots');
    const rows = [...menu.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]')];
    const names = rows.map((x) => x.querySelector('.k7-mrow__name')?.textContent);
    expect(names).toContain('nina');
    expect(names).not.toContain('atlas');   /* the bot you are talking to is not offered */
    expect(names.every((n) => (n ?? '').startsWith('n'))).toBe(true);   /* what was typed after the "@" narrows the list */
    expect(menu.textContent).toContain('atlas reads the name. The bot you name does not see this chat.');
    rows.find((x) => x.dataset['value'] === 'nina')!.click();
    await flush();
    expect(c.value).toBe('ask @nina ');
    expect(c.input.querySelector('[data-kind="mention"]')?.getAttribute('data-words')).toBe('@nina');
  });
  it('a file added with "+" is a chip in the text, and its words are the "@" reference', async () => {
    const m = withGroups();
    mount({ ...m, files: { ...m.files, pick: () => Promise.resolve([{ name: 'notes.md', path: '/home/you/notes.md' }]) } as unknown as DataProvider['files'] });
    const { emit } = await import('../../core/bus');
    emit('hx:bot-select', { id: 'atlas', from: 'test' }); await flush();
    q('.bt-room:not(.bt-group) .k7-composer [data-plus]').click();
    await flush();
    const chip = q('.bt-room:not(.bt-group) .k7-composer__text [data-kind="reference"]');
    expect(chip.querySelector('[data-name]')?.getAttribute('data-name')).toBe('@notes.md');
    expect(chip.getAttribute('contenteditable')).toBe('false');
    expect(S.composer!.value).toBe('@/home/you/notes.md ');
  });
});

describe('a live bot’s room has a live composer', () => {
  it('shows the composer, sends to the bot, and keeps its earlier sessions in its details (Library), each opening that session', async () => {
    const l = liveBot(createMockProvider({ simulate: false }));
    mount(l.provider);
    const id = S.sel as string;
    expect(q('.bt-composer-zone').hidden).toBe(false);
    expect(q('.bt-room:not(.bt-group) .bt-log [data-kit~="EmptyState"]').textContent).toContain('Nothing here yet');
    q('.bt-composer').dispatchEvent(new CustomEvent('ui:send', { detail: { text: 'hello' } }));
    expect(l.sent).toEqual([[id, 'hello', 'bots']]);
    q('#hx-right-bots [data-kit~="Segmented"] [data-value="library"]').click();
    q('#hx-right-bots [data-session]').click();
    expect(l.opened).toEqual(['s1']);
  });
  it('draws a thread the provider swaps in, the reply as the bot’s, and a note as the kit\'s SystemLine', async () => {
    const l = liveBot(createMockProvider({ simulate: false }));
    mount(l.provider);
    const id = S.sel as string;
    l.events.emit({ type: 'thread', botId: id, messages: [{ kind: 'text', id: 'a', who: 'you', t: '10:00', text: 'review billing' }, { kind: 'text', id: 'b', who: id, t: '10:01', text: 'Looks fine.' }, { kind: 'note', id: 'n', who: 'app', t: '10:02', text: 'Your message was not sent.' }] });
    expect(document.querySelectorAll('.bt-log [data-hx-turn]')).toHaveLength(2);
    expect(q('.bt-note').matches('[data-kit~="SystemLine"]')).toBe(true);
    expect(q('.bt-note').textContent).toContain('not sent');
    expect(q('.bt-log').textContent).toContain('Looks fine.');
    expect(q('.bt-topline [data-action="new-session"]')).toBeTruthy();
    q('[data-action="new-session"]').click();
    expect(l.fresh).toEqual([id]);
  });
});

describe('a group’s kanban board', () => {
  const kanban = (): NonNullable<DataProvider['kanban']> => ({
    boards: () => Promise.resolve([{ slug: 'release-crew', name: 'Release crew', archived: false, counts: { running: 1 } }]),
    view: () => Promise.resolve({ board: { slug: 'release-crew', name: 'Release crew', archived: false, counts: { running: 1 } }, tasks: [{ id: 't1', title: 'Cut the tag', status: 'running', assignee: 'atlas', priority: 0, createdAt: null, startedAt: null, completedAt: null, problem: null }] })
  });
  beforeEach(async () => { mount({ ...withGroups(), kanban: kanban() }); openRoom(); await flush(); });
  const board = (): HTMLElement => paneRow('board');

  it('is reached from the room\'s details, takes the thread\'s place and gives it back', async () => {
    expect(board().textContent).toContain('Open');
    expect(q<HTMLElement>('.bt-board').hidden).toBe(true);
    board().click();
    await flush();
    expect(q<HTMLElement>('.bt-board').hidden).toBe(false);
    expect(q<HTMLElement>('.bt-group .bt-log').hidden).toBe(true);
    expect(q<HTMLElement>('.bt-group .bt-composer-zone').hidden).toBe(true);
    expect(q('.bt-board').textContent).toContain('Cut the tag');
    expect(board().textContent).toContain('Back to the thread');
    expect(board().getAttribute('aria-pressed')).toBe('true');
    board().click();
    expect(q<HTMLElement>('.bt-board').hidden).toBe(true);
    expect(q<HTMLElement>('.bt-group .bt-log').hidden).toBe(false);
  });
  it('is never a part of the message list', async () => {
    board().click();
    await flush();
    expect(document.querySelector('.bt-log .bt-board, .bt-log [data-task]')).toBeNull();
  });
  it('says there is no board where the build cannot read one', async () => {
    mount({ ...withGroups() });
    openRoom(); await flush();
    board().click();
    await flush();
    expect(q('.bt-board').textContent).toContain('This build cannot read kanban boards.');
  });
});
