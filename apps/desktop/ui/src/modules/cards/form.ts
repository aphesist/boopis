/* The form card on the kit (REPASS.md step 6d; docs/FORMS.md). A form is the AskCard's own block (boards 11 and K04): the asker and
   "<asker> asks" with the StatusWord at the head's end, the ask, its why, what it asks for (the kit's Field, OptionRows, Segmented,
   SelectorItem, Switch, Swatches, a Well, a DiffView, the card of steps), what submitting does, and the answers as the AskCard's: the
   form's own verb first (the hold where it writes or approves), "Later" when it can wait, Cancel (Deny for a permission) at the end
   with esc. A question with options is S23's chips (up to three short ones) or K02-11's lettered rows. Done, put off, expired and
   cancelled are the answered one-row receipt with a quiet StatusWord. A kind is a template (form-model.ts), never a new component.
   Keys (KEYMAP section 6): Tab and Shift+Tab move between fields; Enter submits from a single-line field or an option (a hold form
   asks for the hold); mod+Enter submits from long text; Esc cancels (Deny for a permission); 1-9 pick an option when focus is not in
   a text field.
   Secrets: a secret field's value lives in `FormState.sec` only until the submit hands it to the host through the data seam
   (`formsHost().submit`), then it is dropped; it is never in an event, a receipt, the markup of a finished card or a log. Accessible
   errors: every error is the kit Field's error line under its field, the control is `aria-invalid` and described by it, the first one
   is announced and focused. */
import { kit, ui } from '@boopis/ui';
import type { OptionRowOpts, AskAnswer, AskCardOpts } from '@boopis/ui';

type MenuEntry = Parameters<typeof kit.openMenu>[1]['entries'][number];
import { data as provider } from '../../data';
import type { FieldSchema, FormSpec, PickerKind } from '../../data';
import { later } from '../chat/compose';
import { formsHost } from './forms-host';
import type { HxCard } from './card';
import { bot, cap, originOf } from './parts';
import type { KnownOrigin } from './parts';
import { FORM_KINDS, PERMISSION, answerText, formT, hasCancel, holdForm, isLocalForm, isReq, optLabel, props, receiptText, validateForm, valuesOf } from './form-model';
import type { FieldError, Values } from './form-model';
import type { Ctx, Data, Kind } from './types';

const H = kit.html;
export { FORM_KINDS };
export const LIVE_FORM: readonly string[] = ['open', 'invalid', 'holding'];
const DONE_FORM: readonly string[] = ['done', 'deferred', 'expired', 'cancelled'];
const spec = (d: Data): FormSpec => d as unknown as FormSpec;
/** a form's words are plain text in the kit's block: a sender's `code` marks are dropped, the words kept */
const plain = (s: unknown): string => String(s ?? '').replace(/`/g, '');

/** a form card's own state: what the user typed, kept out of the DOM and out of every event */
export interface FormState { vals: Values; sec: Record<string, string>; signedIn: Set<string>; error: string; other: Record<string, boolean> }
export const newFormState = (): FormState => ({ vals: {}, sec: {}, signedIn: new Set(), error: '', other: {} });
const fst = (card: HxCard): FormState => card.formState as FormState;
const teammateName = (id: string): string | null => bot(id)?.name ?? null;

/* ───────── who asks (the head's lead and its words) ───────── */
/** the asker's 16 px mark: a bot's orb; the session agent's model mark; up to three orbs and the rail's "+N" chip; a connector's tile;
    a mod's glyph; the boopis mark for the app; nothing when nobody is named */
function askerLead(o: KnownOrigin | null): Pick<AskCardOpts, 'bot' | 'model' | 'lead'> {
  if (!o) return { lead: '' };
  if (o.kind === 'teammate') {
    const bots = o.ids.map((id) => bot(id) ?? { id, name: id });
    if (bots.length === 1 && bots[0]) return { bot: bots[0] };
    const shown = bots.slice(0, 3), more = bots.length - shown.length;
    return { lead: '<span class="k7-ask__askers">' + H.avatar({ variant: 'stack', members: shown, size: 16, max: 3, surface: '--bg-3', label: o.ids.map((id) => teammateName(id) ?? id).join(', ') }) + (more ? '<span class="k7-ask__more" aria-hidden="true" data-more="+' + more + '"></span>' : '') + '</span>' };
  }
  if (o.kind === 'agent') return { model: o.model };
  if (o.kind === 'mcp') return { lead: '<span class="k7-ask__tile" aria-hidden="true">' + ui.esc(String(o.server || '?').slice(0, 1).toUpperCase()) + '</span>' };
  if (o.kind === 'mod') return { lead: ui.icon('mod', { size: 'm', class: 'k7-ic' }) };
  return { lead: H.avatar({ variant: 'logomark', label: 'boopis' }) };
}
/** who asks, as one word for the block (`data-origin`): teammate, joint (several), relay, agent, mcp, mod, or the app's own */
const originWord = (o: KnownOrigin | null): string | null => (!o ? null : o.kind === 'teammate' ? (o.ids.length > 1 ? 'joint' : o.via ? 'relay' : 'teammate') : o.kind);
function askerWords(o: KnownOrigin | null): string {
  if (!o) return 'Needs your answer';
  if (o.kind === 'teammate') {
    const n = o.ids.map((id) => teammateName(id) ?? id);
    const who = n.length === 1 ? n[0] + ' asks' : n.length === 2 ? n[0] + ' and ' + n[1] + ' ask' : n[0] + ' and ' + (n.length - 1) + ' others ask';
    return who + (o.via ? ', via ' + (teammateName(o.via) ?? o.via) : '');
  }
  if (o.kind === 'agent') return 'asked during the turn';
  if (o.kind === 'mcp') return (o.server || 'A connector') + ' asks';
  if (o.kind === 'mod') return o.plugin + ' mod asks';
  return 'boopis asks';
}

/* ───────── what a form is drawn as ───────── */
/** a question with options (conflict 5, decided at 6d): one single choice and nothing else. Up to three short options are S23's chips,
    more (or a long one) K02-11's lettered rows; "Something else" is there when the asker takes your own words (`x-other`) */
export function questionShape(d: Pick<FormSpec, 'kind' | 'schema'>): 'chips' | 'letters' | null {
  const ps = props(d);
  const only = ps.length === 1 ? ps[0]?.[1] : undefined;
  if (d.kind !== 'question' || !only?.enum || only['x-multi'] || only['x-preview'] || only['x-picker']) return null;
  const labels = only.enum.map((v) => optLabel(only, v));
  return labels.length <= 3 && labels.every((l) => l.length <= 24) ? 'chips' : 'letters';
}
const HEX = /^#[0-9a-f]{3,8}$/i;
const isModelChoice = (p: FieldSchema): boolean => !!p.enum && !p['x-multi'] && !p['x-other'] && !p['x-preview'] && /^models?$/i.test((p.title ?? '').trim());
/** a few short words to choose one of: the kit's Segmented (a feedback's "Right, Partly right, Wrong") */
const isSegmented = (p: FieldSchema): boolean => !!p.enum && !p['x-multi'] && !p['x-other'] && !p['x-preview'] && p.enum.length >= 2 && p.enum.length <= 3 && p.enum.every((v) => optLabel(p, v).length <= 14);
const PICK_ICON: Readonly<Record<string, string>> = { folder: 'folder', file: 'file', branch: 'fork', repo: 'fork', host: 'at', teammate: 'bots' };
function pickLead(kind: PickerKind, v: unknown): string {
  const b = kind === 'teammate' && v ? bot(String(v)) : undefined;
  if (b) return H.avatar({ bot: b, size: 16, still: true });
  if (kind === 'model' && v) return ui.html.modelMark(String(v), { size: 16, label: false });
  return ui.icon(PICK_ICON[kind] ?? 'more', { size: 'm', class: 'k7-ic' });
}
const pickShown = (kind: PickerKind, v: unknown): string => (kind === 'teammate' && v ? teammateName(String(v)) ?? String(v) : v ? String(v) : 'Choose…');

/* ───────── fields ───────── */
function fieldHTML(c: Ctx, st: FormState, name: string, p: FieldSchema): string {
  const d = spec(c.d), id = c.id + '-f-' + name, req = isReq(d, name), label = p.title || cap(name);
  const base = { id, label, optional: !req, ...(p.description ? { hint: p.description } : {}) };
  const wrap = (inner: string): string => '<div data-field="' + ui.esc(name) + '">' + inner + '</div>';
  const can = formsHost().can;
  if (p['x-secret']) return wrap(H.field({ ...base, secret: true, placeholder: p.placeholder, attrs: { 'data-secret': name, 'aria-required': req ? 'true' : null } }));
  if (p['x-signin']) {
    const s = p['x-signin'];
    /* a command or arguments in the field are never run, and a provider the host's table does not have is not a sign-in boopis knows:
       its Sign in stays drawn and says why it does nothing. Where the source checks its table (`login`) a known one shows the line it runs */
    const known: { known: boolean; line?: string } = s.command !== undefined || s.args !== undefined ? { known: false } : s.server ? { known: true } : formsHost().login ? formsHost().login?.(s) ?? { known: false } : { known: true };
    const note = !can.signin ? 'Signing in from here is not available in this build yet.' : !known.known ? 'This sign-in is not one boopis knows.' : known.line ? 'Runs ' + known.line + ' on this computer, then shows what it said.' : s.flow === 'device' ? 'Shows a code to enter on ' + (s.host || 'the provider’s site') + '.' : 'Opens ' + (s.host || s.provider || 'the provider') + ' in your browser.';
    const who = s.provider || 'the provider';
    return wrap('<div class="k7-ask__item" data-signin-row data-known="' + String(can.signin && known.known) + '" data-note="' + ui.esc(note) + '"><span class="k7-ask__tile" aria-hidden="true">' + ui.esc(who.slice(0, 2)) + '</span><span class="k7-ask__item-text"><span class="k7-ask__item-name">' + ui.esc(cap(who)) + '</span><span class="k7-ask__item-line" id="' + id + '-note">' + ui.esc(note) + '</span></span></div>');
  }
  if (p['x-picker'] || isModelChoice(p)) {
    const kind: PickerKind = p['x-picker'] ?? 'model', v = st.vals[name] ?? p.default;
    return wrap(H.field({ ...base, control: H.selectorItem({ variant: 'field', value: pickShown(kind, v), leadHTML: pickLead(kind, v), mono: kind !== 'teammate', attrs: { id, 'data-picker': kind, 'data-name': name, 'aria-labelledby': id + '-label ' + id, 'aria-haspopup': kind === 'folder' && can.folder ? 'dialog' : 'menu' } }) }));
  }
  if (p['x-upload']) {
    const files = (st.vals[name] as Array<{ name: string }> | undefined) ?? [];
    const chips = files.map((f, i) => H.inlineChip({ kind: 'reference', text: f.name, action: true, label: 'Remove ' + f.name, attrs: { 'data-remove-file': String(i) } })).join('');
    const add = H.button({ label: 'Add files', variant: 'ghost', size: 28, icon: 'plus', disabled: !can.upload, attrs: { 'data-add-file': '', ...(can.upload ? {} : { 'data-tip': 'Adding files is not available in this build yet' }) } });
    return wrap(H.field({ ...base, control: '<div class="k7-ask__files" role="group" data-drop="' + ui.esc(name) + '" aria-labelledby="' + id + '-label">' + chips + add + '<input type="file" multiple hidden tabindex="-1" aria-hidden="true"></div>' }));
  }
  if (p.enum && p.enum.length && p.enum.every((v) => typeof v === 'string' && HEX.test(v)) && !p['x-multi']) {
    return wrap(H.field({ ...base, control: H.swatches({ label, choose: true, items: p.enum.map((v) => ({ label: optLabel(p, v), hex: String(v), value: String(v) })), value: String(st.vals[name] ?? p.default ?? ''), attrs: { 'data-group': name, 'aria-labelledby': id + '-label' } }) }));
  }
  if (p.enum && isSegmented(p)) {
    const v = String(st.vals[name] ?? p.default ?? '');
    return wrap(H.field({ ...base, control: H.segmented({ label, value: v, items: p.enum.map((x) => ({ value: String(x), label: optLabel(p, x) })), attrs: { 'data-group': name, 'aria-labelledby': id + '-label' } }) }));
  }
  if (p.enum) {
    const multi = !!p['x-multi'], prev = p['x-preview'];
    const cur = st.vals[name] ?? p.default ?? (multi ? [] : null);
    const on = (v: unknown): boolean => (multi ? ((cur as unknown[] | null) ?? []).includes(v) : cur === v);
    const other = !!p['x-other'] && !multi, otherOn = other && (st.other[name] || (typeof cur === 'string' && cur !== '' && !p.enum.includes(cur)));
    const rows = p.enum.map((v, i) => H.optionRow({ label: optLabel(p, v), meaning: '', chosen: on(v) && !otherOn, check: multi, value: String(v), ...(i < 9 ? { keys: String(i + 1) } : {}), attrs: { role: multi ? 'checkbox' : 'radio', tabindex: multi || on(v) || (cur == null && i === 0) ? '0' : '-1', 'data-i': String(i) } })).join('') +
      (other ? H.optionRow({ label: 'Something else', meaning: '', chosen: otherOn, icon: 'pen', value: '', attrs: { role: 'radio', tabindex: otherOn ? '0' : '-1', 'data-other': '' } }) : '');
    const group = '<div class="k7-orows" role="' + (multi ? 'group' : 'radiogroup') + '" data-group="' + ui.esc(name) + '" aria-labelledby="' + id + '-label">' + rows + '</div>';
    const own = otherOn ? H.field({ id: id + '-own', placeholder: 'Your answer', ariaLabel: label + ': your own answer', value: typeof cur === 'string' && !p.enum.includes(cur) ? cur : '', attrs: { 'data-own': name } }) : '';
    /* the chosen answer's preview (code in K04's Well, or words) under the rows */
    const pv = prev ? previewHTML(p, multi ? null : cur) : '';
    return wrap(H.field({ ...base, label: label + (multi ? ', choose any' : ''), control: group + own + (prev ? '<div aria-live="polite" data-preview-for="' + ui.esc(name) + '">' + pv + '</div>' : '') }));
  }
  if (p.type === 'boolean') {
    const v = st.vals[name] != null ? !!st.vals[name] : !!p.default;
    return wrap(H.field({ ...base, optional: false, inline: true, control: H.switch({ checked: v, labelledby: id + '-label', id, attrs: { 'data-switch': name } }) }));
  }
  const num = p.type === 'number' || p.type === 'integer';
  const v = st.vals[name] ?? (p.default != null ? p.default : '');
  /* a number is typed in a text field (validated as a number by form-model): the platform's number field grows spin buttons */
  return wrap(H.field({ ...base, kind: p['x-multiline'] ? 'multiline' : 'text', value: String(v), placeholder: p.placeholder, mono: num || !!p['x-mono'], attrs: { 'data-name': name, autocomplete: 'off', 'aria-required': req ? 'true' : null, inputmode: num ? (p.type === 'integer' && (p.minimum ?? -1) >= 0 ? 'numeric' : 'decimal') : null }, ...(p.format === 'email' ? { inputType: 'email' as const } : p.format === 'uri' ? { inputType: 'url' as const } : {}) }));
}
function previewHTML(p: FieldSchema, v: unknown): string {
  const i = (p.enum ?? []).indexOf(v), x = i >= 0 ? p['x-preview']?.[i] : null;
  if (!x) return '<p class="k7-field__hint">' + (v ? 'No preview for this answer.' : 'Pick an answer to preview it.') + '</p>';
  return (x.code != null ? H.well({ text: x.code, label: 'Preview' }) : '<p class="k7-field__hint">' + ui.esc(x.text ?? '') + '</p>') + (x.note ? '<p class="k7-field__hint">' + ui.esc(x.note) + '</p>' : '');
}

/** what the form shows before its fields: a setup's config change (the kit's DiffView in a Well), a plan (board 17's card of steps,
    not started), a connector (O-B06's block: its tile, its name, what it can reach), a theme's colours (P1's swatches) */
function extrasHTML(d: FormSpec): string {
  let h = '';
  if (d.diff) {
    const lines = String(d.diff).split('\n').map((l) => ({ sign: (l[0] === '+' ? '+' : l[0] === '-' ? '-' : ' ') as '+' | '-' | ' ', text: l.slice(1) }));
    h += '<div class="k7-well" data-kit="Well" data-kind="diff" data-sq data-sq-mode="frame">' + H.diffView({ path: d.file || 'config', lines, body: 'group' }) + '</div>';
  }
  if (d.plan) h += H.steps(d.plan.map((t) => ({ text: plain(t), state: 'todo' as const })));
  if (d.contents && d.kind !== 'connector') {
    /* what to run or what it is, line by line (first run's "Install it", "Sign in"): K04's Well */
    h += H.well({ text: d.contents.map((x) => plain(x[1] ? x[0] + '  ' + x[1] : x[0])).join('\n') + (d.pinned ? '\nPinned  ' + d.pinned : ''), label: cap(d.title) });
  } else if (d.kind === 'connector') {
    const reach = plain((d.contents ?? []).map((x) => (x[1] ? x[0] + ': ' + x[1] : x[0])).join('. '));
    const name = d.name || cap(d.title);
    h += '<div class="k7-ask__item"><span class="k7-ask__tile" aria-hidden="true">' + ui.esc(name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?') + '</span><span class="k7-ask__item-text"><span class="k7-ask__item-name">' + ui.esc(name) + '</span>' +
      (reach ? '<span class="k7-ask__item-line">' + ui.esc(reach) + '</span>' : '') + (d.pinned ? '<span class="k7-ask__item-line k7-mono">Pinned ' + ui.esc(d.pinned) + '</span>' : '') + '</span></div>';
  }
  if (d.swatches?.length) h += H.swatches({ label: 'Colours', items: d.swatches.map((x) => ({ label: x[0], hex: x[1] })) });
  return h;
}

/* ───────── the answers ───────── */
const submitWord = (d: FormSpec, st: FormState): string => {
  if (d.submit?.label) return d.submit.label;
  if (d.kind === 'credential') return 'Save key';
  if (d.kind === 'connector') return 'Add ' + (d.name || 'it').split(' ')[0];
  if (d.kind === 'plan') return 'Approve plan';
  if (d.kind === 'setup') return 'Apply';
  if (d.kind === 'permission') return (PERMISSION[String(st.vals['scope'] ?? 'once')] ?? PERMISSION['once'])?.[0] ?? 'Allow once';
  return formT(d).submit || 'Send';
};
/** "Hold to approve plan": the hold's words say what holding does */
const holdWords = (w: string): string => (/^hold to /i.test(w) ? w : 'Hold to ' + w.charAt(0).toLowerCase() + w.slice(1));
function answersOf(d: FormSpec, st: FormState): AskAnswer[] {
  if (d.kind === 'permission') {
    /* exactly the AskCard's approval (board 11): the hold allows once; the standing answers are hidden until approval rules exist */
    const rules = later('approval-rules');
    return [{ label: 'Hold to allow once', primary: true, hold: true, action: 'submit', value: 'once' }, { label: 'Allow this session', action: 'scope', value: 'session' },
      ...(rules ? [{ label: 'Always allow', action: 'scope', value: 'always' }] : []), { label: 'Deny', action: 'scope', value: 'deny', keys: 'esc', outline: true, end: true }];
  }
  const out: AskAnswer[] = [];
  const w = submitWord(d, st);
  if (d.kind === 'signin') {
    const row = props(d).find(([, p]) => p['x-signin']);
    if (row) out.push({ label: 'Sign in', primary: true, action: 'signin', value: row[0] });
  } else out.push(holdForm(d) ? { label: holdWords(w), primary: true, hold: true, action: 'submit' } : { label: w, primary: true, action: 'submit' });
  if (d.kind === 'plan') out.push({ label: 'Change it', action: 'change' });
  if (d.defer !== false) out.push({ label: 'Later', action: 'defer' });
  if (hasCancel(d)) out.push({ label: (typeof d.cancel === 'object' && d.cancel?.label) || formT(d).cancel || 'Cancel', action: 'cancel', keys: 'esc', outline: true, end: true });
  return out;
}

/* ───────── the receipts ───────── */
/** an ended form's one row: what was done, or the form's ask, and its quiet word */
function rowOf(c: Ctx): { text: string; word: string } {
  const d = spec(c.d), t = formT(d);
  if (c.s === 'done') return { text: String(c.d['receiptText'] || c.d['receipt'] || receiptText(d, '', '')), word: 'done' };
  if (c.s === 'deferred') return { text: plain(c.d['deferredText'] || cap(d.title)), word: 'later' };
  if (c.s === 'expired') return { text: plain(cap(d.title)), word: 'expired' };
  return { text: plain(c.d['cancelledText'] || cap(d.title)), word: String(t.cancelled ?? 'Cancelled').toLowerCase() };
}

/* ───────── the kind ───────── */
export const formKind: Kind = {
  states: ['open', 'invalid', 'holding', 'submitting', 'done', 'deferred', 'expired', 'cancelled'],
  initial: 'open',
  quiet: { 'open>holding': 1, 'holding>open': 1, 'open>invalid': 1, 'invalid>open': 1, 'invalid>holding': 1, 'holding>invalid': 1 },
  tone: (c) => (LIVE_FORM.includes(c.s) ? (formT(spec(c.d ?? { kind: 'question' } as unknown as Data)).stamp ? 'red' : 'none') : c.s === 'submitting' ? 'pulse' : c.s === 'done' ? 'ink' : 'ring'),
  stamp: (c) => formT(spec(c.d)).stamp || 'needs you',
  resolved: (c) => ['done', 'expired', 'cancelled'].includes(c.s),
  say: (c) => ({ done: 'Done: ', deferred: 'Later: ', expired: 'Expired: ', cancelled: 'Cancelled: ', submitting: '', open: 'Open: ', invalid: '', holding: '' } as Record<string, string>)[c.s] + c.plain + (c.s === 'done' && c.d['receiptText'] ? (/[.?!]$/.test(c.plain) ? ' ' : '. ') + String(c.d['receiptText']) : ''),
  text: (c) => { const o = originOf(c.d); const w = o ? askerWords(o).replace(/ asks?$| ask$/, '') : ''; return (o && o.kind !== 'agent' ? cap(w) + ': ' : '') + cap(c.d.title); },
  render(c) { return { head: '', body: '', foot: '', whole: formHTML(c) }; },
  mini(c) {
    const d = spec(c.d), live = LIVE_FORM.includes(c.s) || c.s === 'submitting', o = originOf(c.d);
    if (live) return H.askCard({ variant: 'form', state: 'answered', ask: plain(cap(d.title)), word: formT(d).stamp ? { text: 'needs you', tone: 'owe' } : { text: 'open' }, ...askerLead(o), attrs: { 'data-form-row': '' } });
    const r = rowOf(c);
    return H.askCard({ variant: 'form', state: 'answered', ask: r.text, word: { text: r.word }, ...askerLead(o), attrs: { 'data-form-row': '' } });
  },
  act(card, a, x) {
    if (a === 'submit') void submitForm(card, false);
    else if (a === 'approve') void submitForm(card, true);
    else if (a === 'cancel') cancelForm(card);
    else if (a === 'defer') { dropSecrets(card); card.setState('deferred'); }
    else if (a === 'reopen') { if (card.state === 'expired') card.rearmExpiry(); card.setState('open'); }
    else if (a === 'signin') void signin(card, x.value ?? x.el?.dataset['value'] ?? '');
    else if (a === 'scope') { fst(card).vals['scope'] = x.value ?? x.el?.dataset['value'] ?? 'once'; void submitForm(card, true); }
    else if (a === 'change') changePlan(card);
  }
};

function formHTML(c: Ctx): string {
  const d = spec(c.d), st = fst(c.card), o = originOf(c.d), lead = askerLead(o);
  if (DONE_FORM.includes(c.s)) {
    const r = rowOf(c);
    const act = c.s === 'deferred' ? H.button({ label: 'Open', variant: 'ghost', size: 28, attrs: { 'data-action': 'reopen' } }) : c.s === 'expired' ? H.button({ label: 'Ask again', variant: 'ghost', size: 28, attrs: { 'data-action': 'reopen' } }) : '';
    return H.askCard({ variant: 'form', state: 'answered', ask: r.text, word: { text: r.word }, rowAction: act, ...lead, attrs: { 'data-form-row': '', 'data-origin': originWord(o), 'aria-label': plain(cap(d.title)) + ': ' + r.text } });
  }
  const busy = c.s === 'submitting';
  const owed = !!formT(d).stamp;
  const head: Partial<AskCardOpts> = { who: askerWords(o), ...lead, ...(owed ? {} : { word: { text: d.preview ? 'previewing' : '' } }), ...(d.expires || d.expiresAt ? { countdown: String(d.expires ?? '') } : {}), busy, ...(st.error ? { error: st.error } : {}) };
  const shape = questionShape(d);
  if (shape) {
    const [name, p] = props(d)[0] as [string, FieldSchema];
    const cur = st.vals[name];
    const opts = (p.enum ?? []).map((v) => optLabel(p, v));
    const own = st.other[name] ? H.field({ id: c.id + '-own', placeholder: 'Your answer', ariaLabel: (p.title || cap(name)) + ': your own answer', value: typeof cur === 'string' && !(p.enum ?? []).includes(cur) ? cur : '', attrs: { 'data-own': name } }) : '';
    const chosen = (p.enum ?? []).indexOf(cur);
    return H.askCard({ ...head, variant: shape === 'chips' ? 'question' : 'choices', ask: plain(cap(d.title)), ...(d.why ? { sub: plain(d.why) } : {}), something: !!p['x-other'],
      ...(shape === 'chips' ? { answers: (p.enum ?? []).map((v, i) => ({ label: opts[i] ?? String(v), value: String(v), primary: cur === v })) } : { choices: opts, ...(chosen >= 0 ? { chosen } : {}) }),
      ...(own ? { fields: own } : {}), attrs: { 'data-question': name, 'data-shape': shape, 'data-origin': originWord(o) } });
  }
  /* a permission is exactly the AskCard: its scope is the answers, not a field */
  const fields = d.kind === 'permission' ? '' : extrasHTML(d) + props(d).map(([name, p]) => fieldHTML(c, st, name, p)).join('');
  return H.askCard({ ...head, variant: 'form', ask: plain(cap(d.title)), ...(d.why ? { sub: plain(d.why) } : {}), ...(fields ? { fields } : {}), ...(d.effect ? { effect: plain(d.effect) } : d.kind === 'credential' ? { effect: 'Stored in your system’s keychain' } : {}), answers: answersOf(d, st), attrs: { 'data-form': d.kind, 'data-origin': originWord(o) } });
}

/** focus a form's first control (a screen that just drew one: the store, connectors, providers, first run) */
export const FIRST_CONTROL = '.k7-ask__fields input:not([type=file]), .k7-ask__fields textarea, .k7-ask__fields [role=radio][tabindex="0"], .k7-ask__fields [role=checkbox], .k7-ask__fields [role=switch], .k7-ask__fields .k7-sel, .k7-ask__choice, .k7-ask__answers .k7-chip';
export function focusForm(c: HTMLElement): void { c.querySelector<HTMLElement>(FIRST_CONTROL)?.focus(); }

/* ───────── behaviour ───────── */
const fieldsOf = (card: HxCard): HTMLElement[] => Array.from(card.querySelectorAll<HTMLElement>('[data-field]')).filter((f) => !f.closest('.cd-ghost'));
const fieldEl = (card: HxCard, name: string): HTMLElement | undefined => fieldsOf(card).find((f) => f.dataset['field'] === name);
const CONTROL = 'input:not([type=file]), textarea, [role=radio][tabindex="0"], [role=checkbox], [role=switch], .k7-sel, [data-add-file]';

export function validate(card: HxCard): FieldError[] {
  const st = fst(card);
  return validateForm(spec(card.data), st.vals, st.sec, st.signedIn);
}
/** a field's error as the kit Field draws it: the line under the field, the box ringed, the control invalid and described by it */
function paintField(f: HTMLElement, msg: string): void {
  const k = f.querySelector<HTMLElement>('.k7-field') ?? f;
  const ctl = f.querySelector<HTMLElement>('input:not([type=file]), textarea, .k7-orows, .k7-seg, .k7-sel, .k7-swatches, .k7-switch, .k7-ask__files, [data-signin-row]');
  const id = (ctl?.id || f.dataset['field'] || 'f') + '-err';
  let out = k.querySelector<HTMLElement>(':scope > .k7-field__error');
  if (msg) {
    if (!out) { out = document.createElement('p'); out.className = 'k7-field__error'; out.id = id; k.append(out); }
    out.textContent = msg;
    k.setAttribute('data-error', '');
    if (ctl) { ctl.setAttribute('aria-invalid', 'true'); const by = (ctl.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean); if (!by.includes(out.id)) ctl.setAttribute('aria-describedby', [...by, out.id].join(' ')); }
  } else {
    if (out) { const oid = out.id; out.remove(); if (ctl) { const by = (ctl.getAttribute('aria-describedby') ?? '').split(' ').filter((x) => x && x !== oid); if (by.length) ctl.setAttribute('aria-describedby', by.join(' ')); else ctl.removeAttribute('aria-describedby'); } }
    k.removeAttribute('data-error');
    ctl?.removeAttribute('aria-invalid');
  }
}
/** paint errors in place (no focus move): used while the user fixes fields */
function paintErrors(card: HxCard, errs: FieldError[]): void {
  for (const f of fieldsOf(card)) paintField(f, errs.find((x) => x.name === f.dataset['field'])?.msg ?? '');
  if (errs.length && card.state !== 'invalid' && LIVE_FORM.includes(card.state)) card.setState('invalid');
  else if (!errs.length && card.state === 'invalid') card.setState('open');
}
/** show errors on submit: paint them, say the first one, and move focus to it */
function showErrors(card: HxCard, errs: FieldError[]): void {
  paintErrors(card, errs);
  const first = errs[0];
  if (!first) return;
  card.announce((errs.length === 1 ? 'Check ' + first.title + ': ' : 'Check ' + errs.length + ' fields. ' + first.title + ': ') + first.msg);
  fieldEl(card, first.name)?.querySelector<HTMLElement>(CONTROL)?.focus({ preventScroll: false });
}
/** forget every secret: the memory and the fields */
export function dropSecrets(card: HxCard): void {
  const st = card.formState as FormState | null;
  if (!st) return;
  for (const k of Object.keys(st.sec)) st.sec[k] = '';
  st.sec = {};
  for (const i of card.querySelectorAll<HTMLInputElement>('input[data-secret]')) i.value = '';
}

/** submit: validate, hand secrets to the host through the data seam (never to the agent), send the rest, then collapse to a receipt */
export async function submitForm(card: HxCard, viaHold: boolean): Promise<boolean> {
  const d = spec(card.data), st = fst(card);
  if (!LIVE_FORM.includes(card.state)) return false;
  const errs = validate(card);
  showErrors(card, errs);
  if (errs.length) return false;
  if (holdForm(d) && !viaHold && d.kind !== 'permission') {
    card.holdButton()?.focus();
    card.announce('Hold the space bar, or press enter twice, to ' + holdWords(submitWord(d, st)).replace(/^Hold to /, '').toLowerCase());
    return false;
  }
  if (d.kind === 'permission' && !viaHold && String(st.vals['scope'] ?? 'once') === 'once') {
    card.holdButton()?.focus();
    card.announce('Hold the space bar, or press enter twice, to allow once');
    return false;
  }
  const values = valuesOf(d, st.vals);
  const secrets: Record<string, string> = {};
  for (const [name, p] of props(d)) if (p['x-secret'] && st.sec[name]) secrets[name] = st.sec[name] as string;
  const provided = Object.keys(secrets);
  /* the event carries the values and the NAMES of the secrets provided, never a secret */
  const ok = card.dispatchEvent(new CustomEvent('hx:card-action', { bubbles: true, composed: true, cancelable: true, detail: { kind: 'form', action: 'submit', value: { form_id: d.id, kind: d.kind, values, provided }, data: card.data, state: card.state, card } }));
  if (!ok) return false;
  const raw = d.kind === 'permission' ? String(st.vals['scope'] ?? 'once') : '';
  card.data['receiptText'] = receiptText(d, answerText(d, st.vals, teammateName), raw);
  st.error = '';
  const sent = { values, secrets };
  /* the secret leaves the page's memory and fields BEFORE the card re-renders (a fading copy of the old fields must not hold it) */
  dropSecrets(card);
  card.setState('submitting');
  try {
    if (!isLocalForm(d)) await formsHost().submit(d.id, sent);
    if (card.state !== 'submitting') return true;
    card.setState('done');
    return true;
  } catch (e) {
    /* nothing was delivered: the form is open again with what went wrong, and the secret has to be typed again (it was dropped) */
    if (card.state === 'submitting') { st.error = (e instanceof Error ? e.message : String(e)) || 'The answer was not delivered. Try again.'; card.setState('open'); card.announce(st.error); }
    return false;
  }
}
export function cancelForm(card: HxCard): void {
  dropSecrets(card);
  const d = spec(card.data);
  if (card.state === 'submitting' && d.kind === 'signin') {
    const field = props(d).find(([, p]) => p['x-signin'])?.[0];
    if (field) void formsHost().cancelSignin?.(d.id, field)?.catch(() => undefined);
    card.setState('open');
    return;
  }
  /* a permission's Deny is an answer of its own (the rule says no), not a withdrawn form */
  if (d.kind === 'permission' && LIVE_FORM.includes(card.state)) { fst(card).vals['scope'] = 'deny'; void submitForm(card, true); return; }
  card.setState('cancelled');
  if (!isLocalForm(d)) void formsHost().cancel(d.id).catch(() => undefined);
}
/** a plan's "Change it": the plan goes back to the asker as your reply, with what you wrote in its field; the form ends as answered */
function changePlan(card: HxCard): void {
  const d = spec(card.data), st = fst(card);
  const words = props(d).map(([n]) => st.vals[n]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  st.vals['changes'] = words?.trim() || 'Change the plan before you start.';
  card.data['receiptText'] = 'You asked for changes to the plan';
  card.dispatchEvent(new CustomEvent('hx:card-action', { bubbles: true, composed: true, cancelable: true, detail: { kind: 'form', action: 'change', value: { form_id: d.id, kind: d.kind, values: { changes: st.vals['changes'], approved: false }, provided: [] }, data: card.data, state: card.state, card } }));
  card.setState('submitting');
  formsHost().submit(d.id, { values: { changes: st.vals['changes'], approved: false }, secrets: {} }).then(() => { if (card.state === 'submitting') card.setState('done'); }, (e: unknown) => {
    if (card.state === 'submitting') { st.error = (e instanceof Error ? e.message : String(e)) || 'The answer was not delivered. Try again.'; card.setState('open'); card.announce(st.error); }
  });
}

async function signin(card: HxCard, name: string): Promise<void> {
  const d = spec(card.data), st = fst(card);
  const p = d.schema.properties?.[name], s = p?.['x-signin'];
  if (!name || !s) return;
  const row = fieldEl(card, name)?.querySelector<HTMLElement>('[data-signin-row]');
  if (row?.dataset['known'] === 'false') { card.announce(row.dataset['note'] ?? ''); return; }
  card.data['busyText'] = 'Waiting for ' + (s.host || s.provider || 'the provider') + ' in your browser';
  card.setState('submitting');
  try {
    await formsHost().signin(d.id, name);
    if (card.state !== 'submitting') return;
    st.signedIn.add(name);
    card.data['receiptText'] = receiptText(d, '', '');
    card.setState('done');
  } catch (e) {
    if (card.state === 'submitting') { st.error = (e instanceof Error ? e.message : String(e)) || 'The sign-in did not finish.'; card.setState('open'); card.announce(st.error); }
  }
}

function addFiles(card: HxCard, name: string, list: FileList | readonly File[] | null | undefined): void {
  const files = Array.from(list ?? []);
  if (!files.length) return;
  const st = fst(card), cur = ((st.vals[name] as Array<{ name: string; size: number }> | undefined) ?? []).slice();
  for (const f of files) cur.push({ name: f.name, size: f.size });
  st.vals[name] = cur;
  card.announce('Added ' + files.map((f) => f.name).join(', '));
  redraw(card);
}
/** draw the open form again from its state (a value that changes what is drawn: a file added, "Something else" chosen) */
function redraw(card: HxCard): void {
  const errs = card.state === 'invalid' ? validate(card) : [];
  card.update({});
  if (errs.length) paintErrors(card, errs);
}

/** KEYMAP section 6, forms: Esc cancels (a permission's Deny); Enter submits from a single-line field or an option (a hold form asks for
    the hold); mod+Enter submits from long text; 1-9 pick an option when focus is not in a text field */
export function formKey(card: HxCard, e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement, d = spec(card.data);
  const typing = (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && (t as HTMLInputElement).type !== 'checkbox';
  if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.defaultPrevented) {
    if (!hasCancel(d) && d.kind !== 'permission') return false;
    e.preventDefault(); e.stopPropagation(); cancelForm(card); return true;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
    const mod = e.ctrlKey || e.metaKey;
    if (t.tagName === 'TEXTAREA' && !mod) return false;
    if (t.matches('[data-own]')) { e.preventDefault(); void submitForm(card, false); return true; }
    if (!mod && t.tagName === 'BUTTON' && !t.matches('[role=radio], [role=checkbox]')) return false;
    if (t.closest('.k7-ask__answers')) return false;
    e.preventDefault(); void submitForm(card, false); return true;
  }
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing) return false;
  const n = /^Digit([1-9])$/.exec(e.code);
  if (n) {
    const k = +(n[1] ?? 0) - 1;
    const row = (t.closest('.k7-orows') ?? card.querySelector('.k7-orows'))?.querySelectorAll<HTMLElement>('.k7-orow:not([data-other])')[k]
      ?? card.querySelectorAll<HTMLElement>('.k7-ask__choice')[k] ?? card.querySelectorAll<HTMLElement>('[data-question] .k7-ask__answers > .k7-chip')[k];
    if (row) { e.preventDefault(); row.click(); row.focus(); return true; }
  }
  return false;
}

/** a form's controls: values live in the card's FormState (secrets until they are handed to the host) */
export function wireForm(card: HxCard): void {
  const root = card.querySelector<HTMLElement & { _wired?: boolean }>(':scope > [data-r] [data-kit~="AskCard"], :scope > [data-r][data-kit~="AskCard"]');
  if (!root || root._wired) return;
  root._wired = true;
  kit.wire(root);
  const d = spec(card.data), st = fst(card), props0 = d.schema.properties ?? {};
  const clearErr = (): void => { if (card.state === 'invalid') paintErrors(card, validate(card)); };
  for (const [name, p] of Object.entries(props0)) if (st.vals[name] === undefined && p.default !== undefined && !p['x-secret']) st.vals[name] = p.default;
  /* a name or a why cut to one line is whole on hover */
  for (const w of root.querySelectorAll<HTMLElement>('.k7-ask__who, .k7-ask__sub')) w.addEventListener('pointerenter', () => { if (w.scrollWidth > w.clientWidth + 1) w.dataset['tip'] = w.textContent ?? ''; else delete w.dataset['tip']; });
  /* the AskCard's answers run through the card (card.ts: each chip's data-action, the hold its commit); a question's chips answer it,
     and "Something else" opens a Field for your own words */
  if (root.dataset['question']) root.querySelector('.k7-ask__answers')?.addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('.k7-chip');
    if (c && !c.dataset['action'] && c.getAttribute('aria-disabled') !== 'true') answerQuestion(card, root.dataset['question'] ?? '', c.dataset['value'] ?? '');
  });
  for (const ch of root.querySelectorAll<HTMLElement>('.k7-ask__choice')) ch.addEventListener('click', () => {
    const q = root.dataset['question'] ?? '', p = props0[q], list = Array.from(root.querySelectorAll('.k7-ask__choice')), i = list.indexOf(ch);
    answerQuestion(card, q, i < (p?.enum?.length ?? 0) ? String(p?.enum?.[i]) : 'else');
  });
  for (const i of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-name], textarea[data-name]')) {
    const n = i.dataset['name'] ?? '';
    i.addEventListener('input', () => { st.vals[n] = i.value; if (i.getAttribute('aria-invalid')) clearErr(); });
  }
  for (const i of root.querySelectorAll<HTMLInputElement>('input[data-own]')) {
    const n = i.dataset['own'] ?? '';
    i.addEventListener('input', () => { st.vals[n] = i.value; clearErr(); });
    if (st.other[n] && document.activeElement !== i && card.contains(document.activeElement) === false) queueMicrotask(() => i.focus());
  }
  for (const i of root.querySelectorAll<HTMLInputElement>('input[data-secret]')) {
    const n = i.dataset['secret'] ?? '';
    delete st.sec[n];   /* a freshly drawn field is empty: so is what the card remembers */
    i.addEventListener('input', () => { st.sec[n] = i.value; if (i.getAttribute('aria-invalid')) clearErr(); });
    /* paste-friendly: trim what was pasted and check it at once */
    i.addEventListener('paste', () => setTimeout(() => { i.value = i.value.trim(); st.sec[n] = i.value; const e = validate(card).filter((x) => x.name === n); if (e.length) showErrors(card, e); else clearErr(); }, 0));
    const show = i.parentElement?.querySelector<HTMLButtonElement>('[data-reveal]');
    show?.addEventListener('click', () => {
      const on = i.type === 'password';
      i.type = on ? 'text' : 'password';
      show.setAttribute('aria-pressed', String(on));
      const lbl = show.querySelector('.k7-btn__label'); if (lbl) lbl.textContent = on ? 'Hide' : 'Show';
      show.setAttribute('aria-label', (on ? 'Hide ' : 'Show ') + (props0[n]?.title ?? 'the secret').toLowerCase());
      i.focus();
    });
  }
  /* the kit wires a Switch and a Segmented (wire.ts): the form keeps what they say */
  for (const sw of root.querySelectorAll<HTMLElement>('[data-switch]')) {
    const n = sw.dataset['switch'] ?? '';
    st.vals[n] = sw.getAttribute('aria-checked') === 'true';
    sw.addEventListener('ui:change', (e) => { st.vals[n] = !!(e as CustomEvent<{ value: boolean }>).detail.value; });
  }
  for (const g of root.querySelectorAll<HTMLElement>('.k7-seg[data-group]')) {
    const n = g.dataset['group'] ?? '';
    g.addEventListener('ui:change', (e) => { st.vals[n] = (e as CustomEvent<{ value: string }>).detail.value; clearErr(); });
  }
  for (const g of root.querySelectorAll<HTMLElement>('.k7-orows[data-group]')) wireOptions(card, g, st, props0, clearErr);
  for (const g of root.querySelectorAll<HTMLElement>('.k7-swatches[data-group]')) {
    const n = g.dataset['group'] ?? '';
    const items = Array.from(g.querySelectorAll<HTMLElement>('[role=radio]'));
    const pick = (it: HTMLElement): void => {
      st.vals[n] = it.dataset['value'];
      items.forEach((x) => { const on = x === it; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
      clearErr();
    };
    items.forEach((it) => it.addEventListener('click', () => pick(it)));
    g.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement as HTMLElement), dlt = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
      if (i < 0 || !dlt) return;
      e.preventDefault(); const nx = items[(i + dlt + items.length) % items.length]; if (nx) { pick(nx); nx.focus(); }
    });
  }
  for (const pk of root.querySelectorAll<HTMLElement>('.k7-sel[data-picker]')) wirePicker(pk, st, props0, clearErr);
  for (const drop of root.querySelectorAll<HTMLElement>('[data-drop]')) {
    const name = drop.dataset['drop'] ?? '', input = drop.querySelector<HTMLInputElement>('input[type=file]');
    drop.querySelector('[data-add-file]')?.addEventListener('click', () => { if (formsHost().can.upload) input?.click(); });
    input?.addEventListener('change', () => { addFiles(card, name, input.files); });
    for (const chip of drop.querySelectorAll<HTMLElement>('[data-remove-file]')) chip.addEventListener('click', () => {
      const cur = ((st.vals[name] as unknown[] | undefined) ?? []).slice(), gone = cur.splice(+(chip.dataset['removeFile'] ?? 0), 1)[0] as { name?: string } | undefined;
      st.vals[name] = cur.length ? cur : undefined;
      if (gone?.name) card.announce('Removed ' + gone.name);
      redraw(card);
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.dataset['over'] = ''; });
    drop.addEventListener('dragleave', () => { delete drop.dataset['over']; });
    drop.addEventListener('drop', (e) => { e.preventDefault(); delete drop.dataset['over']; if (formsHost().can.upload) addFiles(card, name, e.dataTransfer?.files); });
  }
}

/** a question's answer: an option answers it at once; "Something else" opens a Field for your own words (Enter answers) */
function answerQuestion(card: HxCard, name: string, v: string): void {
  const st = fst(card);
  if (!name || !LIVE_FORM.includes(card.state)) return;
  if (v === 'else') { st.other[name] = true; redraw(card); card.querySelector<HTMLInputElement>('input[data-own]')?.focus(); return; }
  const p = spec(card.data).schema.properties?.[name];
  st.other[name] = false;
  st.vals[name] = (p?.enum ?? []).find((x) => String(x) === v) ?? v;
  void submitForm(card, false);
}

function wireOptions(card: HxCard, g: HTMLElement, st: FormState, props0: Readonly<Record<string, FieldSchema>>, clearErr: () => void): void {
  const name = g.dataset['group'] ?? '', p = props0[name];
  if (!p?.enum) return;
  const multi = !!p['x-multi'], opts = p.enum;
  const rows = Array.from(g.querySelectorAll<HTMLElement>('.k7-orow'));
  const showPreview = (v: unknown): void => { const pv = card.querySelector<HTMLElement>('[data-preview-for="' + name + '"]'); if (pv) pv.innerHTML = previewHTML(p, v); };
  const sync = (): void => {
    const v = st.vals[name];
    rows.forEach((r) => {
      const other = r.hasAttribute('data-other');
      const on = other ? !!st.other[name] : multi ? ((v as unknown[] | undefined) ?? []).map(String).includes(r.dataset['value'] ?? '') : !st.other[name] && String(v) === r.dataset['value'];
      r.setAttribute('aria-checked', String(on)); if (!multi) r.tabIndex = on ? 0 : -1;
    });
    if (!multi && !rows.some((r) => r.tabIndex === 0) && rows[0]) rows[0].tabIndex = 0;
  };
  rows.forEach((r) => {
    r.addEventListener('click', () => {
      if (r.hasAttribute('data-other')) { if (!st.other[name]) { st.other[name] = true; st.vals[name] = null; redraw(card); card.querySelector<HTMLInputElement>('input[data-own="' + name + '"]')?.focus(); } return; }
      const v = opts[+(r.dataset['i'] ?? 0)];
      if (multi) { const cur = [...((st.vals[name] as unknown[] | undefined) ?? [])], k = cur.indexOf(v); if (k >= 0) cur.splice(k, 1); else cur.push(v); st.vals[name] = cur; }
      else if (st.other[name]) { st.other[name] = false; st.vals[name] = v; redraw(card); card.querySelector<HTMLElement>('.k7-orows[data-group="' + name + '"] [aria-checked="true"]')?.focus(); return; }
      else st.vals[name] = v;
      sync(); showPreview(multi ? null : v); clearErr();
    });
    r.addEventListener('focus', () => { if (!r.hasAttribute('data-other')) showPreview(multi ? null : opts[+(r.dataset['i'] ?? 0)]); });
  });
  g.addEventListener('keydown', (e) => {
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const dlt = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    if (i < 0 || !dlt) return;
    e.preventDefault();
    const nx = rows[(i + dlt + rows.length) % rows.length];
    if (!nx) return;
    if (!multi && !nx.hasAttribute('data-other')) nx.click();
    nx.focus();
  });
  sync();
}

/** a picker (S17's SelectorItem): a folder from the system's dialog where the build has one, else the kit's option Menu of what can be
    chosen (models with their marks, teammates with their orbs, the source's folders, files, branches) */
function wirePicker(pk: HTMLElement, st: FormState, props0: Readonly<Record<string, FieldSchema>>, clearErr: () => void): void {
  const name = pk.dataset['name'] ?? '', kind = (pk.dataset['picker'] ?? 'folder') as PickerKind, p = props0[name];
  const set = (v: string): void => {
    st.vals[name] = v;
    const out = pk.querySelector('.k7-sel__value'); if (out) out.textContent = pickShown(kind, v);
    const lead = pk.firstElementChild; if (lead && !lead.classList.contains('k7-sel__value')) lead.outerHTML = pickLead(kind, v);
    clearErr();
  };
  pk.addEventListener('click', () => {
    if (kind === 'folder' && formsHost().can.folder) { void formsHost().pickFolder().then((v) => { if (v) set(v); }); return; }
    const cur = String(st.vals[name] ?? '');
    kit.openMenu(pk, { label: p?.title || cap(name), variant: 'options', entries: pickerEntries(kind, p, cur), place: 'below', align: 'start', onSelect: (v) => { if (v) set(v); pk.focus(); } });
  });
}
function pickerEntries(kind: PickerKind, p: FieldSchema | undefined, cur: string): readonly MenuEntry[] {
  const d = provider();
  const row = (o: OptionRowOpts): OptionRowOpts => ({ ...o, chosen: o.value === cur });
  if (p?.enum && !p['x-picker']) return p.enum.map((x) => row({ label: optLabel(p, x), meaning: '', value: String(x), leadHTML: ui.html.modelMark(String(x), { size: 16, label: false }) }));
  if (kind === 'teammate') return d.bots.snapshot().bots.map((b) => row({ label: b.name, meaning: b.role ?? '', value: b.id, leadHTML: H.avatar({ bot: b, size: 16, still: true }) }));
  if (kind === 'model') return d.details.models.get().map((m) => row({ label: ui.modelMark.short(m) || m, meaning: m, value: m, leadHTML: ui.html.modelMark(m, { size: 16, label: false }) }));
  const items = d.forms.pickerItems(kind), icon = PICK_ICON[kind];
  return items.length ? items.map((x) => row({ label: x.label, meaning: x.desc ?? '', value: x.value, ...(icon ? { icon } : {}) })) : [{ label: 'Nothing to choose from yet', meaning: 'The source has nothing of this kind', value: '', disabled: true }];
}
