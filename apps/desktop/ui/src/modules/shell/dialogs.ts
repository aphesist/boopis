/* The dialogs: Settings (opened here, drawn by modules/settings), the store, the shortcut sheet and the account menu. Esc closes
   each, and Tab cycles inside a dialog (KEYMAP section 10). */
import { $, $$ } from '../../core/dom';
import { state, toggle } from '../../core/state';
import { logger } from '../../core/log';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import { els, sh } from './ctx';
import { FOCUSABLE, visible } from './regions';
import { keysTableHTML } from './keymap';
import { closePalette } from './palette';
import { openSettings as openSettingsDialog } from '../settings';

const log = logger('dialogs');

export const closeMenu = (returnFocus?: boolean): void => ui.layer.close(returnFocus);

/* ───────── the shortcut sheet (mod+/): the kit's wide Dialog, its filter at the head's end, the keymap's groups as Cards of rows ───────── */
const KEYS_NOTE = 'Every action is also in the palette.';
function drawKeys(d: HTMLDialogElement): void {
  if (d.querySelector('.k7-dialog')) return;
  const filter = kit.html.field({ id: 'hx-keys-filter', kind: 'search', ariaLabel: 'Filter shortcuts', placeholder: 'Filter' });
  d.replaceChildren(kit.dialog({ variant: 'wide', title: 'Keyboard shortcuts', id: 'hx-keys-card', scrim: false, headEnd: filter, body: '<div class="hx-keys" id="hx-keys-body"></div><p class="k7-page__note">' + KEYS_NOTE + '</p>', bodyAttrs: { tabindex: '0', role: 'region', 'aria-label': 'Keyboard shortcuts' } }));
}
export function openKeys(): void {
  closePalette(true); closeMenu(false);
  const d = $<HTMLDialogElement>('#hx-keys-sheet', sh.app);
  drawKeys(d);
  const input = $<HTMLInputElement>('#hx-keys-filter', d);
  input.value = '';
  const body = $('#hx-keys-body', d);
  body.innerHTML = keysTableHTML('');
  kit.wire(body);
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  input.focus();
}

/* ───────── settings: the kit's dialog (modules/settings, boards 14 and S39) ───────── */
export function openSettings(section?: string, find?: string, focus?: string): void {
  closePalette(); closeMenu(false);
  openSettingsDialog(section, { ...(find ? { find } : {}), ...(focus ? { focus } : {}) });
}

/* ───────── the store (board 15): the kit's wide Dialog in the shell's <dialog>, its body the store's own view (modules/store), reached from
   the palette, mod+shift+S, the sidebar's foot, Settings › Connectors and the session's details ───────── */
let storeView: import('../store/view').StoreView | null = null;
let storeMounting: Promise<void> | null = null;
const storeDialog = (): HTMLDialogElement => $<HTMLDialogElement>('#hx-store', sh.app);
function drawStore(d: HTMLDialogElement): void {
  if (d.querySelector('.k7-dialog')) return;
  d.replaceChildren(kit.dialog({ variant: 'wide', title: 'Store', id: 'hx-store-card', scrim: false, headEnd: '<span hidden></span>', body: '', bodyAttrs: { id: 'hx-store-body', tabindex: '-1', role: 'region', 'aria-label': 'Store' } }));
}
export function openStore(screen: 'browse' | 'installed' | 'sources' = 'browse', item?: string): void {
  closePalette(); closeMenu(false);
  const d = storeDialog();
  drawStore(d);
  if (els().settings.open) els().settings.close();
  const ret = document.activeElement as HTMLElement | null;
  /* every time it opens, the store reads the sources that are due (never read, failed last time, or old), with its progress on
     the page: a source is never left at "Not read yet" with no attempt */
  const go = (): void => { storeView?.show(screen, item); void storeView?.readDue(); };
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  d.addEventListener('close', () => { ret?.focus?.(); }, { once: true });
  if (storeView) { go(); } else {
    storeMounting ??= import('../store/view').then((m) => {
      storeView = m.mountStore($('#hx-store-body', d), { store: data().store, notify: (t) => { kit.notify(t); }, project: () => data().details.environment.get().cwd || null });
    }).catch((e: unknown) => { log.warn('the store did not mount', e); });
    void storeMounting.then(go);
  }
  const card = $<HTMLElement>('.k7-dialog', d); card.tabIndex = -1; card.focus({ preventScroll: true });
}

/* ───────── the account menu ───────── */
export function openMenu(): void {
  ui.tooltip.hide();
  const U = data().user.get();
  /* the kit's Menu (its key chips sit in their row's corner, which the v6 menu's did not): the person's name heads it */
  kit.openMenu(els().btnAccount, {
    label: 'Account', variant: 'list', place: 'above', align: 'start', onSelect: menuAction,
    entries: [
      { heading: U.name },
      { label: 'Settings', value: 'settings', keys: 'mod+,' },
      { label: 'Keyboard shortcuts', value: 'shortcuts', keys: 'mod+/' },
      '-',
      { label: 'Show the dock', value: 'dock', checked: state.dock === 'on', keys: 'mod+J' },
      { label: 'Show session details', value: 'right', checked: state.right === 'open', keys: 'mod+I', disabled: state.tab !== 'session' }
    ]
  });
  /* an account menu starts at its first row (the kit starts a choice menu at the checked one) */
  els().btnAccount.ownerDocument.querySelector<HTMLElement>('.k7-menu[data-floating] [data-kit~="MenuRow"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
}
function menuAction(act: string): void {
  // the menu returns focus to the account button as it closes, so a dialog opens on the next tick and keeps it
  if (act === 'settings') setTimeout(() => openSettings(), 0);
  else if (act === 'shortcuts') setTimeout(openKeys, 0);
  else if (act === 'dock') toggle('dock');
  else if (act === 'right') toggle('right');
}

/* ───────── wiring ───────── */
export function wireDialogs(): void {
  const el = els();
  const sd = storeDialog(), ks = $<HTMLDialogElement>('#hx-keys-sheet', sh.app);
  drawStore(sd); drawKeys(ks);
  const shut = (d: HTMLDialogElement): void => { if (d.open) d.close(); };
  /* the kit Dialog's close, and a press on the backdrop, shut each (Settings wires its own close) */
  for (const d of [sd, ks, el.settings]) {
    d.addEventListener('click', (e) => { if (e.target === d) shut(d); else if (d !== el.settings && (e.target as Element).closest('[data-dialog-close]')) shut(d); });
  }
  ks.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement; if (t.id !== 'hx-keys-filter') return;
    const b = $('#hx-keys-body', ks); b.innerHTML = keysTableHTML(t.value); kit.wire(b);
  });
  // Esc shuts each explicitly: a module's window-level key handler must never be able to keep a dialog open (a field that clears itself on Esc goes first)
  for (const d of [ks, el.settings, sd]) d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d.open && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); shut(d); } });
  // Tab cycles inside a dialog: a modal dialog would otherwise hand focus to the browser after its last control
  const tabStops = (d: HTMLElement): HTMLElement[] => $$(FOCUSABLE, d).filter((n) => {
    const r = n as HTMLInputElement;
    return visible(n) && n.tabIndex >= 0 && !(r.type === 'radio' && !r.checked && $$<HTMLInputElement>('input[type="radio"][name="' + r.name + '"]', d).some((x) => x.checked));
  });
  for (const d of [ks, el.settings, sd]) d.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !d.open || ui.popover.current) return;
    const f = tabStops(d); if (!f.length) return;
    const first = f[0] as HTMLElement, last = f[f.length - 1] as HTMLElement, a = document.activeElement;
    if (e.shiftKey && (a === first || (!f.includes(a as HTMLElement) && !d.contains(a)))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  });
}
