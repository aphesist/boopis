/* The v7 kit's behaviours, wired once per element (`wire(root)` wires every kit component under root). Events bubble and
   are cancelable where an action follows: ui:change {value} (Segmented, Switch, Chip), ui:commit (a hold finished),
   ui:toggle {open} (Disclosure, Card's danger zone, FilesCard). State lives in ARIA and data attributes (R-state-2). */
import { esc, frag, reduced, tokenMs } from '../../core/dom';
import { emit } from './events';
import { layer } from '../layer';
import { icon } from '../icons';
import { paintDock } from './dock';
import { VOICE_SETUP } from './thread';
import { composerForget, composerRemember, wireComposerEditing } from './compose';

/* which behaviours an element has: an element can carry two (a chip that holds) */
const WIRED = new WeakMap<Element, Set<string>>();
const once = (el: Element, key: string): boolean => { let s = WIRED.get(el); if (!s) WIRED.set(el, (s = new Set())); if (s.has(key)) return false; s.add(key); return true; };

/** Segmented: one of a few; arrows move and choose (radio) or move and choose the tab (tabs) */
function wireSegmented(seg: HTMLElement): void {
  const items = (): HTMLButtonElement[] => [...seg.querySelectorAll<HTMLButtonElement>('.k7-seg__item')];
  const choose = (b: HTMLButtonElement, focus: boolean): void => {
    const tabs = seg.getAttribute('role') === 'tablist', list = items(), i = list.indexOf(b);
    if (b.getAttribute(tabs ? 'aria-selected' : 'aria-checked') === 'true') { if (focus) b.focus(); return; }
    if (!emit(seg, 'ui:change', { value: b.dataset['value'] ?? '' }, true)) return;
    for (const x of list) { const on = x === b; x.setAttribute(tabs ? 'aria-selected' : 'aria-checked', String(on)); x.tabIndex = on ? 0 : -1; }
    seg.style.setProperty('--i', String(i));
    if (focus) b.focus();
  };
  seg.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLButtonElement>('.k7-seg__item'); if (b) choose(b, false); });
  seg.addEventListener('keydown', (e) => {
    const list = items(), i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (n == null) return;
    e.preventDefault();
    const b = list[(n + list.length) % list.length];
    if (b) choose(b, true);
  });
}

/** Switch: applies at once (R-switch-1) */
function wireSwitch(sw: HTMLButtonElement): void {
  sw.addEventListener('click', () => {
    if (sw.disabled) return;
    const on = sw.getAttribute('aria-checked') !== 'true';
    if (!emit(sw, 'ui:change', { value: on }, true)) return;
    sw.setAttribute('aria-checked', String(on));
  });
}

/** a Row that is a checkbox (board 14's "Under the composer"): a press toggles it and fires ui:change {value}; Space and Enter press it
    (it is a row action, wireRowAction) */
function wireCheckRow(r: HTMLElement): void {
  const toggle = (): void => {
    const on = r.getAttribute('aria-checked') !== 'true';
    if (!emit(r, 'ui:change', { value: on }, true)) return;
    r.setAttribute('aria-checked', String(on));
  };
  r.addEventListener('click', toggle);
}

/** a filter or mode Chip toggles; an answer chip only reports (its card decides) */
function wireChip(c: HTMLButtonElement): void {
  if (c.dataset['variant'] === 'answer' || c.hasAttribute('data-hold')) return;
  c.addEventListener('click', () => {
    const on = c.getAttribute('aria-pressed') !== 'true';
    if (!emit(c, 'ui:change', { value: on }, true)) return;
    c.setAttribute('aria-pressed', String(on));
    c.toggleAttribute('data-chosen', on);
  });
}

/** hold to confirm (owner decision: 1 s, --dur-hold, everywhere): press and hold, or hold Space; released early it drains. From the
    keyboard Enter twice confirms too (KEYMAP section 6, as the v6 hold: the first press arms it and says so, for 4 s) */
export function wireHold(b: HTMLElement): void {
  let timer = 0, held = false, armed = 0;
  const label = b.querySelector<HTMLElement>('.k7-chip__label, .k7-btn__label'), words = label?.textContent ?? '';
  const disarm = (): void => { clearTimeout(armed); armed = 0; b.removeAttribute('data-armed'); if (label && !held) label.textContent = words; };
  const commit = (): void => { if (!emit(b, 'ui:commit', undefined, true)) return; held = true; b.setAttribute('data-held', ''); };
  const ms = (): number => tokenMs('--dur-hold', 1000);
  const start = (): void => {
    if (held || (b as HTMLButtonElement).disabled) return;
    b.setAttribute('data-holding', '');
    clearTimeout(timer);
    timer = window.setTimeout(() => { b.removeAttribute('data-holding'); commit(); }, ms());
  };
  const stop = (): void => { clearTimeout(timer); b.removeAttribute('data-holding'); };
  b.addEventListener('pointerdown', (e) => { if (e.button === 0) start(); });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) b.addEventListener(t, stop);
  b.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.repeat) { e.preventDefault(); start(); return; }
    if (e.key !== 'Enter' || e.repeat || held || (b as HTMLButtonElement).disabled) return;
    e.preventDefault();
    if (armed) { disarm(); commit(); return; }
    b.setAttribute('data-armed', '');
    if (label) label.textContent = 'Press again to confirm';
    armed = window.setTimeout(disarm, 4000);
  });
  b.addEventListener('blur', () => { if (armed) disarm(); });
  b.addEventListener('keyup', (e) => { if (e.key === ' ') stop(); });
}

/** Disclosure and every collapsed summary (Card's danger zone, FilesCard, ToolRow): the summary opens its body */
function wireDisclosure(d: HTMLElement): void {
  const btn = d.querySelector<HTMLButtonElement>(':scope > [aria-expanded], :scope > * > [aria-expanded]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    if (!emit(d, 'ui:toggle', { open }, true)) return;
    btn.setAttribute('aria-expanded', String(open));
    d.toggleAttribute('data-open', open);
  });
}

/** Menu (drawn in place or floating): arrows move between rows, Home and End, a letter jumps; Enter and Space choose */
export function wireMenu(m: HTMLElement): void {
  m.addEventListener('keydown', (e) => {
    const rows = [...m.querySelectorAll<HTMLElement>('[data-kit~="MenuRow"]:not([aria-disabled="true"]), [data-kit~="OptionRow"]')];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const n = ({ ArrowDown: i + 1, ArrowUp: i < 0 ? rows.length - 1 : i - 1, Home: 0, End: rows.length - 1 } as Record<string, number>)[e.key];
    if (n != null && rows.length) { e.preventDefault(); rows[(n + rows.length) % rows.length]?.focus(); return; }
    if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
      const k = e.key.toLowerCase(), s = i + 1;
      rows.slice(s).concat(rows.slice(0, s)).find((x) => (x.textContent ?? '').trim().toLowerCase().startsWith(k))?.focus();
    }
  });
}

/** a feedforward or blank mark that is new draws in once, then loses the flag (17.1); reduced motion shows it whole */
function wireMark(mk: HTMLElement): void {
  if (!mk.hasAttribute('data-mark-new')) return;
  if (reduced()) { mk.removeAttribute('data-mark-new'); return; }
  mk.addEventListener('animationend', () => mk.removeAttribute('data-mark-new'), { once: true });
}

/** an info label (17.1): hovering it opens its explanation after 300 ms, 8 from the label; Enter or Space opens it; Esc closes and
    returns focus (layer.ts) */
function wireInfo(b: HTMLElement): void {
  let t = 0;
  const open = (): void => {
    const text = b.getAttribute('data-explain');
    if (!text || b.getAttribute('aria-expanded') === 'true') return;
    const pop = frag('<div class="k7-pop" role="dialog" data-kit="Menu" data-variant="popover" data-sq data-sq-mode="surface"' + (b.textContent ? ' aria-label="' + esc(b.textContent.trim()) + '"' : '') + '>' + esc(text) + '</div>');
    b.setAttribute('data-mark', 'open');
    layer.open(b, pop, { place: 'below', align: 'start', onClose: () => b.removeAttribute('data-mark') });
  };
  b.addEventListener('pointerenter', () => { clearTimeout(t); t = window.setTimeout(open, 300); });
  b.addEventListener('pointerleave', () => clearTimeout(t));
  b.addEventListener('click', open);
}

/** a Row that is a control (RowOpts.action): Enter and Space press it */
function wireRowAction(r: HTMLElement): void {
  r.addEventListener('keydown', (e) => { if (e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); } });
}
/** Composer (12.2). Enter sends (queues while it runs, S06 B), ctrl Enter steers, Shift Enter is a new line; the end button is voice
    with no text, send with text, stop while it runs. It fires, each cancelable where an action follows:
      ui:send {text, queue}   ui:steer {text}   ui:stop   ui:voice {setup} (the circle pressed with no text; `setup`: no voice model yet)
      ui:add                  "+" was pressed (the app picks what to add; `composerInsert` puts it in the text)
      ui:dictate {on, mode}   the mic was switched on or off (aria-pressed says which): `toggle` by a press or alt+V, `hold` while held
      ui:dictate-unavailable  the mic was pressed, held or keyed in a build with no dictation (`data-mic-off`): nothing started
      ui:files {files, via}   files were dropped on it or pasted into it (compose.ts)
      ui:refused              Enter while a turn runs where nothing queues (`data-queue-off`): the text stays
    The voice circle is never hidden (owner, 26 November): `data-voice-setup` (ComposerOpts.voiceSetup) says no voice model is set up
    yet, in the circle's name and tip, and ui:voice fires all the same (the app then says what voice needs). `data-queue-off`: nothing
    queues here, so there is no send while a turn runs (a control shows only once its feature exists).
    Stop is a button of its own at the start of the right cluster, there only while `data-running` is set (owner, 25 November: the
    primary circle never turns into Stop) */
function wireComposer(c: HTMLElement): void {
  const t = c.querySelector<HTMLElement>('.k7-composer__text'), b = c.querySelector<HTMLButtonElement>('[data-send]');
  if (!t || !b) return;
  const setUp = (): boolean => c.hasAttribute('data-voice-setup'), noQueue = (): boolean => c.hasAttribute('data-queue-off');
  const sync = (): void => {
    const typed = (t.textContent ?? '').trim().length > 0, running = c.hasAttribute('data-running');
    c.toggleAttribute('data-typed', typed);
    const [glyphName, label] = typed ? ['arrowup', running ? 'Queue' : 'Send'] : ['waveform', setUp() ? VOICE_SETUP : 'Talk'];
    if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.setAttribute('data-tip', label); b.innerHTML = icon(glyphName, { size: 'm', class: 'k7-ic' }); }
    /* pressed with no voice model, the circle opens what says so (a dialog of one action) */
    if (!typed && setUp()) b.setAttribute('aria-haspopup', 'dialog'); else b.removeAttribute('aria-haspopup');
    /* the voice circle always shows; there is no send while a turn runs where nothing queues (a control shows only once its feature exists) */
    b.hidden = typed && running && noQueue();
  };
  const send = (steer: boolean): void => {
    const text = (t.textContent ?? '').trim();
    if (!text) return;
    if (c.hasAttribute('data-running') && noQueue()) { emit(c, 'ui:refused', {}); return; }
    if (emit(c, steer ? 'ui:steer' : 'ui:send', { text, queue: c.hasAttribute('data-running') && !steer }, true)) { t.textContent = ''; composerForget(t); sync(); }
  };
  t.addEventListener('input', sync);
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented) return;
    e.preventDefault();
    send(e.ctrlKey || e.metaKey);
  });
  b.addEventListener('click', () => {
    if ((t.textContent ?? '').trim()) { send(false); return; }
    emit(c, 'ui:voice', { setup: setUp() });
  });
  /* Stop is its own button, there while a turn runs (`data-running`, which the app sets and clears in place: composerRunning) */
  c.querySelector('[data-stop]')?.addEventListener('click', () => { if (c.hasAttribute('data-running')) emit(c, 'ui:stop', {}); });
  new MutationObserver(sync).observe(c, { attributes: true, attributeFilter: ['data-running', 'data-queue-off', 'data-voice-setup'] });
  c.querySelector('[data-plus]')?.addEventListener('click', () => { emit(c, 'ui:add', {}); });
  /* a word the text is read by (composerMarks): pressing it, or alt ArrowDown with the caret in it, asks what it is read as */
  const markAt = (n: Node | null): HTMLElement | null => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>(FF) ?? null;
  const ask = (el: HTMLElement): void => { emit(c, 'ui:mark', { text: el.textContent ?? '', kind: el.getAttribute('data-ff') ?? '', el }); };
  t.addEventListener('click', (e) => { const m = markAt(e.target as Node); if (m) ask(m); });
  t.addEventListener('keydown', (e) => { if (e.key !== 'ArrowDown' || !e.altKey) return; const m = markAt(getSelection()?.anchorNode ?? null); if (m) { e.preventDefault(); ask(m); } });
  /* its own undo, a chip as one unit, paste, files dropped and pasted, the mic (a press, alt+V, or held): compose.ts */
  wireComposerEditing(c);
  sync();
}
/** say that the composer's turn runs, or no longer does, in place (no redraw): Stop shows or goes, the send's name follows */
export function composerRunning(c: HTMLElement, on: boolean): void {
  const root = c.matches('.k7-composer') ? c : c.querySelector<HTMLElement>('.k7-composer');
  if (root && root.hasAttribute('data-running') !== on) root.toggleAttribute('data-running', on);
}
/** put `text` into a composer at the caret (at the end when the caret is elsewhere), as if typed: the composer's own input handling follows */
export function composerInsert(c: HTMLElement, text: string): void {
  const t = c.matches('.k7-composer__text') ? c : c.querySelector<HTMLElement>('.k7-composer__text');
  if (!t) return;
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const r = sel && sel.rangeCount && t.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  composerRemember(t, 'edit');
  if (r) { r.deleteContents(); r.insertNode(document.createTextNode(text)); r.collapse(false); } else t.append(text);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}
/** a chip set into a composer's text at the caret (a file added with "+": the kit's InlineChip with `words`), then a space: one unit
    for the caret and Backspace, its words what is sent. `html` is trusted kit markup */
export function composerInsertChip(c: HTMLElement, html: string): void {
  const t = c.matches('.k7-composer__text') ? c : c.querySelector<HTMLElement>('.k7-composer__text');
  if (!t) return;
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const r = sel && sel.rangeCount && t.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
  const mark = document.createElement('span'), space = document.createTextNode(' ');
  composerRemember(t, 'edit');
  if (r) { r.deleteContents(); r.insertNode(space); r.insertNode(mark); } else t.append(mark, space);
  /* written into the page as markup, in place: an orb made in a template and moved in is not painted by its worker */
  mark.insertAdjacentHTML('beforebegin', html); mark.remove();
  const after = document.createRange(); after.setStart(space, 1); after.collapse(true);
  sel?.removeAllRanges(); sel?.addRange(after);
  t.dispatchEvent(new Event('input', { bubbles: true }));
}
/** a mention in a composer's text, to draw as its chip: where it starts in the text, its exact words, and the chip (kit markup with `words`) */
export interface ComposerChip { at: number; text: string; html: string }
/** Draw the finished mentions of a composer's text as chips, in place. Each run of typed text is read by `find`; a mention the caret
    is still inside, or right after, stays words (it is being typed) and becomes its chip once something follows it. A chip is one
    unit (not editable inside): the caret steps over it and one Backspace takes it out; its own text is the words typed, so what the
    composer sends is the same text, byte for byte. Nothing is drawn while an input method composes. */
export function composerChips(t: HTMLElement, find: (text: string) => readonly ComposerChip[]): void {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  for (const n of [...t.childNodes]) {
    if (n.nodeType !== 3) continue;
    const text = n.textContent ?? '';
    if (!text.trim()) continue;
    const caret = sel && sel.rangeCount && sel.isCollapsed && sel.anchorNode === n ? sel.anchorOffset : -1;
    const marks = [...find(text)].sort((x, y) => x.at - y.at).filter((m) => m.text && text.startsWith(m.text, m.at) && !(caret > m.at && caret <= m.at + m.text.length));
    if (!marks.length) continue;
    const parts: Node[] = [], slots: Array<{ el: HTMLElement; html: string }> = [];
    let i = 0, caretNode: Text | null = null, caretOff = 0;
    const words = (from: number, to: number): void => {
      if (to <= from && !(caret === from && !caretNode)) return;
      const tn = document.createTextNode(text.slice(from, to)); parts.push(tn);
      if (caret >= from && caret <= to && !caretNode) { caretNode = tn; caretOff = caret - from; }
    };
    for (const m of marks) {
      if (m.at < i) continue;
      words(i, m.at);
      const slot = document.createElement('span'); parts.push(slot); slots.push({ el: slot, html: m.html });
      i = m.at + m.text.length;
    }
    words(i, text.length);
    (n as ChildNode).replaceWith(...parts);
    for (const x of slots) { x.el.insertAdjacentHTML('beforebegin', x.html); x.el.remove(); }
    if (caret >= 0 && caretNode && sel) { const r = document.createRange(); r.setStart(caretNode, caretOff); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
  }
}
/** a word of a composer's text that the app reads as something (feedforward, 17; board S20): where it starts in the text, its exact
    words, what it is read as (`kind`, the app's), and whether that reading is the person's choice (solid) or still a guess (dashed) */
export interface ComposerMark { at: number; text: string; kind?: string; chosen?: boolean }
const FF = '.k7-mark[data-ff]';
/** how far into `t`'s text the caret is (its chips counted by their words), or -1 when the caret is elsewhere */
function caretAt(t: HTMLElement): number {
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !sel.anchorNode || !t.contains(sel.anchorNode)) return -1;
  const r = document.createRange(); r.selectNodeContents(t); r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}
/** the text nodes of `t` a person can type in (a chip's own words are one unit), each with where it starts */
function typedRuns(t: HTMLElement): Array<{ node: Text; from: number }> {
  const out: Array<{ node: Text; from: number }> = [];
  let at = 0;
  const walk = (n: Node): void => {
    if (n.nodeType === 3) { out.push({ node: n as Text, from: at }); at += (n.textContent ?? '').length; return; }
    if (n instanceof HTMLElement && n.getAttribute('contenteditable') === 'false') { at += (n.textContent ?? '').length; return; }
    n.childNodes.forEach(walk);
  };
  t.childNodes.forEach(walk);
  return out;
}
/** Draw the words a composer's text is read by as the kit's Marks, in place (board S20: "auto margins", "page"): dashed under a guess,
    solid once the person chose. A mark stays text: it is typed through and deleted as words are. The text is only drawn again when the
    marks changed (so typing elsewhere moves nothing), never while an input method composes; the caret keeps its place. A press on a
    mark, or alt ArrowDown with the caret in it, fires `ui:mark` {text, kind, el} on the composer (wireComposer). */
export function composerMarks(c: HTMLElement, find: (text: string) => readonly ComposerMark[]): void {
  const t = c.matches('.k7-composer__text') ? c : c.querySelector<HTMLElement>('.k7-composer__text');
  if (!t) return;
  const text = t.textContent ?? '';
  const want = [...find(text)].filter((m) => m.text && text.startsWith(m.text, m.at)).sort((x, y) => x.at - y.at);
  const have = [...t.querySelectorAll<HTMLElement>(FF)];
  if (!want.length && !have.length) return;
  /* the marks already drawn, by where they are now: the same ones are kept as they are (only what they are read as is said again) */
  const runs = typedRuns(t);
  const placeOf = (el: HTMLElement): number => runs.find((r) => el.contains(r.node))?.from ?? -1;
  if (have.length === want.length && have.every((el, i) => { const w = want[i] as ComposerMark; return placeOf(el) === w.at && el.textContent === w.text && el.childNodes.length === 1; })) {
    have.forEach((el, i) => { const w = want[i] as ComposerMark; el.setAttribute('data-mark', w.chosen ? 'chosen' : 'shown'); if (w.kind) el.setAttribute('data-ff', w.kind); });
    return;
  }
  const caret = caretAt(t);
  for (const el of have) el.replaceWith(...el.childNodes);
  t.normalize();
  for (const w of [...want].reverse()) {
    const run = typedRuns(t).find((r) => w.at >= r.from && w.at + w.text.length <= r.from + (r.node.textContent ?? '').length);
    if (!run) continue;   /* a reading that crosses a chip is not drawn */
    const r = document.createRange(); r.setStart(run.node, w.at - run.from); r.setEnd(run.node, w.at - run.from + w.text.length);
    const span = document.createElement('span');
    span.className = 'k7-mark'; span.setAttribute('data-kit', 'Mark'); span.setAttribute('data-mark-kind', 'feedforward'); span.setAttribute('data-mark', w.chosen ? 'chosen' : 'shown'); span.setAttribute('data-ff', w.kind ?? '');
    r.surroundContents(span);
  }
  if (caret < 0) return;
  const sel = getSelection(), after = typedRuns(t);
  const hit = after.find((r) => caret >= r.from && caret <= r.from + (r.node.textContent ?? '').length) ?? after[after.length - 1];
  if (!sel || !hit) return;
  const back = document.createRange(); back.setStart(hit.node, Math.max(0, Math.min((hit.node.textContent ?? '').length, caret - hit.from))); back.collapse(true);
  sel.removeAllRanges(); sel.addRange(back);
}
/** who or what an "@" can name in a composer */
export interface KitMentions {
  /** the menu's name ("Members", "Bots": its heading) and the line at its foot */ label: string; foot?: () => string;
  /** what can be named now: `value` is written after the "@", `label` and `desc` are shown, `leadHTML` leads the row (an orb, a mark) */
  entries(): readonly { value: string; label: string; desc?: string; leadHTML?: string; icon?: string }[];
  /** the mentions a text holds, each drawn in the composer as the chip a sent message shows (composerChips); none: a mention stays words */
  chips?(text: string): readonly ComposerChip[];
}
/** "@" in a composer (owner, 25 November: as the composer's lists of boards S31 and S32): typing "@" and a few letters opens the kit's
    Menu over the composer, under its heading, with what matches; choosing a row writes "@value " in place of what was typed, and a
    finished mention is drawn as its chip (`src.chips`); Escape, or a space, closes it. One open menu at a time (the kit's layer) */
export function composerMentions(c: HTMLElement, src: KitMentions, open: (anchor: HTMLElement, o: { label: string; entries: readonly unknown[]; onSelect(v: string): void }) => HTMLElement | null, close: () => void): void {
  const t = c.querySelector<HTMLElement>('.k7-composer__text');
  if (!t) return;
  let shown = false, menu: HTMLElement | null = null;   /* the list now open: a list just replaced is still leaving the page, and is never the one chosen from */
  const typing = (): { query: string; node: Text; from: number; to: number } | null => {
    const sel = getSelection();
    const n = sel && sel.rangeCount && sel.isCollapsed ? sel.anchorNode : null;
    if (!n || n.nodeType !== 3 || !t.contains(n)) return null;
    const before = (n.textContent ?? '').slice(0, sel?.anchorOffset ?? 0);
    const m = /(^|\s)@([\w.-]*)$/.exec(before);
    return m ? { query: (m[2] ?? '').toLowerCase(), node: n as Text, from: before.length - (m[2] ?? '').length - 1, to: before.length } : null;
  };
  const hide = (): void => { if (shown) { shown = false; close(); } };
  const chips = (): void => { if (src.chips) composerChips(t, src.chips); };
  t.addEventListener('compositionend', chips);
  t.addEventListener('input', (e) => {
    if (!(e as InputEvent).isComposing) chips();
    const q = typing();
    if (!q) { hide(); return; }
    const rows = src.entries().filter((e) => e.value.toLowerCase().startsWith(q.query) || e.label.toLowerCase().startsWith(q.query));
    if (!rows.length) { hide(); return; }
    const foot = src.foot?.();
    if (shown) { shown = false; close(); }   /* the list is drawn again for what is typed now (the layer would take a second opening on one anchor for a toggle) */
    menu = open(c.querySelector<HTMLElement>('.k7-composer__box') ?? c, {
      label: src.label,
      entries: [{ heading: src.label }, ...rows.map((e) => ({ label: e.label, value: e.value, ...(e.desc ? { desc: e.desc } : {}), ...(e.leadHTML ? { leadHTML: e.leadHTML } : e.icon ? { icon: e.icon } : {}) })), ...(foot ? ['-', { heading: foot }] : [])],
      onSelect: (v) => {
        shown = false;
        const now = typing() ?? q;
        const text = now.node.textContent ?? '';
        composerRemember(t, 'edit');   /* a pick is one step for the undo */
        now.node.textContent = text.slice(0, now.from) + '@' + v + ' ' + text.slice(now.to);
        const r = document.createRange(); r.setStart(now.node, now.from + v.length + 2); r.collapse(true);
        const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
        t.focus();
        t.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    shown = !!menu;
    t.focus();   /* typing goes on in the text: the menu is chosen from with the pointer, or with the arrows once it has focus (ArrowDown) */
  });
  t.addEventListener('keydown', (e) => {
    if (!shown) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
    else if (e.key === 'ArrowDown') { const first = menu?.querySelector<HTMLElement>('[data-kit~="MenuRow"]'); if (first) { e.preventDefault(); first.focus(); } }
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { const first = menu?.querySelector<HTMLElement>('[data-kit~="MenuRow"]'); if (first) { e.preventDefault(); e.stopPropagation(); first.click(); } }   /* Enter or Tab takes what the letters name */
  }, true);
  /* the list goes when the focus leaves both the text and the list (opening it passes the focus through it for a moment) */
  t.addEventListener('blur', () => { setTimeout(() => { const a = document.activeElement; if (a !== t && !a?.closest('.k7-menu[data-floating]')) hide(); }, 0); });
}

/** HoverBar: a press on one of its actions says which (`ui:act` {value, el}: `el` is the button, what a menu opens against) */
function wireHoverBar(bar: HTMLElement): void {
  bar.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('[data-act]'); if (b && bar.contains(b)) emit(bar, 'ui:act', { value: b.dataset['act'] ?? '', el: b }); });
}
/** a bot at rest on a rest surface wakes under the pointer (the lively idle, its 3D turns and glances) and settles back into the pose
    when it leaves (ORBS.md, per-surface policy); a bot in a state keeps its state */
function wireRestOrb(w: HTMLElement): void {
  const o = w.querySelector('orb-avatar');
  if (!o) return;
  w.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch' || o.getAttribute('reaction') !== 'pose') return;
    w.dataset['awake'] = '';
    o.setAttribute('reaction', 'idle'); o.setAttribute('idle-motion', 'lively');
  });
  w.addEventListener('pointerleave', () => {
    if (!('awake' in w.dataset)) return;
    delete w.dataset['awake'];
    o.setAttribute('reaction', 'pose'); o.setAttribute('idle-motion', 'off');
  });
}

const WIRES: ReadonlyArray<readonly [string, (el: HTMLElement) => void]> = [
  ['.k7-seg', wireSegmented], ['.k7-switch', (el) => wireSwitch(el as HTMLButtonElement)], ['.k7-chip', (el) => wireChip(el as HTMLButtonElement)],
  ['[data-hold]', wireHold], ['[data-disclose]', wireDisclosure], ['[data-kit~="Menu"]', wireMenu], ['.k7-mark', wireMark], ['.k7-info', wireInfo], ['.k7-composer', wireComposer], ['.k7-row[data-action]', wireRowAction], ['.k7-row[data-check]', wireCheckRow], ['.k7-file[data-action]', wireRowAction], ['.k7-hoverbar', wireHoverBar], ['.k7-dock', paintDock], ['.ui-orb[data-orb-rest]', wireRestOrb]
];
/** wire every kit component under root (and root itself) once */
export function wire<T extends Element>(root: T): T {
  for (const [sel, fn] of WIRES) {
    if (root.matches(sel) && once(root, sel)) fn(root as unknown as HTMLElement);
    for (const el of root.querySelectorAll<HTMLElement>(sel)) if (once(el, sel)) fn(el);
  }
  return root;
}

/** a container's mark reveal (17.1): 'hover' hides its info labels' marks until the row or card is hovered or focused */
export function markReveal(container: HTMLElement, mode: 'hover' | 'always'): void { container.setAttribute('data-mark-reveal', mode); }
