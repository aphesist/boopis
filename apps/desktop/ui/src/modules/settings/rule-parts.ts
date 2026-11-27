/* The parts of a rules list, one set for Settings › Approvals (the rules for every bot) and a bot sheet's Approvals (that bot's own), in
   board O-B07's look on the kit: a rule is a settings Card's row led by its Switch, its words, where it came from as a quiet word at its
   end, and Edit and Remove under the pointer or the focus; an opened rule is a Block under its card with its words in a Field; a draft
   from "Always allow" is a Block with its words in a Field, "Save rule" and Discard. Nothing here keeps state: the page or the sheet says
   which rule is open and draws again. */
import { kit } from '@boopis/ui';
import type { RowOpts } from '@boopis/ui';
import type { Rule, RulesView } from '../../data';
import { actionsHTML, buttonHTML, esc } from './rows';

/** where a rule came from, as the quiet word at its row's end */
export const SOURCE_WORDS: Readonly<Record<Rule['source'], string>> = { default: 'default', owner: 'yours', card: 'from a card', chat: 'from a chat' };
/** the kinds of action a rule is checked against, in words ("What this catches") */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  reads: 'reading files', writes: 'writing files', commands: 'running commands', code: 'running code', network: 'network requests', connector_write: 'changes through a connector',
  messages: 'sending messages', spend: 'spending money', browser: 'driving a browser', computer: 'using the computer', delegation: 'handing work to another bot', unknown: 'anything it cannot place'
};
export function catches(kinds: readonly string[]): string {
  const words = kinds.map((k) => KIND_WORDS[k] ?? k);
  if (!words.length) return 'The reviewer has not read what this catches yet.';
  return 'Checked when a bot is ' + (words.length === 1 ? words[0] : words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1]) + '.';
}
export const isDraft = (r: Rule): boolean => r.type === 'exception' && r.state === 'draft';
/** a rule for every bot: it names none */
export const everyBot = (r: Rule): boolean => !r.bots || !r.bots.length;
/** a rule of this bot's own: it names the bot (by its id or its name) */
export const ofBot = (r: Rule, b: { id: string; name: string }): boolean => !!r.bots && r.bots.some((n) => n === b.id || n === b.name);
/** the quiet word of a rule from the rules list */
export const originWord = (r: Rule): string => (r.edited ? 'edited default' : SOURCE_WORDS[r.source]);

export interface RuleRowOpts {
  /** the key the row's controls carry (a rule's id; a bot's kind of action is `tier:<kind>`) */
  key: string;
  text: string;
  enabled: boolean;
  /** the quiet word at its end; none for a row that came from nowhere in particular */
  origin?: string;
  /** a second line (what it is checked against, for whom) */
  sub?: string;
  /** opened under its card */
  open?: boolean;
  /** a row whose switch cannot be turned (what it says is fixed) */
  locked?: boolean;
}
/** a rule's row: its Switch first, its words, its quiet word, Edit and Remove under the pointer or the focus */
export const ruleRow = (o: RuleRowOpts): RowOpts => ({
  label: o.text, wrap: true,
  leadHTML: kit.html.switch({ checked: o.enabled, label: o.text, disabled: !!o.locked, attrs: { 'data-rule-switch': o.key } }),
  ...(o.sub ? { sub: o.sub } : {}),
  control: (o.origin ? '<span class="k7-row__value">' + esc(o.origin) + '</span>' : '') +
    '<span class="hx-set__hover">' + kit.html.iconButton({ icon: 'pen', label: 'Edit: ' + o.text, variant: 'ghost', expanded: !!o.open, attrs: { 'data-rule-edit': o.key } }) +
    kit.html.iconButton({ icon: 'close', label: 'Remove: ' + o.text, variant: 'ghost', attrs: { 'data-rule-remove': o.key } }) + '</span>',
  attrs: { 'data-rule': o.key, ...(o.open ? { 'data-open': '' } : {}) }
});

/** a rule opened to edit, or a new one: its words in a Field (what it catches under them), then what else it asks (`extra`, a kit
    control in a Field), Save, Cancel and Remove */
export function ruleEditor(o: { key: string; text?: string; label?: string; hint: string; extra?: string; removable?: boolean; wordsFixed?: boolean }): string {
  const words = o.wordsFixed
    ? '<p class="k7-page__note">' + esc(o.text ?? '') + '</p>'
    : kit.html.field({ id: 'hx-rule-text-' + o.key.replace(/[^\w-]/g, '-'), label: o.label ?? (o.text === undefined ? 'A new rule' : 'The rule'), value: o.text ?? '', placeholder: 'Ask before …', hint: o.hint, attrs: { maxlength: '200', 'data-rule-input': '' } });
  return kit.html.block({ attrs: { 'data-rule-editor': o.key }, body: words + (o.extra ?? '') +
    actionsHTML(buttonHTML('Save', { variant: 'primary', attrs: { 'data-rule-save': o.key } }), buttonHTML('Cancel', { variant: 'ghost', attrs: { 'data-rule-cancel': '' } }), o.removable ? buttonHTML('Remove', { variant: 'ghost', attrs: { 'data-rule-remove': o.key } }) : '') });
}

/** a draft from "Always allow": its words in a Field to finish, what it lets through, then "Save rule" (it becomes active) and Discard */
export function draftBlock(r: Rule, view: RulesView | null, o: { forWhom?: boolean } = {}): string {
  const excepts = (r.excepts ?? []).map((id) => view?.rules.find((x) => x.id === id)?.text ?? id);
  const who = o.forWhom !== false && r.bots && r.bots.length ? 'For ' + r.bots.join(', ') : '';
  return kit.html.block({ attrs: { 'data-draft': r.id }, body:
    kit.html.field({ id: 'hx-draft-' + r.id, label: 'Always allow', value: r.text, hint: [who, excepts.length ? 'Lets through: ' + excepts.join('; ') : '', (r.match ?? []).length ? 'Only: ' + (r.match ?? []).join(', ') : ''].filter(Boolean).join('. ') || 'An exception kept from “Always allow”. It does nothing until you save it.', attrs: { maxlength: '200', 'data-draft-input': '' } }) +
    actionsHTML(buttonHTML('Save rule', { variant: 'primary', attrs: { 'data-draft-save': r.id } }), buttonHTML('Discard', { variant: 'ghost', attrs: { 'data-draft-discard': r.id } })) });
}

/** a card of rule rows under its head, with the opened one's editor under it */
export function rulesCard(o: { title: string; rows: readonly RuleRowOpts[]; part: string; count?: string; editor?: string }): string {
  if (!o.rows.length) return '';
  return '<div class="k7-section" data-part="' + esc(o.part) + '">' + kit.html.sectionHead({ title: o.title, ...(o.count ? { count: o.count } : {}) }) +
    kit.html.card({ variant: 'settings', rows: o.rows.map(ruleRow), attrs: { 'data-mark-reveal': 'hover' } }) + (o.editor ?? '') + '</div>';
}

/** what can still be said of a rule a change was refused for */
export const ruleLimit = (text: string): string | null => (!text ? 'Write the rule first' : text.length > 200 ? 'A rule is one line of at most 200 characters' : null);

/** The protections built in, whatever a rules list says (docs/specs/host-protections.md; policy/bot_tiers.json `never_allow`): no bot may
    answer an approval meant for you, change these rules or read boopis's own keys, and paying with a saved card always asks */
export const BUILT_IN = 'Some protections are built in and hold whatever this list says: no bot may answer an approval for you, change these rules or read boopis’s own keys, and paying with a saved card always asks.';
