/* The form card: one renderer for every form (docs/FORMS.md), drawn from the schema (MCP elicitation's `requestedSchema`
   plus the hypotaxis extensions: secret, multi, other, previews, pickers, upload, sign-in, hold to approve).
   A kind is a template (form-model.ts), never a new component. States: open, invalid, holding, submitting, done (a
   receipt), deferred, expired, cancelled. Keys (KEYMAP section 6): Tab and Shift+Tab move between fields, Enter submits
   (a hold form asks for the hold), mod+Enter submits from long text, Esc defers (never cancels), x cancels and 1-9 pick an
   option when focus is not in a text field.
   Secrets: a secret field's value lives in `FormState.sec` only until the submit hands it to the host through the data
   seam (`data().forms.submit`), then it is dropped; it is never in an event, a receipt, the markup of a finished card or
   a log. Accessible errors: every error sits in the field's description, the field is `aria-invalid`, the first one is
   announced and focused. */
import { esc } from '../../core/dom';
import { ui } from '../../components';
import { holdOf } from '../../components/hold';
import { data as provider } from '../../data';
import { formsHost } from './forms-host';
import type { FieldSchema, FormSpec, PickerKind } from '../../data';
import type { HxCard } from './card';
import { animate } from './motion';
import { actions, bot, breath, btn, cap, check, fmt, foot, headrow, meta, mini, originText, originVisual, sentenceHTML, sentenceText } from './parts';
import { FORM_KINDS, PERMISSION, answerText, formT, hasCancel, holdForm, isReq, optLabel, props, receiptText, validateForm, valuesOf } from './form-model';
import type { FieldError, Values } from './form-model';
import type { Ctx, Data, Kind } from './types';

const U = ui;
export { FORM_KINDS };
export const LIVE_FORM: readonly string[] = ['open', 'invalid', 'holding'];
const DONE_FORM: readonly string[] = ['done', 'deferred', 'expired', 'cancelled'];
const spec = (d: Data): FormSpec => d as unknown as FormSpec;

/** a form card's own state: what the user typed, kept out of the DOM and out of every event */
export interface FormState { vals: Values; sec: Record<string, string>; signedIn: Set<string>; error: string; files: Record<string, { name: string; size: number } | undefined> }
export const newFormState = (): FormState => ({ vals: {}, sec: {}, signedIn: new Set(), error: '', files: {} });
const fst = (card: HxCard): FormState => card.formState as FormState;

/* ───────── pickers: the app's own (teammates, models, folders) ───────── */
const PICK_ICON: Readonly<Record<string, string>> = { folder: 'folder', file: 'file', branch: 'fork', repo: 'fork', host: 'at', teammate: 'bots' };
/** the picker's lead: a teammate's orb, a model's brand mark (the picker is the one place brand colour shows), else a glyph */
function pickLead(kind: PickerKind, v: unknown, b: ReturnType<typeof bot>): string {
  if (b) return U.html.orb(b, { size: 16 });
  if (kind === 'model') return U.html.modelMark(String(v ?? ''), { size: 16, color: 'brand', label: false, class: 'cd-glyph' });
  return U.icon(PICK_ICON[kind] ?? 'more', { class: 'cd-glyph' });
}
function pickerItems(kind: PickerKind): Array<Record<string, unknown>> {
  const d = provider();
  if (kind === 'teammate') return d.bots.snapshot().bots.map((b) => ({ value: b.id, label: b.name, desc: b.role, lead: U.html.orb(b, { size: 16 }) }));
  if (kind === 'model') return [{ title: 'Models' }, ...d.details.models.get().map((m) => ({ value: m, label: m, mono: true, model: m }))];
  const items = d.forms.pickerItems(kind);
  const icon = PICK_ICON[kind];
  return items.length ? items.map((x) => ({ value: x.value, label: x.label, desc: x.desc, mono: true, ...(icon ? { icon } : {}) })) : [{ label: 'Nothing to choose from yet', value: '', disabled: true }];
}

/* ───────── fields ───────── */
function fieldHTML(c: Ctx, st: FormState, name: string, p: FieldSchema): string {
  const d = spec(c.d), id = c.id + '-f-' + name, req = isReq(d, name);
  const label = esc(p.title || cap(name)) + (req ? '' : ' <span class="cd-opt-label">(optional)</span>');
  const hint = p.description ? '<p class="ui-field__hint" id="' + id + '-h">' + fmt(p.description) + '</p>' : '';
  const err = '<p class="ui-field__hint cd-err" data-tone="attention" id="' + id + '-e" hidden></p>';
  const desc = 'aria-describedby="' + (p.description ? id + '-h ' : '') + id + '-e"';
  const wrap = (inner: string, cls?: string): string => '<div class="ui-field cd-field' + (cls ? ' ' + cls : '') + '" data-field="' + esc(name) + '">' + inner + '</div>';
  const can = formsHost().can;
  if (p['x-secret']) {
    return wrap('<label class="ui-field__label" for="' + id + '">' + label + '</label>' +
      '<div class="cd-secret"><input type="password" class="ui-input ui-input--mono" id="' + id + '" data-secret="' + esc(name) + '" autocomplete="off" spellcheck="false" autocapitalize="off"' +
      (p.placeholder ? ' placeholder="' + esc(p.placeholder) + '"' : '') + ' ' + desc + (req ? ' aria-required="true"' : '') + '>' +
      btn('paste', 'Paste', null, { attrs: { 'aria-label': 'Paste ' + (p.title || name) + ' from the clipboard' } }) + '</div>' + hint + err +
      '<p class="cd-saved" hidden>' + check() + '<span></span></p>', 'cd-field--secret');
  }
  if (p['x-signin']) {
    const s = p['x-signin'];
    const note = !can.signin ? 'Signing in from here is not available in this build yet.' : s.flow === 'device' ? 'Shows a code to enter on ' + (s.host || 'the provider’s site') + '.' : 'Opens ' + (s.host || s.provider || 'the provider') + ' in your browser.';
    return wrap('<div class="cd-signin">' + U.html.button({ label: 'Sign in with ' + (s.provider || 'the provider'), variant: 'primary', action: 'signin', disabled: !can.signin, attrs: { 'data-field': name } }) +
      '<span class="cd-note">' + esc(note) + '</span></div>' + err, 'cd-field--signin');
  }
  if (p['x-picker']) {
    const v = st.vals[name] ?? p.default;
    const kind = p['x-picker'], b = kind === 'teammate' && v ? bot(String(v)) : undefined;
    return wrap('<span class="ui-field__label" id="' + id + '-l">' + label + '</span>' +
      '<button type="button" class="ui-input cd-picker" id="' + id + '" data-picker="' + esc(kind) + '" data-name="' + esc(name) + '" aria-haspopup="' + (kind === 'folder' && can.folder ? 'dialog' : 'menu') + '" aria-expanded="false" aria-labelledby="' + id + '-l ' + id + '-v" ' + desc + '>' +
      pickLead(kind, v, b) + '<span class="cd-picker__v' + (kind === 'teammate' ? '' : ' cd-mono') + '" id="' + id + '-v">' + esc(v ? (b ? b.name : String(v)) : 'Choose…') + '</span>' + U.icon('chevron-down', { size: 's' }) + '</button>' + hint + err);
  }
  if (p['x-upload']) {
    return wrap('<span class="ui-field__label" id="' + id + '-l">' + label + '</span>' +
      '<div class="ui-input cd-drop" data-drop="' + esc(name) + '" role="group" aria-labelledby="' + id + '-l" ' + desc + '>' +
      btn('choose-file', 'Choose a file', null, { size: 's', disabled: !can.upload, attrs: { 'aria-describedby': id + '-l' } }) + '<span class="cd-drop__hint">' + (can.upload ? 'or drop it here' : 'not available in this build yet') + '</span>' +
      '<input type="file" hidden tabindex="-1" aria-hidden="true"></div>' + hint + err);
  }
  if (p.enum) {
    const multi = !!p['x-multi'], prev = p['x-preview'];
    const cur = st.vals[name] ?? (p.default != null ? p.default : (multi ? [] : null));
    const on = (v: unknown): boolean => (multi ? ((cur as unknown[] | null) ?? []).includes(v) : cur === v);
    const free = typeof cur === 'string' && !p.enum.includes(cur) && cur ? cur : '';
    const rows = p.enum.map((v, i) => '<button type="button" class="cd-opt" role="' + (multi ? 'checkbox' : 'radio') + '" data-v="' + esc(v) + '" data-i="' + i + '" aria-checked="' + on(v) + '"' +
      (i < 9 ? ' aria-keyshortcuts="' + (i + 1) + '"' : '') + ' tabindex="' + (multi || on(v) || (cur == null && i === 0) ? '0' : '-1') + '">' +
      '<span class="cd-opt__ring" aria-hidden="true">' + (multi ? check() : '') + '</span><span class="cd-opt__text">' + fmt(optLabel(p, v)) + '</span>' +
      (i < 9 ? '<span class="cd-opt__key" aria-hidden="true">' + (i + 1) + '</span>' : '') + '</button>').join('') +
      (p['x-other'] ? '<label class="cd-free" data-other' + (free ? ' data-on' : '') + '><span class="cd-opt__ring" aria-hidden="true"></span><span class="ui-sr">Other: your own answer</span>' +
        '<input type="text" autocomplete="off" spellcheck="false" placeholder="Other" value="' + esc(free) + '"></label>' : '');
    const group = '<div class="cd-opts" role="' + (multi ? 'group' : 'radiogroup') + '" id="' + id + '" aria-labelledby="' + id + '-l" ' + desc + ' data-group="' + esc(name) + '">' + rows + '</div>';
    const preview = prev ? '<div class="cd-preview" aria-live="polite" data-preview-for="' + esc(name) + '"></div>' : '';
    return wrap('<span class="ui-field__label" id="' + id + '-l">' + label + '</span>' + (prev ? '<div class="cd-pick">' + group + preview + '</div>' : group) + hint + err, prev ? 'cd-field--preview' : '');
  }
  if (p.type === 'boolean') {
    const v = st.vals[name] != null ? !!st.vals[name] : !!p.default;
    return wrap(U.html.setRow({ label: p.title || cap(name), hint: p.description, for: id, control: U.html.switch({ id, checked: v }) }), 'cd-field--switch');
  }
  const num = p.type === 'number' || p.type === 'integer';
  const v = st.vals[name] ?? (p.default != null ? p.default : '');
  const type = num ? 'number' : p.format === 'email' ? 'email' : p.format === 'uri' ? 'url' : 'text';
  const common = 'class="ui-input' + (num || p['x-mono'] ? ' ui-input--mono' : '') + '" id="' + id + '" data-name="' + esc(name) + '" autocomplete="off" ' + desc + (req ? ' aria-required="true"' : '') +
    (p.placeholder ? ' placeholder="' + esc(p.placeholder) + '"' : '') + (num && p.minimum != null ? ' min="' + p.minimum + '"' : '') + (num && p.maximum != null ? ' max="' + p.maximum + '"' : '') + (num && p.type === 'integer' ? ' step="1"' : '');
  const control = p['x-multiline'] ? '<textarea ' + common + ' rows="3">' + esc(v) + '</textarea>' : '<input type="' + type + '" ' + common + ' value="' + esc(v) + '">';
  return wrap('<label class="ui-field__label" for="' + id + '">' + label + '</label>' + control + hint + err);
}

/** what the form shows before its fields: a config diff (setup), a plan (plan), a connector's contents and hash */
function formExtras(d: FormSpec): string {
  let h = '';
  if (d.diff) {
    const lines = String(d.diff).split('\n');
    h += '<div class="cd-well cd-diff" role="group" aria-label="' + esc('Changes to ' + (d.file || 'the config')) + '">' + (d.file ? '<div class="cd-diff__file">' + esc(d.file) + '</div>' : '') +
      lines.map((l) => '<div class="cd-diff__l"' + (/^\+/.test(l) ? ' data-d="add"' : /^-/.test(l) ? ' data-d="del"' : '') + '><span aria-hidden="true">' + esc(l.charAt(0) === '+' || l.charAt(0) === '-' ? l.charAt(0) : ' ') + '</span>' +
        '<span class="ui-sr">' + (/^\+/.test(l) ? 'added: ' : /^-/.test(l) ? 'removed: ' : '') + '</span>' + esc(l.replace(/^[+\- ]/, '')) + '</div>').join('') + '</div>';
  }
  if (d.plan) h += '<ol class="cd-plan">' + d.plan.map((x) => '<li>' + fmt(x) + '</li>').join('') + '</ol>';
  if (d.contents) h += '<div class="cd-well cd-contents">' + d.contents.map((x) => '<div class="cd-well__line"><span class="cd-well__strong">' + esc(x[0]) + '</span><span>' + fmt(x[1] ?? '') + '</span></div>').join('') +
    (d.pinned ? '<div class="cd-well__line cd-pinned"><span>Pinned</span><span class="cd-mono">' + esc(d.pinned) + '</span></div>' : '') + '</div>';
  return h;
}
const holdHTML = (c: Ctx): string => U.html.hold({ hintId: c.id + '-hint', fill: c.card.opts.holdFill, attrs: { 'data-hold': true } });
const teammateName = (id: string): string | null => bot(id)?.name ?? null;

/* ───────── the kind ───────── */
export const formKind: Kind = {
  states: ['open', 'invalid', 'holding', 'submitting', 'done', 'deferred', 'expired', 'cancelled'],
  initial: 'open',
  quiet: { 'open>holding': 1, 'holding>open': 1, 'open>invalid': 1, 'invalid>open': 1, 'invalid>holding': 1, 'holding>invalid': 1 },
  tone: (c) => (LIVE_FORM.includes(c.s) ? (formT(spec(c.d ?? { kind: 'question' } as unknown as Data)).stamp ? 'red' : 'none') : c.s === 'submitting' ? 'pulse' : c.s === 'done' ? 'ink' : 'ring'),
  stamp: (c) => formT(spec(c.d)).stamp || 'needs you',
  resolved: (c) => ['done', 'expired', 'cancelled'].includes(c.s),
  say: (c) => ({ done: 'Done: ', deferred: 'Later: ', expired: 'Expired: ', cancelled: 'Cancelled: ', submitting: '', open: 'Open: ', invalid: '', holding: '' } as Record<string, string>)[c.s] + c.plain + (c.s === 'done' && c.d['receiptText'] ? (/[.?!]$/.test(c.plain) ? ' ' : '. ') + String(c.d['receiptText']) : ''),
  text: (c) => sentenceText(c.d),
  render(c) {
    const d = spec(c.d), t = formT(d), st = fst(c.card);
    if (DONE_FORM.includes(c.s)) {
      const act = c.s === 'deferred' ? btn('reopen', 'Open', 'ghost', { size: 's' }) : c.s === 'expired' ? btn('reopen', 'Ask again', 'ghost', { size: 's' }) : '';
      return { head: '<div class="cd-collapsed"><span class="cd-mini__lead" aria-hidden="true">' + originVisual(c.origin, 16, 2) + '</span><p class="cd-collapsed__text" id="' + c.id + '-t">' + (c.s === 'done' ? check() : '') +
        '<span class="cd-collapsed__what">' + fmt(cap(d.title)) + '</span><span class="cd-collapsed__how">' + esc(receiptHTML(c)) + '</span></p>' +
        '<span class="cd-mono cd-collapsed__at">' + esc(c.at) + '</span>' + act + '</div>', body: '', foot: '' };
    }
    const fields = props(d).map(([name, p]) => fieldHTML(c, st, name, p)).join('');
    /* an answer that was not delivered: said where the fields are, as the field errors are (role alert), until the next try */
    const problem = st.error ? '<p class="ui-field__hint cd-err cd-err--form" role="alert" data-tone="attention">' + esc(st.error) + '</p>' : '';
    const body = '<form class="cd-form" novalidate>' + (d.why ? '<p class="cd-text">' + fmt(d.why) + '</p>' : '') + formExtras(d) + fields +
      (d.effect ? '<p class="cd-effect">' + fmt(d.effect) + '</p>' : '') + problem + '</form>';
    let f: string;
    if (c.s === 'submitting') f = foot('<p class="cd-receipt">' + breath() + '<span>' + esc(String(c.d['busyText'] || t.busy || 'Saving')) + '</span></p>', d.kind === 'signin' ? actions(btn('cancel', 'Cancel')) : '');
    else {
      const raw = String(st.vals['scope'] ?? 'once');
      const submitLabel = d.submit?.label || (d.kind === 'permission' ? (PERMISSION[raw] ?? PERMISSION['once'])?.[0] : t.submit) || 'Send';
      const cancelLabel = (typeof d.cancel === 'object' && d.cancel?.label) || t.cancel || 'Cancel';
      const cancel = hasCancel(d) ? btn('cancel', String(cancelLabel), null, { keys: 'x' }) : '';
      const submit = d.kind === 'signin' ? '' : holdForm(d) ? holdHTML(c) : btn('submit', submitLabel, 'primary', { keys: 'enter' });
      f = foot(meta([d.expires || d.expiresAt ? '<span data-countdown>' + esc(cap(d.expires ?? '')) + '</span>' : '']), actions((d.defer === false ? '' : btn('defer', 'Later', 'ghost', { keys: 'escape' })) + cancel + submit));
    }
    return { head: headrow(c, sentenceHTML(c.d)), body, foot: f };
  },
  mini(c) {
    const live = LIVE_FORM.includes(c.s), d = spec(c.d);
    return mini(c, { text: sentenceHTML(c.d), meta: live ? (d.expires || d.expiresAt ? '<span data-countdown="short"></span>' : esc(cap(formT(d).submit || 'Open'))) : esc(receiptHTML(c)) });
  },
  act(card, a, x) {
    if (a === 'submit') void submitForm(card, false);
    else if (a === 'approve') void submitForm(card, true);
    else if (a === 'cancel') cancelForm(card);
    else if (a === 'defer') { dropSecrets(card); card.setState('deferred'); }
    else if (a === 'reopen') { if (card.state === 'expired') card.rearmExpiry(); card.setState('open'); }
    else if (a === 'signin') void signin(card, x.el);
    else if (a === 'paste') paste(card, x.el);
    else if (a === 'choose-file') x.el?.closest('.cd-drop')?.querySelector<HTMLInputElement>('input[type=file]')?.click();
    else if (a === 'remove-file') { const n = x.el?.closest<HTMLElement>('.cd-drop')?.dataset['drop']; if (n) setFile(card, n, null); }
  }
};

function receiptHTML(c: Ctx): string {
  const d = spec(c.d), t = formT(d), who = c.origin ? originText(c.origin) : 'The agent';
  if (c.s === 'done') return String(c.d['receiptText'] || c.d['receipt'] || receiptText(d, '', ''));
  if (c.s === 'deferred') return 'Later. It waits in the dock';
  if (c.s === 'expired') return 'Expired, nothing was saved';
  if (c.s === 'cancelled') return String(c.d['cancelledText'] || (t.cancelled ?? 'Cancelled') + '. ' + cap(who) + ' continues without it');
  return '';
}

/* ───────── behaviour ───────── */
const formEl = (card: HxCard): HTMLFormElement | null => Array.from(card.querySelectorAll<HTMLFormElement>('.cd-form')).find((f) => !f.closest('.cd-ghost')) ?? null;
const fieldEl = (card: HxCard, name: string): HTMLElement | undefined => Array.from(card.querySelectorAll<HTMLElement>('.cd-field')).find((f) => f.dataset['field'] === name && !f.closest('.cd-ghost'));
const CONTROL = '.ui-input, .cd-opts, .ui-switch, [data-action="signin"]';

export function validate(card: HxCard): FieldError[] {
  const st = fst(card);
  return validateForm(spec(card.data), st.vals, st.sec, st.signedIn);
}
/** paint errors in place (no focus move): used while the user fixes fields */
function paintErrors(card: HxCard, errs: FieldError[]): void {
  for (const f of card.querySelectorAll<HTMLElement>('.cd-field')) {
    if (f.closest('.cd-ghost')) continue;
    const e = errs.find((x) => x.name === f.dataset['field']), out = f.querySelector<HTMLElement>('.cd-err');
    const ctl = f.querySelector<HTMLElement>(CONTROL);
    if (out) { out.textContent = e ? e.msg : ''; out.hidden = !e; }
    if (ctl) { if (e) ctl.setAttribute('aria-invalid', 'true'); else ctl.removeAttribute('aria-invalid'); }
  }
  if (errs.length && card.state !== 'invalid' && LIVE_FORM.includes(card.state)) card.setState('invalid');
  else if (!errs.length && card.state === 'invalid') card.setState('open');
}
/** show errors on submit: paint them, say the first one, and move focus to it */
function showErrors(card: HxCard, errs: FieldError[]): void {
  paintErrors(card, errs);
  const first = errs[0];
  if (!first) return;
  card.announce((errs.length === 1 ? 'Check ' + first.title + ': ' : 'Check ' + errs.length + ' fields. ' + first.title + ': ') + first.msg);
  const ctl = fieldEl(card, first.name)?.querySelector<HTMLElement>('.ui-input, .cd-opt[tabindex="0"], .cd-opt, .ui-switch, [data-action="signin"], .cd-drop .ui-btn');
  ctl?.focus({ preventScroll: false });
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
  if (errs.length) { holdOf(card.holdButton())?.reset(); return false; }
  if (holdForm(d) && !viaHold) {
    card.holdButton()?.focus();
    card.announce('Hold the space bar, or press enter twice, to ' + String(d.submit?.label || formT(d).submit).toLowerCase());
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
    await formsHost().submit(d.id, sent);
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
  if (card.state === 'submitting' && d.kind === 'signin') { card.setState('open'); return; }
  card.setState('cancelled');
  void formsHost().cancel(d.id).catch(() => undefined);
}

async function signin(card: HxCard, el: HTMLElement | undefined): Promise<void> {
  const d = spec(card.data), st = fst(card), name = el?.dataset['field'] ?? '';
  const p = d.schema.properties?.[name], s = p?.['x-signin'];
  if (!name || !s) return;
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

function paste(card: HxCard, el: HTMLElement | undefined): void {
  const input = el?.closest('.cd-secret')?.querySelector<HTMLInputElement>('input[data-secret]');
  if (!input) return;
  const done = (t: string): void => { input.value = String(t || '').trim(); fst(card).sec[input.dataset['secret'] ?? ''] = input.value; input.dispatchEvent(new Event('input')); input.focus(); };
  const ask = (): void => { input.focus(); card.announce('Press ' + (/Mac/.test(navigator.platform) ? 'command V' : 'control V') + ' to paste'); };
  try { if (navigator.clipboard?.readText) navigator.clipboard.readText().then(done, ask); else ask(); } catch { ask(); }
}

function setFile(card: HxCard, name: string, file: { name: string; size: number } | null): void {
  const st = fst(card);
  st.vals[name] = file ? { name: file.name, size: file.size } : undefined;
  const drop = fieldEl(card, name)?.querySelector<HTMLElement>('.cd-drop');
  if (!drop) return;
  const input = drop.querySelector('input[type=file]');
  drop.innerHTML = '';
  if (file) {
    const kb = file.size < 1024 * 1024 ? Math.max(1, Math.round(file.size / 1024)) + ' KB' : (file.size / 1048576).toFixed(1) + ' MB';
    drop.insertAdjacentHTML('beforeend', '<span class="cd-filechip">' + U.icon('file', { class: 'cd-glyph' }) + '<span class="cd-filechip__name">' + esc(file.name) + '</span><span class="cd-mono">' + kb + '</span></span>' +
      U.html.button({ label: 'Remove', variant: 'ghost', size: 's', action: 'remove-file', attrs: { 'aria-label': 'Remove ' + file.name } }));
    card.announce('Added ' + file.name);
  } else drop.insertAdjacentHTML('beforeend', U.html.button({ label: 'Choose a file', size: 's', action: 'choose-file' }) + '<span class="cd-drop__hint">or drop it here</span>');
  if (input) drop.appendChild(input);
  if (card.state === 'invalid') paintErrors(card, validate(card));
}

/** KEYMAP section 6, forms: Esc defers; Enter submits (from a field or an option; a hold form asks for the hold);
    mod+Enter submits from long text; x cancels and 1-9 pick an option when focus is not in a text field */
export function formKey(card: HxCard, e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement, d = spec(card.data);
  const typing = (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && (t as HTMLInputElement).type !== 'checkbox';
  if (e.key === 'Escape' && spec(card.data).defer !== false && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); card.act('defer'); return true; }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
    const mod = e.ctrlKey || e.metaKey;
    if (t.tagName === 'TEXTAREA' && !mod) return false;
    if (!mod && t.tagName === 'BUTTON' && !t.classList.contains('cd-opt')) return false;
    if (t.closest('.cd-foot, .ui-hold')) return false;
    e.preventDefault(); void submitForm(card, false); return true;
  }
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing) return false;
  if (e.code === 'KeyX' && hasCancel(d)) { e.preventDefault(); card.act('cancel'); return true; }
  const n = /^Digit([1-9])$/.exec(e.code);
  if (n) {
    const group = t.closest('.cd-opts') ?? card.querySelector('.cd-form .cd-opts');
    const row = group?.querySelectorAll<HTMLElement>('.cd-opt')[+(n[1] ?? 0) - 1];
    if (row) { e.preventDefault(); row.click(); row.focus(); return true; }
  }
  return false;
}

/** a form's fields: values live in the card's FormState (secrets until they are handed to the host) */
export function wireForm(card: HxCard): void {
  const form = formEl(card) as (HTMLFormElement & { _wired?: boolean }) | null;
  if (!form || form._wired) return;
  form._wired = true;
  const d = spec(card.data), st = fst(card), props0 = d.schema.properties ?? {};
  const clearErr = (): void => { if (card.state === 'invalid') paintErrors(card, validate(card)); };
  form.addEventListener('submit', (e) => { e.preventDefault(); void submitForm(card, false); });
  for (const [name, p] of Object.entries(props0)) if (st.vals[name] === undefined && p.default !== undefined && !p['x-secret']) st.vals[name] = p.default;
  for (const i of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-name], textarea[data-name]')) {
    const n = i.dataset['name'] ?? '';
    i.addEventListener('input', () => { st.vals[n] = i.value; if (i.getAttribute('aria-invalid')) clearErr(); });
  }
  for (const i of form.querySelectorAll<HTMLInputElement>('input[data-secret]')) {
    const n = i.dataset['secret'] ?? '';
    delete st.sec[n];   /* a freshly drawn field is empty: so is what the card remembers */
    i.addEventListener('input', () => { st.sec[n] = i.value; if (i.getAttribute('aria-invalid')) clearErr(); });
    /* paste-friendly: trim what was pasted and check it at once */
    i.addEventListener('paste', () => setTimeout(() => { i.value = i.value.trim(); st.sec[n] = i.value; const e = validate(card).filter((x) => x.name === n); if (e.length) showErrors(card, e); else clearErr(); }, 0));
  }
  for (const sw of form.querySelectorAll<HTMLInputElement>('.cd-field--switch input[role="switch"]')) {
    const name = sw.closest<HTMLElement>('.cd-field')?.dataset['field'] ?? '';
    st.vals[name] = sw.checked;
    sw.addEventListener('change', () => { st.vals[name] = sw.checked; });
  }
  for (const g of form.querySelectorAll<HTMLElement>('.cd-opts[data-group]')) wireOptions(card, g, st, props0, clearErr);
  for (const pk of form.querySelectorAll<HTMLButtonElement>('.cd-picker')) wirePicker(pk, st, props0, clearErr);
  for (const drop of form.querySelectorAll<HTMLElement>('.cd-drop')) {
    const name = drop.dataset['drop'] ?? '';
    drop.addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if ((e.target as HTMLInputElement).type === 'file' && f) setFile(card, name, f); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.dataset['over'] = ''; });
    drop.addEventListener('dragleave', () => { delete drop.dataset['over']; });
    drop.addEventListener('drop', (e) => { e.preventDefault(); delete drop.dataset['over']; const f = e.dataTransfer?.files[0]; if (f && formsHost().can.upload) setFile(card, name, f); });
  }
}

function wireOptions(card: HxCard, g: HTMLElement, st: FormState, props0: Readonly<Record<string, FieldSchema>>, clearErr: () => void): void {
  const name = g.dataset['group'] ?? '', p = props0[name];
  if (!p?.enum) return;
  const multi = !!p['x-multi'], opts = p.enum;
  const rows = Array.from(g.querySelectorAll<HTMLElement>('.cd-opt'));
  const other = g.querySelector<HTMLInputElement>('[data-other] input'), otherRow = g.querySelector<HTMLElement>('[data-other]');
  const pv = card.querySelector<HTMLElement>('.cd-preview[data-preview-for="' + name + '"]');
  const showPreview = (v: unknown): void => {
    if (!pv) return;
    const i = opts.indexOf(v), x = i >= 0 ? p['x-preview']?.[i] : null;
    pv.innerHTML = x ? (x.code != null ? '<pre class="cd-out">' + esc(x.code) + '</pre>' : '<p class="cd-text">' + fmt(x.text ?? '') + '</p>') + (x.note ? '<p class="cd-note">' + fmt(x.note) + '</p>' : '') : '<p class="cd-note">' + (v ? 'No preview for this answer.' : 'Pick an answer to preview it.') + '</p>';
  };
  const sync = (): void => {
    const v = st.vals[name];
    rows.forEach((r) => { const on = multi ? ((v as unknown[] | undefined) ?? []).map(String).includes(r.dataset['v'] ?? '') : String(v) === r.dataset['v']; r.setAttribute('aria-checked', String(on)); if (!multi) r.tabIndex = on ? 0 : -1; });
    if (!multi && !rows.some((r) => r.tabIndex === 0) && rows[0]) rows[0].tabIndex = 0;
    otherRow?.toggleAttribute('data-on', !multi && typeof v === 'string' && v !== '' && !opts.includes(v));
    if (d0(card).kind === 'permission' && name === 'scope') {
      const lbl = card.querySelector('.cd-foot [data-action="submit"] span');
      if (lbl) lbl.textContent = (PERMISSION[String(v)] ?? PERMISSION['once'])?.[0] ?? '';
    }
  };
  rows.forEach((r, i) => {
    r.addEventListener('click', () => {
      const v = opts[i];
      if (multi) { const cur = [...((st.vals[name] as unknown[] | undefined) ?? [])], k = cur.indexOf(v); if (k >= 0) cur.splice(k, 1); else cur.push(v); st.vals[name] = cur; }
      else { st.vals[name] = v; if (other) other.value = ''; }
      sync(); showPreview(multi ? null : v);
      if (r.getAttribute('aria-checked') === 'true') animate(r.querySelector('.cd-opt__ring'), [{ transform: 'scale(.5)' }, { transform: 'scale(1)' }], { preset: 'quick' });
      clearErr();
    });
    r.addEventListener('focus', () => showPreview(multi ? null : opts[i]));
  });
  g.addEventListener('keydown', (e) => {
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const dlt = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    if (!dlt) return;
    e.preventDefault();
    if (dlt > 0 && i === rows.length - 1 && other) { other.focus(); return; }
    const nx = rows[(i + dlt + rows.length) % rows.length];
    if (!nx) return;
    if (!multi) nx.click();
    nx.focus();
  });
  if (other) {
    other.addEventListener('input', () => { st.vals[name] = other.value.trim() ? other.value : (opts.includes(st.vals[name]) ? st.vals[name] : null); sync(); clearErr(); });
    other.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); rows[rows.length - 1]?.focus(); } });
  }
  sync(); showPreview(multi ? null : st.vals[name]);
}
const d0 = (card: HxCard): FormSpec => spec(card.data);

function wirePicker(pk: HTMLButtonElement, st: FormState, props0: Readonly<Record<string, FieldSchema>>, clearErr: () => void): void {
  const name = pk.dataset['name'] ?? '', kind = (pk.dataset['picker'] ?? 'folder') as PickerKind, p = props0[name];
  const set = (v: string): void => {
    st.vals[name] = v;
    const b = kind === 'teammate' ? bot(v) : undefined;
    const out = pk.querySelector('.cd-picker__v');
    if (out) out.textContent = b ? b.name : v;
    const lead = pk.firstElementChild;
    if (lead && (b || kind === 'model')) lead.outerHTML = pickLead(kind, v, b);
    clearErr();
  };
  pk.addEventListener('click', () => {
    if (kind === 'folder' && formsHost().can.folder) { void formsHost().pickFolder().then((v) => { if (v) set(v); }); return; }
    const items = pickerItems(kind).map((x) => (x['value'] != null && x['value'] !== '' ? { ...x, checked: st.vals[name] === x['value'] } : x));
    U.menu.open(pk, items as Parameters<typeof U.menu.open>[1], { label: p?.title || cap(name), onSelect: (v) => { set(String(v)); } });
  });
}
