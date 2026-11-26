/* The kit's conversation parts as the session's boards draw them (S05, S09, S20, S23), and the owner's 25 November decisions: the
   composer's own Stop, the words a text is read by (Marks), the upright tab switch, the turn's foot. Each behaves as a component:
   its states are in its markup, its controls fire the kit's events. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from './index';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { document.body.replaceChildren(); });

describe('Composer: Stop', () => {
  const stopOf = (c: HTMLElement): HTMLButtonElement => c.querySelector('[data-stop]') as HTMLButtonElement;
  const sendOf = (c: HTMLElement): HTMLButtonElement => c.querySelector('[data-send]') as HTMLButtonElement;
  it('sits at the start of the right cluster in every kind that has one: stop, mic, primary', () => {
    for (const kind of ['session', 'bot', 'room', 'dock'] as const) {
      const c = put(kit.composer({ kind, running: true }));
      const order = [...c.querySelectorAll('.k7-composer__box > button')].map((b) => (b.hasAttribute('data-plus') ? 'plus' : b.hasAttribute('data-stop') ? 'stop' : b.hasAttribute('data-mic') ? 'mic' : 'primary'));
      expect(order).toEqual(['plus', 'stop', 'mic', 'primary']);
    }
  });
  it('is named Stop, says its key, and fires ui:stop only while a turn runs', () => {
    const c = put(kit.composer({ kind: 'bot', running: true })), stop = vi.fn();
    c.addEventListener('ui:stop', stop);
    expect(stopOf(c).getAttribute('aria-label')).toBe('Stop');
    expect(stopOf(c).getAttribute('data-kbd')).toBe('mod+period');
    stopOf(c).click();
    expect(stop).toHaveBeenCalledTimes(1);
    kit.composerRunning(c, false);
    expect(c.hasAttribute('data-running')).toBe(false);
    stopOf(c).click();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it('the primary circle never becomes Stop: voice with no text, Queue with text while it runs, Send once it does not', async () => {
    const c = put(kit.composer({ kind: 'bot', running: true }));
    expect(sendOf(c).getAttribute('aria-label')).toBe('Talk');
    kit.composerInsert(c, 'and the tests');
    expect(sendOf(c).getAttribute('aria-label')).toBe('Queue');
    kit.composerRunning(c, false);
    await tick();
    expect(sendOf(c).getAttribute('aria-label')).toBe('Send');
  });
  it('the voice circle always shows (owner, 26 November): with no voice model it says so in its name and tip, and a press still asks', async () => {
    for (const kind of ['session', 'bot', 'room', 'dock'] as const) {
      const c = put(kit.composer({ kind, voiceSetup: true })), voice = vi.fn();
      c.addEventListener('ui:voice', (e) => { voice((e as CustomEvent<{ setup: boolean }>).detail.setup); });
      const b = sendOf(c);
      expect(b.hidden).toBe(false);
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.getAttribute('aria-label')).toBe('Talk: set up a voice model first');
      expect(b.getAttribute('data-tip')).toBe('Talk: set up a voice model first');
      expect(b.getAttribute('aria-haspopup')).toBe('dialog');
      b.click();
      expect(voice).toHaveBeenCalledWith(true);
      /* with text it is the send, and says nothing of voice; emptied, it is the voice circle again */
      kit.composerInsert(c, 'hello');
      expect(b.getAttribute('aria-label')).toBe('Send');
      expect(b.hasAttribute('aria-haspopup')).toBe(false);
      (c.querySelector('.k7-composer__text') as HTMLElement).textContent = '';
      (c.querySelector('.k7-composer__text') as HTMLElement).dispatchEvent(new Event('input', { bubbles: true }));
      expect(b.getAttribute('aria-label')).toBe('Talk: set up a voice model first');
    }
    /* a voice model set up: the same circle, named Talk, and the press says so */
    const c = put(kit.composer({ kind: 'bot' })), voice = vi.fn();
    c.addEventListener('ui:voice', (e) => { voice((e as CustomEvent<{ setup: boolean }>).detail.setup); });
    expect(sendOf(c).getAttribute('aria-label')).toBe('Talk');
    expect(sendOf(c).hasAttribute('aria-haspopup')).toBe(false);
    sendOf(c).click();
    expect(voice).toHaveBeenCalledWith(false);
    c.setAttribute('data-voice-setup', '');   /* the voice model goes: the name follows in place */
    await tick();
    expect(sendOf(c).getAttribute('aria-label')).toBe('Talk: set up a voice model first');
  });
  it('what does not exist is not shown: no send while a turn runs where nothing queues (the voice circle stays)', async () => {
    const c = put(kit.composer({ kind: 'session', running: true, voiceSetup: true, queueOff: true })), send = vi.fn(), refused = vi.fn();
    c.addEventListener('ui:send', send); c.addEventListener('ui:refused', refused);
    expect(sendOf(c).hidden).toBe(false);
    kit.composerInsert(c, 'wait');
    expect(sendOf(c).hidden).toBe(true);
    (c.querySelector('.k7-composer__text') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(send).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(1);
    expect(c.querySelector('.k7-composer__text')?.textContent).toBe('wait');
    c.removeAttribute('data-queue-off');   /* a typed message now has somewhere to go (a change waits for feedback) */
    await tick();
    expect(sendOf(c).hidden).toBe(false);
  });
});

describe('Composer: the line and the words it is read by', () => {
  it('draws S20\'s items: a glyph and a value, the branch as words that only say, a model with its effort ticks, the context\'s ticks and the cost at the end', () => {
    const c = put(kit.composer({ kind: 'session', line: [
      { label: 'How careful', value: 'Supervised', icon: 'shield', plain: true }, { label: 'Branch', value: 'w32/dock-paint', icon: 'fork', mono: true, plain: true, still: true },
      { label: 'Who answers next', value: 'sonnet 5.5', model: 'sonnet 5.5', plain: true, ticks: 3 }, { label: 'Context', value: '76k / 200k', mono: true, end: true, ticks: 2 }, { label: 'Cost', value: '$0.37 of $0.60', mono: true, end: true }
    ] }));
    const items = [...c.querySelectorAll<HTMLElement>('.k7-composer__item')];
    expect(items.map((i) => i.tagName)).toEqual(['BUTTON', 'SPAN', 'BUTTON']);
    expect(items[2]?.querySelectorAll('.k7-ticks > i[data-on]').length).toBe(3);
    const ends = [...c.querySelectorAll<HTMLElement>('.k7-composer__end')];
    expect(ends.map((e) => e.textContent)).toEqual(['76k / 200k', '$0.37 of $0.60']);
    expect(ends[0]?.querySelectorAll('.k7-ticks > i[data-on]').length).toBe(2);
  });
  it('marks the words the text is read by, dashed for a guess and solid for a choice, and leaves the text as it was typed', () => {
    const c = put(kit.composer({ kind: 'session', text: 'use auto margins on the page' }));
    const find = (chosen: boolean) => (t: string) => [{ at: t.indexOf('auto margins'), text: 'auto margins', kind: 'centre', chosen }, { at: t.indexOf('page'), text: 'page', kind: 'where' }];
    kit.composerMarks(c, find(false));
    const marks = (): HTMLElement[] => [...c.querySelectorAll<HTMLElement>('.k7-mark')];
    expect(marks().map((m) => m.textContent + ':' + m.dataset['mark'])).toEqual(['auto margins:shown', 'page:shown']);
    expect(c.querySelector('.k7-composer__text')?.textContent).toBe('use auto margins on the page');
    const first = marks()[0];
    kit.composerMarks(c, find(true));
    expect(marks()[0]).toBe(first);   /* the same marks are kept: nothing is drawn again under the caret */
    expect(marks()[0]?.dataset['mark']).toBe('chosen');
    kit.composerMarks(c, () => []);
    expect(marks().length).toBe(0);
    expect(c.querySelector('.k7-composer__text')?.textContent).toBe('use auto margins on the page');
  });
  it('a press on a mark asks what it is read as', () => {
    const c = put(kit.composer({ kind: 'session', text: 'fix the page' })), asked = vi.fn();
    c.addEventListener('ui:mark', (e) => { asked((e as CustomEvent<{ text: string; kind: string }>).detail); });
    kit.composerMarks(c, (t) => [{ at: t.indexOf('page'), text: 'page', kind: 'where' }]);
    (c.querySelector('.k7-mark') as HTMLElement).click();
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ text: 'page', kind: 'where' }));
  });
});

describe('the thread\'s parts', () => {
  it('ToolRow, a session\'s: the model\'s mark, the name, an edit\'s lines, and at the end what waits or what became of it', () => {
    const waiting = put(kit.toolRow({ kind: 'edit', state: 'waiting', tool: 'dock.css', model: 'sonnet 5.5', add: 12, del: 3, ask: { ask: 'Allow?', answers: [{ label: 'Deny', value: 'deny', outline: true, keys: 'esc' }, { label: 'Hold to allow once', value: 'once', hold: true, primary: true }] } }));
    expect(waiting.querySelector('.k7-tool__head .k7-word')?.textContent).toBe('Waiting for you');
    expect(waiting.querySelector('.k7-files__counts')?.textContent).toBe('+12−3');
    expect([...waiting.querySelectorAll('.k7-ask[data-variant="attached"] .k7-chip__label')].map((x) => x.textContent)).toEqual(['Deny', 'Hold to allow once']);
    expect(waiting.querySelector('.k7-ask__head')).toBeNull();   /* attached: the answers alone, the row's head says the rest */
    const done = put(kit.toolRow({ kind: 'edit', state: 'done', tool: 'dock.css', word: 'Denied 09:44', note: 'Keep the transform' }));
    expect(done.querySelector('.k7-word')?.textContent).toBe('Denied 09:44');
    expect(done.querySelector('.k7-tool__note')?.textContent).toBe('“Keep the transform”');
    expect(done.querySelector('.k7-chip')).toBeNull();
    expect(done.querySelector('.k7-tool__head')?.tagName).toBe('DIV');   /* nothing to open: the head is not a control */
  });
  it('ToolRow with steps opens and closes on its head', () => {
    const row = put(kit.toolRow({ kind: 'command', tool: 'npm test', steps: [{ text: 'ran 142 tests' }] }));
    const head = row.querySelector('.k7-tool__head') as HTMLButtonElement;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    head.click();
    expect(row.hasAttribute('data-open')).toBe(true);
  });
  it('FilesCard: the count and the turn\'s lines, an action at the head\'s end, a row per file; a long list folds', () => {
    const card = put(kit.filesCard({ files: [{ path: 'a.css', add: 12, del: 3 }, { path: 'b.ts', add: 2, del: 2 }], action: 'Open diff' }));
    expect(card.querySelector('.k7-files__title')?.textContent).toBe('2 changed files');
    expect(card.querySelector('.k7-files__head .k7-files__counts')?.textContent).toBe('+14−5');
    expect(card.querySelector('[data-files]')?.textContent).toBe('Open diff');
    expect(card.querySelectorAll('.k7-files__row').length).toBe(2);
    expect(card.hasAttribute('data-open')).toBe(true);
    expect(put(kit.filesCard({ files: [{ path: 'only.ts' }] })).querySelector('.k7-files__title')?.textContent).toBe('1 changed file');
    const long = put(kit.filesCard({ files: Array.from({ length: 12 }, (_, i) => ({ path: 'f' + i + '.ts' })), fold: true }));
    expect(long.hasAttribute('data-open')).toBe(false);
    (long.querySelector('.k7-files__fold') as HTMLElement).click();
    expect(long.hasAttribute('data-open')).toBe(true);
  });
  it('TurnFoot, a session\'s: the checkpoint, the actions that exist, the model with its time and cost; a bot\'s has no actions', () => {
    const foot = put(kit.turnFoot({ kind: 'session', label: 'Checkpoint 3', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '0m 59s', cost: '$0.08', actions: [{ label: 'Undo', value: 'undo', icon: 'back' }] }));
    expect(foot.querySelector('.k7-foot__label')?.textContent).toBe('Checkpoint 3');
    expect([...foot.querySelectorAll<HTMLElement>('.k7-foot__btn')].map((b) => b.dataset['value'])).toEqual(['undo']);
    expect(foot.querySelector('.k7-foot__meta')?.textContent?.trim()).toBe('sonnet 5.5 0m 59s $0.08');
    expect(put(kit.turnFoot({ kind: 'session', actions: [] })).querySelector('.k7-foot__acts')).toBeNull();
    expect([...put(kit.turnFoot({ kind: 'session' })).querySelectorAll('.k7-foot__btn')].map((b) => b.textContent)).toEqual(['Undo', 'Edit from here', 'Fork']);
    expect(put(kit.turnFoot({ kind: 'bot', model: 'sonnet 5.5', modelName: 'sonnet 5.5', time: '12s' })).querySelector('.k7-foot__btn')).toBeNull();
  });
  it('Disclosure: the chevron leads the summary, and the summary opens the steps', () => {
    const d = put(kit.disclosure({ variant: 'worklog', summary: 'Read 6 files', steps: [{ text: 'read_file' }] }));
    const sum = d.querySelector('.k7-disc__sum') as HTMLButtonElement;
    expect(sum.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    sum.click();
    expect(d.hasAttribute('data-open')).toBe(true);
    expect(sum.getAttribute('aria-expanded')).toBe('true');
  });
  it('the title pill says a session\'s branch after its name', () => {
    document.body.innerHTML = kit.html.titlePill({ title: 'Fix the dock', icon: 'session', sub: 'w32/dock-paint' });
    expect(document.querySelector('.k7-title__sub')?.textContent).toBe('w32/dock-paint');
    document.body.innerHTML = kit.html.titlePill({ title: 'kai' });
    expect(document.querySelector('.k7-title__sub')).toBeNull();
  });
});

describe('the upright switch and @all (owner, 25 November)', () => {
  const tabs = { value: 'bots', items: [{ value: 'session', label: 'Sessions', icon: 'session' }, { value: 'bots', label: 'Bots', icon: 'bots' }] };
  it('the rail carries the Segmented stood on its end: two named glyph items, the open tab chosen', () => {
    const rail = put(kit.rail({ bots: [], tabs, newLabel: 'New session' }));
    const seg = rail.querySelector('[data-rail-tabs]') as HTMLElement;
    expect(seg.dataset['kit']).toBe('Segmented');
    expect(seg.hasAttribute('data-upright')).toBe(true);
    expect(seg.getAttribute('aria-orientation')).toBe('vertical');
    expect([...seg.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-label') + ':' + t.getAttribute('aria-selected'))).toEqual(['Sessions:false', 'Bots:true']);
    expect(rail.querySelectorAll('.k7-tile').length).toBe(0);
    expect(rail.querySelector('.k7-rail__foot button')?.getAttribute('aria-label')).toBe('New session');
  });
  it('a press, or the arrows, choose a tab and say so', () => {
    const rail = put(kit.rail({ bots: [], tabs })), changed = vi.fn();
    rail.addEventListener('ui:change', (e) => { changed((e as CustomEvent<{ value: string }>).detail.value); });
    (rail.querySelector('[data-value="session"]') as HTMLElement).click();
    expect(changed).toHaveBeenCalledWith('session');
    const on = rail.querySelector('[aria-selected="true"]') as HTMLElement;
    on.focus();
    on.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(changed).toHaveBeenLastCalledWith('bots');
  });
  it('a rail without the switch is as it was', () => { expect(put(kit.rail({ bots: [] })).querySelector('[data-rail-tabs]')).toBeNull(); });
  it('a room\'s cluster: its members on the circle around the box\'s middle; a room with one member left is that one orb, its box the orb\'s', () => {
    const tri = (n: number): HTMLElement => put(kit.rail({ bots: [], groups: [{ name: 'crew', members: ['atlas', 'nina', 'kai'].slice(0, n).map((name) => ({ name })) }] })).querySelector('.k7-rail__tri') as HTMLElement;
    const at = (t: HTMLElement): { x: number; y: number }[] => [...t.querySelectorAll<HTMLElement>(':scope > span')].map((s) => ({ x: parseFloat(s.style.getPropertyValue('--x')), y: parseFloat(s.style.getPropertyValue('--y')) }));
    const one = tri(1);
    expect(one.hasAttribute('data-one')).toBe(true);
    expect(at(one)).toEqual([{ x: 0, y: 0 }]);
    /* the standard rail's cluster orb is 15 (0.42 of 36), its box 37.5: an orb on the middle starts at 18.75 - 7.5 */
    const three = tri(3), mid = 15 * 1.25 - 15 / 2, pts = at(three);
    expect(three.hasAttribute('data-one')).toBe(false);
    expect(pts).toHaveLength(3);
    expect(pts[0]!.y).toBeCloseTo(mid - 15 * 0.62, 5);   /* the first at the top */
    expect(pts.reduce((a, p) => a + p.x, 0) / 3).toBeCloseTo(mid, 5);
    expect(pts.reduce((a, p) => a + p.y, 0) / 3).toBeCloseTo(mid, 5);
  });
  it('@all is marked as the whole room\'s mention; a member\'s is not', () => {
    document.body.innerHTML = kit.html.inlineChip({ kind: 'mention', text: '@all', members: [{ name: 'kai' }, { name: 'nina' }] }) + kit.html.inlineChip({ kind: 'mention', bot: { name: 'kai' } });
    const [all, one] = [...document.querySelectorAll('.k7-mention')];
    expect(all?.hasAttribute('data-all')).toBe(true);
    expect(one?.hasAttribute('data-all')).toBe(false);
  });
});

describe('HoverBar: what a turn offers under the pointer or the focus', () => {
  const ACTS = [{ value: 'copy', icon: 'copy', label: 'Copy kai’s message', tip: 'Copy', keys: 'C' }, { value: 'more', icon: 'more', label: 'More for kai’s message', tip: 'More', menu: true }];
  it('is a named group of ghost IconButtons, each named, with its tip and its key; "more" says it opens a menu', () => {
    const bar = put(kit.hoverBar({ label: 'Actions on kai’s message', actions: ACTS }));
    expect([bar.getAttribute('role'), bar.getAttribute('aria-label')]).toEqual(['group', 'Actions on kai’s message']);
    const [copy, more] = [...bar.querySelectorAll<HTMLButtonElement>('button')] as [HTMLButtonElement, HTMLButtonElement];
    expect([copy.getAttribute('aria-label'), copy.getAttribute('data-tip'), copy.getAttribute('data-kbd'), copy.getAttribute('data-variant')]).toEqual(['Copy kai’s message', 'Copy', 'C', 'ghost']);
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
  });
  it('a press says which action, and on what (a menu opens against the button)', () => {
    const bar = put(kit.hoverBar({ label: 'Actions', actions: ACTS }));
    const got: Array<[string, Element]> = [];
    bar.addEventListener('ui:act', (e) => { const d = (e as CustomEvent<{ value: string; el: Element }>).detail; got.push([d.value, d.el]); });
    bar.querySelector<HTMLElement>('[data-act="more"]')?.click();
    expect(got).toEqual([['more', bar.querySelector('[data-act="more"]')]]);
  });
  it('stands beside a bubble, and moves to a later one, leaving the first as it was', () => {
    const thread = document.createElement('div');
    const a = kit.bubble({ kind: 'agent', text: 'one' }), b = kit.bubble({ kind: 'agent', text: 'two' });
    thread.append(a, b); document.body.append(thread);
    const bar = kit.hoverBar({ label: 'Actions', actions: ACTS });
    kit.hoverBeside(bar, a);
    expect([...thread.children].map((x) => x.className.split(' ')[0])).toEqual(['k7-hoverrow', 'k7-bubble']);
    expect([...(thread.firstElementChild as Element).children]).toEqual([a, bar]);
    kit.hoverBeside(bar, b);
    expect([...thread.children]).toEqual([a, bar.parentElement]);
    expect([...(bar.parentElement as Element).children]).toEqual([b, bar]);
    kit.hoverBeside(bar, b);   /* already there: nothing moves */
    expect(thread.querySelectorAll('.k7-hoverrow')).toHaveLength(1);
  });
});

