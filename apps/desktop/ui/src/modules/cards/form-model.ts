/* What a form is, without a DOM: the kind templates (stamp, submit label, receipts), reading a schema, validation and the
   words a receipt says back. docs/FORMS.md sections 1 and 2. A kind is a template (data), never a new component. */
import type { FieldSchema, FormSpec } from '../../data';

export type Values = Record<string, unknown>;
export interface KindTemplate {
  stamp: string; submit: string | null; busy: string; hold?: boolean; cancel?: string | false;
  done: string | ((f: FormSpec, answer: string, raw: string) => string); cancelled?: string;
}
export const PERMISSION: Readonly<Record<string, readonly [label: string, receipt: string]>> = {
  once: ['Allow once', 'Allowed once'],
  session: ['Allow for this session', 'Allowed for this session'],
  always: ['Always allow in this project', 'Always allowed in this project'],
  deny: ['Deny', 'Denied']
};
export const FORM_KINDS: Readonly<Record<string, KindTemplate>> = {
  credential: { stamp: 'needs you', submit: 'Save key', busy: 'Saving to your keychain', done: (f) => f.receipt || 'Saved to your keychain' + (f.provider ? '. The ' + f.provider + ' provider is connected' : '') },
  question: { stamp: 'waiting for you', submit: 'Answer', busy: 'Sending your answer', done: (_f, v) => 'Answered' + (v ? ': ' + v : '') },
  approval: { stamp: 'needs you', submit: 'Hold to approve', hold: true, cancel: 'Deny', busy: 'Approving', done: () => 'Approved', cancelled: 'Denied' },
  permission: { stamp: 'needs you', submit: 'Allow once', busy: 'Writing the rule', done: (_f, _v, raw) => PERMISSION[raw]?.[1] ?? 'Answered' },
  signin: { stamp: 'needs you', submit: null, busy: 'Waiting for your browser', done: (f) => 'Signed in' + (f.provider ? ' to ' + f.provider : '') },
  setup: { stamp: 'needs you', submit: 'Write config', busy: 'Writing the config', done: (f) => 'Wrote ' + (f.file || 'the config') },
  connector: { stamp: 'needs you', submit: 'Install', hold: true, busy: 'Installing', done: (f) => f.receipt || 'Installed ' + (f.name || 'the connector') },
  choice: { stamp: 'waiting for you', submit: 'Use this', busy: 'Saving', done: (_f, v) => 'Chose ' + v },
  plan: { stamp: 'needs you', submit: 'Approve plan', cancel: 'Reject', busy: 'Starting the work', done: () => 'Plan approved', cancelled: 'Plan rejected' },
  feedback: { stamp: '', submit: 'Send', cancel: false, busy: 'Saving', done: () => 'Thanks. Stored for you only' },
  /** a mod's colours (MODS.md section 3): not owed, so no stamp; Keep applies them, Reject leaves the theme as it is */
  theme: { stamp: '', submit: 'Keep', cancel: 'Reject', busy: 'Applying', done: (f) => f.receipt || 'Kept', cancelled: 'Rejected' }
};
/** a form the UI answers itself: a theme card is Keep or Reject in the app's own theme, and no provider hears of it */
export const isLocalForm = (d: Pick<FormSpec, 'kind'>): boolean => d.kind === 'theme';
export const formT = (d: Pick<FormSpec, 'kind'>): KindTemplate => FORM_KINDS[d.kind] ?? (FORM_KINDS['question'] as KindTemplate);
export const props = (d: Pick<FormSpec, 'schema'>): Array<[string, FieldSchema]> => Object.entries(d.schema?.properties ?? {});
export const isReq = (d: Pick<FormSpec, 'schema'>, name: string): boolean => (d.schema?.required ?? []).includes(name);
export const holdForm = (d: Pick<FormSpec, 'kind' | 'submit'>): boolean => (d.submit?.hold != null ? d.submit.hold : !!formT(d).hold);
export const hasCancel = (d: Pick<FormSpec, 'kind' | 'cancel'>): boolean => d.cancel !== false && formT(d).cancel !== false;
/* the brand stays lowercase at the start of a sentence too (design system section 2) */
export const cap = (s: unknown): string => { const t = String(s == null ? '' : s); return /^boopis\b/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1); };
export function optLabel(p: FieldSchema, v: unknown): string {
  const i = (p.enum ?? []).indexOf(v);
  return i >= 0 && p.enumNames?.[i] != null ? String(p.enumNames[i]) : String(v);
}
/** the text a receipt says for a finished form (the kind's words) */
export function receiptText(d: FormSpec, answer: string, raw: string): string {
  const t = formT(d);
  return typeof t.done === 'function' ? t.done(d, answer, raw) : t.done;
}
const isEmpty = (v: unknown): boolean => v == null || v === '' || (Array.isArray(v) && v.length === 0);

export interface FieldError { name: string; title: string; msg: string }
/** Validate a form's values (and the presence of its secrets: a secret's value is never read here, only whether it is there).
    `signedIn` says which sign-in fields were completed. Messages are plain words a person can act on. */
export function validateForm(d: FormSpec, vals: Values, secrets: Readonly<Record<string, string | null | undefined>>, signedIn: ReadonlySet<string> = new Set()): FieldError[] {
  const errs: FieldError[] = [];
  for (const [name, p] of props(d)) {
    const req = isReq(d, name), title = p.title || cap(name);
    const v = p['x-secret'] ? secrets[name] : vals[name];
    let msg = '';
    if (p['x-signin']) { if (req && !signedIn.has(name)) msg = 'Sign in to ' + (p['x-signin'].provider || 'continue') + ' first'; }
    else if (isEmpty(v)) { if (req) msg = p.enum || p['x-picker'] ? 'Choose ' + title.toLowerCase() : p['x-upload'] ? 'Add a file' : 'Enter ' + title.toLowerCase(); }
    else if (p.type === 'number' || p.type === 'integer') {
      const num = Number(v);
      if (!isFinite(num) || String(v).trim() === '') msg = 'Enter a number';
      else if (p.type === 'integer' && !Number.isInteger(num)) msg = 'Use a whole number';
      else if ((p.minimum != null && num < p.minimum) || (p.maximum != null && num > p.maximum)) msg = 'Use a number from ' + (p.minimum != null ? p.minimum : '−∞') + ' to ' + (p.maximum != null ? p.maximum : '∞');
    } else if (typeof v === 'string') {
      const sv = v.trim();
      if (p.minLength && sv.length < p.minLength) msg = p['x-error'] || title + ' is too short: it needs at least ' + p.minLength + ' characters';
      else if (p.maxLength && sv.length > p.maxLength) msg = title + ' is too long: keep it under ' + p.maxLength + ' characters';
      else if (p.pattern && !safeRegExp(p.pattern).test(sv)) msg = p['x-error'] || 'That doesn’t look like ' + title.toLowerCase();
      else if (p.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sv)) msg = 'Enter an email address, like name@example.com';
      else if (p.format === 'uri' && !/^https?:\/\/\S+$/.test(sv)) msg = 'Enter a full address, starting with https://';
    }
    if (msg) errs.push({ name, title, msg });
  }
  return errs;
}
/** a pattern from a schema is data from outside: one that is not a regular expression never matches, so it is shown as an error, not thrown */
function safeRegExp(src: string): RegExp {
  try { return new RegExp(src); } catch { return /(?!)/; }
}

/** the answer, said back in the receipt (secrets and sign-ins never: they are "provided") */
export function answerText(d: FormSpec, vals: Values, teammateName: (id: string) => string | null): string {
  for (const [name, p] of props(d)) {
    if (p['x-secret'] || p['x-signin']) continue;
    const v = vals[name];
    if (isEmpty(v)) continue;
    if (Array.isArray(v)) return v.map((x) => optLabel(p, x)).join(', ');
    if (p['x-picker'] === 'teammate') { const n = teammateName(String(v)); if (n) return n; }
    if (p.type === 'boolean') return (p.title || name) + (v ? ' on' : ' off');
    if (p['x-upload']) return String((v as { name?: unknown }).name ?? '');
    return p.enum ? optLabel(p, v) : String(v);
  }
  return '';
}
/** the non-secret values a form sends, with a default read in when the user left the field alone */
export function valuesOf(d: FormSpec, vals: Values): Values {
  const out: Values = {};
  for (const [name, p] of props(d)) {
    if (p['x-secret'] || p['x-signin']) continue;
    const v = vals[name] !== undefined ? vals[name] : p.default;
    if (v === undefined || (v === '' && !isReq(d, name))) continue;
    out[name] = p.type === 'number' || p.type === 'integer' ? (typeof v === 'string' && v.trim() !== '' ? Number(v) : v) : v;
  }
  return out;
}
/** the secret fields a form has, by name */
export const secretFields = (d: FormSpec): string[] => props(d).filter(([, p]) => p['x-secret']).map(([n]) => n);
