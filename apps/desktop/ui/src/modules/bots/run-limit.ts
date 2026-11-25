/* The run-limit menu, one for a group's header (the most rounds `boopis run --group` lets a discussion take) and a bot's settings
   sheet (the most turns `boopis run --bot` lets one task take): "Default (n)", then 5, 20, 30, 60 and 100, the one kept checked
   (a number kept by the command line that is not among them is listed too). */
import { kit } from '@boopis/ui';

export const LIMIT_CHOICES: readonly number[] = [5, 20, 30, 60, 100];

export interface LimitMenu {
  /** the menu's heading */
  title: string;
  /** what the menu is called for a screen reader */
  label: string;
  /** the number kept, null when none is (the default applies) */
  kept: number | null;
  /** the default a limit without its own has */
  fallback: number;
  /** the choice: a number, or null for the default */
  onPick(value: number | null): void;
}

/** the limit in words, as a button or a menu item says it */
export const limitWords = (kept: number | null, fallback: number): string => (kept === null ? 'Default (' + fallback + ')' : String(kept));

export function openLimitMenu(anchor: HTMLElement, o: LimitMenu): void {
  const choices = o.kept !== null && !LIMIT_CHOICES.includes(o.kept) ? [...LIMIT_CHOICES, o.kept].sort((a, b) => a - b) : LIMIT_CHOICES;
  /* the kit's Menu under its heading: the one kept carries the check */
  kit.openMenu(anchor, {
    label: o.label, place: 'below', align: 'end',
    entries: [{ heading: o.title }, { label: limitWords(null, o.fallback), value: 'default', ...(o.kept === null ? { icon: 'check' } : {}) }, ...choices.map((n) => ({ label: String(n), value: String(n), ...(o.kept === n ? { icon: 'check' } : {}) }))],
    onSelect: (v) => { o.onPick(v === 'default' ? null : Number(v)); }
  });
}
