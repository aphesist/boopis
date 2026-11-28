/* ModView's behaviour: what the person does to a mod's drawing comes back as `ui:mod {type, id, value}` on its root, by the handler id the
   view wrote (a Button's `data-mv-press`, a Field's `data-mv-input` and `data-mv-submit`, a SelectorItem's `data-mv-select`); a mod's hotkey
   works while focus is inside it; a literal colour is painted against the surface the view stands on, and again when the theme changes.
   `modViewUpdate` draws a new tree in place and keeps the focus and the caret in the control that is still there. */
import { isMac } from '../../../core/dom';
import { on as onBus } from '../../../core/bus';
import { emit } from '../events';
import type { MenuOpts } from '../menu/menu';
import { paintLiterals } from './colours';
import type { Surface } from './colours';
import { modView, normKey } from './mod-view';
import { validateTree } from './tree';

type Opener = (anchor: HTMLElement, o: MenuOpts & { place?: 'above' | 'below'; align?: 'start' | 'end' | 'center'; onSelect?: (value: string) => void }) => HTMLElement | null;
/* the kit's floating Menu (index.ts `openMenu`), handed in by the barrel so this folder does not import it back */
let openMenu: Opener | null = null;
export function setModMenu(fn: Opener): void { openMenu = fn; }

const surfaceOf = (root: HTMLElement): Surface => { const s = root.dataset['surface']; return s === 'row' || s === 'band' ? s : 'pane'; };
/* the views on the page, painted again when the theme changes (a surface or a token moved) */
const LIVE = new Set<HTMLElement>();
onBus('hx:theme', () => { for (const r of LIVE) { if (!r.isConnected) { LIVE.delete(r); continue; } paintLiterals(r, surfaceOf(r)); } });

/** does a key event match a spec such as 'mod+r'? `mod` is the platform's command key */
export function matchesKey(e: KeyboardEvent, spec: string): boolean {
  const parts = normKey(spec).split('+'), key = parts.pop() ?? '';
  const want = { mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt') };
  const mod = isMac ? e.metaKey : e.ctrlKey, other = isMac ? e.ctrlKey : e.metaKey;
  if (other || mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt) return false;
  return e.key.toLowerCase() === key;
}

const say = (root: HTMLElement, type: 'ui.press' | 'ui.input' | 'ui.select' | 'ui.submit', id: string | undefined, value?: string): void => {
  if (id) emit(root, 'ui:mod', { type, id, ...(value != null ? { value } : {}) });
};
const fieldValue = (f: Element | null): string => (f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement ? f.value : '');

export function wireModView(root: HTMLElement): void {
  LIVE.add(root);
  paintLiterals(root, surfaceOf(root));
  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    const press = t.closest<HTMLButtonElement>('[data-mv-press]');
    if (press && root.contains(press)) { if (!press.disabled) say(root, 'ui.press', press.dataset['mvPress']); return; }
    const send = t.closest<HTMLElement>('[data-mv-send]');
    if (send && root.contains(send)) { say(root, 'ui.submit', send.dataset['mvSend'], fieldValue(root.querySelector('#' + CSS.escape(send.dataset['mvFor'] ?? '')))); return; }
    const sel = t.closest<HTMLElement>('[data-mv-select]');
    if (sel && root.contains(sel) && openMenu) {
      let opts: Array<{ label: string; value: string }> = [];
      try { opts = JSON.parse(sel.dataset['mvOptions'] ?? '[]') as typeof opts; } catch { opts = []; }
      const cur = sel.dataset['mvValue'] ?? '';
      sel.setAttribute('aria-expanded', 'true');
      openMenu(sel, {
        label: sel.getAttribute('aria-label')?.replace(/:.*$/, '') ?? 'Choose', variant: 'list', place: 'below', align: 'start',
        entries: opts.map((o) => ({ label: o.label, value: o.value, role: 'menuitemradio', checked: o.value === cur })),
        onSelect: (v) => { sel.setAttribute('aria-expanded', 'false'); say(root, 'ui.select', sel.dataset['mvSelect'], v); }
      });
    }
  });
  root.addEventListener('input', (e) => {
    const f = (e.target as Element).closest<HTMLElement>('[data-mv-input]');
    if (f && root.contains(f)) say(root, 'ui.input', f.dataset['mvInput'], fieldValue(f));
  });
  root.addEventListener('keydown', (e) => {
    const f = (e.target as Element).closest<HTMLElement>('[data-mv-submit]');
    if (f && e.key === 'Enter' && !e.isComposing && (f.dataset['mvMulti'] == null || e.ctrlKey || e.metaKey)) { e.preventDefault(); say(root, 'ui.submit', f.dataset['mvSubmit'], fieldValue(f)); return; }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-mv-hotkey]')) {
      const spec = b.dataset['mvHotkey'];
      if (spec && !b.disabled && matchesKey(e, spec)) { e.preventDefault(); say(root, 'ui.press', b.dataset['mvPress']); return; }
    }
  });
}

/** draws a new tree in place: the root stays (and its listeners), focus and the caret survive when the same control is still there.
    False, and the old drawing kept, when the tree is refused */
export function modViewUpdate(root: HTMLElement, tree: unknown): boolean {
  if (!validateTree(tree).ok) return false;
  const a = document.activeElement as (HTMLInputElement & HTMLTextAreaElement) | null;
  const key = a && root.contains(a) ? a.getAttribute('data-mv-key') : null;
  const sel = key && a && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] as const : null;
  const tpl = document.createElement('template');
  tpl.innerHTML = modView({ tree, surface: surfaceOf(root) });
  root.replaceChildren(...(tpl.content.firstElementChild?.childNodes ?? []));
  paintLiterals(root, surfaceOf(root));
  if (key) {
    const n = root.querySelector<HTMLInputElement>('[data-mv-key="' + CSS.escape(key) + '"]');
    if (n) {
      n.focus({ preventScroll: true });
      if (sel && n.setSelectionRange) { try { n.setSelectionRange(sel[0], sel[1]); } catch { /* not a text field */ } }
    }
  }
  return true;
}
