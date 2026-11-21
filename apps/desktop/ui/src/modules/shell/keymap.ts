/* The keymap: KEYMAP.md is the spec; this table feeds the sheet, Settings and the palette, and `classifyKey` is the
   dispatcher the shell's window handler runs (a pure function, unit-tested; the shell executes what it returns).
   Spec syntax: alternatives ' | ', a sequence ' ' (press one after the other), a combination '+', 'hold:X' (press
   and hold). 'mod' is Command on macOS and Ctrl elsewhere; 'alt' is Option on macOS. */
import { esc } from '../../core/dom';
import { ui } from '@boopis/ui';

export const KEYGROUPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [label: string, spec: string]>]> = [
  ['General', [
    ['Search and commands', 'mod+K'],
    ['Go to a session or bot', 'mod+P'],
    ['Find in this conversation', 'mod+F'],
    ['New session or bot', 'mod+shift+O'],
    ['Stop the running turn', 'mod+.'],
    ['Back, forward', 'mod+[ | mod+]'],
    ['Settings', 'mod+,'],
    ['Appearance and theme', 'mod+shift+,'],
    ['Light or dark theme', 'mod+shift+L'],
    ['Keyboard shortcuts', 'mod+/ | ?'],
    ['Close the top layer, or leave the composer', 'esc']
  ]],
  ['Layout', [
    ['Session tab, Bots tab', 'alt+1 | alt+2'],
    ['Sidebar: open or collapse', 'mod+B'],
    ['Sidebar: hide or show', 'mod+shift+B'],
    ['Details panel (bot settings on Bots)', 'mod+I'],
    ['Dock on or off', 'mod+J'],
    ['Expand or collapse the dock', 'mod+shift+J']
  ]],
  ['Move around', [
    ['Next or previous region', 'F6 | shift+F6'],
    ['Next or previous thing that needs you', 'F8 | shift+F8'],
    ['Sidebar list', 'mod+G L'],
    ['Conversation', 'mod+G M'],
    ['Composer', 'mod+G I | / | i'],
    ['Details panel', 'mod+G P'],
    ['Dock', 'mod+G D'],
    ['Session or Bots tab', 'mod+G S | mod+G B'],
    ['Bot n in the dock', 'mod+G 1-9'],
    ['Go to without the modifier (outside text fields)', 'g']
  ]],
  ['Lists', [
    ['Previous or next row', 'up | down | k | j'],
    ['First or last row', 'home | end'],
    ['Open', 'enter'],
    ['Previous or next project', 'shift+up | shift+down']
  ]],
  ['Conversation', [
    ['Previous or next turn', 'up | down | k | j'],
    ['First or latest turn', 'home | end | g g | shift+G'],
    ['Open or close the steps', 'enter | o'],
    ['Copy the turn', 'c'],
    ['Edit your message', 'e'],
    ['Open the diff', 'd'],
    ['Answer the blank', 'b']
  ]],
  ['Cards', [
    ['Approve', 'hold:space | enter enter'],
    ['Deny, or cancel a form', 'x'],
    ['Pick a blank or a form option', '1-9'],
    ['Submit a form', 'enter'],
    ['Show a cut name in full (it takes focus only then)', 'tab'],
    ['Defer a form (Later), or back to the turn', 'esc']
  ]],
  ['Composer', [
    ['Send', 'enter'],
    ['New line', 'shift+enter'],
    ['Send now', 'mod+enter'],
    ['Edit your last message (empty composer)', 'up'],
    ['Review the assumptions', 'tab'],
    ['Governed or ungoverned', 'alt+G'],
    ['Smart on or off', 'alt+S'],
    ['Who answers next: the model menu (the first entry is Automatic, Smart)', 'alt+M'],
    ['Ask a council: several models answer the next message, one combines them', 'alt+C'],
    ['Attach files', 'alt+A'],
    ['Talk: a tap toggles listening, a hold talks while held', 'alt+V'],
    ['Stop listening (while listening)', 'esc']
  ]],
  ['Dock', [
    ['Bot row: previous, next, first, last bot (and "+")', 'left | right | home | end'],
    ['Bot row: open the grid on the same bot', 'up'],
    ['Bot row: minimise the dock', 'down'],
    ['Open the bot\'s session in the dock; again closes it', 'enter | space'],
    ['Open the bot\'s full chat in the Bots tab', 'mod+enter'],
    ['Grid: move in two dimensions (down from the last row goes back to the bot row)', 'left | right | up | down | home | end'],
    ['Session switcher: previous, next bot; Enter switches', 'left | right | home | end'],
    ['Queue (Needs you): previous, next row; Enter expands it', 'up | down | home | end'],
    ['Page nub: previous, next, first, last page', 'left | right | home | end'],
    ['Previous or next dock page, anywhere in the dock', '[ | ] | pageup | pagedown'],
    ['Bot n', '1-9'],
    ['Close the session, collapse, leave', 'esc'],
    ['Expand or collapse (elsewhere in the dock)', 'up | down']
  ]],
  ['Palette', [
    ['Move', 'up | down'],
    ['Run', 'enter'],
    ['Commands only', '>'],
    ['Bots only', '@'],
    ['Close', 'esc']
  ]]
];

function specHTML(spec: string): string {
  return spec.split(' | ').map((alt) => '<span class="ui-keys">' + alt.split(' ').map((step) =>
    step.startsWith('hold:') ? '<span class="hx-kword">hold</span>' + ui.html.comboKbds(step.slice(5)) : ui.html.comboKbds(step)).join('<span class="hx-kthen" aria-hidden="true"></span>') + '</span>').join('<span class="hx-kword">or</span>');
}
/** the shortcut table as HTML, filtered by a search (a group, a label or a spec matches) */
export function keysTableHTML(filter?: string): string {
  const f = (filter || '').trim().toLowerCase();
  let html = '';
  for (const [group, rows] of KEYGROUPS) {
    const list = rows.filter(([label, spec]) => !f || (group + ' ' + label + ' ' + spec).toLowerCase().includes(f));
    if (!list.length) continue;
    html += '<section class="hx-keygroup"><h3>' + esc(group) + '</h3><dl>' + list.map(([label, spec]) => '<div><dt>' + esc(label) + '</dt><dd>' + specHTML(spec) + '</dd></div>').join('') + '</dl></section>';
  }
  return html || '<p class="hx-keys-empty">No shortcut matches <b>' + esc(filter ?? '') + '</b>.</p>';
}

/* ───────── the dispatcher ───────── */
export interface KeyLike {
  key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; defaultPrevented: boolean; isComposing: boolean;
}
export interface KeyCtx {
  isMac: boolean;
  /** focus is in a text field (single keys then belong to the field) */
  typing: boolean;
  /** a palette, dialog or popover is open (single keys then belong to it) */
  layerOpen: boolean;
}
export type KeyCommand =
  | { type: 'palette-toggle' } | { type: 'palette-items' } | { type: 'find' } | { type: 'new' } | { type: 'stop' }
  | { type: 'sidebar-toggle' } | { type: 'sidebar-hide-toggle' } | { type: 'details' } | { type: 'dock-toggle' } | { type: 'dock-expand' }
  | { type: 'back' } | { type: 'forward' } | { type: 'settings'; section: 'general' | 'appearance' } | { type: 'light-dark' } | { type: 'keys' }
  | { type: 'leader'; withMod: boolean } | { type: 'region'; dir: 1 | -1 } | { type: 'attention'; dir: 1 | -1 }
  | { type: 'tab'; tab: 'session' | 'bots' } | { type: 'composer' } | { type: 'escape' };
/** `take`: the shell prevents the browser's default; `consume`: the shell has no action but the key must not reach the page */
export interface Classified { command: KeyCommand; preventDefault: boolean }

/**
 * Decide what a key press means. Modifier keys (mod, alt, F-keys) work everywhere, including while typing; single keys
 * (g, ?, /, i) only outside text fields and with no layer open. A match on `code` for letters and digits (never `key`).
 * `find` and `stop` are returned as commands whose default is prevented only if a module answers: the shell decides.
 */
export function classifyKey(e: KeyLike, c: KeyCtx): Classified | null {
  if (e.defaultPrevented || e.isComposing) return null;
  const mod = c.isMac ? e.metaKey : e.ctrlKey;
  const other = c.isMac ? e.ctrlKey : e.metaKey;
  const code = e.code || '', k = (e.key || '').toLowerCase();
  const take = (command: KeyCommand): Classified => ({ command, preventDefault: true });

  if (e.key === 'Escape') return { command: { type: 'escape' }, preventDefault: false };   // what Esc closes depends on what is open: the shell decides
  if (e.key === 'F6' && !mod && !e.altKey) return take({ type: 'region', dir: e.shiftKey ? -1 : 1 });
  if (e.key === 'F8' && !mod && !e.altKey) return take({ type: 'attention', dir: e.shiftKey ? -1 : 1 });

  if (mod && !other && !e.altKey) {
    const sh = e.shiftKey;
    switch (code) {
      case 'KeyK': if (!sh) return take({ type: 'palette-toggle' }); break;
      case 'KeyP': if (!sh) return take({ type: 'palette-items' }); break;
      case 'KeyF': return sh ? null : { command: { type: 'find' }, preventDefault: false };
      case 'KeyO': if (sh) return take({ type: 'new' }); break;
      case 'KeyB': return take(sh ? { type: 'sidebar-hide-toggle' } : { type: 'sidebar-toggle' });
      case 'KeyI': if (!sh) return take({ type: 'details' }); break;
      case 'KeyJ': return take(sh ? { type: 'dock-expand' } : { type: 'dock-toggle' });
      case 'Period': return sh ? null : { command: { type: 'stop' }, preventDefault: false };
      case 'BracketLeft': if (!sh) return take({ type: 'back' }); break;
      case 'BracketRight': if (!sh) return take({ type: 'forward' }); break;
      case 'Comma': return take({ type: 'settings', section: sh ? 'appearance' : 'general' });
      case 'KeyL': if (sh) return take({ type: 'light-dark' }); break;
      case 'Slash': return take({ type: 'keys' });
      case 'KeyG': if (!sh) return take({ type: 'leader', withMod: true }); break;
      default: break;
    }
  }
  if (e.altKey && !mod && !other && !e.shiftKey && (code === 'Digit1' || code === 'Digit2')) return take({ type: 'tab', tab: code === 'Digit1' ? 'session' : 'bots' });
  /* the navigation layer: single keys, only when not typing and no layer is open */
  if (!c.typing && !mod && !other && !e.altKey && !c.layerOpen) {
    if (e.key === '?') return take({ type: 'keys' });
    if (k === 'g' && !e.shiftKey) return take({ type: 'leader', withMod: false });
    if (e.key === '/' || (k === 'i' && !e.shiftKey)) return take({ type: 'composer' });
  }
  return null;
}
