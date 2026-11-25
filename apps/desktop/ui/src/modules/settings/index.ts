/* Settings on the v7 kit (DESIGN-SYSTEM.md v7 7 "Dialogs", 12.1 Dialog, 21.2 "Patterns: the Settings page"): the large Dialog (900,
   its 220 nav of 32 rows), each section a settings Page: a 17/500 title, then SectionHeads over soft Cards of Rows (label, value,
   control; the explanation behind the label's mark, 17.1). The sections: General (Layout, Window, Local API, Diagnostics), Models,
   Connectors (host/connectors.ts), Appearance (section 5 and 18: Theme, accent, corners, light shadows, density, size, a bot's
   colour) and Keyboard (the shortcut table; an allowed dense surface, section 11). Changes apply at once (R-switch-1). */
import { $ } from '../../core/dom';
import { prefs, saveState, setState, state } from '../../core/state';
import { kit } from '@boopis/ui';
import { data } from '../../data';
import { inTauri } from '../../host/bridge';
import { logger } from '../../core/log';
import type { WindowControlsPref } from '../../core/settings';
import { UI_SIZES } from '../../core/settings';
import type { UiSize } from '../../core/settings';
import { describeDesktop } from '../../host/window';
import { onWindowChange, setWindowPref, windowInfo, windowPref } from '../shell/window';
import { mountLocalApi } from '../shell/local-api';
import { tauriLocalApiBridge } from '../../host/local-api';
import { canZoom, onUiSizeChange, setUiSize, uiSize, uiZoomPercent } from '../shell/ui-size';
import { KEYGROUPS } from '../shell/keymap';
import { appearance, density, followTheme, MODES, setAppearance, setDensity } from '../../styles/theme-v7';
import type { ThemeMode } from '../../styles/theme-v7';
import { DENSITIES } from '../../styles/theme';
import type { Density } from '../../styles/theme';

const log = logger('settings');
const say = (text: string): void => { kit.notify(text); };
const fail = (e: unknown): void => { say(e instanceof Error ? e.message : 'That did not work'); };

/** the dialog's sections, in nav order: [value, label, glyph]; each has its page #hx-dpanel-<value> and its nav row #hx-dtab-<value> */
export const SETTINGS_SECTIONS = [['general', 'General', 'gear'], ['models', 'Models', 'spark'], ['connectors', 'Connectors', 'at'], ['appearance', 'Appearance', 'sliders'], ['keys', 'Keyboard', 'slash']] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number][0];

const h = (html: string): HTMLElement => kit.wire(document.createRange().createContextualFragment(html).firstElementChild as HTMLElement);
type RowOpts = Parameters<typeof kit.html.card>[0]['rows'][number];
/** a section of a page: its SectionHead and its Card */
const section = (id: string, title: string, rows: readonly RowOpts[]): HTMLElement => {
  const s = h('<div class="k7-section" role="group" aria-labelledby="' + id + '-h">' + kit.html.sectionHead({ title, attrs: { id: id + '-h' } }) + kit.html.card({ rows }) + '</div>');
  s.id = id;
  return s;
};
const seg = (label: string, items: ReadonlyArray<readonly [string, string]>, value: string, attrs?: Record<string, string>): string =>
  kit.html.segmented({ label, items: items.map(([v, l]) => ({ value: v, label: l })), value, ...(attrs ? { attrs } : {}) });
/** a page: its 17/500 title, then its sections */
const pageHTML = (title: string): string => kit.html.page({ variant: 'settings', title, body: '' });
const bodyOf = (panel: HTMLElement): HTMLElement => panel.querySelector('.k7-page__body') as HTMLElement;

/* ───────── the dialog ───────── */
let dialog: HTMLDialogElement | null = null;
/** draw the dialog into its <dialog> (index.html #hx-settings), once, at boot */
export function buildSettings(d: HTMLDialogElement): void {
  dialog = d;
  followTheme(d);
  const host = $('#hx-settings-body', d);
  host.innerHTML = kit.html.dialog({
    variant: 'large', title: 'Settings', scrim: false, id: 'hx-settings-dlg', attrs: { role: null, 'aria-modal': null },
    nav: SETTINGS_SECTIONS.map(([value, label, icon]) => ({ label, icon, current: value === 'general', attrs: { 'data-value': value, id: 'hx-dtab-' + value, 'aria-controls': 'hx-dpanel-' + value } })),
    body: SETTINGS_SECTIONS.map(([value, label]) => '<div class="hx-dpanel" id="hx-dpanel-' + value + '"' + (value === 'general' ? '' : ' hidden') + '>' + (value === 'connectors' || value === 'models' ? '' : pageHTML(label)) + '</div>').join('')
  });
  kit.wire(host);
  $('[data-dialog-close]', host).id = 'hx-settings-close';
  $('[data-dialog-close]', host).setAttribute('aria-label', 'Close settings');
  $('.k7-dialog__nav', host).addEventListener('ui:change', (e) => { showSection((e as CustomEvent<{ value: string }>).detail.value); });
  d.addEventListener('click', (e) => { if ((e.target as Element).closest('[data-dialog-close]')) d.close(); });
  drawGeneral();
}
const panelOf = (sec: string): HTMLElement => $('#hx-dpanel-' + sec, dialog ?? document);

/** show one section (General when the name is not one); the nav row follows */
export function showSection(section?: string): void {
  if (!dialog) return;
  const sec = SETTINGS_SECTIONS.some(([v]) => v === section) ? (section as SettingsSection) : 'general';
  for (const [v] of SETTINGS_SECTIONS) {
    panelOf(v).hidden = v !== sec;
    const row = $('#hx-dtab-' + v, dialog);
    if (v === sec) row.setAttribute('aria-current', 'page'); else row.removeAttribute('aria-current');
  }
  if (sec === 'general') { mountDiagnostics(); mountLocalApiSection(); }
  if (sec === 'models') showModels();
  if (sec === 'connectors') showConnectors();
  if (sec === 'appearance') drawAppearance();
  if (sec === 'keys') drawKeys();
  const page = dialog.querySelector<HTMLElement>('.k7-dialog__page'); if (page) page.scrollTop = 0;
}

/** keep the controls that mirror the app's state in step with it (the shell calls this whenever its state changes) */
export function syncSettings(): void {
  if (!dialog) return;
  const set = (id: string, on: boolean): void => { dialog?.querySelector('#' + id)?.setAttribute('aria-checked', String(on)); };
  set('hx-set-dock', state.dock === 'on');
  set('hx-set-dock-centre', state.dockCentred);
  set('hx-set-orb-grow', state.orbGrow);
  const c = dialog.querySelector<HTMLElement>('#hx-set-collapse');
  if (c) selectSeg(c, prefs.collapse);
}
/** a Segmented drawn already, moved to a value without an event (a change made elsewhere) */
function selectSeg(s: HTMLElement, value: string): void {
  const items = [...s.querySelectorAll<HTMLElement>('[data-kit-part~="SegmentedItem"]')];
  const i = items.findIndex((x) => x.dataset['value'] === value); if (i < 0) return;
  items.forEach((x, n) => { x.setAttribute('aria-checked', String(n === i)); x.tabIndex = n === i ? 0 : -1; });
  s.style.setProperty('--i', String(i));
}
const onChange = <T>(root: ParentNode, sel: string, fn: (v: T) => void): void => {
  root.querySelector(sel)?.addEventListener('ui:change', (e) => { fn((e as CustomEvent<{ value: T }>).detail.value); });
};

/* ───────── General ───────── */
function drawGeneral(): void {
  const body = bodyOf(panelOf('general'));
  body.append(section('hx-set-layout', 'Layout', [
    { label: 'Show the dock', explain: 'Bots and widgets at the bottom edge. Everything in it is also in the sidebar.', control: kit.html.switch({ id: 'hx-set-dock', checked: state.dock === 'on', label: 'Show the dock' }) },
    { label: 'Keep the dock centred in the window', explain: 'It stays in the middle of the window while the sidebar and the details panel open and close.', control: kit.html.switch({ id: 'hx-set-dock-centre', checked: state.dockCentred, label: 'Keep the dock centred in the window' }) },
    { label: 'When the sidebar collapses', explain: 'A rail keeps the tabs and the new button in reach.', control: seg('When the sidebar collapses', [['rail', 'Rail'], ['closed', 'Hide']], prefs.collapse, { id: 'hx-set-collapse' }) }
  ]));
  onChange<boolean>(body, '#hx-set-dock', (on) => { setState({ dock: on ? 'on' : 'off' }); });
  onChange<boolean>(body, '#hx-set-dock-centre', (on) => { setState({ dockCentred: on }); });
  onChange<string>(body, '#hx-set-collapse', (v) => { prefs.collapse = v === 'closed' ? 'closed' : 'rail'; saveState(); if (state.left !== 'open') setState({ left: prefs.collapse }); });
  /* Window: which title-bar buttons show. Automatic follows the desktop the host found (a tiling window manager gets close alone);
     the other two correct a wrong guess. The label's explanation says what was found */
  const winExplain = (): string => (windowPref() === 'auto' ? '' : 'Set by you. ') + describeDesktop(windowInfo());
  const win = section('hx-set-window', 'Window', [{ label: 'Window controls', explain: winExplain(), control: seg('Window controls', [['auto', 'Automatic'], ['close', 'Close only'], ['all', 'All']], windowPref(), { id: 'hx-win-seg' }) }]);
  body.append(win);
  onWindowChange(() => { win.querySelector('[data-explain]')?.setAttribute('data-explain', winExplain()); });
  onChange<string>(win, '#hx-win-seg', (v) => { setWindowPref(v as WindowControlsPref); });
}
/* General > Local API (ADR-0045), in the desktop app only */
function mountLocalApiSection(): void {
  if (!inTauri()) return;
  mountLocalApi(bodyOf(panelOf('general')), tauriLocalApiBridge());
}
/* General > Diagnostics, in the desktop app only (the page has no host to ask): the GPU choice, applied at the next start, and the
   renderer report to copy. Measuring frames and WebKitGTK's own GPU page, rarer, are in the row's overflow Menu (section 11) */
let diagMounted = false;
function mountDiagnostics(): void {
  if (diagMounted || !inTauri()) return;
  diagMounted = true;
  const sec = section('hx-set-diag', 'Diagnostics', [
    { label: 'Graphics card', explain: 'Which GPU draws the window. Automatic uses the dedicated GPU on AC power when it is safe to. Applies the next time the app starts.', control: '<span id="hx-gpu-seg"></span>' + kit.html.button({ label: 'Restart to switch', size: 28, variant: 'tint', attrs: { id: 'hx-gpu-restart', hidden: true } }) },
    { label: 'Graphics renderer', explain: 'What the window draws with. Copy it when asked why the app is slow or blank.', control: kit.html.button({ label: 'Copy report', size: 28, variant: 'tint', attrs: { id: 'hx-diag-copy' } }) + kit.html.iconButton({ icon: 'more', label: 'More diagnostics', variant: 'tinted', haspopup: 'menu', tip: 'More', attrs: { id: 'hx-diag-more' } }) }
  ]);
  bodyOf(panelOf('general')).append(sec);
  let frames: import('../../host/renderer').FrameStats | null = null;
  const measure = (): void => {
    say('Measuring for 5 seconds: close this and move the pointer along the dock');
    void import('../../host/renderer').then(async (m) => {
      const rate = m.hz((await m.loadReport().catch(() => null))?.frame_rate.refresh_millihertz);
      frames = await m.measureFrames(5000);
      kit.notify(`${m.describeFrames(frames, rate)}: Copy report includes it`, { ms: 6000 });
    }).catch(fail);
  };
  $('#hx-diag-copy', sec).addEventListener('click', () => {
    void import('../../host/renderer').then(async (m) => {
      const text = m.reportText(await m.loadReport(), m.displayFacts(), frames);
      try { await navigator.clipboard.writeText(text); say('Copied'); } catch { say('Copy is blocked here'); }
    }).catch(fail);
  });
  const more = $('#hx-diag-more', sec);
  more.addEventListener('click', () => {
    kit.openMenu(more, { label: 'More diagnostics', align: 'end', entries: [{ label: 'Measure frames', value: 'fps' }, { label: 'WebKit GPU page', value: 'gpu' }],
      onSelect: (v) => { if (v === 'fps') measure(); else void import('../../host/renderer').then((m) => m.openGpuPage()).catch(fail); } });
  });
  mountGpuChoice(sec);
}
/* The GPU choice: saved at once, applied at the next start (the GPU is fixed when the process starts), so the row says so and offers
   a restart when the choice differs from what is running or the power source moved since start */
function mountGpuChoice(sec: HTMLElement): void {
  const host = $('#hx-gpu-seg', sec), restart = $<HTMLButtonElement>('#hx-gpu-restart', sec);
  const mark = sec.querySelector('[data-explain]'), base = mark?.getAttribute('data-explain') ?? '';
  void import('../../host/renderer').then(async (m) => {
    const [{ settings, policy }, report] = await Promise.all([m.loadGpuChoice(), m.loadReport()]);
    const s = h(seg('Graphics card', [['auto', 'Auto'], ['integrated', 'Integrated'], ['dedicated', 'Dedicated']], policy));
    host.replaceWith(s);
    const g = report.gpu;
    const show = (chosen: typeof policy): void => {
      const lines: string[] = [];
      lines.push(g.policy_source === 'environment' ? `BOOPIS_GPU is set (${m.gpuLabel(g.policy)}) and overrides this choice.` : `Running on: ${g.set.length ? 'the dedicated GPU' : 'the integrated GPU'} (${g.rule.replace(/_/g, ' ')}).`);
      if (g.warning === 'may_crash_on_wayland') lines.push('The dedicated GPU on Wayland with this WebKitGTK (before 2.54.2) may crash or show a blank window.');
      if (g.restart_advice) lines.push(`The power source changed: a restart would switch to the ${g.restart_advice === 'to_dedicated' ? 'dedicated' : 'integrated'} GPU.`);
      const pending = chosen !== g.policy && g.policy_source !== 'environment';
      if (pending) lines.push('Saved. It applies after a restart.');
      mark?.setAttribute('data-explain', [base, ...lines].join(' '));
      restart.hidden = !(pending || g.restart_advice);
    };
    show(policy);
    s.addEventListener('ui:change', (e) => {
      const chosen = (e as CustomEvent<{ value: string }>).detail.value as typeof policy;
      void m.saveGpuChoice(settings, chosen).then(() => { show(chosen); if (chosen !== g.policy) say('Saved. It applies after a restart.'); }).catch(fail);
    });
    restart.addEventListener('click', () => { void m.restartApp().catch(fail); });
  }).catch(fail);
}

/* ───────── Models (host/models-tab.ts) ───────── */
let models: { refresh: () => Promise<void> } | null = null;
let modelsMounting = false;
/* Built the first time the section opens, and asked again every time it opens, because the engine's plan and the saved ladder move
   while the dialog is closed. Without the desktop host there is no engine to ask: the plan says so and the rest is left out */
function showModels(): void {
  if (models) { void models.refresh().catch((e: unknown) => { log.warn('the models tab did not refresh', e); }); return; }
  if (modelsMounting) return;
  const panel = panelOf('models');
  modelsMounting = true;
  const finish = (): void => { modelsMounting = false; };
  if (!inTauri()) {
    void import('../../host/plan-view').then((m) => m.mountPlan(panel)).then((m) => { models = m; }).catch((e: unknown) => { log.warn('the plan did not mount', e); }).finally(finish);
    return;
  }
  void import('../../host/models-tab').then((m) => m.mountModels(panel, m.realModelsDeps(() => { dialog?.close(); }))).then((m) => { models = m; }).catch((e: unknown) => { log.warn('the models tab did not mount', e); }).finally(finish);
}

/* ───────── Connectors (host/connectors.ts) ───────── */
let connectors: { refresh: () => Promise<void> } | null = null;
let connectorsMounting = false;
let openStoreFn: () => void = () => undefined;
/** how Connectors' "Browse the store" opens the store (the shell's dialogs) */
export const setOpenStore = (fn: () => void): void => { openStoreFn = fn; };
/* Built the first time the section opens and asked again every time it opens. Without the desktop host there is no engine to ask or
   change: the page says so and draws no control */
function showConnectors(): void {
  if (connectors) { void connectors.refresh().catch((e: unknown) => { log.warn('the connectors tab did not refresh', e); }); return; }
  if (connectorsMounting) return;
  const panel = panelOf('connectors');
  if (!inTauri()) {
    panel.innerHTML = kit.html.page({ variant: 'settings', title: 'Connectors', empty: { text: 'Connectors are added in the desktop app. This page cannot reach boopis\'s engine.' } });
    return;
  }
  connectorsMounting = true;
  void Promise.all([import('../../host/connectors'), import('../../host/connectors-bridge')])
    .then(([view, bridge]) => view.mountConnectors(panel, { bridge: bridge.tauriConnectorsBridge(), bridgeFor: (bot) => bridge.tauriConnectorsBridge(bot), bots: () => data().bots.snapshot().bots.map((b) => ({ id: b.id, name: b.name })), notify: say, openStore: () => { openStoreFn(); } }))
    .then((m) => { connectors = m; })
    .catch((e: unknown) => { log.warn('the connectors tab did not mount', e); })
    .finally(() => { connectorsMounting = false; });
}

/* ───────── Appearance (sections 5 and 18) ───────── */
const MODE_LABELS: Readonly<Record<ThemeMode, string>> = { system: 'Follow system', light: 'Light', dark: 'Dark' };
const SIZE_LABELS: Readonly<Record<UiSize, string>> = { default: 'Default', larger: 'Larger', largest: 'Largest' };
const DENSITY_LABELS: Readonly<Record<Density, string>> = { compact: 'Compact', regular: 'Regular', comfortable: 'Comfortable' };
const HEX = /^#[0-9a-f]{6}$/i;
const sizeExplain = (): string => 'Text, bots and layout grow together. ' + (canZoom() ? 'Now ' + uiZoomPercent() + '%.' : 'The desktop app applies it.');
let appearanceDrawn = false;
function drawAppearance(): void {
  if (appearanceDrawn) { syncAppearance(); return; }
  appearanceDrawn = true;
  const body = bodyOf(panelOf('appearance'));
  const a = appearance();
  body.append(section('hx-set-theme', 'Theme', [
    { label: 'Theme', control: seg('Theme', MODES.map((m) => [m, MODE_LABELS[m]] as const), a.mode, { id: 'hx-set-mode' }) },
    { label: 'Accent', explain: 'Any colour. boopis derives its text, focus and mark shades so they stay readable. Empty is the default indigo.', control: kit.html.field({ id: 'hx-set-accent', ariaLabel: 'Accent colour, as a hex value', mono: true, placeholder: 'Default', value: a.accent ?? '', attrs: { maxlength: '7', spellcheck: 'false', autocomplete: 'off' } }) },
    { label: 'Corners', control: seg('Corners', [['b', 'Standard'], ['c', 'Rounder']], a.radii, { id: 'hx-set-radii' }) },
    { label: 'Light shadows', explain: 'How raised surfaces read in the light theme.', control: seg('Light shadows', [['a', 'Standard'], ['b', 'Hairline and half'], ['c', 'Flat']], a.shadow, { id: 'hx-set-shadow' }) },
    { label: 'Density', control: seg('Density', DENSITIES.map((d) => [d, DENSITY_LABELS[d]] as const), density(), { id: 'hx-set-density' }) }
  ]));
  body.append(section('hx-set-size', 'Size', [
    { label: 'Interface size', explain: sizeExplain(), control: seg('Interface size', UI_SIZES.map((s) => [s, SIZE_LABELS[s]] as const), uiSize(), { id: 'hx-ui-size', 'data-name': 'hx-ui-size' }) }
  ]));
  body.append(section('hx-set-bots', 'Bots', [
    { label: 'Your messages in a bot\'s colour', explain: 'In a bot\'s own chat, your messages and the send button take that bot\'s colour. Off, they are ink everywhere.', control: kit.html.switch({ id: 'hx-set-bot-colour', checked: a.botColour, label: 'Your messages in a bot\'s colour' }) },
    { label: 'Grow bots on hover', explain: 'Bots in the dock grow under the pointer.', control: kit.html.switch({ id: 'hx-set-orb-grow', checked: state.orbGrow, label: 'Grow bots on hover' }) }
  ]));
  onChange<string>(body, '#hx-set-mode', (v) => { setAppearance({ mode: v as ThemeMode }); });
  onChange<string>(body, '#hx-set-radii', (v) => { setAppearance({ radii: v === 'c' ? 'c' : 'b' }); });
  onChange<string>(body, '#hx-set-shadow', (v) => { setAppearance({ shadow: v as 'a' | 'b' | 'c' }); });
  onChange<string>(body, '#hx-set-density', (v) => { setDensity(v as Density); });
  onChange<string>(body, '#hx-ui-size', (v) => { setUiSize(v as UiSize); });
  onChange<boolean>(body, '#hx-set-bot-colour', (on) => { setAppearance({ botColour: on }); });
  onChange<boolean>(body, '#hx-set-orb-grow', (on) => { setState({ orbGrow: on }); });
  const accent = $<HTMLInputElement>('#hx-set-accent', body);
  const field = accent.closest<HTMLElement>('[data-kit~="Field"]');
  /* applied as soon as it is a whole hex value (or empty, the default); a value that is neither says so on the field */
  accent.addEventListener('input', () => {
    const v = accent.value.trim();
    const ok = v === '' || HEX.test(v);
    field?.toggleAttribute('data-error', !ok && v.length >= 7);
    accent.setAttribute('aria-invalid', String(!ok && v.length >= 7));
    if (ok) setAppearance({ accent: v === '' ? null : v.toLowerCase() });
  });
  onUiSizeChange(() => { body.querySelector('#hx-set-size [data-explain]')?.setAttribute('data-explain', sizeExplain()); });
}
/** the page again after the theme moved by another way (the light and dark key) */
function syncAppearance(): void {
  const body = bodyOf(panelOf('appearance')), a = appearance();
  const m = body.querySelector<HTMLElement>('#hx-set-mode'); if (m) selectSeg(m, a.mode);
  const d = body.querySelector<HTMLElement>('#hx-set-density'); if (d) selectSeg(d, density());
}

/* ───────── Keyboard (the shortcut table: an allowed dense surface) ───────── */
/** a spec as key chips: alternatives joined by "or", steps by "then", a hold said in words */
export function keysHTML(spec: string): string {
  const word = (w: string): string => '<span class="hx-keyspec__word">' + w + '</span>';
  return '<span class="hx-keyspec">' + spec.split(' | ').map((alt) => alt.split(' ').map((step) => (step.startsWith('hold:') ? word('hold') + kit.html.kbd({ keys: step.slice(5) }) : kit.html.kbd({ keys: step }))).join(word('then'))).join(word('or')) + '</span>';
}
let keysDrawn = false;
function drawKeys(): void {
  if (keysDrawn) return;
  keysDrawn = true;
  const body = bodyOf(panelOf('keys'));
  KEYGROUPS.forEach(([group, rows], i) => {
    body.append(section('hx-set-keys-' + i, group, rows.map(([label, spec]) => ({ label, ...(label.length > 44 ? { explain: label } : {}), control: keysHTML(spec) }))));
  });
  body.append(h('<p class="hx-set-note">Keys shown for this computer. In a web browser a few belong to the browser (F6, and Alt+1 or Alt+2 on Linux); every action is also in the palette.</p>'));
}
