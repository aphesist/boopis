/* The dialogs: Settings (modules/settings, on the v7 kit), the Store (modules/store), the shortcut sheet and the account menu.
   Tab cycles inside a dialog (KEYMAP section 10). */
import { $, $$ } from '../../core/dom';
import { state, toggle } from '../../core/state';
import { kit, ui } from '@boopis/ui';
import { followTheme, startThemeV7 } from '../../styles/theme-v7';
import { data } from '../../data';
import { els, sh } from './ctx';
import { FOCUSABLE, visible } from './regions';
import { keysTableHTML } from './keymap';
import { closePalette } from './palette';
import { logger } from '../../core/log';
import { buildSettings, setOpenStore, showSection } from '../settings';

const log = logger('dialogs');

export const closeMenu = (returnFocus?: boolean): void => ui.menu.close(returnFocus);

/* ───────── the shortcut sheet ───────── */
export function openKeys(): void {
  closePalette(true); closeMenu(false);
  const d = $<HTMLDialogElement>('#hx-keys-sheet', sh.app);
  const input = $<HTMLInputElement>('#hx-keys-filter', d);
  input.value = '';
  $('#hx-keys-body', d).innerHTML = keysTableHTML('');
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  input.focus();
}

/* ───────── settings: modules/settings (the v7 kit's large Dialog) ───────── */
export { SETTINGS_SECTIONS } from '../settings';
export function openSettings(section?: string): void {
  closePalette(); closeMenu(false);
  const d = els().settings;
  showSection(section);
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  const card = $('#hx-settings-body', d); card.tabIndex = -1; card.focus({ preventScroll: true });
}

/* ───────── the store: its own full view (modules/store), reached from the palette, mod+shift+S, the Connectors tab and the session details panel ───────── */
let storeView: import('../store/view').StoreView | null = null;
let storeMounting: Promise<void> | null = null;
const storeDialog = (): HTMLDialogElement => $<HTMLDialogElement>('#hx-store', sh.app);
export function openStore(screen: 'browse' | 'installed' | 'sources' = 'browse', item?: string): void {
  closePalette(); closeMenu(false);
  const d = storeDialog();
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
  const card = $('#hx-store-body', d); card.tabIndex = -1; card.focus({ preventScroll: true });
}

/* ───────── the account menu ───────── */
export function openMenu(): void {
  ui.tooltip.hide();
  const U = data().user.get();
  const m = ui.menu.open(els().btnAccount, [
    { title: U.name },
    { label: 'Settings', value: 'settings', keys: 'mod+,', role: 'menuitem' },
    { label: 'Keyboard shortcuts', value: 'shortcuts', keys: 'mod+/', role: 'menuitem' },
    '-',
    { label: 'Show the dock', value: 'dock', role: 'menuitemcheckbox', checked: state.dock === 'on', keys: 'mod+J' },
    { label: 'Show session details', value: 'right', role: 'menuitemcheckbox', checked: state.right === 'open', keys: 'mod+I', disabled: state.tab !== 'session' }
  ], { place: 'above', label: 'Account', onSelect: menuAction });
  // an account menu starts at its first item (the library starts a choice menu at the checked one)
  const first = m && m.querySelector<HTMLElement>('.ui-menu__item:not(:disabled)'); if (first) first.focus({ preventScroll: true });
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
  startThemeV7();
  buildSettings(el.settings);
  setOpenStore(() => { openStore(); });
  const sd = storeDialog();
  followTheme(sd);
  sd.addEventListener('click', (e) => { if ((e.target as Element).closest('[data-dialog-close]')) sd.close(); });
  sd.addEventListener('click', (e) => { if (e.target === sd) sd.close(); });
  el.settings.addEventListener('click', (e) => { if (e.target === el.settings) el.settings.close(); });
  const ks = $<HTMLDialogElement>('#hx-keys-sheet', sh.app);
  $('#hx-keys-close', ks).addEventListener('click', () => ks.close());
  $<HTMLInputElement>('#hx-keys-filter', ks).addEventListener('input', (e) => { $('#hx-keys-body', ks).innerHTML = keysTableHTML((e.target as HTMLInputElement).value); });
  ks.addEventListener('click', (e) => { if (e.target === ks) ks.close(); });
  // close on Esc explicitly: a module's window-level key handler must never be able to keep a dialog open
  for (const d of [ks, el.settings, sd]) d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && d.open) { e.preventDefault(); e.stopPropagation(); d.close(); } });
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
