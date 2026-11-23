// @vitest-environment jsdom
/* "@" in a composer (the owner, 0.1.9: "the @ designs are not appearing when i write the @ in the box. it stays as a text"): the kit's
   one mention machinery with the Bots tab's source (the engine's handles) and with the session's (the models), typed the way a person
   types: each character at the caret, then its input. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MENTION_SOURCE, ui } from '@boopis/ui';
import type { ComposerEl, MarkdownCtx, MdBot } from '@boopis/ui';
import { botMentions } from './mentions';
import type { Named } from './mentions';
import { bestMention, findMentions, mentionName, mentionQuery } from '../../data/mentions';
import type { ModelChoice } from '../../data';

const bot = (id: string, role = ''): Named => ({ id, name: id, handle: id, role, state: 'idle' });
const ROOM = [bot('kai', 'docs'), bot('nina', 'deploys'), bot('moss', 'tests')];
const SOL: MdBot = { id: 'sol', name: 'sol', handle: 'sol', state: 'idle' };
const ctx: MarkdownCtx = {
  mention: (h) => ROOM.find((b) => b.handle === h.toLowerCase()) ?? null,
  everyone: ROOM,
  outside: (h) => (h.toLowerCase() === 'sol' ? SOL : null)
};
const roomSource = () => botMentions({ label: 'Ask in this room', foot: () => 'Only the bots you name answer.', named: () => ROOM, everyone: () => 'Everyone in paper past', ctx: () => ctx });

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
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('.ui-listbox');
const options = (): string[] => [...document.querySelectorAll('.ui-listbox .ui-option .ui-menu__label')].map((x) => (x.textContent ?? '').trim());
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

describe('a room’s composer: typing "@"', () => {
  beforeEach(() => { mount({ placeholder: 'Message paper past', mentions: roomSource() }); });
  it('opens the members (and the whole room) as suggestions, and the caret stays in the text', async () => {
    type('hi @'); await settle();
    expect(menu()).not.toBeNull();
    expect(menu()?.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Ask in this room');
    expect(options()).toEqual(['kai', 'nina', 'moss', 'all']);
    expect(document.activeElement).toBe(c.input);
    type('n'); await settle();
    expect(menu()).not.toBeNull();   /* typing goes on into the text */
    expect(c.value).toBe('hi @n');
  });
  it('opens nothing for an "@" inside a word, and closes when what follows cannot be a handle', async () => {
    type('mail me@'); await settle();
    expect(menu()).toBeNull();
    c.setValue(''); type('@'); await settle();
    expect(menu()).not.toBeNull();
    type(' 5pm'); await settle();
    expect(menu()).toBeNull();
    expect(c.value).toBe('@ 5pm');
  });
  it('closes when the letters name nobody: "@kai." is not kai to the engine', async () => {
    type('thanks @kai'); await settle();
    expect(menu()).not.toBeNull();
    type('.'); await settle();
    expect(menu()).toBeNull();
    expect(c.value).toBe('thanks @kai.');
  });
  it('Tab takes the member the letters name: "@ni" becomes nina’s chip and a space', async () => {
    type('ask @ni'); await settle();
    expect(key('Tab')).toBe(false);
    await settle();
    expect(menu()).toBeNull();
    expect(c.value).toBe('ask @nina ');
    expect(chips().map((x) => x.textContent)).toEqual(['@nina']);
    type('now'); await settle();
    expect(c.value).toBe('ask @nina now');
  });
  it('Enter takes it too, and with nothing named Enter sends', async () => {
    const sent: string[] = [];
    c.addEventListener('ui:send', (e) => { sent.push((e as CustomEvent<{ text: string }>).detail.text); });
    type('@mo'); await settle();
    key('Enter'); await settle();
    expect(c.value).toBe('@moss ');
    expect(sent).toEqual([]);
    type('@'); await settle();
    key('Enter'); await settle();
    expect(sent).toEqual(['@moss @']);
  });
  it('a click on a row writes that member after the "@"; Down moves into the list', async () => {
    type('ping @'); await settle();
    key('ArrowDown');
    expect(document.activeElement?.closest('.ui-listbox')).not.toBeNull();
    [...document.querySelectorAll<HTMLElement>('.ui-listbox .ui-option')][2]?.click();
    await settle();
    expect(c.value).toBe('ping @moss ');
    expect(document.activeElement).toBe(c.input);
  });
  it('Escape closes the list and keeps what was typed', async () => {
    type('@k'); await settle();
    key('Escape'); await settle();
    expect(menu()).toBeNull();
    expect(c.value).toBe('@k');
  });
});

describe('a room’s composer: the mentions in the text', () => {
  beforeEach(() => { mount({ mentions: roomSource() }); });
  it('draws a member as the sent capsule (orb and name), its text exactly the words typed', async () => {
    type('@KAI check this'); await settle();
    const [k] = chips();
    expect(k?.classList.contains('ui-mention')).toBe(true);
    expect(k?.getAttribute('contenteditable')).toBe('false');
    expect(k?.querySelector('.ui-orb[data-bot="kai"] orb-avatar')).not.toBeNull();
    expect(k?.querySelector('.ui-mention__name')?.getAttribute('data-name')).toBe('kai');
    expect(k?.textContent).toBe('@KAI');
    expect(c.value).toBe('@KAI check this');
  });
  it('draws a bot that is not in the room as the muted capsule, saying so', async () => {
    type('ask @sol too'); await settle();
    const [s] = chips();
    expect(s?.classList.contains('ui-mention--out')).toBe(true);
    expect(s?.getAttribute('data-tip')).toBe("sol isn't in this room");
  });
  it('leaves "@kai." as text: a full stop right after a handle is part of it, as the engine reads it', async () => {
    type('thanks @kai. and @kai, again'); await settle();
    expect(chips().map((x) => x.textContent)).toEqual(['@kai']);
    expect(c.input.textContent).toBe('thanks @kai. and @kai, again');
    const first = c.input.firstChild;
    expect(first?.nodeType).toBe(3);
    expect(first?.textContent).toBe('thanks @kai. and ');
  });
  it('draws @all and @everyone with the room’s orbs, and an unknown handle stays text', async () => {
    type('@all and @Everyone, not @nobody '); await settle();
    expect(chips().map((x) => [x.textContent, x.querySelectorAll('.ui-mention__stack .ui-orb').length])).toEqual([['@all', 3], ['@Everyone', 3]]);
    expect(c.input.textContent).toContain('not @nobody ');
  });
  it('sends the plain text byte for byte, and the engine’s pattern reads the same handles from it', async () => {
    const draft = '@kai check the dates with @nina, then @all read it; ask @sol too. Thanks @kai.';
    const sent: string[] = [];
    c.addEventListener('ui:send', (e) => { sent.push((e as CustomEvent<{ text: string }>).detail.text); });
    type(draft); await settle();
    expect(chips()).toHaveLength(4);
    key('Enter');
    expect(sent).toEqual([draft]);
    /* hosted_room_discussion._MENTION_RE, re.IGNORECASE: the kit's copy is the engine's literal */
    expect(MENTION_SOURCE).toBe('@([A-Za-z0-9][A-Za-z0-9._:-]*)');
    expect(ui.markdown.handles(sent[0] ?? '')).toEqual(['kai', 'nina', 'all', 'sol', 'kai.']);
  });
  it('a name still being typed at the caret stays words; it becomes a chip once it is finished', async () => {
    type('@kai'); await settle();
    expect(chips()).toHaveLength(0);
    type(' '); await settle();
    expect(chips().map((x) => x.textContent)).toEqual(['@kai']);
  });
  it('one Backspace takes a chip out, and undo brings it back', async () => {
    type('@nina hi'); await settle();
    c.setValue('@nina hi'); c.input.focus();
    const [n] = chips(); expect(n).toBeDefined();
    setAt(c.input, [...c.input.childNodes].indexOf(n as ChildNode) + 1);   /* the caret right after the chip */
    expect(key('Backspace')).toBe(false);
    expect(c.value).toBe(' hi');
    expect(chips()).toHaveLength(0);
    expect(key('z', { ctrlKey: true, code: 'KeyZ' } as KeyboardEventInit)).toBe(false);
    expect(c.value).toBe('@nina hi');
    expect(chips().map((x) => x.textContent)).toEqual(['@nina']);
    key('z', { ctrlKey: true, shiftKey: true, code: 'KeyZ' } as KeyboardEventInit);
    expect(c.value).toBe(' hi');
  });
  it('undoes a pick as one edit', async () => {
    type('@ni'); await settle();
    key('Tab'); await settle();
    expect(c.value).toBe('@nina ');
    key('z', { ctrlKey: true, code: 'KeyZ' } as KeyboardEventInit);
    expect(c.value).toBe('@ni');
  });
  it('draws nothing under an input method’s composition, and the chip once it ends', async () => {
    c.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    type('@kai ', { composing: true }); await settle();
    expect(chips()).toHaveLength(0);
    expect(menu()).toBeNull();
    c.input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await settle();
    expect(chips().map((x) => x.textContent)).toEqual(['@kai']);
  });
  it('a click on a chip opens the list with “Remove the mention” first; picking another member changes it, Remove takes it out', async () => {
    c.setValue('ask @kai now');
    chips()[0]?.click();
    await settle();
    expect(options()).toEqual(['Remove the mention', 'kai', 'nina', 'moss', 'all']);
    [...document.querySelectorAll<HTMLElement>('.ui-listbox .ui-option')][2]?.click();
    await settle();
    expect(c.value).toBe('ask @nina now');
    chips()[0]?.click(); await settle();
    document.querySelector<HTMLElement>('.ui-listbox .ui-option')?.click(); await settle();
    expect(c.value).toBe('ask  now');
  });
  it('pastes plain text, and its mentions become chips', async () => {
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } };
    Object.defineProperty(ev, 'clipboardData', { value: { getData: () => '@moss look' } });
    let pasted = '';
    (document as unknown as { execCommand: (cmd: string, ui: boolean, t: string) => boolean }).execCommand = (_cmd, _u, t) => { pasted = t; c.input.textContent = (c.input.textContent ?? '') + t; c.input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: t })); return true; };
    c.input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(pasted).toBe('@moss look');
    await settle();
    expect(chips().map((x) => x.textContent)).toEqual(['@moss']);
  });
});

describe('the bots’ source', () => {
  it('reads a handle being typed by the engine’s pattern, from an "@" that starts a word', () => {
    const s = roomSource();
    expect(s.query('hi @ni')).toEqual({ at: 3, query: 'ni' });
    expect(s.query('@')).toEqual({ at: 0, query: '' });
    expect(s.query('(@kai.d')).toEqual({ at: 1, query: 'kai.d' });
    expect(s.query('me@ni')).toBeNull();
    expect(s.query('@ ')).toBeNull();
    expect(s.query('@.')).toBeNull();
  });
  it('names a member by its handle or a word of its name, then the room; nothing for no letters', () => {
    const s = roomSource();
    expect(s.best('ni')).toBe('nina');
    expect(s.best('al')).toBe('all');
    expect(s.best('every')).toBe('everyone');
    expect(s.best('')).toBeNull();
    expect(s.best('zz')).toBeNull();
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
