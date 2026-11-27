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
            named "Stop listening" and the placeholder says who listens (`data-hears`). What the dictation then does is told to
            the composer as its source reports it (`composerDictation`): the speech model being fetched, once, with its progress
            in the placeholder; listening; the words arriving in the text; an error, which switches the mic off. In a build with
            no dictation (`data-mic-off`) a press, a hold or alt+V starts nothing and `ui:dictate-unavailable` says so. */
import { isMac } from '../../../core/dom';
import { emit } from '../events';
import { announce } from '../../announce';

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
/** what a dictation says of itself while the mic is on, as its source reports it (the provider's `DictationEvent` is this shape):
    `preparing` the speech model is being fetched, once (bytes done of the total); `listening` it hears; `partial` the words so far
    of what is being said (each replaces the last); `final` a finished stretch, written into the text; `error` it could not go on,
    in plain words (`retry: false` where trying again cannot help) */
export type DictationState =
  | { kind: 'preparing'; done: number; total: number }
  | { kind: 'listening' }
  | { kind: 'partial'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; reason: string; retry?: boolean };
/** the phase the composer shows while its mic is on (`data-dictation`) */
export type DictationPhase = 'preparing' | 'listening' | 'transcribing';
interface Mic { say(ev: DictationState): void; turn(on: boolean): void }
const MICS = new WeakMap<HTMLElement, Mic>();
const micOf = (c: HTMLElement): Mic | undefined => { const root = c.matches('.k7-composer') ? c : c.querySelector<HTMLElement>('.k7-composer'); return root ? MICS.get(root) : undefined; };
/** tell the composer what its dictation is doing (the app hands on what the source reports). The composer draws it with what it has:
    the placeholder says "Getting the speech model 12 of 57 MB" and then who listens, the words arrive in the text where the caret
    stood, and an error switches the mic off (what says why, and offers to try again, is `kit.composerDictation`'s Notice at the mic).
    When the mic is switched off while words are still being heard, the composer goes on taking that dictation's events until its
    last words arrive (one `final`), an error does, or the source has said nothing for about 3 s, and then lets go: what was said
    right before the release is kept. Otherwise events that arrive while the mic is off are dropped */
export function composerDictation(c: HTMLElement, ev: DictationState): void { micOf(c)?.say(ev); }
/** switch a composer's mic on or off, as a press does ("Try again" after an error) */
export function composerDictate(c: HTMLElement, on: boolean): void { micOf(c)?.turn(on); }
/** megabytes as a download's progress says them: whole numbers, at least 1 of something that has started */
const mb = (bytes: number): number => Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1048576));
export const preparingWords = (done: number, total: number): string => 'Getting the speech model' + (total > 0 ? ' ' + mb(Math.min(done, total)) + ' of ' + mb(total) + ' MB' : '');

const HOLD_TALK = 400;
/** how long a dictation that was switched off may stay silent before the composer stops waiting for its last words */
const LAST_WORDS = 3000;
function wireMic(c: HTMLElement, t: HTMLElement, mic: HTMLButtonElement): void {
  const rest = { label: mic.getAttribute('aria-label') ?? 'Dictate', ph: null as string | null };
  let pressAt = 0, pressStarted = false, keyAt = 0;
  /* what the dictation is doing while the mic is on, the words of a download, and the stretch of text being heard */
  let phase: DictationPhase = 'listening', prep = '', hearing: Text | null = null, shown = '';
  /* after the mic is switched off: the wait for the last words of the stretch that was being spoken (`tail`); a press that ended such
     a wait takes no words until its own dictation has said it listens (`fresh`), so the other's late words do not land in it; and
     the moment a press is starting its dictation (`starting`), whose first report can come before the mic shows on */
  let tail: ReturnType<typeof setTimeout> | null = null, fresh = false, starting = false;
  const on = (): boolean => mic.getAttribute('aria-pressed') === 'true';
  const who = (): string => { const w = c.getAttribute('data-hears'); return w ? w + ' is listening' : 'Listening'; };
  const words = (): string => (phase === 'preparing' ? prep : who());
  /* the look of listening follows the mic's own state, whoever changed it (the app switches it off when its composer is drawn again) */
  const paint = (): void => {
    const v = on();
    if (!v && tail === null) { phase = 'listening'; prep = ''; hearing = null; }
    c.toggleAttribute('data-listening', v);
    if (v || tail !== null) c.setAttribute('data-dictation', phase); else c.removeAttribute('data-dictation');
    const label = v ? 'Stop listening' : rest.label;
    if (mic.getAttribute('aria-label') !== label) { mic.setAttribute('aria-label', label); mic.setAttribute('data-tip', label); }
    if (v) { if (rest.ph === null) rest.ph = t.getAttribute('data-placeholder') ?? ''; shown = words(); t.setAttribute('data-placeholder', shown); }
    else if (rest.ph !== null) { if (t.getAttribute('data-placeholder') === shown) t.setAttribute('data-placeholder', rest.ph); rest.ph = null; }
  };
  /* this build has no dictation (`data-mic-off`): the mic never switches on, and the app is asked to say so (ui:dictate-unavailable) */
  const off = (): boolean => c.hasAttribute('data-mic-off');
  const sayOff = (): void => { emit(c, 'ui:dictate-unavailable', {}); };
  /** stop waiting for a switched-off dictation's last words: what stands of them stays in the text, as words that were said */
  const letGo = (): void => {
    if (tail === null) return;
    clearTimeout(tail); tail = null;
    if (hearing?.isConnected) hear(hearing.data, true);
    hearing = null; paint();
  };
  const wait = (): void => { if (tail !== null) clearTimeout(tail); tail = setTimeout(letGo, LAST_WORDS); };
  const set = (v: boolean, mode: 'toggle' | 'hold' = 'toggle'): void => {
    if (v === on()) return;
    if (v && off()) return;
    if (v) { fresh = tail !== null; letGo(); }   /* a new press lets go of the last dictation: its events do not mix with this one's */
    starting = v;
    const go = emit(c, 'ui:dictate', { on: v, mode: v ? mode : null }, true);
    starting = false;
    if (!go) return;
    if (!v && phase !== 'preparing') { phase = 'transcribing'; wait(); }   /* it was listening: the last words said are still to come */
    mic.setAttribute('aria-pressed', String(v));
    paint();
    announce(v ? who() : 'Stopped listening');
  };
  /** the words being heard, written where the caret stands (at the end of the text when it is elsewhere; after a space where the
      words before have none); each partial replaces the last, the final one stays and the composer's own input handling follows it (a partial does not wake it: the text would be
      drawn again under the words still arriving) */
  const hear = (text: string, done: boolean): void => {
    const sel = typeof getSelection === 'function' ? getSelection() : null;
    const inText = !!sel && sel.rangeCount > 0 && t.contains(sel.anchorNode);
    /* last words that arrive after the mic is off move the caret only if it still stands at the end of the words they replace */
    const stood = !!hearing && hearing.isConnected, atEnd = stood && !!sel && sel.isCollapsed && sel.anchorNode === hearing && sel.anchorOffset === hearing?.length;
    if (!hearing || !hearing.isConnected) {
      composerRemember(t, 'edit');
      hearing = document.createTextNode('');
      if (inText && sel) { const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(hearing); } else t.append(hearing);
      const before = hearing.previousSibling?.textContent ?? '';
      hearing.data = before && !/\s$/.test(before) ? ' ' : '';
      hearing.splitText(hearing.length);   /* the space stays; what follows it is the stretch that is replaced */
      hearing = hearing.nextSibling as Text;
    }
    const follow = inText && !!sel && (on() || !stood || atEnd);
    hearing.data = text;
    if (follow && sel) sel.collapse(hearing, hearing.length);
    if (done) {
      const after = hearing.nextSibling?.textContent ?? '';
      if (after && !/^\s/.test(after)) { hearing.data += ' '; if (follow && sel) sel.collapse(hearing, hearing.length); }   /* said in the middle of a text: a space before what follows */
      hearing = null; t.normalize(); t.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  MICS.set(c, {
    turn(v) { set(v); },
    say(ev) {
      if (starting) { if (ev.kind === 'listening' || ev.kind === 'preparing') fresh = false; return; }
      if (!on()) {
        if (tail === null) return;
        if (ev.kind === 'final') { if (!hearing || hearing.isConnected) hear(ev.text, true); hearing = null; letGo(); }   /* not where the person erased the words meanwhile */
        else if (ev.kind === 'error') { letGo(); announce(ev.reason); }
        else wait();   /* the source is still there: its last words are on their way */
        return;
      }
      if (fresh) { if (ev.kind === 'partial' || ev.kind === 'final') return; fresh = false; }
      const was = phase;
      if (ev.kind === 'error') { set(false); letGo(); announce(ev.reason); return; }
      if (ev.kind === 'preparing') { phase = 'preparing'; prep = preparingWords(ev.done, ev.total); }
      else if (ev.kind === 'listening') phase = 'listening';
      else if (ev.kind === 'partial') { phase = 'transcribing'; hear(ev.text, false); }
      else { hear(ev.text, true); phase = 'listening'; }
      paint();
      if (phase !== was && phase !== 'transcribing') announce(phase === 'preparing' ? 'Getting the speech model' : who());
    }
  });
  new MutationObserver(paint).observe(mic, { attributes: true, attributeFilter: ['aria-pressed'] });
  mic.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();   /* the text keeps the focus: you can talk and type */
    try { mic.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    if (off()) return;   /* the click that follows says so, once, however long the press was held */
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
  mic.addEventListener('click', (e) => { if (off()) { if (on()) set(false); else sayOff(); return; } if (e.detail === 0) set(!on()); });
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && on()) { e.preventDefault(); e.stopPropagation(); set(false); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyV') return;
    e.preventDefault();
    if (e.repeat) return;
    if (on()) { set(false); keyAt = 0; return; }
    if (off()) { sayOff(); return; }
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
    emit(c, 'ui:files', { files, via: 'drop' });
  });
  t.addEventListener('paste', (e) => {
    const d = e.clipboardData, files = [...(d?.files ?? [])];
    e.preventDefault();
    if (files.length) { emit(c, 'ui:files', { files, via: 'paste' }); return; }
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
