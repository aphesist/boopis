/* The dialogs: Settings (General, Appearance = the theme customizer, Keyboard), the shortcut sheet and the account menu.
   On Appearance the dialog steps aside to the right edge and drops its scrim, so every change shows on the whole app
   as it is made. Tab cycles inside a dialog (KEYMAP section 10). */
import { $, $$ } from '../../core/dom';
import { setState, state, toggle } from '../../core/state';
import { ui } from '@boopis/ui';
import type { SegElement } from '@boopis/ui';
import { data } from '../../data';
import { mountThemePanel } from '../../styles/theme-panel';
import { els, sh } from './ctx';
import { FOCUSABLE, visible } from './regions';
import { keysTableHTML } from './keymap';
import { closePalette } from './palette';
import { inTauri } from '../../host/bridge';
import { logger } from '../../core/log';
import type { WindowControlsPref } from '../../core/settings';
import { describeDesktop } from '../../host/window';
import { onWindowChange, setWindowPref, windowInfo, windowPref } from './window';
import { mountLocalApi } from './local-api';
import { tauriLocalApiBridge } from '../../host/local-api';
import { canZoom, onUiSizeChange, setUiSize, uiSize, uiZoomPercent } from './ui-size';
import { UI_SIZES } from '../../core/settings';
import type { UiSize } from '../../core/settings';

const log = logger('settings');

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

/* ───────── settings ───────── */
/** the dialog's sections, in tab order: [value, label]; each has its panel #hx-dpanel-<value> */
export const SETTINGS_SECTIONS = [['general', 'General'], ['models', 'Models'], ['connectors', 'Connectors'], ['appearance', 'Appearance'], ['keys', 'Keyboard']] as const;
let themeMounted = false;
function showSettingsSection(section?: string): void {
  const d = els().settings;
  const sec = SETTINGS_SECTIONS.some(([v]) => v === section) ? (section as string) : 'general';
  $<SegElement>('.hx-dtabs', d).select(sec);
  for (const p of $$('.hx-dpanel', d)) p.hidden = p.id !== 'hx-dpanel-' + sec;
  if (sec === 'general') { mountWindowControls(); mountDiagnostics(); mountLocalApiSection(); }
  if (sec === 'models') showModels();
  if (sec === 'connectors') showConnectors();
  if (sec === 'appearance' && !themeMounted) { mountThemePanel($('#hx-dpanel-appearance')); themeMounted = true; mountInterfaceSize(); mountOrbGrow(); }
  d.classList.toggle('is-side', sec === 'appearance');
  $('.hx-dialog__body', d).scrollTop = 0;
}
/* Settings > Models: the plan, the ladder and "Change models". Built the first time the tab opens, and asked again every time
   it opens, because Hermes's plan and the saved ladder move while the dialog is closed. Without the desktop host there is no
   Hermes to ask: the plan section says so and the ladder and the button are left out, rather than drawn empty. */
let models: { refresh: () => Promise<void> } | null = null;
let modelsMounting = false;
function showModels(): void {
  if (models) { void models.refresh().catch((e: unknown) => { log.warn('the models tab did not refresh', e); }); return; }
  if (modelsMounting) return;
  const panel = $('#hx-dpanel-models'); if (!panel) return;
  modelsMounting = true;
  const finish = (): void => { modelsMounting = false; };
  if (!inTauri()) {
    void import('../../host/plan-view').then((m) => m.mountPlan(panel)).then((m) => { models = m; }).catch((e: unknown) => { log.warn('the plan did not mount', e); }).finally(finish);
    return;
  }
  void import('../../host/models-tab').then((m) => m.mountModels(panel, m.realModelsDeps(() => { els().settings.close(); }))).then((m) => { models = m; }).catch((e: unknown) => { log.warn('the models tab did not mount', e); }).finally(finish);
}
/* Settings > Connectors: the MCP servers Hermes has and how to add one (host/connectors.ts). Built the first time the tab opens
   and asked again every time it opens, because Hermes's servers move while the dialog is closed and a form left open is dropped.
   Without the desktop host there is no Hermes to ask or change: the tab says so and draws no control. */
let connectors: { refresh: () => Promise<void> } | null = null;
let connectorsMounting = false;
function showConnectors(): void {
  if (connectors) { void connectors.refresh().catch((e: unknown) => { log.warn('the connectors tab did not refresh', e); }); return; }
  if (connectorsMounting) return;
  const panel = $('#hx-dpanel-connectors'); if (!panel) return;
  if (!inTauri()) { panel.innerHTML = '<p class="ui-field__hint">Connectors are added in the desktop app. This page cannot reach boopis\'s engine.</p>'; return; }
  connectorsMounting = true;
  void Promise.all([import('../../host/connectors'), import('../../host/connectors-bridge')])
    .then(([view, bridge]) => view.mountConnectors(panel, { bridge: bridge.tauriConnectorsBridge(), bridgeFor: (bot) => bridge.tauriConnectorsBridge(bot), bots: () => data().bots.snapshot().bots.map((b) => ({ id: b.id, name: b.name })), toast: (t) => { ui.toast(t); }, openStore: () => { openStore(); } }))
    .then((m) => { connectors = m; })
    .catch((e: unknown) => { log.warn('the connectors tab did not mount', e); })
    .finally(() => { connectorsMounting = false; });
}
/* Settings > General > Window: which title-bar buttons show. Automatic follows the desktop the host found (a tiling window
   manager gets close alone); the other two correct a wrong guess. The row says what was found. */
let windowMounted = false;
function mountWindowControls(): void {
  if (windowMounted) return;
  const panel = $('#hx-dpanel-general'); if (!panel) return;
  windowMounted = true;
  const sec = document.createElement('section');
  sec.className = 'ui-set'; sec.setAttribute('aria-labelledby', 'hx-set-window-h');
  sec.innerHTML = ui.html.setHead({ id: 'hx-set-window-h', label: 'Window' }) +
    ui.html.setRow({ label: 'Window controls', hint: describeDesktop(windowInfo()), control: '<div id="hx-win-seg"></div>' });
  const layout = panel.querySelector('section.ui-set');
  if (layout) layout.after(sec); else panel.prepend(sec);
  ui.hydrate(sec);
  const seg = ui.segmented({ mode: 'radio', size: 's', label: 'Window controls', value: windowPref(), options: [{ value: 'auto', label: 'Automatic' }, { value: 'close', label: 'Close only' }, { value: 'all', label: 'All' }] });
  $('#hx-win-seg', sec).replaceWith(seg);
  const hint = $('.ui-set__label small', sec);
  const say = (): void => { hint.textContent = (windowPref() === 'auto' ? '' : 'Set by you. ') + describeDesktop(windowInfo()); };
  say();
  onWindowChange(say);
  seg.addEventListener('ui:change', (e) => { setWindowPref((e as CustomEvent<{ value: string }>).detail.value as WindowControlsPref); });
}
/* Settings > General > Local API (ADR-0045), in the desktop app only: the switch, the address, the token file's path and Rotate. */
function mountLocalApiSection(): void {
  if (!inTauri()) return;
  const panel = $('#hx-dpanel-general'); if (!panel) return;
  mountLocalApi(panel, tauriLocalApiBridge());
}
/* Settings > General > Diagnostics, in the desktop app only (the page has no host to ask): the renderer report to copy and
   WebKitGTK's own GPU page. Nothing in the main chrome; the report is read when a button is pressed. */
let diagMounted = false;
function mountDiagnostics(): void {
  if (diagMounted || !inTauri()) return;
  const panel = $('#hx-dpanel-general'); if (!panel) return;
  diagMounted = true;
  const sec = document.createElement('section');
  sec.className = 'ui-set'; sec.setAttribute('aria-labelledby', 'hx-set-diag-h');
  sec.innerHTML = ui.html.setHead({ id: 'hx-set-diag-h', label: 'Diagnostics' }) +
    ui.html.setRow({ label: 'Graphics card', hint: 'Which GPU draws the window. Automatic uses the dedicated GPU on AC power when it is safe to. Applies the next time the app starts.',
      control: '<div class="ui-set__actions"><div id="hx-gpu-seg"></div>' + ui.html.button({ label: 'Restart to switch', size: 's', attrs: { id: 'hx-gpu-restart', hidden: true } }) + '</div>' }) +
    ui.html.setRow({ label: 'Graphics renderer', hint: 'What the window draws with. Copy it when asked why the app is slow or blank.',
      control: '<div class="ui-set__actions">' + ui.html.button({ label: 'Copy report', size: 's', attrs: { id: 'hx-diag-copy' } }) + ui.html.button({ label: 'Measure frames', size: 's', variant: 'ghost', attrs: { id: 'hx-diag-fps' } }) + ui.html.button({ label: 'WebKit GPU page', size: 's', variant: 'ghost', attrs: { id: 'hx-diag-gpu' } }) + '</div>' });
  panel.appendChild(sec);
  ui.hydrate(sec);
  const fail = (e: unknown): void => { ui.toast(e instanceof Error ? e.message : 'That did not work'); };
  let frames: import('../../host/renderer').FrameStats | null = null;
  $('#hx-diag-fps', sec).addEventListener('click', () => {
    ui.toast('Measuring for 5 seconds: close this and move the pointer along the dock', { ms: 6000 });
    void import('../../host/renderer').then(async (m) => {
      const rate = m.hz((await m.loadReport().catch(() => null))?.frame_rate.refresh_millihertz);
      frames = await m.measureFrames(5000);
      ui.toast(`${m.describeFrames(frames, rate)}: Copy report includes it`, { ms: 6000 });
    }).catch(fail);
  });
  $('#hx-diag-copy', sec).addEventListener('click', () => {
    void import('../../host/renderer').then(async (m) => {
      const text = m.reportText(await m.loadReport(), m.displayFacts(), frames);
      try { await navigator.clipboard.writeText(text); ui.toast('Copied'); } catch { ui.toast('Copy is blocked here'); }
    }).catch(fail);
  });
  mountGpuChoice(sec, fail);
  $('#hx-diag-gpu', sec).addEventListener('click', () => { void import('../../host/renderer').then((m) => m.openGpuPage()).catch(fail); });
}
/* The GPU choice: saved at once, applied at the next start (the GPU is fixed when the process starts), so the control says so
   and offers a restart when the choice differs from what is running or the power source moved since start. */
function mountGpuChoice(sec: HTMLElement, fail: (e: unknown) => void): void {
  const host = $('#hx-gpu-seg', sec), restart = $('#hx-gpu-restart', sec), status = $('.ui-set__label small', sec), base = status.textContent ?? '';
  void import('../../host/renderer').then(async (m) => {
    const [{ settings, policy }, report] = await Promise.all([m.loadGpuChoice(), m.loadReport()]);
    const seg = ui.segmented({ mode: 'radio', size: 's', label: 'Graphics card', value: policy, options: [{ value: 'auto', label: 'Auto' }, { value: 'integrated', label: 'Integrated' }, { value: 'dedicated', label: 'Dedicated' }] });
    host.replaceWith(seg);
    const g = report.gpu;
    const show = (chosen: typeof policy): void => {
      const lines: string[] = [];
      lines.push(g.policy_source === 'environment' ? `BOOPIS_GPU is set (${m.gpuLabel(g.policy)}) and overrides this choice.` : `Running on: ${g.set.length ? 'the dedicated GPU' : 'the integrated GPU'} (${g.rule.replace(/_/g, ' ')}).`);
      if (g.warning === 'may_crash_on_wayland') lines.push('The dedicated GPU on Wayland with this WebKitGTK (before 2.54.2) may crash or show a blank window.');
      const moved = g.restart_advice ? `The power source changed: a restart would switch to the ${g.restart_advice === 'to_dedicated' ? 'dedicated' : 'integrated'} GPU.` : '';
      if (moved) lines.push(moved);
      const pending = chosen !== g.policy && g.policy_source !== 'environment';
      if (pending) lines.push('Saved. It applies after a restart.');
      status.textContent = [base, ...lines].join(' ');
      restart.hidden = !(pending || g.restart_advice);
    };
    show(policy);
    seg.addEventListener('ui:change', (e) => {
      const chosen = (e as CustomEvent<{ value: string }>).detail.value as typeof policy;
      void m.saveGpuChoice(settings, chosen).then(() => show(chosen)).catch(fail);
    });
    restart.addEventListener('click', () => { void m.restartApp().catch(fail); });
  }).catch(fail);
}
/* Settings > Appearance > Size: the window's zoom in three steps (`ui-size.ts`). One segmented control in a settings row, as the
   rows above it; the hint says what the step is and, off the desktop app, that this page keeps the browser's zoom. */
const SIZE_LABELS: Readonly<Record<UiSize, string>> = { default: 'Default', larger: 'Larger', largest: 'Largest' };
const sizeHint = (): string => 'Text, bots and layout grow together. ' + (canZoom() ? 'Now ' + uiZoomPercent() + '%.' : 'The desktop app applies it.');
function mountInterfaceSize(): void {
  const panel = $('#hx-dpanel-appearance'); if (!panel || panel.querySelector('#hx-set-size-h')) return;
  const sec = document.createElement('section');
  sec.className = 'ui-set'; sec.setAttribute('aria-labelledby', 'hx-set-size-h');
  sec.innerHTML = ui.html.setHead({ id: 'hx-set-size-h', label: 'Size' }) +
    ui.html.setRow({ label: 'Interface size', labelId: 'hx-ui-size-l', hint: sizeHint(), control: '<div id="hx-ui-size-seg"></div>' });
  const before = panel.querySelector('[aria-labelledby="hxt-h-type"]');
  panel.insertBefore(sec, before);
  ui.hydrate(sec);
  const seg = ui.segmented({ mode: 'radio', size: 's', labelledby: 'hx-ui-size-l', value: uiSize(), attrs: { 'data-name': 'hx-ui-size' },
    options: UI_SIZES.map((s) => ({ value: s, label: SIZE_LABELS[s] })) });
  $('#hx-ui-size-seg', sec).replaceWith(seg);
  const hint = $('.ui-set__label small', sec);
  onUiSizeChange(() => { hint.textContent = sizeHint(); });
  seg.addEventListener('ui:change', (e) => { setUiSize((e as CustomEvent<{ value: string }>).detail.value as UiSize); });
}
function mountOrbGrow(): void {
  const panel = $('#hx-dpanel-appearance'); if (!panel || panel.querySelector('#hx-set-orb-grow')) return;
  const sec = document.createElement('section');
  sec.className = 'ui-set'; sec.setAttribute('aria-labelledby', 'hx-set-bots-h');
  sec.innerHTML = ui.html.setHead({ id: 'hx-set-bots-h', label: 'Bots' }) + ui.html.setRow({ for: 'hx-set-orb-grow', label: 'Grow bots on hover', hint: 'Bots in the dock grow under the pointer.',
    control: ui.html.switch({ id: 'hx-set-orb-grow', checked: state.orbGrow }) });
  const colours = panel.querySelector('[aria-labelledby="hxt-h-colours"]');
  panel.insertBefore(sec, colours);
  ui.hydrate(sec);
  $('#hx-set-orb-grow', sec).addEventListener('ui:change', (e) => setState({ orbGrow: !!(e as CustomEvent<{ value: boolean }>).detail.value }));
}
export function openSettings(section?: string): void {
  closePalette(); closeMenu(false);
  const d = els().settings;
  showSettingsSection(section);
  if (!d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
  const card = $('.hx-dialog__card', d); card.tabIndex = -1; card.focus({ preventScroll: true });
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
      storeView = m.mountStore($('#hx-store-body', d), { store: data().store, toast: (t) => { ui.toast(t); }, project: () => data().details.environment.get().cwd || null });
    }).catch((e: unknown) => { log.warn('the store did not mount', e); });
    void storeMounting.then(go);
  }
  const card = $('.hx-dialog__card', d); card.tabIndex = -1; card.focus({ preventScroll: true });
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
  $('#hx-set-dock').addEventListener('change', (e) => setState({ dock: (e.target as HTMLInputElement).checked ? 'on' : 'off' }));
  $('#hx-set-dock-centre').addEventListener('change', (e) => setState({ dockCentred: (e.target as HTMLInputElement).checked }));
  $('#hx-settings-close').addEventListener('click', () => el.settings.close());
  const sd = storeDialog();
  $('#hx-store-close', sd).addEventListener('click', () => sd.close());
  sd.addEventListener('click', (e) => { if (e.target === sd) sd.close(); });
  $('.hx-dtabs', el.settings).addEventListener('ui:change', (e) => showSettingsSection((e as CustomEvent<{ value: string }>).detail.value));
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
