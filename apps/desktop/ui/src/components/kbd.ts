/* Key chips: the one markup for a key, everywhere one is drawn (buttons, menus, tooltips, the search field, the palette's rows, the
   shortcut sheet, the go-to hint). DESIGN-SYSTEM.md §14.17 "Key chip": `.ui-kbd`, 18px, --bg-3, a hairline, mono 11 --text-dim.
   Variants:
     fit     the chips sit in a control's corner and are concentric with it (--r-in of the control, §8.2): the search field, a tooltip
     raised  on a raised surface (a tooltip): --bg-4, no hairline
   The labels come from core/keys (how a key is named on this computer); this module only draws them. */
import { cx, esc } from '../core/dom';
import { comboLabels, keyLabel } from '../core/keys';

type U<T> = T | undefined;

export interface KeysOpts {
  /** concentric with the control the chips sit in */
  fit?: U<boolean>;
  /** on a raised surface (a tooltip) */
  raised?: U<boolean>;
  /** the chips repeat what aria-keyshortcuts says: hidden from assistive tech (the default) */
  hidden?: U<boolean>;
  class?: U<string>;
}
/** the variants the UI lab draws */
export const keysVariants = { fit: [false, true], raised: [false, true] } as const;

/** one chip with a literal label ('1-9', 'L') */
export const kbd = (label: string): string => '<kbd class="ui-kbd">' + esc(label) + '</kbd>';
/** chips from labels, one wrapper; a space separates them so a screen reader that does read them hears separate keys */
export const chips = (labels: readonly string[], o: KeysOpts = {}): string =>
  '<span class="' + cx('ui-keys', o.fit && 'ui-keys--fit', o.raised && 'ui-keys--raised', o.class) + '"' + (o.hidden === false ? '' : ' aria-hidden="true"') + '>' + labels.map(kbd).join(' ') + '</span>';
/** a spec ('mod+shift+K') as chips */
export const keys = (spec: U<string>, o?: KeysOpts): string => (spec ? chips(String(spec).split('+').map(keyLabel), o) : '');
/** a combination from the keymap table ('mod+F6', 'home'), which also names function keys, tab, home and end */
export const combo = (c: string, o?: KeysOpts): string => chips(comboLabels(c), o);
/** the same chips without a wrapper, for a sequence the caller wraps once (the shortcut sheet's "ctrl K then L") */
export const comboKbds = (c: string): string => comboLabels(c).map(kbd).join('');
