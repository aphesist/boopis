// @vitest-environment jsdom
/* The kit Composer's own editing (compose.ts), the same in every composer: its undo across a text that is drawn again (mention chips,
   marks, files set in), a chip as one unit, paste, files dropped and pasted, and the mic (a press, alt+V, or held). Typed the way a
   person types: each character at the caret, with the events a browser sends. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kit } from '@boopis/ui';

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = (): void => undefined;
  mount();
});
afterEach(async () => { kit.closeMenu(); await vi.advanceTimersByTimeAsync(300); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Composer: its own undo', () => {
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

describe('Composer: a chip is one unit', () => {
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

describe('Composer: files dropped and pasted', () => {
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

describe('Composer: the mic', () => {
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
  it('no speech model set up (micSetup): the mic is there and says so; a press, a hold, Enter and alt+V start nothing and ask for the setup', () => {
    mount({ kind: 'bot', placeholder: 'Message nina', hears: 'nina', micSetup: true }); listen();
    let asked = 0;
    c.addEventListener('ui:dictate-setup', () => { asked++; });
    expect(mic().hidden).toBe(false);
    expect([mic().getAttribute('aria-label'), mic().getAttribute('data-tip'), mic().getAttribute('aria-haspopup')]).toEqual(['Dictate: set up a speech model first', 'Dictate: set up a speech model first', 'dialog']);
    down(); vi.advanceTimersByTime(120); up();          /* a press */
    expect(asked).toBe(1);
    down();
    expect(pressed()).toBe('false');                     /* held: it never listens */
    vi.advanceTimersByTime(900); up();
    expect(asked).toBe(2);
    mic().click();                                       /* Enter or Space on it */
    expect(asked).toBe(3);
    key('v', { code: 'KeyV', altKey: true }); window.dispatchEvent(new KeyboardEvent('keyup', { key: 'v', code: 'KeyV' }));
    expect(asked).toBe(4);
    expect(pressed()).toBe('false');
    expect(heard).toEqual([]);
    expect(c.hasAttribute('data-listening')).toBe(false);
    expect(t.getAttribute('data-placeholder')).toBe('Message nina');
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
