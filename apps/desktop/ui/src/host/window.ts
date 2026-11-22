/* The window, from the page's side: what the host detected about the desktop, the title bar's controls (minimise,
   maximise or restore, close) and which of them this desktop needs. The host decides once at start (`window.rs`: the
   compositor's variables, the session's names, the running window manager); the person can correct a wrong guess in
   Settings > General. Everything here is pure except `tauriWindowHost`, so tests drive a fake. */
import { commands, events } from './bindings';
import type { WindowAction } from './bindings';
import { asHostError } from './bridge';

/** the setting: let the app decide, or force the controls */
export type ControlsPref = 'auto' | 'close' | 'all';
/** what the title bar draws: the close button alone (a tiling manager), the three (a floating desktop), or the three in
    macOS's order and with its zoom (close, minimise, then full screen) */
export type ControlsLayout = 'close' | 'all' | 'mac';

export interface WindowInfo {
  platform: 'linux' | 'windows' | 'macos' | 'other';
  /** the desktop or window manager by name, when the host knows it */
  desktop: string | null;
  tiling: boolean;
  maximized: boolean;
  fullscreen: boolean;
}

export const CONTROLS_PREFS: readonly ControlsPref[] = ['auto', 'close', 'all'];
export const isControlsPref = (v: unknown): v is ControlsPref => typeof v === 'string' && (CONTROLS_PREFS as readonly string[]).includes(v);

/** which controls to draw. Without facts (the page build, or a host that did not answer) all three: nothing is hidden on a guess. */
export function resolveControls(pref: ControlsPref, info: Pick<WindowInfo, 'platform' | 'tiling'> | null): ControlsLayout {
  if (pref === 'close') return 'close';
  if (pref === 'auto' && info?.tiling) return 'close';
  return info?.platform === 'macos' ? 'mac' : 'all';
}

/** the words under the setting, so a person can see what was found */
export function describeDesktop(info: Pick<WindowInfo, 'desktop' | 'tiling'> | null): string {
  if (!info) return 'This page is not the desktop app, so nothing was detected.';
  if (!info.desktop) return 'The desktop was not recognised: all three buttons show.';
  return info.tiling ? `Detected ${info.desktop}, a tiling window manager: only close shows.` : `Detected ${info.desktop}: all three buttons show.`;
}

export interface WindowHost {
  info(): Promise<WindowInfo>;
  control(action: WindowAction): Promise<void>;
  /** be told when the window is maximised, restored or full screen; resolves to the function that stops listening */
  onState(cb: (s: { maximized: boolean; fullscreen: boolean }) => void): Promise<() => void>;
}

export function tauriWindowHost(): WindowHost {
  return {
    async info() {
      try {
        const f = await commands.windowFacts();
        return { platform: f.detected.platform, desktop: f.detected.desktop, tiling: f.detected.kind === 'tiling', maximized: f.maximized, fullscreen: f.fullscreen };
      } catch (e) { throw asHostError(e); }
    },
    async control(action) { try { await commands.windowControl(action); } catch (e) { throw asHostError(e); } },
    onState: (cb) => events.windowStateEvent.listen((e) => { cb(e.payload); })
  };
}

/** zoom the web view (the interface size): the page is laid out again at 1/factor of its width and everything is drawn
    `factor` times larger, text and canvases at the device's own resolution, so nothing is scaled from a smaller picture.
    The host's own call (`Webview::set_zoom`, WebKitGTK's page zoom); the capability is `core:webview:allow-set-webview-zoom`. */
export async function setWebviewZoom(factor: number): Promise<void> {
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(factor);
  } catch (e) { throw asHostError(e); }
}
