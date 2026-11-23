/* composer: card stock, the toolbar inside, nothing below. The canonical composer (session, bots and the dock's
   session all use it).
   Layout: full (text, then the bar) or compact (one row: text and the actions group), chosen by `compact`, else
   compact when the composer has nothing but text (no attach, chips, spend or hint). The actions group (mic, send)
   sits in the box's corner, concentric with it.
   OWNER DECISION: every composer can talk (`mic: false` does not exist). A click toggles listening; pressing and
   holding it (400ms or more) talks while held. With a target `bot`, the mic says "Talk to nina", the bot's orbs (every
   .ui-orb[data-bot] of it, plus `orbs()`) take orb2's "listening" reaction while you talk, and the mic shows the bot's
   own small orb listening; the placeholder says "nina is listening". Fires 'ui:dictate' {value, bot, mode}; the
   audio itself is the host's.
   Keys (KEYMAP section 7): Enter sends, Shift+Enter breaks the line, mod+Enter sends from anywhere in the composer,
   Up on an empty composer asks for the last message ('ui:edit-last'), Tab moves into the assumptions row when it
   shows (Left/Right between them, Enter or Space opens one: 'ui:assumption', Delete drops it: 'ui:assumption-drop',
   Shift+Tab or Esc back to the text), Alt+Down on a dashed word opens it ('ui:decision'), Alt+A attaches, Alt+V
   talks (a tap toggles, a hold talks while held), Esc while listening stops listening.
   Stop is mod+. (the shell's provider) or the stop button; otherwise Esc belongs to the shell (and the dock).
   "@" (`mentions`, mentions.ts): a typed "@" suggests whom the message can name, and a finished mention is a chip in the text: one
   unit for the caret, one Backspace takes it out, a click opens the list to change it. The text is always the plain words.
   A composer that draws its text again (feedforward marks, mention chips) keeps its own undo (mod+Z, shift+mod+Z, ctrl+Y and the
   edit menu's): the browser's own cannot follow a text rebuilt under it. Nothing is redrawn while an input method is composing.
   Region markers: the root carries data-hx-composer, the text field data-hx-focus="composer". */
import { attrs, cx, esc, fire, frag, isMac } from '../core/dom';
import type { BotLike } from './bot-state';
import { announce } from './announce';
import { html } from './html';
import type { ChipOpts } from './html';
import { hydrateOne } from './wire';
import { icon } from './icons';
import { orbHtml } from './orb';
import { wireMentions } from './mentions';
import type { MentionMark, MentionSource, Mentions } from './mentions';

export interface FeedforwardMark { text: string; kind?: string | undefined; confirmed?: boolean | undefined; at?: number }
export interface HintItem { label: string; kind: string; text: string }
export interface ComposerOpts {
  placeholder?: string; label?: string; value?: string; attach?: boolean; chips?: ReadonlyArray<ChipOpts | HTMLElement>;
  spend?: { spent: string; cap: string };
  bot?: BotLike | null;
  orbs?: () => Array<Element | null | undefined>;
  compact?: boolean;
  /** While `setRunning(true)`, a typed message can still be sent: the button is Stop when nothing is typed and "Send when done"
   *  when something is, and Enter fires `ui:send`. What a send then does is the owner's: the composer never sends anything itself. */
  queue?: boolean;
  hint?: (text: string) => string | HintItem[];
  feedforward?: (text: string) => FeedforwardMark[];
  /** "@": whom a message can name, suggested as it is typed and drawn as chips in the text (mentions.ts) */
  mentions?: MentionSource | undefined;
}
export interface FileChipOpts { kind?: 'file' | 'image' | 'folder'; /** the full path, as the tooltip */ title?: string; onRemove?: () => void }
/** the file chip: with `onRemove` a button takes it away (the composer's), without it the chip only shows (a sent turn's) */
export function fileChip(name: string, o: FileChipOpts = {}): HTMLElement {
  const removable = !!o.onRemove;
  const f = frag('<span class="ui-file' + (removable ? '' : ' ui-file--static') + '"' + (o.title ? ' data-tip="' + esc(o.title) + '"' : '') + '>' + icon(o.kind === 'folder' ? 'folder' : 'file') + '<span>' + esc(name) + '</span>' + (removable ? html.iconButton({ icon: 'close', label: 'Remove ' + name, size: 's', tip: false }) : '') + '</span>');
  if (o.onRemove) { const remove = o.onRemove; f.querySelector('button')?.addEventListener('click', () => { f.remove(); remove(); }); }
  return f;
}
export interface SendDetail { text: string }
export interface DictateDetail { value: boolean; bot: string | null; mode: 'toggle' | 'hold' | null }
export interface DecisionDetail { kind: string | undefined; text: string; el: HTMLElement }
export interface AssumptionDetail { index: number; item: HintItem | undefined; el: HTMLElement }

export interface ComposerEl extends HTMLElement {
  readonly value: string;
  readonly listening: boolean;
  readonly input: HTMLElement;
  readonly chips: HTMLElement;
  readonly attach: HTMLElement | null;
  readonly mic: HTMLButtonElement;
  setValue(t: string): void;
  refresh(): void;
  insert(t: string): void;
  flashHint(ms?: number): void;
  setListening(v: boolean): void;
  setBot(b: BotLike | null): void;
  /** a chip for a file, picture or folder; `onRemove` is called when the person takes it away */
  addFile(name: string, opts?: FileChipOpts): void;
  setRunning(v: boolean): void;
  setSpend(spent: string, cap: string | null): void;
  setHint(h: string | HintItem[]): void;
}

const HOLD_TALK = 400;

export function composer(opts: ComposerOpts = {}): ComposerEl {
  const o = { placeholder: 'Describe the change', label: 'Message', attach: true, chips: [] as ReadonlyArray<ChipOpts | HTMLElement>, value: '', ...opts };
  let bot: BotLike | null = o.bot ?? null;
  const compact = o.compact != null ? !!o.compact : !(o.attach || o.chips.length || o.spend || o.hint);
  const micLabelOf = (): string => (bot ? 'Talk to ' + (bot.name ?? '') : 'Dictate');
  /* corners (DESIGN-SYSTEM.md §8.2, §14.10): the box is a container, the bar a .ui-corners row, attach (bottom-left, in
     the full layout) and send (bottom-right) .ui-corner controls; the container's rule derives their radius, size,
     inset and ring. Tips: above and centred on the control like every tooltip (R-float-3; the window clamps a tip at
     its edge), and never over the text or the assumptions (data-overlay-avoid, R-tip-2; place.ts). */
  const attachHTML = o.attach ? html.iconButton({ icon: 'plus', label: 'Attach files, folders or a teammate', tip: 'Attach', keys: 'alt+A', haspopup: 'menu', expanded: false, class: compact ? 'ui-composer__attach' : 'ui-composer__attach ui-corner' }) : '';
  const acts = '<span class="ui-composer__acts" data-tip-pos="top">' + (compact ? attachHTML : '') +
    html.iconButton({ icon: 'mic', label: micLabelOf(), keys: 'alt+V', pressed: false, class: 'ui-composer__mic' }) + html.send({ disabled: true, corner: true }) + '</span>';
  const root = frag('<div class="ui-composer" data-ui="composer" data-hx-composer data-overlay-avoid=".ui-composer__input, .ui-composer[data-hinting] .ui-composer__hint"' + (compact ? ' data-compact' : '') + '>' +
    (o.hint ? '<div class="ui-composer__hint" role="group" aria-label="Will assume"></div>' : '') +
    '<div class="ui-composer__box"><div class="ui-composer__files"></div>' +
    '<div class="ui-composer__input ui-scroll" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" data-hx-focus="composer"' + attrs({ 'aria-label': o.label, 'data-placeholder': o.placeholder, 'aria-description': o.feedforward ? 'Dashed words are a reading of your request. Alt and down arrow on one changes it; Tab reaches the assumptions.' : null }) + '></div>' +
    '<div class="ui-composer__bar ui-corners" data-tip-pos="top">' + (compact ? '' : attachHTML) +
    '<span class="ui-composer__chips"></span><span class="ui-composer__spacer"></span>' + (o.spend ? html.capacity(o.spend.spent, o.spend.cap) : '') +
    acts + '</div></div></div>');
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel) as T;
  const box = q('.ui-composer__box'), input = q('.ui-composer__input'), send = q<HTMLButtonElement>('.ui-send');
  const chipsEl = q('.ui-composer__chips'), hintEl = root.querySelector<HTMLElement>('.ui-composer__hint'), files = q('.ui-composer__files');
  const chipOf = (c: ChipOpts): HTMLElement => { const n = frag(html.chip(c)); hydrateOne(n); return n; };
  for (const c of o.chips) chipsEl.appendChild(c instanceof Element ? c : chipOf(c));
  hydrateOne(root);
  let running = false, typingT = 0, typed = false, items: HintItem[] = [], flashT = 0;
  /** the text is drawn again with marks (feedforward, mention chips), so the composer keeps its own undo */
  const redraws = !!(o.feedforward || o.mentions);
  /* an input method is composing (nothing is redrawn under it); the last edit typed forward (a mention the caret is still at the end
     of is a name being typed, not yet a chip) */
  let composing = false, forward = false;
  let mentions: Mentions | null = null;
  const text = (): string => (input.textContent ?? '').replace(/\u00a0/g, ' ');
  function caret(): number | null {
    const s = getSelection(); if (!s || !s.rangeCount || !s.anchorNode || !input.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(input); r.setEnd(s.anchorNode, s.anchorOffset); return r.toString().length;
  }
  /** where a node of the text starts, in characters */
  function offsetOf(node: Node): number { const r = document.createRange(); r.selectNodeContents(input); r.setEndBefore(node); return r.toString().length; }
  /** the caret at a character offset; a chip is one unit, so an offset inside it or at its end lands after it */
  function setCaret(off: number | null): void {
    if (off == null) return;
    const s = getSelection(); if (!s) return;
    const r = document.createRange();
    let left = off;
    const visit = (parent: Node): boolean => {
      for (const n of parent.childNodes) {
        if (n.nodeType === 3) { const len = (n as Text).length; if (left <= len) { r.setStart(n, left); return true; } left -= len; continue; }
        if (n.nodeType !== 1) continue;
        if ((n as Element).hasAttribute('data-chip')) {
          const len = (n.textContent ?? '').length;
          if (left === 0) { r.setStartBefore(n); return true; }
          if (left <= len) { r.setStartAfter(n); return true; }
          left -= len; continue;
        }
        if (visit(n)) return true;
      }
      return false;
    };
    if (!visit(input)) { r.selectNodeContents(input); r.collapse(false); } else r.collapse(true);
    s.removeAllRanges(); s.addRange(r);
  }
  /* the hint: a sentence, or the assumptions as a row of quiet buttons ("Will assume: >refactor, >src/billing") */
  function paintHint(h: string | HintItem[]): void {
    if (!hintEl) return;
    items = Array.isArray(h) ? h : [];
    if (Array.isArray(h)) {
      hintEl.innerHTML = h.length ? '<span class="ui-composer__hint-label">Will assume:</span>' + h.map((x, i) => '<button type="button" class="ui-assume" tabindex="-1" data-i="' + i + '">' + esc(x.label) + '</button>').join('<span aria-hidden="true">,</span>') : '';
    } else hintEl.textContent = h || '';
    syncHint();
  }
  const hasHint = (): boolean => !!(hintEl && (hintEl.textContent ?? '').trim());
  function syncHint(): void { root.toggleAttribute('data-hinting', hasHint() && ((root.contains(document.activeElement) && (typed || !!hintEl?.contains(document.activeElement))) || root.hasAttribute('data-hint-flash'))); }

  /* ───── the text, drawn with its marks ───── */
  type Mark = (FeedforwardMark | MentionMark) & { at: number; chip?: boolean };
  /** the marks of a text, in order: the mention chips first where both start (a name being typed at `off` is left as words), then
      the feedforward's dashed and solid words */
  function marksOf(t: string, off: number | null): Mark[] {
    if (!t) return [];
    const chips: Mark[] = (o.mentions?.find(t) ?? []).filter((m) => !(forward && off != null && m.at + m.text.length === off)).map((m) => ({ ...m, chip: true }));
    const ff: Mark[] = o.feedforward ? (o.feedforward(t) || []).map((m) => ({ ...m, at: m.at ?? t.indexOf(m.text) })).filter((m) => m.at >= 0) : [];
    return [...chips, ...ff].sort((a, b) => a.at - b.at);
  }
  const classesOf = (c: string | undefined): string => (c ?? '').split(/\s+/).filter(Boolean).join(' ');
  const markSig = (chip: boolean, kind: string, confirmed: boolean, cls: string, t: string): string => 'M' + (chip ? 'c' : '') + kind + (confirmed ? '!' : '') + '|' + cls + '|' + t;
  /** what the text should be: its runs of words and its marks, in order */
  function wantSig(t: string, marks: readonly Mark[]): string {
    const parts: string[] = []; let i = 0;
    for (const m of marks) { if (m.at < i) continue; if (m.at > i) parts.push('T' + t.slice(i, m.at)); parts.push(markSig(!!m.chip, m.kind ?? '', 'confirmed' in m && !!m.confirmed, m.chip ? classesOf((m as MentionMark).cls) : '', m.text)); i = m.at + m.text.length; }
    if (i < t.length) parts.push('T' + t.slice(i));
    return parts.join('\u0000');
  }
  /** what the text is now (its orbs and their attributes, which the page writes as it draws, do not count) */
  function haveSig(): string {
    const parts: string[] = [];
    for (const n of input.childNodes) {
      if (n.nodeType === 3) { const v = (n.textContent ?? '').replace(/\u00a0/g, ' '); if (!v) continue; const last = parts[parts.length - 1]; if (last?.startsWith('T')) parts[parts.length - 1] = last + v; else parts.push('T' + v); continue; }
      if (n.nodeType !== 1) continue;
      const e = n as HTMLElement, chip = e.hasAttribute('data-chip');
      if (e.classList.contains('ui-ff')) parts.push(markSig(chip, e.dataset['kind'] ?? '', e.hasAttribute('data-confirmed'), chip ? [...e.classList].filter((c) => c !== 'ui-ff').join(' ') : '', (e.textContent ?? '').replace(/\u00a0/g, ' ')));
      else parts.push('X' + e.tagName + (e.textContent ?? ''));
    }
    return parts.join('\u0000');
  }
  /** a chip's markup only when its text is exactly the mention's words (the send reads the text) */
  const tpl = document.createElement('template');
  const chipInner = (m: Mark & MentionMark): string => { if (!m.html) return esc(m.text); tpl.innerHTML = m.html; return tpl.content.textContent === m.text ? m.html : esc(m.text); };
  function markup(t: string, marks: readonly Mark[]): string {
    let out = '', i = 0;
    for (const m of marks) {
      if (m.at < i) continue;
      out += esc(t.slice(i, m.at));
      if (m.chip) { const c = m as Mark & MentionMark; out += '<span class="' + cx('ui-ff', classesOf(c.cls)) + '" data-kind="' + esc(c.kind) + '" data-chip contenteditable="false"' + attrs({ 'data-tip': c.tip }) + '>' + chipInner(c) + '</span>'; }
      else out += '<span class="ui-ff" data-kind="' + esc(m.kind ?? '') + '"' + ('confirmed' in m && m.confirmed ? ' data-confirmed' : '') + '>' + esc(m.text) + '</span>';
      i = m.at + m.text.length;
    }
    return out + esc(t.slice(i));
  }
  function render(keepCaret: boolean): void {
    const t = text(), off = keepCaret ? caret() : null;
    if (redraws && !composing && !mentions?.suggesting) {
      const marks = marksOf(t, off);
      if (haveSig() !== wantSig(t, marks)) { input.innerHTML = markup(t, marks); if (off != null) setCaret(off); }
    }
    input.dataset['empty'] = String(!t);
    paintSend();
    if (o.hint) paintHint(o.hint(t));
  }
  const later = (): void => { clearTimeout(typingT); typingT = window.setTimeout(() => render(true), 250); };

  /* ───── the composer's own undo (a redrawn text): snapshots of the words and the caret; typing and deleting coalesce by the second ───── */
  interface Snap { text: string; caret: number }
  const past: Snap[] = [], future: Snap[] = [];
  let lastKind = '', lastAt = 0;
  const now = (): Snap => ({ text: text(), caret: caret() ?? text().length });
  function remember(kind: 'type' | 'delete' | 'edit'): void {
    if (!redraws) return;
    const at = performance.now();
    if (kind !== 'edit' && kind === lastKind && at - lastAt < 1000) { lastAt = at; return; }
    past.push(now()); if (past.length > 100) past.shift();
    future.length = 0; lastKind = kind; lastAt = at;
  }
  /** the text as it was (or will be again): drawn at once, the caret where it was, and said as an input */
  function travel(back: boolean): void {
    const from = back ? past : future, to = back ? future : past, snap = from.pop();
    if (!snap) return;
    to.push(now()); lastKind = '';
    input.textContent = snap.text; forward = false; render(false); setCaret(snap.caret);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: back ? 'historyUndo' : 'historyRedo' }));
  }
  /** a typed edit at the caret (the paste, a line break, an insert), kept by the undo */
  function insertText(t: string): void { remember('edit'); document.execCommand('insertText', false, t); }
  /** the text from `start` to `end` becomes `ins` at once (a picked name, a chip changed or taken out), the caret after it */
  function replace(start: number, end: number, ins: string): void {
    const t = text();
    remember('edit');
    input.textContent = t.slice(0, start) + ins + t.slice(end);
    forward = false; render(false);
    input.focus(); setCaret(start + ins.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
  }
  /** the chip that ends (Backspace) or starts (Delete) at a caret */
  function chipBeside(off: number, side: 'before' | 'after'): { el: HTMLElement; start: number; end: number } | null {
    for (const el of input.querySelectorAll<HTMLElement>('[data-chip]')) {
      const start = offsetOf(el), end = start + (el.textContent ?? '').length;
      if (side === 'before' ? end === off : start === off) return { el, start, end };
    }
    return null;
  }
  const assumeBtns = (): HTMLElement[] => (hintEl ? [...hintEl.querySelectorAll<HTMLElement>('.ui-assume')] : []);
  input.addEventListener('input', (e) => {
    const it = (e as InputEvent).inputType;
    forward = it === 'insertText' || it === 'insertCompositionText';
    typed = true; later(); input.dataset['empty'] = String(!text()); paintSend();
  });
  input.addEventListener('beforeinput', (e) => {
    if (!redraws) return;
    const ie = e as InputEvent;
    if (ie.inputType === 'historyUndo' || ie.inputType === 'historyRedo') { e.preventDefault(); travel(ie.inputType === 'historyUndo'); return; }
    if (ie.isComposing || ie.inputType === 'insertCompositionText') return;
    remember(ie.inputType === 'insertText' && !!ie.data && !/\s/.test(ie.data) ? 'type' : /^delete(Content|Word|Soft)/.test(ie.inputType) ? 'delete' : 'edit');
  });
  input.addEventListener('compositionstart', () => { composing = true; remember('edit'); });
  input.addEventListener('compositionend', () => { composing = false; later(); });
  /* a name still being typed becomes a chip once the caret leaves the text: read after the focus has settled, since the suggestions
     take it for a moment as they open and give it straight back */
  input.addEventListener('blur', () => {
    if (!o.mentions) return;
    setTimeout(() => { const a = document.activeElement; if (forward && !mentions?.suggesting && a !== input && !a?.closest('.ui-listbox')) { forward = false; render(false); } }, 0);
  });
  root.addEventListener('focusin', syncHint);
  root.addEventListener('focusout', () => setTimeout(() => { if (!root.contains(document.activeElement)) typed = false; syncHint(); }, 0));
  input.addEventListener('paste', (e) => { e.preventDefault(); const t = e.clipboardData?.getData('text/plain') ?? ''; insertText(t); forward = false; });
  root.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'Enter' && mod && !e.altKey) { e.preventDefault(); doSend(); return; }
    if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyA' && api.attach) { e.preventDefault(); api.attach.click(); return; }
    if (e.altKey && !mod && !e.shiftKey && e.code === 'KeyV') { e.preventDefault(); if (!e.repeat) talkKey(); return; }
    if (e.key === 'Escape' && listening) { e.preventDefault(); e.stopPropagation(); setListening(false); return; }
    const ab = assumeBtns(), ai = ab.indexOf(document.activeElement as HTMLElement);
    if (ai >= 0) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = ab[(ai + (e.key === 'ArrowRight' ? 1 : -1) + ab.length) % ab.length]; ab.forEach((b) => { b.tabIndex = b === n ? 0 : -1; }); n?.focus(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire<AssumptionDetail>(root, 'ui:assumption', { index: ai, item: items[ai], el: ab[ai] as HTMLElement }); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); fire(root, 'ui:assumption-drop', { index: ai, item: items[ai] }); render(false); requestAnimationFrame(() => { const b = assumeBtns(); (b[Math.min(ai, b.length - 1)] ?? input).focus(); }); return; }
      if (e.key === 'Escape' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); api.focus(); return; }
      if (e.key === 'Tab') { ab.forEach((b) => { b.tabIndex = -1; }); return; }
    }
  });
  input.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing) { e.preventDefault(); doSend(); return; }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); insertText('\n'); return; }
    if (redraws && mod && !e.altKey && e.code === 'KeyZ') { e.preventDefault(); travel(!e.shiftKey); return; }
    if (redraws && !isMac && e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyY') { e.preventDefault(); travel(false); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mod && !e.altKey && !e.isComposing && getSelection()?.isCollapsed) {
      /* a chip is one unit: one Backspace after it (or Delete before it) takes the whole mention out */
      const off = caret(), chip = off == null ? null : chipBeside(off, e.key === 'Backspace' ? 'before' : 'after');
      if (chip) { e.preventDefault(); replace(chip.start, chip.end, ''); return; }
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !mod && !text().trim() && !caret()) { if (!fire(root, 'ui:edit-last', {}, true)) e.preventDefault(); return; }
    if (e.key === 'Tab' && !e.shiftKey && hasHint() && root.hasAttribute('data-hinting')) { const ab = assumeBtns(); const first = ab[0]; if (first) { e.preventDefault(); ab.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; }); first.focus(); return; } }
    if (e.key === 'ArrowDown' && e.altKey) {
      const s = getSelection(); const an = s?.anchorNode; const n = an && (an.nodeType === 1 ? (an as Element) : an.parentElement);
      const off = caret(), beside = off == null ? null : chipBeside(off, 'before') ?? chipBeside(off, 'after');
      const m = (n ? n.closest<HTMLElement>('.ui-ff') : null) ?? beside?.el ?? null;
      if (m) { e.preventDefault(); e.stopPropagation(); decide(m); }
    }
  });
  if (hintEl) hintEl.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('.ui-assume'); if (b) fire<AssumptionDetail>(root, 'ui:assumption', { index: +(b.dataset['i'] ?? 0), item: items[+(b.dataset['i'] ?? 0)], el: b }); });
  /** a mark is opened: a chip's list (change or remove the mention), or the reading of a dashed word ('ui:decision') */
  function decide(m: HTMLElement): void {
    if (m.hasAttribute('data-chip') && mentions) { mentions.open(m); return; }
    fire<DecisionDetail>(root, 'ui:decision', { kind: m.dataset['kind'], text: m.textContent ?? '', el: m });
  }
  input.addEventListener('click', (e) => { const m = (e.target as Element).closest<HTMLElement>('.ui-ff'); if (m && getSelection()?.isCollapsed) decide(m); });
  box.addEventListener('pointerdown', (e) => { if (e.target === box) { e.preventDefault(); api.focus(); } });
  const stopping = (): boolean => running && !(o.queue && text().trim());
  send.addEventListener('click', () => (stopping() ? fire(root, 'ui:stop', {}) : doSend()));
  /* the mic: a click toggles; a press held 400ms or more talks while held; Alt+V the same from the keyboard */
  const mic = q<HTMLButtonElement>('.ui-composer__mic');
  let listening = false, listenMode: 'toggle' | 'hold' | null = null, pressAt = 0, pressStarted = false, keyAt = 0, placeholderWas: string | null = null;
  const prevReaction = new Map<Element, string | null>();
  function botOrbs(): Element[] {
    const out: Element[] = [];
    if (bot && bot.id) { const id = String(bot.id).replace(/["\\]/g, ''); for (const el of document.querySelectorAll('.ui-orb[data-bot="' + id + '"] > orb-avatar, orb-avatar[data-bot="' + id + '"]')) out.push(el); }
    if (o.orbs) { try { for (const el of o.orbs() ?? []) if (el && !out.includes(el)) out.push(el); } catch { /* a getter that throws is ignored */ } }
    return out;
  }
  function setListening(v: boolean, mode?: 'toggle' | 'hold'): void {
    if (v === listening) { if (v && mode) listenMode = mode; return; }
    listening = v; listenMode = v ? (mode ?? 'toggle') : null;
    root.toggleAttribute('data-listening', v);
    mic.setAttribute('aria-pressed', String(v));
    mic.setAttribute('aria-label', v ? 'Stop listening' : micLabelOf());
    mic.setAttribute('data-tip', v ? 'Stop listening' : micLabelOf());
    const listeningText = bot ? (bot.name ?? '') + ' is listening' : 'Listening';
    if (v) { placeholderWas = input.getAttribute('data-placeholder'); input.setAttribute('data-placeholder', listeningText); }
    else if (input.getAttribute('data-placeholder') === listeningText) input.setAttribute('data-placeholder', placeholderWas != null ? placeholderWas : (o.placeholder || ''));
    if (v && bot && !mic.querySelector('.ui-orb')) mic.insertAdjacentHTML('beforeend', orbHtml(bot, { size: 18, live: true }));
    const own = mic.querySelector('orb-avatar');
    if (v) {
      for (const el of botOrbs().concat(own ? [own] : [])) { if (!prevReaction.has(el)) prevReaction.set(el, el.getAttribute('reaction')); el.setAttribute('reaction', 'listening'); }
    } else {
      /* give each orb back its reaction, unless something else changed it meanwhile */
      for (const [el, r] of prevReaction) if (el.getAttribute('reaction') === 'listening') { if (r == null) el.removeAttribute('reaction'); else el.setAttribute('reaction', r); }
      prevReaction.clear();
    }
    announce(v ? (bot ? (bot.name ?? '') + ' is listening' : 'Listening') : 'Stopped listening');
    fire<DictateDetail>(root, 'ui:dictate', { value: v, bot: bot ? bot.id ?? null : null, mode: v ? listenMode : null });
  }
  function talkKey(): void {
    if (listening) { setListening(false); keyAt = 0; return; }
    setListening(true, 'hold'); keyAt = performance.now();
    const up = (e: KeyboardEvent): void => {
      if (e.code !== 'KeyV') return;
      removeEventListener('keyup', up, true);
      if (keyAt && performance.now() - keyAt >= HOLD_TALK) setListening(false); else if (listening) listenMode = 'toggle';
      keyAt = 0;
    };
    addEventListener('keyup', up, true);
  }
  mic.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();   /* the text keeps focus: you can talk and type */
    pressAt = performance.now(); pressStarted = !listening;
    if (pressStarted) setListening(true, 'hold');
  });
  const release = (): void => {
    if (!pressAt) return;
    const held = performance.now() - pressAt >= HOLD_TALK;
    if (!pressStarted || held) setListening(false); else listenMode = 'toggle';
    pressAt = 0;
  };
  mic.addEventListener('pointerup', release);
  mic.addEventListener('pointercancel', release);
  mic.addEventListener('click', (e) => { if (e.detail === 0) setListening(!listening, 'toggle'); });   /* Enter or Space on the focused mic */
  function doSend(): void { const t = text().trim(); if (!t || (running && !o.queue)) return; if (fire<SendDetail>(root, 'ui:send', { text: t }, true)) { typed = false; api.setValue(''); if (listening) setListening(false); } }

  const api = root as ComposerEl;
  Object.defineProperties(api, {
    value: { get: text },
    listening: { get: () => listening },
    input: { value: input }, chips: { value: chipsEl }, mic: { value: mic },
    attach: { value: root.querySelector<HTMLElement>('.ui-composer__attach') }
  });
  api.setValue = (t) => { input.textContent = t || ''; past.length = 0; future.length = 0; lastKind = ''; forward = false; render(false); };
  api.refresh = () => render(true);
  api.insert = (t) => { api.focus(); insertText(t); };
  api.focus = () => { input.focus(); setCaret(text().length); };
  api.flashHint = (ms) => { root.setAttribute('data-hint-flash', ''); syncHint(); clearTimeout(flashT); flashT = window.setTimeout(() => { root.removeAttribute('data-hint-flash'); syncHint(); }, ms || 2600); };
  api.setListening = (v) => setListening(v, 'toggle');
  /* a composer reused across bots (the Bots tab) follows the selected one */
  api.setBot = (b) => {
    if (listening) setListening(false);
    bot = b;
    mic.querySelector('.ui-orb')?.remove();
    mic.setAttribute('aria-label', micLabelOf()); mic.setAttribute('data-tip', micLabelOf());
  };
  api.addFile = (name, o) => {
    const f = fileChip(name, { ...o, onRemove: () => { o?.onRemove?.(); input.focus(); } });
    files.appendChild(f);
  };
  /* the send button: Send; Stop while running; and, with `queue`, Send when done once something is typed during a run */
  let drawn = 'send';
  function paintSend(): void {
    const stop = stopping(), mode = stop ? 'stop' : running ? 'queue' : 'send';
    if (mode !== drawn) {
      drawn = mode;
      const s = frag(html.send({ running: stop }));
      send.replaceChildren(...s.childNodes);
      for (const a of ['aria-label', 'data-tip', 'data-kbd', 'aria-keyshortcuts']) { if (s.hasAttribute(a)) send.setAttribute(a, s.getAttribute(a) ?? ''); else send.removeAttribute(a); }
      if (mode === 'queue') { send.setAttribute('aria-label', 'Send when done'); send.setAttribute('data-tip', 'Send when done'); }
    }
    send.disabled = !stop && !text().trim();
  }
  api.setRunning = (v) => { running = !!v; paintSend(); };
  api.setSpend = (spent, cap) => { const c = root.querySelector('.ui-capacity'); if (c) c.outerHTML = cap ? html.capacity(spent, cap) : '<span class="ui-capacity" role="img" aria-label="' + esc(spent + ' spent') + '"><b>' + esc(spent) + '</b></span>'; };
  api.setHint = (h) => paintHint(h);
  if (o.mentions) mentions = wireMentions({ root, input, box, value: text, caret, setCaret, replace, offsetOf }, o.mentions);
  api.setValue(o.value);
  return api;
}
