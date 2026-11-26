/* The parts every Settings page composes, all the kit's (board 14): a section is a head and a card of rows; a row is a label (with at
   most one hint line), then a value, a Switch, a Segmented, a select (the kit's SelectorItem, its chevron, opening the kit's Menu) or a
   check. The page module places them; nothing here draws a look of its own. */
import { kit } from '@boopis/ui';
import type { RowOpts, SegItem } from '@boopis/ui';

type MenuEntry = Parameters<typeof kit.openMenu>[1]['entries'][number];

export type { RowOpts };

export const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrsOf = (a?: Record<string, string>): string => Object.entries(a ?? {}).map(([k, v]) => ' ' + k + '="' + esc(v) + '"').join('');

/** a section: its head (4 in from the card) and its card of rows; `attrs` name the card */
export const section = (title: string, rows: readonly RowOpts[], attrs?: Record<string, string>): string =>
  kit.section(title, kit.html.card({ variant: 'settings', rows, ...(attrs ? { attrs } : {}) }));

/** a section whose content is not rows (a Notice, a Field, a list of drafts): its head, then the markup */
export const sectionOf = (title: string, body: string, attrs?: Record<string, string>): string =>
  '<div class="k7-section"' + attrsOf(attrs) + '>' + kit.html.sectionHead({ title }) + body + '</div>';

/** a row's switch, named by its row (the switch fires ui:change {value}) */
export const switchHTML = (name: string, label: string, checked: boolean, disabled = false): string =>
  kit.html.switch({ label, checked, disabled, attrs: { 'data-set': name } });

/** a row's Segmented (items as wide as their words, the chosen one filled), named by its row */
export const segHTML = (name: string, label: string, items: readonly SegItem[], value: string): string =>
  kit.html.segmented({ label, items, value, attrs: { 'data-set': name } });

/** a row's select: the value and its chevron (the boards' `.select`), opening a Menu of choices (`openSelect`) */
export const selectHTML = (name: string, label: string, value: string, leadHTML?: string): string =>
  kit.html.selectorItem({ variant: 'field', label, value, ...(leadHTML ? { leadHTML } : {}), attrs: { 'data-select': name } });

/** a row's quiet value (13, --text-dim) */
export const valueHTML = (text: string, attrs?: Record<string, string>): string =>
  '<span class="k7-row__value"' + attrsOf(attrs) + '>' + esc(text) + '</span>';

/** buttons at a row's end, 28 tall, 8 apart */
export const actionsHTML = (...buttons: string[]): string => '<span class="hx-set__acts">' + buttons.filter(Boolean).join('') + '</span>';
/** a button in a row: tinted by default (a card is raised: a raised button on it would paint the same, R-colour), 28 tall */
export const buttonHTML = (label: string, o: { variant?: 'primary' | 'ghost' | 'tint' | 'danger'; attrs?: Record<string, string | null> } = {}): string =>
  kit.html.button({ label, variant: o.variant ?? 'tint', size: 28, ...(o.attrs ? { attrs: o.attrs } : {}) });

export interface SelectChoice { value: string; label: string; desc?: string; leadHTML?: string }
/** open a select's Menu under it: the choices, the current one checked; a pick calls `onPick` */
export function openSelect(anchor: HTMLElement, o: { label: string; choices: readonly SelectChoice[]; value: string; heading?: string; onPick: (value: string) => void }): void {
  const entries: MenuEntry[] = [
    ...(o.heading ? [{ heading: o.heading }] : []),
    ...o.choices.map((c) => ({ label: c.label, value: c.value, role: 'menuitemradio' as const, checked: c.value === o.value, ...(c.desc ? { desc: c.desc } : {}), ...(c.leadHTML ? { leadHTML: c.leadHTML } : {}) }))
  ];
  kit.openMenu(anchor, { label: o.label, entries, place: 'below', align: 'end', onSelect: o.onPick });
}

/** what a host refusal says, or a plain fallback */
export const said = (e: unknown): string => (e instanceof Error && e.message ? e.message : 'That did not work');
