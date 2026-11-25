// @vitest-environment jsdom
/* "@" in a composer (the owner, 0.1.9: "the @ designs are not appearing when i write the @ in the box. it stays as a text"; 25 November:
   a menu like the composer's lists, and the pick a real capsule in the text): the v7 kit's composer, which the Bots tab's chats and
   rooms use, and the v6 machinery the session's composer keeps until its own step, typed the way a person types: each character
   at the caret, then its input. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kit, MENTION_SOURCE, ui } from '@boopis/ui';
import type { ComposerEl, MarkdownCtx, MdBot } from '@boopis/ui';
import { mentionChips } from '../chat/compose';
import { bestMention, findMentions, mentionName, mentionQuery } from '../../data/mentions';
import type { ModelChoice } from '../../data';

type Named = MdBot & { handle: string; role: string };
const bot = (id: string, role = ''): Named => ({ id, name: id, handle: id, role, state: 'idle' });
const ROOM = [bot('kai', 'docs'), bot('nina', 'deploys'), bot('moss', 'tests')];
const SOL: MdBot = { id: 'sol', name: 'sol', handle: 'sol', state: 'idle' };
const ctx: MarkdownCtx = {
  mention: (h) => ROOM.find((b) => b.handle === h.toLowerCase()) ?? null,
  everyone: ROOM,
  outside: (h) => (h.toLowerCase() === 'sol' ? SOL : null)
};

let c: ComposerEl;
const setAt = (n: Node, o: number): void => { const r = document.createRange(); r.setStart(n, o); r.collapse(true); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); };
/** each character at the caret (a new text node after a chip), with the input events a browser sends */
function type(chars: string, o: { composing?: boolean } = {}): void {
  for (const ch of chars) {
    const input = c.input, s = getSelection();
    let node: Node | null | undefined = s?.anchorNode, off = s?.anchorOffset ?? 0;
    if (!node || !input.contains(node)) { node = input; off = input.childNodes.length; }
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: o.composing ? 'insertCompositionText' : 'insertText', data: ch, isComposing: !!o.composing }));
    if (node.nodeType === 3) { (node as Text).insertData(off, ch); setAt(node, off + 1); }
    else { const t = document.createTextNode(ch); node.insertBefore(t, node.childNodes[off] ?? null); setAt(t, 1); }
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: o.composing ? 'insertCompositionText' : 'insertText', data: ch, isComposing: !!o.composing }));
  }
}
const key = (k: string, init: KeyboardEventInit = {}): boolean => (document.activeElement ?? c.input).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const settle = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(300); };
const chips = (): HTMLElement[] => [...c.input.querySelectorAll<HTMLElement>('[data-chip]')];
function mount(o: Parameters<typeof ui.composer>[0]): void {
  document.body.replaceChildren();
  c = ui.composer({ attach: false, ...o });
  document.body.append(c);
  c.input.focus();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = (): void => undefined;
});
afterEach(() => { ui.listbox.close(false); vi.useRealTimers(); vi.unstubAllGlobals(); });

/* ───────── the v7 kit's composer (a bot's chat, a room): "@" opens the kit's Menu and a finished mention is a chip in the text ───────── */
describe('the kit\'s composer: mentions as chips in the text', () => {
  let k: HTMLElement, t: HTMLElement;
  const kchips = (): HTMLElement[] => [...t.querySelectorAll<HTMLElement>('[data-kit~="InlineChip"]')];
  const typeK = (chars: string, o: { composing?: boolean } = {}): void => {
    for (const ch of chars) {
      const s = getSelection();
      let node: Node | null | undefined = s?.anchorNode, off = s?.anchorOffset ?? 0;
      /* the caret is at the end of the text when the selection is elsewhere (jsdom drops it when the list takes the focus for a moment) */
      if (!node || !t.contains(node) || node === t) { const last = t.lastChild; if (last && last.nodeType === 3) { node = last; off = (last.textContent ?? '').length; } else { node = t; off = t.childNodes.length; } }
      if (node.nodeType === 3) { (node as Text).insertData(off, ch); setAt(node, off + 1); }
      else { const n = document.createTextNode(ch); node.insertBefore(n, node.childNodes[off] ?? null); setAt(n, 1); }
      t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: o.composing ? 'insertCompositionText' : 'insertText', data: ch, isComposing: !!o.composing }));
    }
  };
  const kmenu = (): HTMLElement | null => document.querySelector<HTMLElement>('.k7-menu[data-floating]');
  const settleK = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(300); };   /* a closed menu leaves the page after its exit */
  beforeEach(() => {
    document.body.replaceChildren();
    k = kit.composer({ kind: 'room', placeholder: 'Message release crew' });
    document.body.append(k);
    t = k.querySelector<HTMLElement>('.k7-composer__text') as HTMLElement;
    t.tabIndex = 0;   /* jsdom does not take an editable element for focusable, as browsers do */
    kit.mentions(k, {
      label: 'Members', foot: () => 'Only the bots you name answer.',
      entries: () => [...ROOM.map((b) => ({ value: b.handle, label: b.name, desc: b.role })), { value: 'all', label: 'all', desc: 'Everyone in paper past' }],
      chips: (text) => mentionChips(text, ctx)
    });
    t.focus();
  });
  afterEach(async () => { kit.closeMenu(); await settleK(); });

  it('typing "@" opens the members (and the whole room) under the menu\'s heading, and the caret stays in the text', async () => {
    typeK('@');
    expect(kmenu()?.querySelector('.k7-menu__head')?.textContent).toBe('Members');
    expect([...(kmenu()?.querySelectorAll('.k7-mrow__name') ?? [])].map((x) => x.textContent)).toEqual(['kai', 'nina', 'moss', 'all']);
    expect(document.activeElement).toBe(t);
    typeK('n');
    await settleK();   /* the list is drawn again for what was typed; the one before it has left */
    expect([...(kmenu()?.querySelectorAll('.k7-mrow__name') ?? [])].map((x) => x.textContent)).toEqual(['nina']);
  });
  it('opens nothing for an "@" inside a word, and closes when what follows names nobody', async () => {
    typeK('me@');
    expect(kmenu()).toBeNull();
    t.textContent = ''; typeK('@zz');
    await settleK();
    expect(kmenu()).toBeNull();
  });
  it('Enter takes the first match: "@ni" becomes nina\'s chip and a space; Escape closes the list and keeps what was typed', async () => {
    typeK('@ni');
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(t.textContent).toBe('@nina ');
    expect(kchips().map((c2) => c2.getAttribute('data-words'))).toEqual(['@nina']);
    typeK('@k');
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settleK();
    expect(kmenu()).toBeNull();
    expect(t.textContent).toBe('@nina @k');
  });
  it('draws a member as the sent capsule (orb and name), one unit whose text is exactly the words typed', () => {
    typeK('@kai ');
    const [m] = kchips();
    expect(m?.getAttribute('contenteditable')).toBe('false');
    expect(m?.textContent).toBe('@kai');
    expect(m?.querySelector('.ui-orb')?.getAttribute('data-bot')).toBe('kai');
    expect(m?.querySelector('[data-name]')?.getAttribute('data-name')).toBe('kai');
    expect(t.textContent).toBe('@kai ');
  });
  it('a name still being typed at the caret stays words; it becomes a chip once it is finished', () => {
    typeK('ask @kai');
    expect(kchips()).toHaveLength(0);
    typeK(' ');
    expect(kchips()).toHaveLength(1);
    typeK('now');
    expect(t.textContent).toBe('ask @kai now');
  });
  it('draws a bot that is not in the room as the muted capsule, saying so; "@kai." and an unknown handle stay text', () => {
    typeK('@sol and @kai. and @nobody ');
    expect(kchips().map((c2) => [c2.getAttribute('data-words'), c2.hasAttribute('data-out')])).toEqual([['@sol', true]]);
    expect(kchips()[0]?.getAttribute('data-tip')).toBe("sol isn't in this room");
  });
  it('draws @all and @everyone with the room\'s orbs', () => {
    typeK('@all and @everyone ');
    expect(kchips().map((c2) => c2.getAttribute('data-words'))).toEqual(['@all', '@everyone']);
    expect(kchips()[0]?.querySelectorAll('.ui-stack orb-avatar')).toHaveLength(3);
  });
  it('sends the plain text byte for byte, and the engine\'s pattern reads the same handles from it', () => {
    const sent: string[] = [];
    k.addEventListener('ui:send', (e) => { sent.push((e as CustomEvent<{ text: string }>).detail.text); });
    typeK('@kai write the notes, @nina ship it');
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(sent).toEqual(['@kai write the notes, @nina ship it']);
    expect([...sent[0]!.matchAll(new RegExp(MENTION_SOURCE, 'gi'))].map((m) => m[1])).toEqual(['kai', 'nina']);
  });
  it('draws nothing under an input method\'s composition, and the chip once it ends', () => {
    typeK('@kai ', { composing: true });
    expect(kchips()).toHaveLength(0);
    t.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(kchips()).toHaveLength(1);
  });
  it('text set from outside (a held message taken back, a paste) has its mentions as chips', () => {
    t.textContent = 'thanks @moss and @nina, done';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    expect(kchips().map((c2) => c2.getAttribute('data-words'))).toEqual(['@moss', '@nina']);
    expect(t.textContent).toBe('thanks @moss and @nina, done');
  });
  it('a chip taken out leaves the words around it, and the voice button comes back when nothing is left', () => {
    typeK('@kai ');
    kchips()[0]!.remove(); t.textContent = '';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    expect(k.querySelector('[data-send]')?.getAttribute('aria-label')).toBe('Talk');
  });
  it('a file set in with `composerInsertChip` is a reference chip, a space after it, its words what is sent', () => {
    kit.composerInsertChip(k, kit.html.inlineChip({ kind: 'reference', text: '@notes.md', words: '@/home/you/notes.md' }));
    expect(kchips().map((c2) => c2.getAttribute('data-kind'))).toEqual(['reference']);
    expect(t.textContent).toBe('@/home/you/notes.md ');
    expect(k.hasAttribute('data-typed')).toBe(true);
  });
});

describe('the session’s models: the same machinery', () => {
  const HAIKU = { value: 'anthropic/claude-haiku-4-5', model: 'claude-haiku-4-5' } as unknown as ModelChoice;
  const called = (m: string): string => ui.modelMark.called(m);
  beforeEach(() => {
    mount({ mentions: {
      label: 'Answer this message with', query: mentionQuery, entries: () => [{ value: HAIKU.value, label: mentionName(HAIKU, called) }],
      best: (q) => bestMention(q, [HAIKU], called)?.value ?? null, write: (v) => (v === HAIKU.value ? mentionName(HAIKU, called) : null),
      find: (t) => findMentions(t, [HAIKU], called).map((m) => ({ at: m.start, text: m.text, kind: 'mention' }))
    } });
  });
  it('draws a model’s mention as one chip of its words, and one Backspace takes it out', async () => {
    const name = mentionName(HAIKU, called);
    type('@cl'); await settle();
    key('Tab'); await settle();
    expect(c.value).toBe('@' + name + ' ');
    const [m] = chips();
    expect(m?.dataset['kind']).toBe('mention');
    expect(m?.textContent).toBe('@' + name);
    setAt(c.input, 1);
    key('Backspace');
    expect(c.value).toBe(' ');
  });
});
