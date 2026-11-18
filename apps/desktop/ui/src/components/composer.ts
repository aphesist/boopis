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
   Region markers: the root carries data-hx-composer, the text field data-hx-focus="composer". */
import { attrs, esc, fire, frag, isMac } from '../core/dom';
import type { BotLike } from './bot-state';
import { announce } from './announce';
import { html } from './html';
import type { ChipOpts } from './html';
import { hydrateOne } from './wire';
import { icon } from './icons';
import { orbHtml } from './orb';

export interface FeedforwardMark { text: string; kind?: string | undefined; confirmed?: boolean | undefined; at?: number }
export interface HintItem { label: string; kind: string; text: string }
export interface ComposerOpts {
  placeholder?: string; label?: string; value?: string; attach?: boolean; chips?: ReadonlyArray<ChipOpts | HTMLElement>;
  spend?: { spent: string; cap: string };
  bot?: BotLike | null;
  orbs?: () => Array<Element | null | undefined>;
  compact?: boolean;
  hint?: (text: string) => string | HintItem[];
  feedforward?: (text: string) => FeedforwardMark[];
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
  addFile(name: string): void;
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
  const attachHTML = o.attach ? html.iconButton({ icon: 'plus', label: 'Attach files, folders or a teammate', tip: 'Attach', keys: 'alt+A', haspopup: 'menu', expanded: false, class: 'ui-composer__attach' }) : '';
  const acts = '<span class="ui-composer__acts">' + (compact ? attachHTML : '') +
    html.iconButton({ icon: 'mic', label: micLabelOf(), keys: 'alt+V', pressed: false, class: 'ui-composer__mic' }) + html.send({ disabled: true }) + '</span>';
  const root = frag('<div class="ui-composer" data-ui="composer" data-hx-composer' + (compact ? ' data-compact' : '') + '>' +
    (o.hint ? '<div class="ui-composer__hint" role="group" aria-label="Will assume"></div>' : '') +
    '<div class="ui-composer__box"><div class="ui-composer__files"></div>' +
    '<div class="ui-composer__input" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="false" data-hx-focus="composer"' + attrs({ 'aria-label': o.label, 'data-placeholder': o.placeholder, 'aria-description': o.feedforward ? 'Dashed words are a reading of your request. Alt and down arrow on one changes it; Tab reaches the assumptions.' : null }) + '></div>' +
    '<div class="ui-composer__bar">' + (compact ? '' : attachHTML) +
    '<span class="ui-composer__chips"></span><span class="ui-composer__spacer"></span>' + (o.spend ? html.capacity(o.spend.spent, o.spend.cap) : '') +
    acts + '</div></div></div>');
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel) as T;
  const box = q('.ui-composer__box'), input = q('.ui-composer__input'), send = q<HTMLButtonElement>('.ui-send');
  const chipsEl = q('.ui-composer__chips'), hintEl = root.querySelector<HTMLElement>('.ui-composer__hint'), files = q('.ui-composer__files');
  const chipOf = (c: ChipOpts): HTMLElement => { const n = frag(html.chip(c)); hydrateOne(n); return n; };
  for (const c of o.chips) chipsEl.appendChild(c instanceof Element ? c : chipOf(c));
  hydrateOne(root);
  let running = false, typingT = 0, typed = false, items: HintItem[] = [], flashT = 0;
  const text = (): string => (input.textContent ?? '').replace(/ /g, ' ');
  function caret(): number | null {
    const s = getSelection(); if (!s || !s.rangeCount || !s.anchorNode || !input.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(input); r.setEnd(s.anchorNode, s.anchorOffset); return r.toString().length;
  }
  function setCaret(off: number | null): void {
    if (off == null) return;
    const s = getSelection(); if (!s) return;
    const w = document.createTreeWalker(input, NodeFilter.SHOW_TEXT); let n: Node | null, left = off;
    while ((n = w.nextNode())) {
      const len = (n as Text).length;
      if (left <= len) { const r = document.createRange(); r.setStart(n, left); r.collapse(true); s.removeAllRanges(); s.addRange(r); return; }
      left -= len;
    }
    const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); s.removeAllRanges(); s.addRange(r);
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
  function render(keepCaret: boolean): void {
    const t = text(), off = keepCaret ? caret() : null;
    if (o.feedforward) {
      const marks = t ? (o.feedforward(t) || []).map((m) => ({ ...m, at: m.at ?? t.indexOf(m.text) })).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at) : [];
      let out = '', i = 0;
      for (const m of marks) { if (m.at < i) continue; out += esc(t.slice(i, m.at)) + '<span class="ui-ff" data-kind="' + esc(m.kind ?? '') + '"' + (m.confirmed ? ' data-confirmed' : '') + '>' + esc(m.text) + '</span>'; i = m.at + m.text.length; }
      out += esc(t.slice(i));
      if (input.innerHTML !== out) { input.innerHTML = out; if (off != null) setCaret(off); }
    }
    input.dataset['empty'] = String(!t);
    send.disabled = !running && !t.trim();
    if (o.hint) paintHint(o.hint(t));
  }
  const assumeBtns = (): HTMLElement[] => (hintEl ? [...hintEl.querySelectorAll<HTMLElement>('.ui-assume')] : []);
  input.addEventListener('input', () => { typed = true; clearTimeout(typingT); typingT = window.setTimeout(() => render(true), 250); input.dataset['empty'] = String(!text()); send.disabled = !running && !text().trim(); });
  root.addEventListener('focusin', syncHint);
  root.addEventListener('focusout', () => setTimeout(() => { if (!root.contains(document.activeElement)) typed = false; syncHint(); }, 0));
  input.addEventListener('paste', (e) => { e.preventDefault(); const t = e.clipboardData?.getData('text/plain') ?? ''; document.execCommand('insertText', false, t); });
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
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '\n'); return; }
    if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !mod && !text().trim() && !caret()) { if (!fire(root, 'ui:edit-last', {}, true)) e.preventDefault(); return; }
    if (e.key === 'Tab' && !e.shiftKey && hasHint() && root.hasAttribute('data-hinting')) { const ab = assumeBtns(); const first = ab[0]; if (first) { e.preventDefault(); ab.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; }); first.focus(); return; } }
    if (e.key === 'ArrowDown' && e.altKey) {
      const s = getSelection(); const an = s?.anchorNode; const n = an && (an.nodeType === 1 ? (an as Element) : an.parentElement);
      const m = n ? n.closest<HTMLElement>('.ui-ff') : null;
      if (m) { e.preventDefault(); e.stopPropagation(); fire<DecisionDetail>(root, 'ui:decision', { kind: m.dataset['kind'], text: m.textContent ?? '', el: m }); }
    }
  });
  if (hintEl) hintEl.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('.ui-assume'); if (b) fire<AssumptionDetail>(root, 'ui:assumption', { index: +(b.dataset['i'] ?? 0), item: items[+(b.dataset['i'] ?? 0)], el: b }); });
  input.addEventListener('click', (e) => { const m = (e.target as Element).closest<HTMLElement>('.ui-ff'); if (m && getSelection()?.isCollapsed) fire<DecisionDetail>(root, 'ui:decision', { kind: m.dataset['kind'], text: m.textContent ?? '', el: m }); });
  box.addEventListener('pointerdown', (e) => { if (e.target === box) { e.preventDefault(); api.focus(); } });
  send.addEventListener('click', () => (running ? fire(root, 'ui:stop', {}) : doSend()));
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
  function doSend(): void { const t = text().trim(); if (!t || running) return; if (fire<SendDetail>(root, 'ui:send', { text: t }, true)) { typed = false; api.setValue(''); if (listening) setListening(false); } }

  const api = root as ComposerEl;
  Object.defineProperties(api, {
    value: { get: text },
    listening: { get: () => listening },
    input: { value: input }, chips: { value: chipsEl }, mic: { value: mic },
    attach: { value: root.querySelector<HTMLElement>('.ui-composer__attach') }
  });
  api.setValue = (t) => { input.textContent = t || ''; render(false); };
  api.refresh = () => render(true);
  api.insert = (t) => { api.focus(); document.execCommand('insertText', false, t); };
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
  api.addFile = (name) => {
    const f = frag('<span class="ui-file">' + icon('file') + '<span>' + esc(name) + '</span>' + html.iconButton({ icon: 'close', label: 'Remove ' + name, size: 's', tip: false }) + '</span>');
    f.querySelector('button')?.addEventListener('click', () => { f.remove(); input.focus(); });
    files.appendChild(f);
  };
  api.setRunning = (v) => {
    running = !!v;
    const s = frag(html.send({ running }));
    send.replaceChildren(...s.childNodes);
    for (const a of ['aria-label', 'data-tip', 'data-kbd', 'aria-keyshortcuts']) { if (s.hasAttribute(a)) send.setAttribute(a, s.getAttribute(a) ?? ''); else send.removeAttribute(a); }
    send.disabled = !running && !text().trim();
  };
  api.setSpend = (spent, cap) => { const c = root.querySelector('.ui-capacity'); if (c) c.outerHTML = cap ? html.capacity(spent, cap) : '<span class="ui-capacity" aria-label="' + esc(spent + ' spent') + '"><b>' + esc(spent) + '</b></span>'; };
  api.setHint = (h) => paintHint(h);
  api.setValue(o.value);
  return api;
}
