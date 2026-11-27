/* CommandPalette: its view (typed props to markup) and its contract. Its look is command-palette.css, its stories and tests stand beside
   it, its behaviour is behaviour.ts (docs/kit/RULES.md). */
import { field } from '../field/field';
import { kbd } from '../kbd/kbd';
import { statusWord } from '../status-word/status-word';
import { attrs, esc, glyph, kitAttrs, partAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── CommandPalette (derived, no board: S31's rows of a name and what it is, P2's search that opens it): mod+K's search over the
   sessions, the bots and the commands. A search Field over one listbox of rows under group heads; the row the keys are on is the
   option the field's aria-activedescendant names. 640 wide (the grok search menu, --palette-w), at most 520 tall ── */
export interface CommandPaletteRow {
  /** what the row is called to the app: `ui:select {value}` */ value: string;
  label: string; /** a quiet word after the label (a session's project, a bot's role) */ meta?: U<string>;
  /** the row's end word (when a session last ran; "needs you" in the attention amber) */ trail?: U<string>; attn?: U<boolean>;
  /** a glyph of the kit's icon set that leads the row */ icon?: U<string>; /** trusted kit markup in place of the glyph (a bot's orb) */ leadHTML?: U<string>;
  /** its keys, as the keymap writes them */ keys?: U<string>; attrs?: U<Attrs>;
}
export interface CommandPaletteGroup { label: string; rows: readonly CommandPaletteRow[] }
export interface CommandPaletteListOpts {
  /** the ids the parts are named by: the field `<id>-input`, the list `<id>-list`, each row `<id>-<n>` */ id: string;
  groups: readonly CommandPaletteGroup[]; /** the row the keys are on, counted over every group (0 by default) */ active?: U<number>;
  /** the words typed: their first word is marked where a label holds it */ query?: U<string>;
  /** the one line where no row matches */ empty?: U<string>;
}
export interface CommandPaletteOpts extends CommandPaletteListOpts {
  /** the palette's accessible name */ label: string; placeholder: string; /** what the field holds */ value?: U<string>; attrs?: U<Attrs>;
}

/** a label with the first word of the query marked where it stands */
function marked(label: string, q: string): string {
  const w = q.split(/\s+/).filter(Boolean)[0];
  const i = w ? label.toLowerCase().indexOf(w.toLowerCase()) : -1;
  if (!w || i < 0) return esc(label);
  return esc(label.slice(0, i)) + '<mark class="k7-cpal__hit">' + esc(label.slice(i, i + w.length)) + '</mark>' + esc(label.slice(i + w.length));
}
/** the list's markup alone: a screen draws it again as the query changes (the field keeps its caret) */
export function commandPaletteList(o: CommandPaletteListOpts): string {
  const active = o.active ?? 0;
  let n = 0;
  const body = o.groups.filter((g) => g.rows.length).map((g) => '<div class="k7-cpal__head" role="presentation"' + attrs({ 'data-key': 'g-' + g.label }) + '>' + esc(g.label) + '</div>' + g.rows.map((r) => {
    const i = n++;
    return '<div class="k7-cpal__row"' + partAttrs('CommandPaletteRow', { role: 'option', id: o.id + '-' + i, 'data-i': String(i), 'data-value': r.value, 'aria-selected': String(i === active), 'data-key': 'r-' + r.value, ...(r.attrs ?? {}) }) + '>' +
      '<span class="k7-cpal__lead" aria-hidden="true">' + (r.leadHTML ?? glyph(r.icon)) + '</span>' +
      '<span class="k7-cpal__label">' + marked(r.label, o.query ?? '') + '</span>' +
      (r.meta ? ' <span class="k7-cpal__meta">' + esc(r.meta) + '</span>' : '') +
      (r.trail ? ' ' + statusWord({ text: r.trail, tone: r.attn ? 'owe' : 'neutral' }) : '') +
      (r.keys ? kbd({ keys: r.keys }) : '') + '</div>';
  }).join('')).join('');
  return n ? body : '<p class="k7-cpal__empty" role="status" data-key="empty">' + esc(o.empty ?? 'Nothing matches.') + '</p>';
}
export function commandPalette(o: CommandPaletteOpts): string {
  const rows = o.groups.reduce((a, g) => a + g.rows.length, 0);
  const list = rows ? { role: 'listbox', 'aria-label': 'Results' } : {};
  return '<div class="k7-cpal"' + kitAttrs('CommandPalette', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.label, 'data-sq': '', 'data-sq-mode': 'surface', ...(o.attrs ?? {}) }) + '>' +
    field({ id: o.id + '-input', kind: 'search', ariaLabel: o.label, placeholder: o.placeholder, value: o.value, keys: 'esc',
      attrs: { role: 'combobox', 'aria-expanded': 'true', 'aria-controls': o.id + '-list', 'aria-autocomplete': 'list', 'aria-activedescendant': rows ? o.id + '-' + String(o.active ?? 0) : null, autocomplete: 'off', spellcheck: 'false' } }) +
    '<div class="k7-cpal__list"' + attrs({ id: o.id + '-list', ...list }) + '>' + commandPaletteList(o) + '</div></div>';
}

/** what CommandPalette promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<CommandPaletteOpts>({
  name: 'CommandPalette',
  folder: 'command-palette',
  layer: 'surface',
  summary: 'mod+K\'s search over sessions, bots and commands: a search Field over one list of rows under group heads, the row the keys are on named by the field. `commandPaletteList` draws the rows again as the query changes.',
  exports: ['commandPalette', 'commandPaletteList'],
  props: {
    id: 'the ids its parts are named by (<id>-input, <id>-list, <id>-<n>)',
    groups: 'its groups, each a head and its rows (a value, a label, a meta word, a trail word, a glyph or lead, keys)',
    active: 'the row the keys are on, counted over every group',
    query: 'the words typed: the first is marked in a label',
    empty: 'the one line where no row matches',
    label: 'its accessible name',
    placeholder: 'the field\'s placeholder',
    value: 'what the field holds',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*)'
  },
  events: ['ui:select'],
  states: ['aria-selected (the row the keys are on)', 'aria-activedescendant (on the field)'],
  parts: ['CommandPaletteRow', 'k7-cpal__head', 'k7-cpal__list', 'k7-cpal__empty'],
  tokens: [
    '--bg-3', '--float-line', '--fs-s', '--fs-xs', '--gap-row', '--hl', '--hover', '--icon', '--icon-s', '--lh-s', '--lh-xs', '--pad-palette', '--pad-row-x',
    '--pad-row-y', '--palette-h', '--palette-w', '--r-card', '--r-floor', '--row-h', '--shadow-pop', '--sp-1', '--sp-2', '--sp-5', '--text', '--text-dim',
    '--current', '--accent-text', '--track-s'
  ],
  a11y: 'A modal dialog named by its label; the field is a combobox over the listbox. Up and Down (or Tab and Shift+Tab) move the row the keys are on, Enter chooses it (ui:select, cancelable), a press on a row chooses it; Esc is the screen\'s to close it. Nothing matching is one status line.',
  boards: []
});
