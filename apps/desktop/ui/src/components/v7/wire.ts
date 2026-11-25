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

/** a large Dialog's nav: a row chosen (click, Enter, Space) becomes the current page and fires ui:change {value} (its data-value)
    on the nav, cancelable; Up and Down move between the rows, Home and End to the ends */
function wireNav(nav: HTMLElement): void {
  const rows = (): HTMLButtonElement[] => [...nav.querySelectorAll<HTMLButtonElement>('.k7-dialog__navrow')];
  nav.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('.k7-dialog__navrow');
    if (!b || b.getAttribute('aria-current') === 'page') return;
    if (!fire(nav, 'ui:change', { value: b.dataset['value'] ?? '' }, true)) return;
    for (const x of rows()) { if (x === b) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); }
  });
  nav.addEventListener('keydown', (e) => {
    const list = rows(), i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 } as Record<string, number>)[e.key];
    if (n == null) return;
    e.preventDefault();
    list[(n + list.length) % list.length]?.focus();
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

/** hold to confirm (owner decision: 1 s, --dur-hold, everywhere): press and hold, or hold Space; released early it drains */
export function wireHold(b: HTMLElement): void {
  let timer = 0, held = false;
  const ms = (): number => tokenMs('--dur-hold', 1000);
  const start = (): void => {
    if (held || (b as HTMLButtonElement).disabled) return;
    b.setAttribute('data-holding', '');
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      b.removeAttribute('data-holding');
      if (!fire(b, 'ui:commit', undefined, true)) return;
      held = true; b.setAttribute('data-held', '');
    }, ms());
  };
  const stop = (): void => { clearTimeout(timer); b.removeAttribute('data-holding'); };
  b.addEventListener('pointerdown', (e) => { if (e.button === 0) start(); });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) b.addEventListener(t, stop);
  b.addEventListener('keydown', (e) => { if (e.key === ' ' && !e.repeat) { e.preventDefault(); start(); } });
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

/** Composer (12.2): the voice button becomes send with text (200 ms cross-fade, --dur-2); Enter sends (queues while it runs, S06 B),
    ctrl Enter steers; Shift Enter is a new line. Fires ui:send {text, queue} and ui:steer {text} */
function wireComposer(c: HTMLElement): void {
  const t = c.querySelector<HTMLElement>('.k7-composer__text'), b = c.querySelector<HTMLButtonElement>('[data-send]');
  if (!t || !b) return;
  const sync = (): void => {
    const typed = (t.textContent ?? '').trim().length > 0, running = c.hasAttribute('data-running');
    c.toggleAttribute('data-typed', typed);
    const [glyphName, label] = typed ? ['arrowup', running ? 'Queue' : 'Send'] : running ? ['stop', 'Stop'] : ['waveform', 'Talk'];
    if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.setAttribute('data-tip', label); b.innerHTML = icon(glyphName, { size: 'm', class: 'k7-ic' }); }
  };
  t.addEventListener('input', sync);
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const text = (t.textContent ?? '').trim();
    if (!text) return;
    const steer = e.ctrlKey || e.metaKey;
    if (fire(c, steer ? 'ui:steer' : 'ui:send', { text, queue: c.hasAttribute('data-running') && !steer }, true)) { t.textContent = ''; sync(); }
  });
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
  ['.k7-seg', wireSegmented], ['.k7-dialog__nav', wireNav], ['.k7-switch', (el) => wireSwitch(el as HTMLButtonElement)], ['.k7-chip', (el) => wireChip(el as HTMLButtonElement)],
  ['[data-hold]', wireHold], ['[data-disclose]', wireDisclosure], ['[data-kit~="Menu"]', wireMenu], ['.k7-mark', wireMark], ['.k7-info', wireInfo], ['.k7-composer', wireComposer], ['.k7-dock', paintDock], ['.ui-orb[data-orb-rest]', wireRestOrb]
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
