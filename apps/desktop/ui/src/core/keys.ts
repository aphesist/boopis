/* Key labels: how a spec such as 'mod+shift+K' is shown and announced. `mod` is the Command key on macOS and Ctrl
   elsewhere (KEYMAP.md section 0). One implementation for the chips, the tooltips, the palette and the help sheet. */
import { isMac } from './dom';

/** one chip's text (the library's .ui-kbd): 'mod' -> command or ctrl, 'up' -> an arrow, a single letter in capitals */
export function keyLabel(k: string): string {
  const m: Record<string, string> = { mod: isMac ? '⌘' : 'ctrl', shift: isMac ? '⇧' : 'shift', alt: isMac ? '⌥' : 'alt', enter: 'enter', esc: 'esc', up: '↑', down: '↓', left: '←', right: '→', comma: ',', period: '.', space: 'space' };
  return m[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k);
}

/** the value of aria-keyshortcuts for a spec */
export const ariaKeys = (spec: string): string =>
  String(spec).split('+').map((k) => ({ mod: isMac ? 'Meta' : 'Control', shift: 'Shift', alt: 'Alt', esc: 'Escape', enter: 'Enter' } as Record<string, string>)[k.toLowerCase()] ?? k).join('+');

const KEYNAMES: Record<string, string> = isMac
  ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
  : { mod: 'ctrl', shift: 'shift', alt: 'alt', ctrl: 'ctrl' };
const KEYLABEL: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', enter: 'enter', esc: 'esc', space: 'space', tab: 'tab', home: 'home', end: 'end', pageup: 'pgup', pagedown: 'pgdn' };

/** a spec as one string for a sentence ('⌘K' on a Mac, 'ctrl K' elsewhere) */
export function kbdLabel(spec: string): string {
  const parts = String(spec).split('+').map((p) => KEYNAMES[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p.toLowerCase()));
  return parts.join(isMac ? '' : ' ');
}

/** one combination as .ui-kbd chips, for the shortcut sheet (it also knows function keys, tab, home, end) */
export function comboChips(c: string, escape: (s: string) => string): string {
  return c.split('+').map((k) => {
    const low = k.toLowerCase();
    const label = KEYNAMES[low] ?? KEYLABEL[low] ?? (/^f\d+$/.test(low) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : k);
    return '<kbd class="ui-kbd">' + escape(label) + '</kbd>';
  }).join('');
}

/** KeyboardEvent.code for a letter ('KeyK') or digit ('Digit1'): letters and digits are matched by code, never by key */
export const letterOf = (code: string): string | null => (/^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : null);
