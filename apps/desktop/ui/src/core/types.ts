import type { Tab, LeftMode, RightMode, DockSwitch } from './settings';
export type { Tab, LeftMode, RightMode, DockSwitch };
export type ThemeScheme = 'dark' | 'light';

/** the shared UI state (`HX.state`) */
export interface AppState {
  tab: Tab;
  left: LeftMode;
  right: RightMode;
  dock: DockSwitch;
  /** follows the theme: the scheme of the current preset */
  theme: ThemeScheme;
  /** owner setting: dock bots grow under the pointer (Settings > Appearance), default on */
  orbGrow: boolean;
}

/** emitted by the shell as `hx:layout` (viewport coordinates) */
export interface Layout {
  centerX: number; colLeft: number; colWidth: number;
  viewportW: number; viewportH: number;
  appLeft: number; appTop: number; appW: number; appH: number;
  viewLeft: number; viewRight: number;
  leftW: number; rightW: number;
  leftMode: 'push' | 'overlay'; rightMode: 'push' | 'overlay';
  chromeH: number; dockSpace: number; marginW: number; composerW: number;
  dock: DockSwitch; tab: Tab; left: LeftMode; right: RightMode;
  duration: number; easing: string; animate: boolean;
  /** this layout answers a change of the window's size (the dock snaps to it instead of springing) */
  resized?: boolean;
}
