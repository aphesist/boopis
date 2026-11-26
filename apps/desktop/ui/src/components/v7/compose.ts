/* The Composer's own editing, the same in every composer (a session, a bot's chat, a room, the dock's card): wire.ts wires it on each.

   Undo     The text is drawn again under the person (a mention becomes its chip, the words it is read by are marked, a file is set in
            as a chip), which the browser's own undo cannot follow. So the composer keeps its own: mod+Z, shift+mod+Z (ctrl+Y off the
            Mac) and the edit menu's Undo and Redo travel through what the text was, chips and all, the caret where it stood. The
            letters of a word and a run of deletions gather by the second; a space, a paste, a pick, a chip set in or taken out are
            one step each.
   Chips    A chip is one unit: Backspace after it, or Delete before it, takes the whole chip out, in every engine.
   Paste    Text is pasted as plain words at the caret. A pasted file is not text: it is handed on as `ui:files`.
   Files    A file dragged over the composer shows that it can be dropped (`data-drop`: the box's line in the focus colour, nothing
            new), and a dropped one is handed on as `ui:files` {files, via}. What a file becomes is the app's (a chip, as "+" makes).
            Where the host reports drags itself (the desktop app: the page gets no drop), the app says so with `composerDropping`.
   Talk     The mic dictates: a press or alt+V switches it on and off; held 400 ms or more, it listens while held and stops on
            release. Esc stops it. `ui:dictate` {on, mode} (cancelable) says so; the audio is the host's. While it listens the mic is
            named "Stop listening" and the placeholder says who listens (`data-hears`). With no speech model set up (`data-mic-setup`)
            a press, a hold or alt+V starts nothing: `ui:dictate-setup` asks the app to say what dictation needs. */
import { fire, isMac } from '../../core/dom';
import { announce } from '../announce';

const TEXT = '.k7-composer__text';
const textOf = (c: HTMLElement): HTMLElement | null => (c.matches(TEXT) ? c : c.querySelector<HTMLElement>(TEXT));
/** a chip of the text: one unit, not typed into */
const isChip = (n: Node | null | undefined): n is HTMLElement => !!n && n.nodeType === 1 && (n as HTMLElement).getAttribute('contenteditable') === 'false';

/* ───────── the caret, in units: a typed character is one, a chip is one ───────── */
/** how many units of `t` stand before the caret, or -1 when the caret is elsewhere */
function caretUnits(t: HTMLElement): number {
  const sel = typeof getSelection === 'function' ? getSelection() : null, at = sel && sel.rangeCount ? sel.anchorNode : null;
  if (!sel || !at || !t.contains(at)) return -1;
  const off = sel.anchorOffset;
  let units = 0, done = false;
  const walk = (p: Node): void => {
    if (p.nodeType === 3) { if (p === at) { units += off; done = true; } else units += (p.textContent ?? '').length; return; }
    if (isChip(p)) { units += 1; if (p.contains(at)) done = true; return; }
    const kids = p.childNodes;
    for (let i = 0; i < kids.length && !done; i++) { if (p === at && i === off) { done = true; return; } walk(kids[i] as Node); }
    if (p === at) done = true;
  };
  walk(t);
  return units;
}
/** the caret after `units` units of `t` (past the end: at the end) */
function placeCaret(t: HTMLElement, units: number): void {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (!sel) return;
  const r = document.createRange();
  let left = Math.max(0, units), set = false;
  const walk = (p: Node): void => {
    for (const k of [...p.childNodes]) {
      if (set) return;
      if (k.nodeType === 3) { const len = (k.textContent ?? '').length; if (left <= len) { r.setStart(k, left); set = true; } else left -= len; }
      else if (isChip(k)) { if (left === 0) { r.setStartBefore(k); set = true; } else if (--left === 0 && k.nextSibling?.nodeType !== 3) { r.setStartAfter(k); set = true; } }
      else walk(k);
    }
  };
  walk(t);
  if (set) r.collapse(true); else { r.selectNodeContents(t); r.collapse(false); }
  sel.removeAllRanges(); sel.addRange(r);
}
/** what the text says, however it is drawn: its words, and a chip that carries no words (a file that rides with the message) by its mark */
function said(t: HTMLElement): string {
  let out = '';
  const walk = (p: Node): void => {
    for (const k of p.childNodes) {
      if (k.nodeType === 3) out += k.textContent ?? '';
      else if (isChip(k)) out += k.textContent || '\u0001' + (k.getAttribute('data-att') ?? k.getAttribute('data-tip') ?? '');
      else walk(k);
    }
  };
  walk(t);
  return out;
}

/* ───────── undo ───────── */
interface Snap { html: string; caret: number; said: string }
interface History { past: Snap[]; future: Snap[]; kind: string; at: number }
const HIST = new WeakMap<HTMLElement, History>();
const KEEP = 100, GATHER_MS = 1000;
const hist = (t: HTMLElement): History => { let h = HIST.get(t); if (!h) HIST.set(t, (h = { past: [], future: [], kind: '', at: 0 })); return h; };
const snap = (t: HTMLElement): Snap => { const c = caretUnits(t); return { html: t.innerHTML, caret: c < 0 ? Number.MAX_SAFE_INTEGER : c, said: said(t) }; };
/** keep the text as it is now, before an edit: `type` and `delete` gather with the same kind within a second; `edit` is a step of its own */
export function composerRemember(c: HTMLElement, kind: 'type' | 'delete' | 'edit' = 'edit'): void {
  const t = textOf(c); if (!t) return;
  const h = hist(t), now = Date.now();
  if (kind !== 'edit' && kind === h.kind && now - h.at < GATHER_MS) { h.at = now; return; }
  const s = snap(t), last = h.past[h.past.length - 1];
  h.kind = kind; h.at = now; h.future.length = 0;
  if (last && last.said === s.said) return;   /* nothing changed since the last one kept */
  h.past.push(s);
  if (h.past.length > KEEP) h.past.shift();
}
/** the text as it was (`back`), or as it was before the last undo: drawn at once with its chips, the caret where it stood, and said
    as an input. False when there is nothing to go to */
export function composerUndo(c: HTMLElement, back = true): boolean {
  const t = textOf(c); if (!t) return false;
  const h = hist(t), from = back ? h.past : h.future, to = back ? h.future : h.past, now = snap(t);
  let s = from.pop();
  while (s && s.said === now.said) s = from.pop();
  if (!s) return false;
  to.push(now); h.kind = '';
  t.innerHTML = s.html;   /* written in place: a chip's orb is painted where it is made */
  placeCaret(t, s.caret);
  t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: back ? 'historyUndo' : 'historyRedo' }));
  return true;
}
/** forget what the text was (a message was sent: its words do not come back with undo) */
export function composerForget(c: HTMLElement): void { const t = textOf(c); if (t) HIST.delete(t); }
/** set a composer's text from outside (your last message brought back, a held message taken back): one step the undo keeps, the caret at
    the end, said as an input so the chips and the marks follow */
export function composerSet(c: HTMLElement, text: string): void {
  const t = textOf(c); if (!t) return;
  composerRemember(t, 'edit');
  t.textContent = text;
  placeCaret(t, Number.MAX_SAFE_INTEGER);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ───────── typed edits made by the composer itself ───────── */
/** `text` at the caret as if typed, in place of what is selected (at the end when the caret is elsewhere): one step for the undo */
export function composerType(c: HTMLElement, text: string): void {
  const t = textOf(c); if (!t) return;
  composerRemember(t, 'edit');
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const r = sel && sel.rangeCount && t.contains(sel.anchorNode) && !isChip(sel.anchorNode?.parentElement?.closest('[contenteditable="false"]')) ? sel.getRangeAt(0) : null;
  const node = document.createTextNode(text);
  if (r) { r.deleteContents(); r.insertNode(node); } else t.append(node);
  const after = document.createRange(); after.setStart(node, text.length); after.collapse(true);
  sel?.removeAllRanges(); sel?.addRange(after);
  reveal(t);
  t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}
/** a tall draft keeps its caret in sight after text arrives at it */
function reveal(t: HTMLElement): void {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  if (!r || typeof r.getBoundingClientRect !== 'function' || t.scrollHeight <= t.clientHeight) return;
  const c = r.getBoundingClientRect(), box = t.getBoundingClientRect();
  if (c.bottom > box.bottom) t.scrollTop += c.bottom - box.bottom; else if (c.top < box.top && c.height) t.scrollTop -= box.top - c.top;
}
/** the chip that ends at the caret (`before`) or starts at it (`after`), when nothing is selected */
function chipBeside(t: HTMLElement, side: 'before' | 'after'): HTMLElement | null {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !sel.anchorNode || !t.contains(sel.anchorNode)) return null;
  let n: Node = sel.anchorNode, off = sel.anchorOffset;
  if (n.nodeType === 3) {
    if (side === 'before' ? off > 0 : off < (n.textContent ?? '').length) return null;
  } else {
    const k = n.childNodes[side === 'before' ? off - 1 : off];
    if (k) return isChip(k) ? k : k.nodeType === 3 && !(k.textContent ?? '') ? next(k, side, t) : null;
    if (n === t) return null;
  }
  return next(n, side, t);
  /** what stands beside `from` in the text's own order, past empty runs and out of a mark */
  function next(from: Node, dir: 'before' | 'after', root: HTMLElement): HTMLElement | null {
    let at: Node | null = from;
    while (at && at !== root) {
      const sib: Node | null = dir === 'before' ? at.previousSibling : at.nextSibling;
      if (!sib) { at = at.parentNode; continue; }
      if (isChip(sib)) return sib;
      if (sib.nodeType === 3 && !(sib.textContent ?? '')) { at = sib; continue; }
      return null;
    }
    return null;
  }
}

/* ───────── the mic ───────── */
const HOLD_TALK = 400;
function wireMic(c: HTMLElement, t: HTMLElement, mic: HTMLButtonElement): void {
  const rest = { label: mic.getAttribute('aria-label') ?? 'Dictate', ph: null as string | null };
  let pressAt = 0, pressStarted = false, keyAt = 0;
  const on = (): boolean => mic.getAttribute('aria-pressed') === 'true';
  const words = (): string => { const who = c.getAttribute('data-hears'); return who ? who + ' is listening' : 'Listening'; };
  /* the look of listening follows the mic's own state, whoever changed it (the app switches it off when its composer is drawn again) */
  const paint = (): void => {
    const v = on();
    c.toggleAttribute('data-listening', v);
    const label = v ? 'Stop listening' : rest.label;
    if (mic.getAttribute('aria-label') !== label) { mic.setAttribute('aria-label', label); mic.setAttribute('data-tip', label); }
    if (v) { if (rest.ph === null) { rest.ph = t.getAttribute('data-placeholder') ?? ''; t.setAttribute('data-placeholder', words()); } }
    else if (rest.ph !== null) { if (t.getAttribute('data-placeholder') === words()) t.setAttribute('data-placeholder', rest.ph); rest.ph = null; }
  };
  /* nothing can hear yet: the mic never switches on, and the app is asked to say what it needs (thread.ts `micSetup`) */
  const needsSetup = (): boolean => c.hasAttribute('data-mic-setup');
  const askSetup = (): void => { fire(c, 'ui:dictate-setup', {}); };
  const set = (v: boolean, mode: 'toggle' | 'hold' = 'toggle'): void => {
    if (v === on()) return;
    if (v && needsSetup()) return;
    if (!fire(c, 'ui:dictate', { on: v, mode: v ? mode : null }, true)) return;
    mic.setAttribute('aria-pressed', String(v));
    paint();
    announce(v ? words() : 'Stopped listening');
  };
  new MutationObserver(paint).observe(mic, { attributes: true, attributeFilter: ['aria-pressed'] });
  mic.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();   /* the text keeps the focus: you can talk and type */
    try { mic.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    if (needsSetup()) return;   /* the click that follows asks for the setup, once, however long the press was held */
    pressAt = Date.now(); pressStarted = !on();
    if (pressStarted) set(true, 'hold');
  });
  const release = (): void => {
    if (!pressAt) return;
    const held = Date.now() - pressAt >= HOLD_TALK;
    pressAt = 0;
    if (!pressStarted || held) set(false);   /* a press on a mic that was on switches it off; a hold ends with the hold */
  };
  mic.addEventListener('pointerup', release);
  mic.addEventListener('pointercancel', release);
  /* Enter or Space on the focused mic, and a press the app makes for the person: the switch */
  mic.addEventListener('click', (e) => { if (needsSetup()) { if (on()) set(false); else askSetup(); return; } if (e.detail === 0) set(!on()); });
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && on()) { e.preventDefault(); e.stopPropagation(); set(false); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyV') return;
    e.preventDefault();
    if (e.repeat) return;
    if (on()) { set(false); keyAt = 0; return; }
    if (needsSetup()) { askSetup(); return; }
    set(true, 'hold'); keyAt = Date.now();
    const up = (u: KeyboardEvent): void => {
      if (u.code !== 'KeyV') return;
      removeEventListener('keyup', up, true);
      if (keyAt && Date.now() - keyAt >= HOLD_TALK) set(false);
      keyAt = 0;
    };
    addEventListener('keyup', up, true);
  });
  paint();
}

/* ───────── files ───────── */
/** say that a file is being dragged over this composer, or no longer is (the desktop app's host reports drags; the page's own are seen
    by the composer itself) */
export function composerDropping(c: HTMLElement, on: boolean): void {
  const root = c.matches('.k7-composer') ? c : c.querySelector<HTMLElement>('.k7-composer');
  if (root && root.hasAttribute('data-drop') !== on) root.toggleAttribute('data-drop', on);
}
const carriesFiles = (d: DataTransfer | null | undefined): boolean => !!d && [...(d.types ?? [])].includes('Files');
function wireFiles(c: HTMLElement, t: HTMLElement): void {
  c.addEventListener('dragenter', (e) => { if (carriesFiles(e.dataTransfer)) { e.preventDefault(); composerDropping(c, true); } });
  c.addEventListener('dragover', (e) => { if (!carriesFiles(e.dataTransfer)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; composerDropping(c, true); });
  c.addEventListener('dragleave', (e) => { if (!c.contains(e.relatedTarget as Node | null)) composerDropping(c, false); });
  c.addEventListener('drop', (e) => {
    composerDropping(c, false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    fire(c, 'ui:files', { files, via: 'drop' });
  });
  t.addEventListener('paste', (e) => {
    const d = e.clipboardData, files = [...(d?.files ?? [])];
    e.preventDefault();
    if (files.length) { fire(c, 'ui:files', { files, via: 'paste' }); return; }
    const text = d?.getData('text/plain') ?? '';
    if (text) composerType(t, text);
  });
}

/** wire a composer's editing (wire.ts calls it once per composer) */
export function wireComposerEditing(c: HTMLElement): void {
  const t = textOf(c); if (!t) return;
  t.addEventListener('beforeinput', (e) => {
    const ie = e as InputEvent, it = ie.inputType;
    if (it === 'historyUndo' || it === 'historyRedo') { e.preventDefault(); composerUndo(t, it === 'historyUndo'); return; }
    if (ie.isComposing || it === 'insertCompositionText') return;
    composerRemember(t, it === 'insertText' && !!ie.data && !/\s/.test(ie.data) ? 'type' : /^delete(Content|Word|Soft)/.test(it) ? 'delete' : 'edit');
  });
  t.addEventListener('compositionstart', () => { composerRemember(t, 'edit'); });
  t.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && !e.altKey && e.code === 'KeyZ') { e.preventDefault(); composerUndo(t, !e.shiftKey); return; }
    if (!isMac && e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyY') { e.preventDefault(); composerUndo(t, false); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mod && !e.altKey && !e.isComposing && !e.defaultPrevented) {
      const chip = chipBeside(t, e.key === 'Backspace' ? 'before' : 'after');
      if (!chip) return;
      e.preventDefault();
      composerRemember(t, 'edit');
      const units = caretUnits(t) - (e.key === 'Backspace' ? 1 : 0);
      chip.remove(); t.normalize();
      placeCaret(t, units);
      t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: e.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward' }));
    }
  });
  wireFiles(c, t);
  const mic = c.querySelector<HTMLButtonElement>('[data-mic]');
  if (mic) wireMic(c, t, mic);
}
