/* Field: its view (typed props to markup) and its contract. Its look is field.css, its stories and tests stand beside it
   (docs/kit/RULES.md). */
import { button } from '../button/button';
import { kbd } from '../kbd/kbd';
import { attrs, cls, esc, glyph, kitAttrs } from '../util';
import type { Attrs, U } from '../util';
import { defineContract } from '../contract';

/* ── Field (26): text, search (a pill), multi-line ── */
export const FIELD_KINDS = ['text', 'search', 'multiline'] as const;
export type FieldKind = typeof FIELD_KINDS[number];
export interface FieldOpts { id: string; kind?: U<FieldKind>; label?: U<string>; optional?: U<boolean>; value?: U<string>; placeholder?: U<string>; error?: U<string>; disabled?: U<boolean>; keys?: U<string>; mono?: U<boolean>; rows?: U<number>; /** the accessible name where no label shows */ ariaLabel?: U<string>; attrs?: U<Attrs>;
  /** a secret (a key, a token): typed unseen, with Show and Hide at the box's end (6d, derived: a form's credential) */ secret?: U<boolean>;
  /** what the field is for, in one quiet line under it (6d, derived: a form field's description) */ hint?: U<string>;
  /** a Field whose control is another kit part (OptionRows, a Segmented, a SelectorItem, a Switch, Swatches), as markup: the Field keeps its
      label (named `<id>-label`, for the control's aria-labelledby), its hint and its error line (6d) */ control?: U<string>;
  /** the label and the control on one line (a Switch) */ inline?: U<boolean>;
  /** a single-line field's kind of text, for the platform's keyboard and checks */ inputType?: U<'email' | 'url'> }
export function field(o: FieldOpts): string {
  const k = o.kind ?? 'text', err = o.error ? o.id + '-err' : null, hint = o.hint ? o.id + '-hint' : null;
  const common = attrs({ id: o.id, placeholder: o.placeholder, disabled: !!o.disabled, 'aria-invalid': o.error ? 'true' : null, 'aria-describedby': [hint, err].filter(Boolean).join(' ') || null, 'aria-label': o.label ? null : o.ariaLabel ?? o.placeholder, ...(o.secret ? { autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' } : {}), ...(o.attrs ?? {}) });
  const control = k === 'multiline'
    ? '<textarea class="' + cls('k7-field__input', o.mono && 'k7-mono') + '" rows="' + (o.rows ?? 3) + '"' + common + '>' + esc(o.value ?? '') + '</textarea>'
    : '<input class="' + cls('k7-field__input', (o.mono || o.secret) && 'k7-mono') + '" type="' + (o.secret ? 'password' : k === 'search' ? 'search' : o.inputType ?? 'text') + '"' + attrs({ value: o.value }) + common + '>';
  /* a secret's Show and Hide: a ghost Button at the box's end, pressed while the secret shows */
  const reveal = o.secret ? button({ label: 'Show', variant: 'ghost', size: 28, attrs: { 'data-reveal': '', 'aria-pressed': 'false', 'aria-controls': o.id, 'aria-label': 'Show ' + (o.label ?? 'the secret').toLowerCase() } }) : '';
  const box = '<span class="k7-field__box"' + attrs({ 'data-kind': k, 'data-secret': o.secret ? '' : null }) + '>' + (k === 'search' ? glyph('search', 'k7-field__glyph') : '') + control + reveal + (o.keys ? kbd({ keys: o.keys, inPill: k === 'search' }) : '') + '</span>';
  const opt = o.optional ? ' <span class="k7-field__opt">(Optional)</span>' : '';
  const label = o.control != null
    ? (o.label ? '<span class="k7-field__label" id="' + esc(o.id) + '-label">' + esc(o.label) + opt + '</span>' : '')
    : (o.label ? '<label class="k7-field__label" for="' + esc(o.id) + '">' + esc(o.label) + opt + '</label>' : '');
  return '<div class="k7-field"' + kitAttrs('Field', { 'data-kind': o.control != null ? 'control' : k, 'data-inline': o.inline ? '' : null, 'data-error': o.error ? '' : null, 'data-disabled': o.disabled ? '' : null }) + '>' +
    (o.inline ? '<span class="k7-field__line">' + label + (o.control ?? '') + '</span>' : label + (o.control ?? box)) + (o.hint ? '<p class="k7-field__hint" id="' + hint + '">' + esc(o.hint) + '</p>' : '') + (o.error ? '<p class="k7-field__error" id="' + err + '">' + esc(o.error) + '</p>' : '') + '</div>';
}

/** what Field promises: read by the docs (pnpm kit:docs) and checked by contract.test.ts */
export const contract = defineContract<FieldOpts>({
  name: 'Field',
  folder: 'field',
  layer: 'row',
  summary: 'A labelled text field: text, search (a pill) or several lines, with an optional hint and error line. It can also frame another control (OptionRows, a Segmented, a Switch) with its label, hint and error.',
  exports: ['field'],
  props: {
    id: 'the control\'s id (the label\'s `for`)',
    kind: 'text (the default), search or multiline',
    label: 'its visible label',
    optional: '"(Optional)" after the label',
    value: 'its value',
    placeholder: 'the words while empty',
    error: 'what is wrong, in its error line (aria-invalid)',
    disabled: 'it cannot be changed now',
    keys: 'the keys that do the same, shown in its tooltip, at the box\'s end',
    mono: 'the value in mono',
    rows: 'multiline: how many lines it shows',
    ariaLabel: 'the accessible name where no label shows',
    attrs: 'extra attributes on its root: the app\'s handles (an id, data-*, aria-*) on the control',
    secret: 'a key or a token: typed unseen, with Show and Hide at its end',
    hint: 'what it is for, in one quiet line under it',
    control: 'another kit control as markup, framed by the label, hint and error',
    inline: 'the label and the control on one line (a Switch)',
    inputType: 'email or url: the kind of text, for the platform\'s keyboard'
  },
  events: [],
  states: ['data-kind', 'data-error', 'aria-invalid', 'data-disabled', 'data-secret', 'aria-pressed (Show)'],
  parts: ['k7-field__box', 'k7-field__label', 'k7-field__hint', 'k7-field__error'],
  tokens: [
    '--ctl', '--ctl-s', '--dur-1', '--dur-out', '--ease-out', '--fill-2', '--focus', '--focus-off', '--focus-w', '--fs-s',
    '--fs-xs', '--gap-label', '--gap-s', '--hl', '--icon-quiet', '--icon-s', '--lh-s', '--lh-xs', '--line', '--line-field', '--mono',
    '--pad-field', '--pad-field-y', '--r-field', '--r-floor', '--r-pill', '--red', '--red-text', '--sp-1', '--sp-2', '--text',
    '--text-dim', '--text-faint', '--text-quiet', '--track', '--track-s'
  ],
  a11y: 'A native input or textarea with a <label>; the hint and error are joined to it by aria-describedby. A secret\'s Show is a pressed toggle that names what it shows.',
  boards: []
});
