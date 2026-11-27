// @vitest-environment jsdom
/* Composer: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from thread.test.ts and compose.test.ts keep their words; the editing scene (editing.ts) runs on one composer
  mounted before each case, with fake timers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '../index';
import { contract } from './composer';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const stopOf = (c: HTMLElement): HTMLButtonElement => c.querySelector('[data-stop]') as HTMLButtonElement;
const sendOf = (c: HTMLElement): HTMLButtonElement => c.querySelector('[data-send]') as HTMLButtonElement;
const EX: Parameters<typeof kit.html.composer>[0] = {};
beforeEach(() => { document.body.replaceChildren(); });

describe('story: Composer', () => {
  it('draws the component its contract names (data-kit="Composer")', () => {
    const el = put(kit.composer(EX));
    expect(el.matches('[data-kit~="Composer"]') || !!el.querySelector('[data-kit~="Composer"]')).toBe(true);
    expect(contract.name).toBe('Composer');
  });
});

describe('story: Composer, the line', () => {
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
});

describe('scene: Composer, Stop', () => {
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

describe('scene: Composer, the words it is read by', () => {
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

/* the composer's own editing (editing.ts, moved from compose.test.ts): undo, a chip as one unit, files, the mic */
let c: HTMLElement, t: HTMLElement;
const setAt = (n: Node, o: number): void => { const r = document.createRange(); r.setStart(n, o); r.collapse(true); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); };
/** each character at the caret, with its beforeinput and input */
function type(chars: string): void {
  for (const ch of chars) {
    t.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
    const s = getSelection();
    let node: Node | null | undefined = s?.anchorNode, off = s?.anchorOffset ?? 0;
    if (!node || !t.contains(node) || node === t) { const last = t.lastChild; if (last && last.nodeType === 3) { node = last; off = (last.textContent ?? '').length; } else { node = t; off = t.childNodes.length; } }
    if (node.nodeType === 3) { (node as Text).insertData(off, ch); setAt(node, off + 1); }
    else { const n = document.createTextNode(ch); node.insertBefore(n, node.childNodes[off] ?? null); setAt(n, 1); }
    t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
  }
}
const key = (k: string, init: KeyboardEventInit = {}, on: Element = t): boolean => on.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const undo = (): boolean => key('z', { code: 'KeyZ', ctrlKey: true });
const redo = (): boolean => key('z', { code: 'KeyZ', ctrlKey: true, shiftKey: true });
const pause = (): void => { vi.advanceTimersByTime(1500); };
const chips = (): HTMLElement[] => [...t.querySelectorAll<HTMLElement>('[data-kit~="InlineChip"]')];
const paste = (o: { text?: string; files?: File[] }): Event => {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { files: o.files ?? [], getData: (k: string) => (k === 'text/plain' ? o.text ?? '' : '') } });
  t.dispatchEvent(e);
  return e;
};
const drag = (type: string, o: { files?: File[]; types?: string[]; related?: Node | null } = {}, on: Element = t): Event => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types: o.types ?? ['Files'], files: o.files ?? [], dropEffect: 'none' } });
  Object.defineProperty(e, 'relatedTarget', { value: o.related ?? null });
  on.dispatchEvent(e);
  return e;
};
function mount(o: Parameters<typeof kit.composer>[0] = {}): void {
  document.body.replaceChildren();
  c = kit.composer({ kind: 'room', placeholder: 'Message release crew', ...o });
  document.body.append(c);
  t = c.querySelector<HTMLElement>('.k7-composer__text') as HTMLElement;
  t.focus();
}
const NINA = { id: 'nina', name: 'nina', state: 'idle' as const };
const members = (): void => {
  kit.mentions(c, {
    label: 'Members', entries: () => [{ value: 'nina', label: 'nina' }, { value: 'kai', label: 'kai' }],
    chips: (text) => [...text.matchAll(/@(nina|kai)\b/g)].map((m) => ({ at: m.index, text: m[0], html: kit.html.inlineChip({ kind: 'mention', bot: { ...NINA, id: m[1] as string, name: m[1] as string }, words: m[0] }) }))
  });
};

describe('scene: Composer, its own editing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = (): void => undefined;
    mount();
  });
  afterEach(async () => { kit.closeMenu(); await vi.advanceTimersByTimeAsync(300); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  describe('its own undo', () => {
    it('the letters of a word gather, a space is a step: undo goes back a word at a time, redo comes forward, and each is said as an input', () => {
      const said: string[] = [];
      t.addEventListener('input', (e) => { const it = (e as InputEvent).inputType; if (it?.startsWith('history')) said.push(it); });
      type('hello world');
      expect(undo()).toBe(false);   /* the key is the composer's: the browser's own undo does not run */
      expect(t.textContent).toBe('hello ');
      undo();
      expect(t.textContent).toBe('hello');
      undo();
      expect(t.textContent).toBe('');
      expect(c.hasAttribute('data-typed')).toBe(false);   /* the voice circle is back: the composer followed */
      undo();   /* nothing further back */
      expect(t.textContent).toBe('');
      redo();
      expect(t.textContent).toBe('hello');
      redo(); redo();
      expect(t.textContent).toBe('hello world');
      expect(said).toEqual(['historyUndo', 'historyUndo', 'historyUndo', 'historyRedo', 'historyRedo', 'historyRedo']);
    });
    it('a pause of a second starts a new step inside a word', () => {
      type('hel'); pause(); type('lo');
      undo();
      expect(t.textContent).toBe('hel');
      undo();
      expect(t.textContent).toBe('');
    });
    it('a new edit after an undo drops what could be redone', () => {
      type('one'); pause(); type('two');
      undo();
      type('!');
      redo();
      expect(t.textContent).toBe('one!');
    });
    it('the edit menu\'s Undo and Redo (beforeinput), and ctrl+Y, are the same travel', () => {
      type('one'); pause(); type('two');
      const e = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' });
      t.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(t.textContent).toBe('one');
      key('y', { code: 'KeyY', ctrlKey: true });
      expect(t.textContent).toBe('onetwo');
      t.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' }));
      t.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyRedo' }));
      expect(t.textContent).toBe('onetwo');
    });
    it('survives a mention drawn as its chip: the pick is one step, the chip comes back with redo, and the caret keeps its place', async () => {
      members();
      type('ask '); pause(); type('@ni');
      key('Enter');   /* the list's first match: nina */
      expect(t.textContent).toBe('ask @nina ');
      expect(chips().map((x) => x.getAttribute('data-words'))).toEqual(['@nina']);
      pause(); type('now');
      expect(t.textContent).toBe('ask @nina now');
      undo();
      expect(t.textContent).toBe('ask @nina ');
      expect(chips()).toHaveLength(1);   /* the chip is still a chip */
      undo();
      expect(t.textContent).toBe('ask @ni');   /* before the pick: the letters typed */
      expect(chips()).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(300); kit.closeMenu();
      redo(); redo();
      expect(t.textContent).toBe('ask @nina now');
      expect(chips().map((x) => x.getAttribute('data-words'))).toEqual(['@nina']);
      type('!');   /* the caret is where it stood: at the end */
      expect(t.textContent).toBe('ask @nina now!');
    });
    it('survives the words it is read by being marked again: the marks follow the text back and forth', () => {
      const marks = (): void => { kit.composerMarks(c, (s) => { const at = s.indexOf('staging'); return at >= 0 ? [{ at, text: 'staging', kind: 'env' }] : []; }); };
      t.addEventListener('input', marks);
      type('deploy to staging today');
      expect(t.querySelector('.k7-mark')?.textContent).toBe('staging');
      undo(); undo();
      expect(t.textContent).toBe('deploy to staging');
      expect(t.querySelectorAll('.k7-mark')).toHaveLength(1);
      undo();
      expect(t.textContent).toBe('deploy to ');
      expect(t.querySelectorAll('.k7-mark')).toHaveLength(0);
      redo();
      expect(t.textContent).toBe('deploy to staging');
      expect(t.querySelector('.k7-mark')?.textContent).toBe('staging');
      type('!');   /* the caret is where it stood, after the marked word */
      expect(t.textContent).toBe('deploy to staging!');
    });
    it('a paste is plain words at the caret, and one step', () => {
      type('see ');
      const e = paste({ text: 'line one\nline two' });
      expect(e.defaultPrevented).toBe(true);
      expect(t.textContent).toBe('see line one\nline two');
      type('!');
      expect(t.textContent).toBe('see line one\nline two!');
      pause(); undo(); undo();
      expect(t.textContent).toBe('see ');
      redo();
      expect(t.textContent).toBe('see line one\nline two');
    });
    it('a file set in as a chip, and text set from outside, are one step each', () => {
      type('read ');
      kit.composerInsertChip(c, kit.html.inlineChip({ kind: 'reference', text: 'notes.md', words: '', attrs: { 'data-att': 'a1' } }));
      expect(chips().map((x) => x.getAttribute('data-att'))).toEqual(['a1']);
      undo();
      expect(chips()).toHaveLength(0);
      expect(t.textContent).toBe('read ');
      redo();
      expect(chips().map((x) => x.getAttribute('data-att'))).toEqual(['a1']);   /* the chip itself, with what it carries */
      kit.composerSet(c, 'your last message');
      expect(t.textContent).toBe('your last message');
      undo();
      expect(chips().map((x) => x.getAttribute('data-att'))).toEqual(['a1']);
    });
    it('a sent message does not come back with undo', () => {
      c.addEventListener('ui:send', () => undefined);
      type('ship it');
      key('Enter');
      expect(t.textContent).toBe('');
      undo();
      expect(t.textContent).toBe('');
    });
    it('nothing is kept while an input method composes', () => {
      type('a'); pause();
      t.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      t.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertCompositionText', data: 'に', isComposing: true }));
      (t.lastChild as Text).appendData('に');
      t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: 'に', isComposing: true }));
      t.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertCompositionText', data: 'にほ', isComposing: true }));
      (t.lastChild as Text).data = 'aにほ';
      undo();
      expect(t.textContent).toBe('a');   /* the whole composition is one step */
    });
  });

  describe('a chip is one unit', () => {
    it('Backspace after a chip, or Delete before it, takes the whole chip out; undo puts it back', () => {
      members();
      type('@nina and @kai ok');
      expect(chips()).toHaveLength(2);
      /* the caret right after nina's chip */
      const nina = chips()[0] as HTMLElement;
      const r = document.createRange(); r.setStartAfter(nina); r.collapse(true); getSelection()?.removeAllRanges(); getSelection()?.addRange(r);
      expect(key('Backspace')).toBe(false);
      expect(t.textContent).toBe(' and @kai ok');
      expect(chips().map((x) => x.getAttribute('data-words'))).toEqual(['@kai']);
      /* the caret right before kai's chip: Delete */
      const kai = chips()[0] as HTMLElement;
      const before = kai.previousSibling as Text;
      setAt(before, before.length);
      expect(key('Delete')).toBe(false);
      expect(t.textContent).toBe(' and  ok');
      undo();
      expect(chips().map((x) => x.getAttribute('data-words'))).toEqual(['@kai']);
      undo();
      expect(chips().map((x) => x.getAttribute('data-words'))).toEqual(['@nina', '@kai']);
    });
    it('Backspace inside words is the browser\'s own', () => {
      type('abc');
      expect(key('Backspace')).toBe(true);
    });
  });

  describe('files dropped and pasted', () => {
    const FILE = new File(['x'], 'notes.md', { type: 'text/markdown' }), PIC = new File(['x'], 'shot.png', { type: 'image/png' });
    it('a file dragged over it shows that it can be dropped, until it leaves or is dropped', () => {
      const over = drag('dragover');
      expect(over.defaultPrevented).toBe(true);
      expect(c.hasAttribute('data-drop')).toBe(true);
      drag('dragleave', { related: t });   /* onto a part of the composer: still over it */
      expect(c.hasAttribute('data-drop')).toBe(true);
      drag('dragleave', { related: document.body });
      expect(c.hasAttribute('data-drop')).toBe(false);
    });
    it('what is dragged is not a file: nothing shows, and the drop is the browser\'s', () => {
      const over = drag('dragover', { types: ['text/plain'] });
      expect(over.defaultPrevented).toBe(false);
      expect(c.hasAttribute('data-drop')).toBe(false);
    });
    it('a dropped file is handed on as ui:files, on any part of the composer', () => {
      const got: Array<[string[], string]> = [];
      c.addEventListener('ui:files', (e) => { const d = (e as CustomEvent<{ files: File[]; via: string }>).detail; got.push([d.files.map((f) => f.name), d.via]); });
      drag('dragover');
      const drop = drag('drop', { files: [FILE, PIC] }, c.querySelector('[data-plus]') as Element);
      expect(drop.defaultPrevented).toBe(true);
      expect(got).toEqual([[['notes.md', 'shot.png'], 'drop']]);
      expect(c.hasAttribute('data-drop')).toBe(false);
    });
    it('a pasted file is handed on the same way and no words are written; `composerDropping` shows the state for a host that reports drags', () => {
      const got: string[] = [];
      c.addEventListener('ui:files', (e) => { const d = (e as CustomEvent<{ files: File[]; via: string }>).detail; got.push(d.via + ':' + d.files.map((f) => f.name).join(',')); });
      paste({ files: [PIC], text: 'shot.png' });
      expect(got).toEqual(['paste:shot.png']);
      expect(t.textContent).toBe('');
      kit.composerDropping(c, true);
      expect(c.hasAttribute('data-drop')).toBe(true);
      kit.composerDropping(c, false);
      expect(c.hasAttribute('data-drop')).toBe(false);
    });
  });

  describe('the mic', () => {
    const mic = (): HTMLButtonElement => c.querySelector<HTMLButtonElement>('[data-mic]') as HTMLButtonElement;
    const pressed = (): string | null => mic().getAttribute('aria-pressed');
    let heard: Array<{ on: boolean; mode: string | null }>;
    const listen = (): void => { heard = []; c.addEventListener('ui:dictate', (e) => { heard.push((e as CustomEvent<{ on: boolean; mode: string | null }>).detail); }); };
    const down = (): void => { mic().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })); };
    const up = (): void => { mic().dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); mic().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); };

    it('a press switches it on and another off; while it listens it is named "Stop listening" and the placeholder says who listens', () => {
      mount({ kind: 'bot', placeholder: 'Message nina', hears: 'nina' }); listen();
      down(); vi.advanceTimersByTime(120); up();
      expect(pressed()).toBe('true');
      expect(heard).toEqual([{ on: true, mode: 'hold' }]);
      expect(mic().getAttribute('aria-label')).toBe('Stop listening');
      expect(t.getAttribute('data-placeholder')).toBe('nina is listening');
      expect(c.hasAttribute('data-listening')).toBe(true);
      down(); vi.advanceTimersByTime(120); up();
      expect(pressed()).toBe('false');
      expect(heard[1]).toEqual({ on: false, mode: null });
      expect(mic().getAttribute('aria-label')).toBe('Dictate');
      expect(t.getAttribute('data-placeholder')).toBe('Message nina');
      expect(c.hasAttribute('data-listening')).toBe(false);
    });
    it('held, it listens while held and stops when it is let go', () => {
      listen();
      down();
      expect(pressed()).toBe('true');
      expect(t.getAttribute('data-placeholder')).toBe('Listening');
      vi.advanceTimersByTime(900);
      up();
      expect(pressed()).toBe('false');
      expect(heard.map((d) => d.on)).toEqual([true, false]);
      /* a pointer that is taken away ends the hold too */
      down(); vi.advanceTimersByTime(900);
      mic().dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
      expect(pressed()).toBe('false');
    });
    it('the press keeps the focus in the text: you can talk and type', () => {
      const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
      mic().dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(t);
    });
    it('Enter or Space on the mic, and a press the app makes, switch it', () => {
      listen();
      mic().click();
      expect(pressed()).toBe('true');
      expect(heard).toEqual([{ on: true, mode: 'toggle' }]);
      mic().click();
      expect(pressed()).toBe('false');
    });
    it('alt+V: a tap switches it, a hold talks while held; Esc stops it and goes no further', () => {
      listen();
      const v = { code: 'KeyV', altKey: true };
      expect(key('v', v)).toBe(false);
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'v', code: 'KeyV' }));
      expect(pressed()).toBe('true');
      key('v', v); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'v', code: 'KeyV' }));
      expect(pressed()).toBe('false');
      key('v', v);
      key('v', { ...v, repeat: true });   /* the key repeating while held changes nothing */
      expect(pressed()).toBe('true');
      vi.advanceTimersByTime(900);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'v', code: 'KeyV' }));
      expect(pressed()).toBe('false');
      mic().click();
      let outside = 0;
      document.body.addEventListener('keydown', () => { outside++; }, { once: true });
      expect(key('Escape')).toBe(false);
      expect(pressed()).toBe('false');
      expect(outside).toBe(0);
      expect(key('Escape')).toBe(true);   /* not listening: Esc is the shell's */
    });
    it('a build with no dictation (micOff): the mic is there under its own name; a press, a hold, Enter and alt+V start nothing and say so', () => {
      mount({ kind: 'bot', placeholder: 'Message nina', hears: 'nina', micOff: true }); listen();
      let said = 0;
      c.addEventListener('ui:dictate-unavailable', () => { said++; });
      expect(mic().hidden).toBe(false);
      expect([mic().getAttribute('aria-label'), mic().getAttribute('data-tip'), mic().getAttribute('aria-haspopup')]).toEqual(['Dictate', 'Dictate', null]);
      down(); vi.advanceTimersByTime(120); up();          /* a press */
      expect(said).toBe(1);
      down();
      expect(pressed()).toBe('false');                     /* held: it never listens */
      vi.advanceTimersByTime(900); up();
      expect(said).toBe(2);
      mic().click();                                       /* Enter or Space on it */
      expect(said).toBe(3);
      key('v', { code: 'KeyV', altKey: true }); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'v', code: 'KeyV' }));
      expect(said).toBe(4);
      expect(pressed()).toBe('false');
      expect(heard).toEqual([]);
      expect(t.getAttribute('data-placeholder')).toBe('Message nina');
    });
    it('draws what the dictation reports: the speech model being fetched with its progress, then who listens, in the placeholder', () => {
      mount({ kind: 'bot', placeholder: 'Message nina', hears: 'nina' });
      mic().click();
      expect([c.dataset['dictation'], t.getAttribute('data-placeholder')]).toEqual(['listening', 'nina is listening']);
      kit.composerDictation(c, { kind: 'preparing', done: 12 * 1048576, total: 57 * 1048576 });
      expect([c.dataset['dictation'], t.getAttribute('data-placeholder')]).toEqual(['preparing', 'Getting the speech model 12 of 57 MB']);
      kit.composerDictation(c, { kind: 'preparing', done: 40 * 1048576, total: 57 * 1048576 });
      expect(t.getAttribute('data-placeholder')).toBe('Getting the speech model 40 of 57 MB');
      expect(mic().getAttribute('aria-label')).toBe('Stop listening');   /* a press still stops it */
      kit.composerDictation(c, { kind: 'listening' });
      expect([c.dataset['dictation'], t.getAttribute('data-placeholder')]).toEqual(['listening', 'nina is listening']);
      mic().click();
      /* off: the placeholder is the composer's own again at once; the last words said may still arrive for about 3 s */
      expect([c.dataset['dictation'], c.hasAttribute('data-listening'), t.getAttribute('data-placeholder')]).toEqual(['transcribing', false, 'Message nina']);
      vi.advanceTimersByTime(3000);
      expect(c.hasAttribute('data-dictation')).toBe(false);
    });
    it('the words arrive in the text: each partial replaces the last, the final one stays (after a space where the text has none) and wakes the composer once', () => {
      mount({ kind: 'bot', placeholder: 'Message nina', text: 'Ship it' });
      let inputs = 0;
      t.addEventListener('input', () => { inputs++; });
      const end = document.createRange(); end.selectNodeContents(t); end.collapse(false);
      getSelection()?.removeAllRanges(); getSelection()?.addRange(end);   /* the caret after "Ship it" */
      mic().click();
      kit.composerDictation(c, { kind: 'partial', text: 'and update' });
      expect([c.dataset['dictation'], t.textContent]).toEqual(['transcribing', 'Ship it and update']);
      kit.composerDictation(c, { kind: 'partial', text: 'and update the change' });
      expect(t.textContent).toBe('Ship it and update the change');
      expect(inputs).toBe(0);
      kit.composerDictation(c, { kind: 'final', text: 'and update the changelog' });
      expect([c.dataset['dictation'], t.textContent, inputs]).toEqual(['listening', 'Ship it and update the changelog', 1]);
      kit.composerDictation(c, { kind: 'final', text: 'today' });          /* the next stretch follows the last */
      expect(t.textContent).toBe('Ship it and update the changelog today');
      mic().click();
      vi.advanceTimersByTime(3000);
      kit.composerDictation(c, { kind: 'final', text: 'too late' });       /* the mic is off and its last words had their time: nothing more is written */
      expect(t.textContent).toBe('Ship it and update the changelog today');
    });
    const caretAtEnd = (): void => { const end = document.createRange(); end.selectNodeContents(t); end.collapse(false); getSelection()?.removeAllRanges(); getSelection()?.addRange(end); };
    it('the words said right before the mic was switched off are kept: the composer takes that dictation\'s last final, and only that', () => {
      mount({ kind: 'bot', placeholder: 'Message nina', text: 'Ship it' });
      let inputs = 0;
      t.addEventListener('input', () => { inputs++; });
      caretAtEnd();
      mic().click();
      kit.composerDictation(c, { kind: 'listening' });
      kit.composerDictation(c, { kind: 'partial', text: 'and ask' });
      mic().click();                                                        /* let go in the middle of a sentence */
      expect([pressed(), c.hasAttribute('data-listening'), c.dataset['dictation'], t.textContent]).toEqual(['false', false, 'transcribing', 'Ship it and ask']);
      kit.composerDictation(c, { kind: 'partial', text: 'and ask no' });    /* a partial that was on its way changes nothing */
      expect(t.textContent).toBe('Ship it and ask');
      kit.composerDictation(c, { kind: 'final', text: 'and ask not what your country can do' });
      expect([t.textContent, inputs, c.hasAttribute('data-dictation')]).toEqual(['Ship it and ask not what your country can do', 1, false]);
      kit.composerDictation(c, { kind: 'final', text: 'a second one' });    /* it let go: nothing more */
      expect(t.textContent).toBe('Ship it and ask not what your country can do');
    });
    it('a short thing said and let go before any word showed is written when its final arrives; with none in 3 s what stands stays', () => {
      mount({ kind: 'bot', placeholder: 'Message nina' });
      let inputs = 0;
      t.addEventListener('input', () => { inputs++; });
      caretAtEnd();
      mic().click();
      kit.composerDictation(c, { kind: 'listening' });
      mic().click();
      kit.composerDictation(c, { kind: 'final', text: 'Yes.' });
      expect([t.textContent, inputs]).toEqual(['Yes.', 1]);
      /* a source that sends no last words (the mock, a host that heard nothing more): the partial that stands becomes text after 3 s */
      mic().click();
      kit.composerDictation(c, { kind: 'partial', text: 'and then' });
      mic().click();
      vi.advanceTimersByTime(2900);
      expect([c.dataset['dictation'], inputs]).toEqual(['transcribing', 1]);
      vi.advanceTimersByTime(200);
      expect([t.textContent, inputs, c.hasAttribute('data-dictation')]).toEqual(['Yes. and then', 2, false]);
      /* words the person erased while waiting are not written back */
      mic().click();
      kit.composerDictation(c, { kind: 'partial', text: 'oops' });
      mic().click();
      t.textContent = '';
      kit.composerDictation(c, { kind: 'final', text: 'oops, no' });
      expect(t.textContent).toBe('');
    });
    it('a new press while the last words are awaited starts a fresh dictation: a late final of the old one does not land in it', () => {
      mount({ kind: 'bot', placeholder: 'Message nina' }); listen();
      caretAtEnd();
      mic().click();
      kit.composerDictation(c, { kind: 'partial', text: 'one' });
      mic().click();                                                        /* off: waiting for the last words of "one" */
      mic().click();                                                        /* on again before they came */
      expect(heard.map((d) => d.on)).toEqual([true, false, true]);
      expect([pressed(), t.textContent, c.dataset['dictation']]).toEqual(['true', 'one', 'listening']);   /* what stood stays; the wait is over */
      kit.composerDictation(c, { kind: 'final', text: 'one more thing from before' });   /* the old dictation's, late: not this one's words */
      expect(t.textContent).toBe('one');
      kit.composerDictation(c, { kind: 'listening' });                      /* the new one says it listens: its words are taken from here */
      kit.composerDictation(c, { kind: 'partial', text: 'two' });
      expect(t.textContent).toBe('one two');
      kit.composerDictation(c, { kind: 'final', text: 'two.' });
      expect(t.textContent).toBe('one two.');
      vi.advanceTimersByTime(3000);                                         /* the old wait's timer does nothing to the new dictation */
      expect([pressed(), t.textContent]).toEqual(['true', 'one two.']);
    });
    it('an error that arrives after the mic was switched off still opens its Notice, and what was heard stays', () => {
      mount({ kind: 'bot', placeholder: 'Message nina' });
      caretAtEnd();
      mic().click();
      kit.composerDictation(c, { kind: 'partial', text: 'and so' });
      mic().click();
      kit.composerDictation(c, { kind: 'error', reason: 'Dictation failed' });
      const n = [...document.querySelectorAll<HTMLElement>('.k7-notice[data-floating]')].pop() as HTMLElement;
      expect(n.querySelector('.k7-notice__text')?.textContent).toBe('Dictation failed');
      expect([t.textContent, pressed(), c.hasAttribute('data-dictation')]).toEqual(['and so', 'false', false]);
      kit.composerDictation(c, { kind: 'final', text: 'after the error' });   /* nothing more is taken */
      expect(t.textContent).toBe('and so');
    });
    it('said with the caret before other words, a stretch ends with a space; with the caret elsewhere it goes to the end of the text', () => {
      mount({ kind: 'bot', placeholder: 'Message nina', text: 'the changelog' });
      const start = document.createRange(); start.setStart(t.firstChild as Node, 0); start.collapse(true);
      getSelection()?.removeAllRanges(); getSelection()?.addRange(start);
      mic().click();
      kit.composerDictation(c, { kind: 'final', text: 'Update' });
      expect(t.textContent).toBe('Update the changelog');
      getSelection()?.removeAllRanges();
      kit.composerDictation(c, { kind: 'final', text: 'today' });
      expect(t.textContent).toBe('Update the changelog today');
    });
    it('an error switches the mic off, tells the app to stop (ui:dictate off) and opens a Notice at the mic with the reason and "Try again", which switches it on again', () => {
      mount({ kind: 'bot', placeholder: 'Message nina' }); listen();
      mic().click();
      kit.composerDictation(c, { kind: 'error', reason: 'No microphone found' });
      expect(pressed()).toBe('false');
      expect(heard.map((d) => d.on)).toEqual([true, false]);
      const n = document.querySelector<HTMLElement>('.k7-notice[data-floating]') as HTMLElement;
      expect(n.querySelector('.k7-notice__text')?.textContent).toBe('No microphone found');
      const again = [...n.querySelectorAll<HTMLElement>('[data-kit~="Button"]')];
      expect(again.map((b) => b.textContent?.trim())).toEqual(['Try again']);
      expect(mic().getAttribute('aria-expanded')).toBe('true');
      again[0]?.click();
      expect(pressed()).toBe('true');
      /* where trying again cannot help, the Notice only says */
      kit.composerDictation(c, { kind: 'error', reason: 'This computer cannot run the speech model', retry: false });
      const n2 = [...document.querySelectorAll<HTMLElement>('.k7-notice[data-floating]')].pop() as HTMLElement;
      expect(n2.querySelector('.k7-notice__text')?.textContent).toBe('This computer cannot run the speech model');
      expect(n2.querySelector('[data-value="act"]')).toBeNull();
      kit.closeMenu();
    });
    it('an app that refuses (nothing can hear) leaves it off; switched off from outside, its look follows', async () => {
      c.addEventListener('ui:dictate', (e) => { e.preventDefault(); }, { once: true });
      mic().click();
      expect(pressed()).toBe('false');
      mic().click();
      expect(pressed()).toBe('true');
      mic().setAttribute('aria-pressed', 'false');   /* the app, when its composer stops */
      await Promise.resolve();
      expect(c.hasAttribute('data-listening')).toBe(false);
      expect(mic().getAttribute('aria-label')).toBe('Dictate');
      expect(t.getAttribute('data-placeholder')).toBe('Message release crew');
    });
  });
});
