/* The v7 kit's behaviours, wired once per element (`wire(root)` wires every kit component under root). Events bubble and
   are cancelable where an action follows: ui:change {value} (Segmented, Switch, Chip), ui:commit (a hold finished),
   ui:toggle {open} (Disclosure, Card's danger zone, FilesCard). State lives in ARIA and data attributes (R-state-2). */
import { esc, fire, frag, reduced, tokenMs } from '../../core/dom';
import { layer } from '../layer';
import { icon } from '../icons';
import { paintDock } from './dock';

/* which behaviours an element has: an element can carry two (a chip that holds) */
const WIRED = new WeakMap<Element, Set<string>>();
const once = (el: Element, key: string): boolean => { let s = WIRED.get(el); if (!s) WIRED.set(el, (s = new Set())); if (s.has(key)) return false; s.add(key); return true; };

/** Segmented: one of a few; arrows move and choose (radio) or move and choose the tab (tabs) */
function wireSegmented(seg: HTMLElement): void {
  const items = (): HTMLButtonElement[] => [...seg.querySelectorAll<HTMLButtonElement>('.k7-seg__item')];
  const choose = (b: HTMLButtonElement, focus: boolean): void => {
    const tabs = seg.getAttribute('role') === 'tablist', list = items(), i = list.indexOf(b);
    if (b.getAttribute(tabs ? 'aria-selected' : 'aria-checked') === 'true') { if (focus) b.focus(); return; }
    if (!fire(seg, 'ui:change', { value: b.dataset['value'] ?? '' }, true)) return;
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
    if (!fire(sw, 'ui:change', { value: on }, true)) return;
    sw.setAttribute('aria-checked', String(on));
  });
}

/** a filter or mode Chip toggles; an answer chip only reports (its card decides) */
function wireChip(c: HTMLButtonElement): void {
  if (c.dataset['variant'] === 'answer' || c.hasAttribute('data-hold')) return;
  c.addEventListener('click', () => {
    const on = c.getAttribute('aria-pressed') !== 'true';
    if (!fire(c, 'ui:change', { value: on }, true)) return;
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
  const commit = (): void => { if (!fire(b, 'ui:commit', undefined, true)) return; held = true; b.setAttribute('data-held', ''); };
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
    if (!fire(d, 'ui:toggle', { open }, true)) return;
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
      ui:send {text, queue}   ui:steer {text}   ui:stop   ui:voice (no text, not running)
      ui:add                  "+" was pressed (the app picks what to add; `composerInsert` puts it in the text)
      ui:dictate {on}         the mic was switched on or off (aria-pressed says which)
    `data-voice-off="<why>"` (ComposerOpts.voiceOff): the voice button is drawn and does nothing, its tip says why */
function wireComposer(c: HTMLElement): void {
  const t = c.querySelector<HTMLElement>('.k7-composer__text'), b = c.querySelector<HTMLButtonElement>('[data-send]');
  if (!t || !b) return;
  const off = c.getAttribute('data-voice-off');
  const sync = (): void => {
    const typed = (t.textContent ?? '').trim().length > 0, running = c.hasAttribute('data-running');
    c.toggleAttribute('data-typed', typed);
    const [glyphName, label] = typed ? ['arrowup', running ? 'Queue' : 'Send'] : running ? ['stop', 'Stop'] : ['waveform', 'Talk'];
    if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.innerHTML = icon(glyphName, { size: 'm', class: 'k7-ic' }); }
    const idle = !typed && !running && !!off;
    b.setAttribute('data-tip', idle ? (off as string) : label);
    if (idle) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
  };
  const send = (steer: boolean): void => {
    const text = (t.textContent ?? '').trim();
    if (!text) return;
    if (fire(c, steer ? 'ui:steer' : 'ui:send', { text, queue: c.hasAttribute('data-running') && !steer }, true)) { t.textContent = ''; sync(); }
  };
  t.addEventListener('input', sync);
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented) return;
    e.preventDefault();
    send(e.ctrlKey || e.metaKey);
  });
  b.addEventListener('click', () => {
    if ((t.textContent ?? '').trim()) { send(false); return; }
    if (c.hasAttribute('data-running')) fire(c, 'ui:stop', {}); else if (!off) fire(c, 'ui:voice', {});
  });
  c.querySelector('[data-plus]')?.addEventListener('click', () => { fire(c, 'ui:add', {}); });
  const mic = c.querySelector<HTMLButtonElement>('[data-mic]');
  mic?.addEventListener('click', () => { const on = mic.getAttribute('aria-pressed') !== 'true'; if (fire(c, 'ui:dictate', { on }, true)) mic.setAttribute('aria-pressed', String(on)); });
  sync();
}
/** put `text` into a composer at the caret (at the end when the caret is elsewhere), as if typed: the composer's own input handling follows */
export function composerInsert(c: HTMLElement, text: string): void {
  const t = c.matches('.k7-composer__text') ? c : c.querySelector<HTMLElement>('.k7-composer__text');
  if (!t) return;
  const sel = typeof getSelection === 'function' ? getSelection() : null;
  const r = sel && sel.rangeCount && t.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
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
  ['[data-hold]', wireHold], ['[data-disclose]', wireDisclosure], ['[data-kit~="Menu"]', wireMenu], ['.k7-mark', wireMark], ['.k7-info', wireInfo], ['.k7-composer', wireComposer], ['.k7-row[data-action]', wireRowAction], ['.k7-file[data-action]', wireRowAction], ['.k7-dock', paintDock], ['.ui-orb[data-orb-rest]', wireRestOrb]
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
