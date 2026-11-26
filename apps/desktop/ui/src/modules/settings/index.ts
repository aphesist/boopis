/* Settings (boards 14 and S39): the kit's large Dialog in the shell's <dialog> (modal, top layer), its nav at the left with icons
   and a page to its right with a title, section heads and cards of rows. The nav is S39's order with Diagnostics last (board 14):
   General, Sessions, Bots, Models, Approvals, Connectors, Appearance, Keyboard, Diagnostics. A page whose feature is absent is not
   in the nav (rule 2: Approvals without the rules engine, Diagnostics outside the desktop app). Each page is built the first time it
   shows and asked again every time it shows (what it reads moves while the dialog is closed). On Appearance the dialog steps to
   the window's right edge and drops its scrim, so a change shows on the whole app as it is made (today's behaviour, kept). */
import { kit } from '@boopis/ui';
import { inTauri } from '../../host/bridge';
import { data } from '../../data';
import { logger } from '../../core/log';
import { later } from '../chat/compose';
import { settingsHost } from './host';
import type { Page } from './page';
import { generalPage } from './general';
import { sessionsPage } from './sessions';
import { botsPage } from './bots';
import { modelsPage } from './models';
import { approvalsPage } from './approvals';
import { connectorsPage } from './connectors';
import { appearancePage } from './appearance';
import { keyboardPage } from './keyboard';
import { diagnosticsPage } from './diagnostics';
import './settings.css';

const log = logger('settings');

export interface PageDef {
  id: string; label: string; icon: string;
  /** whether the page's feature exists here (a page that has none is not in the nav) */
  shown: () => boolean;
  make: () => Page;
}
/** the pages in nav order (S39's, then board 14's Diagnostics) */
export const PAGES: readonly PageDef[] = [
  { id: 'general', label: 'General', icon: 'gear', shown: () => true, make: generalPage },
  { id: 'sessions', label: 'Sessions', icon: 'session', shown: () => true, make: sessionsPage },
  { id: 'bots', label: 'Bots', icon: 'bots', shown: () => true, make: botsPage },
  { id: 'models', label: 'Models', icon: 'spark', shown: () => true, make: modelsPage },
  { id: 'approvals', label: 'Approvals', icon: 'shield', shown: () => !!data().rules && later('rules-settings'), make: approvalsPage },
  { id: 'connectors', label: 'Connectors', icon: 'plug', shown: () => true, make: connectorsPage },
  { id: 'appearance', label: 'Appearance', icon: 'palette', shown: () => true, make: appearancePage },
  { id: 'keys', label: 'Keyboard', icon: 'keyboard', shown: () => true, make: keyboardPage },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'terminal', shown: () => settingsHost.desktop() || settingsHost.diagnostics() !== null, make: diagnosticsPage }
];
/** a section a caller names by an older name (the v6 tabs: Keyboard was `keys`) */
const ALIAS: Readonly<Record<string, string>> = { keyboard: 'keys' };

let dialog: HTMLDialogElement | null = null;
let current = '';
const built = new Map<string, Page>();

const shownPages = (): PageDef[] => PAGES.filter((p) => { try { return p.shown(); } catch { return false; } });
const pageHost = (): HTMLElement | null => dialog?.querySelector<HTMLElement>('.k7-dialog__page') ?? null;

/** draw the dialog's frame into the shell's <dialog> (once; the nav is drawn again on every open, as pages come and go) */
export function mountSettings(d: HTMLDialogElement): void {
  dialog = d;
  d.setAttribute('data-ui', 'v7');
  drawFrame();
  d.addEventListener('close', () => { d.removeAttribute('data-side'); });
}
function drawFrame(): void {
  const d = dialog; if (!d) return;
  const nav = shownPages().map((p) => ({ label: p.label, icon: p.icon, value: p.id, current: p.id === current, attrs: { id: 'hx-set-nav-' + p.id, 'aria-controls': 'hx-settings-page' } }));
  const frame = kit.dialog({ variant: 'large', title: 'Settings', body: '', nav, scrim: false, id: 'hx-settings-card', pageAttrs: { id: 'hx-settings-page', role: 'region', tabindex: '-1', 'aria-label': 'Settings' } });
  d.replaceChildren(frame);
  const card = d.querySelector<HTMLElement>('.k7-dialog') as HTMLElement;
  card.querySelector('[data-dialog-close]')?.addEventListener('click', () => { d.close(); });
  const navEl = card.querySelector<HTMLElement>('.k7-dialog__nav') as HTMLElement;
  navEl.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('[data-page]'); if (b) show(b.dataset['page'] ?? 'general'); });
  /* the nav is one list: up and down move through it and open the page (a press or Enter opens one too) */
  navEl.addEventListener('keydown', (e) => {
    const rows = [...navEl.querySelectorAll<HTMLElement>('[data-page]')], i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const n = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 } as Record<string, number>)[e.key];
    if (n == null) return;
    e.preventDefault();
    const r = rows[(n + rows.length) % rows.length];
    if (r) { r.focus(); show(r.dataset['page'] ?? 'general'); }
  });
  for (const p of built.values()) p.el.remove();
  const host = pageHost();
  if (host) for (const [id, p] of built) { host.appendChild(p.el); p.el.hidden = id !== current; }
}

/** show a page (an unknown or absent one shows General) */
export function show(section?: string, o: { find?: string; focus?: string } = {}): void {
  const d = dialog; if (!d) return;
  const want = ALIAS[section ?? ''] ?? section ?? 'general';
  const pages = shownPages();
  const def = pages.find((p) => p.id === want) ?? pages[0];
  if (!def) return;
  current = def.id;
  for (const r of d.querySelectorAll<HTMLElement>('.k7-dialog__navrow')) { if (r.dataset['page'] === current) r.setAttribute('aria-current', 'page'); else r.removeAttribute('aria-current'); }
  const host = pageHost(); if (!host) return;
  let page = built.get(def.id);
  if (!page) {
    try { page = def.make(); } catch (e) { log.warn('the page did not build: ' + def.id, e); return; }
    built.set(def.id, page);
    host.appendChild(page.el);
  } else void page.refresh?.().catch((e: unknown) => { log.warn('the page did not refresh: ' + def.id, e); });
  for (const [id, p] of built) p.el.hidden = id !== def.id;
  host.setAttribute('aria-label', def.label);
  host.scrollTop = 0;
  d.toggleAttribute('data-side', def.id === 'appearance');
  if (o.find || o.focus) void page.reveal?.(o);
}

/** open Settings at a page; `find` types into Models' provider search, `focus` scrolls to a part (Models' voice, Approvals' drafts) */
export function openSettings(section?: string, o: { find?: string; focus?: string } = {}): void {
  const d = dialog; if (!d) return;
  drawFrame();
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  show(section, o);
  if (!o.focus) d.querySelector<HTMLElement>('.k7-dialog__navrow[aria-current="page"]')?.focus({ preventScroll: true });
}
export const settingsOpen = (): boolean => !!dialog?.open;
export const currentPage = (): string => current;
/** the lab and the tests: forget the pages built so far (a provider was swapped) */
export function resetSettings(): void { for (const p of built.values()) { p.destroy?.(); p.el.remove(); } built.clear(); current = ''; }
export const desktop = inTauri;
