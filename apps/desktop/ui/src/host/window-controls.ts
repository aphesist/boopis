/* The window's own controls (minimise, maximise or restore, close) wherever a title bar draws them: the shell's bar, and the
   bar of a layer that covers the whole window (first run and "Change models", the startup notice). The window is undecorated
   (tauri.conf.json), so these buttons are the only ones the person has, and a layer that hid them left no way to move, shrink
   or close the window. One controller per page: it asks the host once what the desktop is, follows the window's state and
   lays out every group it is given by the same rule (`resolveControls`: close alone on a tiling desktop, macOS's order, the
   Settings preference), so a layer's bar and the shell's never disagree. In the page build (no host) the buttons keep the
   browser's stand-ins: full screen for maximise, a note for the two that need a window. */
import { kit, ui } from '@boopis/ui';
import { on } from '../core/bus';
import { loadWindowPref, saveWindowPref } from '../core/settings';
import { logger } from '../core/log';
import { inTauri } from './bridge';
import { resolveControls, tauriWindowHost } from './window';
import type { ControlsLayout, ControlsPref, WindowHost, WindowInfo } from './window';

const log = logger('window');

type Which = 'min' | 'max' | 'close';
type WinState = { maximized: boolean; fullscreen: boolean };

/** the three buttons of a group, found by their `data-win` */
const part = (group: HTMLElement, which: Which): HTMLElement | null => group.querySelector<HTMLElement>(`[data-win="${which}"]`);

/** The window group as the shell's bar has it (index.html): the kit's window buttons (`ui.iconButton({ window: true })`). */
export function windowGroup(): HTMLElement {
  const group = document.createElement('div');
  group.className = 'hx-win';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Window');
  group.append(
    ui.iconButton({ icon: 'minimize', label: 'Minimize', window: true, attrs: { 'data-win': 'min' } }),
    ui.iconButton({ icon: 'maximize', label: 'Maximize', window: true, attrs: { 'data-win': 'max' } }),
    ui.iconButton({ icon: 'close', label: 'Close window', window: true, attrs: { 'data-win': 'close' } }));
  return group;
}

/** Draw a layout on a group: the buttons that show, and their order (data on the group, `data-layout`). */
export function layoutGroup(group: HTMLElement, layout: ControlsLayout): void {
  const min = part(group, 'min'), max = part(group, 'max'), close = part(group, 'close');
  if (!min || !max || !close) return;
  group.dataset['layout'] = layout;
  min.hidden = max.hidden = layout === 'close';
  group.append(...(layout === 'mac' ? [close, min, max] : [min, max, close]));
}

/** What the maximise button says: a square to maximise, two to restore (full screen counts as maximised). Without a host
    the page's own full screen is the state. */
export function maxLabel(state: WinState | null, layout: ControlsLayout, pageFull = false): { label: string; icon: 'maximize' | 'restore' } {
  const full = state ? state.fullscreen : pageFull;
  const onNow = state ? state.maximized || state.fullscreen : full;
  return { label: full ? 'Exit full screen' : onNow ? 'Restore' : layout === 'mac' ? 'Full screen' : 'Maximize', icon: onNow ? 'restore' : 'maximize' };
}

function syncMax(group: HTMLElement, state: WinState | null): void {
  const b = part(group, 'max');
  if (!b) return;
  const { label, icon } = maxLabel(state, (group.dataset['layout'] as ControlsLayout | undefined) ?? 'all', !!document.fullscreenElement);
  /* the glyph keeps the size its button drew it at: the v7 chrome's 16 (the kit's `k7-ic`), the v6 bars' own */
  b.innerHTML = b.closest('[data-kit~="WindowChrome"], .k7-chrome') ? ui.icon(icon, { size: 'm', class: 'k7-ic' }) : ui.icon(icon);
  b.dataset['tip'] = label;
  b.setAttribute('aria-label', label);
}

export interface WindowControls {
  /** lay out and wire a group of the three buttons (`data-win` min, max, close); returns what lets it go */
  attach(group: HTMLElement): () => void;
  pref(): ControlsPref;
  setPref(next: ControlsPref): void;
  /** what the host found, once it answered */
  info(): WindowInfo | null;
  layout(): ControlsLayout;
  /** be told when the preference or what the host found changes (the settings row); returns what stops it */
  onChange(fn: () => void): () => void;
  /** draw a layout on request until the preference changes (the lab's `hx:window-controls`) */
  force(layout: ControlsLayout): void;
}

export interface WindowControlsDeps {
  /** the host's window commands; null in the page build, where the buttons keep the browser's stand-ins */
  host: WindowHost | null;
  notify: (text: string) => void;
  loadPref?: () => ControlsPref;
  savePref?: (next: ControlsPref) => void;
}

export function createWindowControls(deps: WindowControlsDeps): WindowControls {
  const { host } = deps;
  let pref: ControlsPref = deps.loadPref?.() ?? 'auto';
  let info: WindowInfo | null = null;
  /** a layout drawn on request (the lab's `hx:window-controls`), until the preference changes */
  let forced: ControlsLayout | null = null;
  let state: WinState | null = host ? { maximized: false, fullscreen: false } : null;
  let asked = false;
  const groups = new Set<HTMLElement>();
  const listeners = new Set<() => void>();
  const layout = (): ControlsLayout => forced ?? resolveControls(pref, info);
  const draw = (): void => { const l = layout(); for (const g of groups) { layoutGroup(g, l); syncMax(g, state); } };
  const changed = (): void => { draw(); for (const fn of listeners) fn(); };
  const fail = (what: string) => (e: unknown): void => { log.warn(what, e); deps.notify(e instanceof Error ? e.message : what); };
  /* the host is asked once, when the first group is drawn: the desktop it found at start, then the window's state as it moves */
  const ask = (): void => {
    if (asked) return;
    asked = true;
    if (!host) { document.addEventListener('fullscreenchange', draw); return; }
    host.info().then((i) => { info = i; state = { maximized: i.maximized, fullscreen: i.fullscreen }; changed(); })
      .catch((e: unknown) => { log.warn('the desktop was not detected; all three buttons show', e); });
    host.onState((s) => { state = s; draw(); }).catch((e: unknown) => { log.warn('the window state is not followed', e); });
  };
  const act = (which: Which): void => {
    if (host) {
      if (which === 'min') host.control('minimize').catch(fail('The window did not minimize'));
      else if (which === 'max') host.control('toggle_maximize').catch(fail('The window did not change size'));
      else host.control('close').catch(fail('The window did not close'));
      return;
    }
    if (which === 'min') deps.notify('Minimize works in the desktop app');
    else if (which === 'close') deps.notify('Close works in the desktop app');
    else void toggleFullscreen(deps.notify);
  };
  return {
    attach(group) {
      const onClick = (e: Event): void => {
        const b = (e.target as Element | null)?.closest<HTMLElement>('[data-win]');
        const which = b?.dataset['win'];
        if (b && group.contains(b) && (which === 'min' || which === 'max' || which === 'close')) act(which);
      };
      group.addEventListener('click', onClick);
      groups.add(group);
      layoutGroup(group, layout());
      syncMax(group, state);
      ask();
      return () => { group.removeEventListener('click', onClick); groups.delete(group); };
    },
    pref: () => pref,
    setPref(next) { pref = next; forced = null; deps.savePref?.(next); changed(); },
    info: () => info,
    layout,
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    force(l) { forced = l; draw(); }
  };
}

/** the page's stand-in for maximise: the browser's full screen */
async function toggleFullscreen(notify: (t: string) => void): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { notify('Full screen is not available in this view'); }
}

let page: WindowControls | null = null;
/** The page's one controller: the host's window in the desktop app, the browser's stand-ins elsewhere. */
export function windowControls(): WindowControls {
  if (!page) {
    const made = createWindowControls({ host: inTauri() ? tauriWindowHost() : null, notify: (t) => { kit.notify(t); }, loadPref: loadWindowPref, savePref: (p) => { saveWindowPref(p); } });
    page = made;
    on('hx:window-controls', (d) => { made.force(d.layout); });
  }
  return page;
}

/** A full-window layer's own title bar: the shell's bar in the layer's flow with the window group at its end, and a drag area
    everywhere but its buttons (`data-tauri-drag-region="deep"`: a double click maximises), wired to `controls`. No mark: the
    layers say who they are (first run's welcome plays the logo, the one logo of its screen). `detach` lets the group go when
    the layer leaves. */
export function windowBar(controls: WindowControls = windowControls()): { node: HTMLElement; detach: () => void } {
  const node = document.createElement('div');
  node.className = 'hx-bar hx-bar--layer';
  node.setAttribute('data-tauri-drag-region', 'deep');
  const end = document.createElement('div');
  end.className = 'hx-bar__end';
  const group = windowGroup();
  end.append(group);
  node.append(end);
  return { node, detach: controls.attach(group) };
}
