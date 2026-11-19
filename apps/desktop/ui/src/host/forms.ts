/* Forms (docs/FORMS.md): one model for every request to the user, whoever sends it. The renderer draws a FormModel and
   knows nothing of where it came from; these adapters turn each source into one and build the reply the source expects.
   - host: first-run setup (the host's `Form`), answered through `setup_advance`;
   - plugin: `plugin.boopis.form.opened`, answered with `plugin.boopis.form.submit` / `.cancel`;
   - hermes: the canonical `approval.request` and `clarify.request` events, answered through Hermes's own
     `approval.respond` / `clarify.respond` (never through the plugin);
   - hermes, one-string prompts: the gateway's server requests `secret`, `sudo`, `vault.unlock_prompt`, `vault.save_login`
     and `vault.code` (`fromServerRequest`), answered with the JSON-RPC response Hermes waits for (`answerFor`).
   A secret field's value is split off by `splitSecrets` and goes to the host's keychain (`secret_set`), never into a frame
   to the gateway. Pure functions: no DOM, no host, no timers.
   Every adapter also builds the `FormSpec` the card draws (`model.spec`): the schema is kept whole (previews, pickers,
   uploads, sign-in and limits included), so there is one renderer and one adapter per source. */
import type { FieldSchema, FormKind, FormSchema, FormSpec, Origin } from '../data/types';
import type { LimitView } from './free-tier';
import { limitTitle, resetText } from './free-tier';

export interface FormField {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean';
  title: string;
  description: string;
  required: boolean;
  /** option values, when the field is a choice */
  options: readonly string[] | null;
  optionNames: readonly string[];
  multi: boolean;
  other: boolean;
  secret: boolean;
  /** `secret://<scope>/<name>`: where the host stores a secret field */
  secretRef: string | null;
  default: unknown;
}

export interface DiffLine { key: string; from: unknown; to: unknown }

export type FormSource =
  | { kind: 'host' }
  | { kind: 'plugin'; sessionId: string }
  | { kind: 'free-tier' }
  | { kind: 'hermes'; sessionId: string; method: 'approval.respond' | 'clarify.respond'; promptId: string; generation: number; multi: boolean }
  /** a server request of the gateway (`secret`, `sudo`, `vault.*`): answered by the response frame with the request's own id */
  | { kind: 'hermes-request'; sessionId: string; requestId: string; method: RequestMethod };

export interface FormModel {
  id: string;
  kind: string;
  title: string;
  body: string;
  fields: readonly FormField[];
  submitLabel: string;
  cancelLabel: string;
  hold: boolean;
  sensitive: boolean;
  origin: string;
  diff: readonly DiffLine[];
  source: FormSource;
  /** the form as the card draws it */
  spec: FormSpec;
}

const KINDS: ReadonlySet<string> = new Set<FormKind>(['credential', 'question', 'approval', 'permission', 'signin', 'setup', 'connector', 'choice', 'plan', 'feedback']);
const kindOf = (k: unknown): FormKind => (typeof k === 'string' && KINDS.has(k) ? (k as FormKind) : 'question');
/** who asks, from the sender's word for it (docs/FORMS.md section 4a); the agent is known by the model the session runs on.
    A teammate or an MCP server carries no name in the event, so none is shown: nothing is invented. */
export function originFor(origin: string, model: string): Origin {
  if (origin === 'agent') return { kind: 'agent', model };
  if (origin === 'plugin' || origin === 'hermes' || origin === 'host') return { kind: origin };
  if (origin === 'mcp') return { kind: 'mcp' };
  return { kind: 'teammate', ids: [] };
}
const timeOf = (v: unknown): number | undefined => { const n = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : undefined; };
const schemaOf = (v: unknown): FormSchema => { const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>; return { properties: (o['properties'] && typeof o['properties'] === 'object' ? o['properties'] : {}) as Record<string, FieldSchema>, required: Array.isArray(o['required']) ? o['required'].filter((x): x is string => typeof x === 'string') : [] }; };
interface SpecIn { id: string; kind: unknown; title: string; body: string; schema: unknown; submit: unknown; cancel: unknown; origin: Origin; expiresAt?: number | undefined; defer?: boolean }
function buildSpec(i: SpecIn): FormSpec {
  const submit = obj(i.submit), cancel = i.cancel === false ? false : obj(i.cancel);
  return {
    id: i.id, kind: kindOf(i.kind), title: i.title, schema: schemaOf(i.schema), origin: i.origin,
    ...(i.body ? { why: i.body } : {}),
    submit: { ...(typeof submit['label'] === 'string' ? { label: submit['label'] } : {}), ...(submit['hold'] === true ? { hold: true } : {}) },
    ...(cancel === false ? { cancel: false as const } : typeof cancel['label'] === 'string' ? { cancel: { label: cancel['label'] } } : {}),
    ...(i.expiresAt !== undefined ? { expiresAt: i.expiresAt } : {}),
    ...(i.defer === false ? { defer: false } : {})
  };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** the fields of an MCP-elicitation schema with the boopis extensions; a field of an unsupported type is dropped */
export function fieldsOf(schema: unknown): FormField[] {
  const s = obj(schema);
  const required = new Set(strings(s['required']));
  const out: FormField[] = [];
  for (const [name, raw] of Object.entries(obj(s['properties']))) {
    const f = obj(raw);
    const type = f['type'];
    if (type !== 'string' && type !== 'number' && type !== 'integer' && type !== 'boolean') continue;
    const options = Array.isArray(f['enum']) ? f['enum'].map(String) : null;
    out.push({
      name, type, title: str(f['title'], name), description: str(f['description']), required: required.has(name),
      options, optionNames: strings(f['enumNames']), multi: f['x-multi'] === true, other: f['x-other'] === true,
      secret: f['x-secret'] === true, secretRef: typeof f['x-secret-ref'] === 'string' ? f['x-secret-ref'] : null, default: f['default']
    });
  }
  return out;
}

const label = (j: unknown, d: string): string => str(obj(j)['label'], d);

/** the host's own form (first-run setup) */
export function fromHostForm(f: { form_id: string; kind: string; title: string; body: string; schema: unknown; submit: unknown; cancel: unknown; sensitive: boolean; origin: string; diff: readonly { key: string; from?: unknown; to: unknown }[] }): FormModel {
  return {
    id: f.form_id, kind: f.kind, title: f.title, body: f.body, fields: fieldsOf(f.schema), submitLabel: label(f.submit, 'Continue'),
    cancelLabel: label(f.cancel, 'Not now'), hold: obj(f.submit)['hold'] === true, sensitive: f.sensitive, origin: f.origin,
    diff: f.diff.map((d) => ({ key: d.key, from: d.from ?? null, to: d.to })), source: { kind: 'host' },
    spec: { ...buildSpec({ id: f.form_id, kind: f.kind, title: f.title, body: f.body, schema: f.schema, submit: f.submit, cancel: f.cancel, origin: { kind: 'host' }, defer: false }), ...(f.diff.length ? { diff: hostDiff(f.diff) } : {}) }
  };
}

/** the host's changes as the card's diff well: one line per setting, what it is now and what it becomes */
function hostDiff(diff: readonly { key: string; from?: unknown; to: unknown }[]): string {
  return diff.flatMap((d) => [...(d.from == null ? [] : ['-' + d.key + ': ' + JSON.stringify(d.from)]), '+' + d.key + ': ' + JSON.stringify(d.to)]).join('\n');
}

/** `plugin.boopis.form.opened`'s payload; `model` is the model the session runs on (the agent's origin) */
export function fromPluginEvent(sessionId: string, p: Obj, model = ''): FormModel | null {
  const id = str(p['form_id']);
  if (!id) return null;
  /* an origin is a word, or an object: a mod's is `{kind: 'mod', plugin}` (a mod's `$.ui.ask` and its permission asks) */
  const raw = p['origin'], mod = obj(raw)['kind'] === 'mod' && str(obj(raw)['plugin']) ? { kind: 'mod' as const, plugin: str(obj(raw)['plugin']) } : null;
  const origin = typeof raw === 'string' ? raw : mod ? 'mod' : 'agent';
  return {
    id, kind: str(p['kind'], 'question'), title: str(p['title'], 'boopis needs something'), body: str(p['body']), fields: fieldsOf(p['schema']),
    submitLabel: label(p['submit'], 'Send'), cancelLabel: label(p['cancel'], 'Cancel'), hold: obj(p['submit'])['hold'] === true,
    sensitive: p['sensitive'] === true, origin, diff: [], source: { kind: 'plugin', sessionId },
    spec: buildSpec({ id, kind: p['kind'], title: str(p['title'], 'boopis needs something'), body: str(p['body']), schema: p['schema'], submit: p['submit'], cancel: p['cancel'], origin: mod ?? originFor(origin, model), expiresAt: timeOf(p['expires_at']) })
  };
}

const CHOICE_NAMES: Readonly<Record<string, string>> = { once: 'Allow once', session: 'Allow for this session', always: 'Always allow', deny: 'Deny' };

/** Hermes's canonical `approval.request` and `clarify.request` events as forms; anything else is not a form */
export function fromGatewayEvent(type: string, sessionId: string, p: Obj, model = ''): FormModel | null {
  const promptId = str(p['prompt_id']);
  const generation = typeof p['execution_generation'] === 'number' ? p['execution_generation'] : null;
  if (!promptId || generation === null) return null;
  if (type === 'approval.request') {
    const choices = strings(p['choices']);
    const field: FormField = {
      name: 'choice', type: 'string', title: 'Decision', description: '', required: true, options: choices, optionNames: choices.map((c) => CHOICE_NAMES[c] ?? c),
      multi: false, other: false, secret: false, secretRef: null, default: choices.includes('once') ? 'once' : choices[0]
    };
    const command = str(p['command']);
    return {
      id: promptId, kind: 'approval', title: 'Allow this command?', body: [str(p['description']), command].filter(Boolean).join('\n'), fields: [field],
      submitLabel: 'Decide', cancelLabel: 'Deny', hold: false, sensitive: false, origin: 'hermes', diff: [],
      source: { kind: 'hermes', sessionId, method: 'approval.respond', promptId, generation, multi: false },
      spec: buildSpec({ id: promptId, kind: 'permission', title: 'Allow this command?', body: [str(p['description']), command].filter(Boolean).join('\n'), origin: { kind: 'hermes' },
        schema: { properties: { choice: { type: 'string', title: 'Decision', enum: choices, enumNames: choices.map((c) => CHOICE_NAMES[c] ?? c), default: choices.includes('once') ? 'once' : choices[0] } }, required: ['choice'] }, submit: { label: 'Decide' }, cancel: { label: 'Deny' } })
    };
  }
  if (type === 'clarify.request') {
    const choices = strings(p['choices']);
    const multi = p['multi_select'] === true;
    const field: FormField = {
      name: 'answer', type: 'string', title: 'Answer', description: '', required: false, options: choices.length ? choices : null, optionNames: [],
      multi, other: choices.length > 0, secret: false, secretRef: null, default: undefined
    };
    return {
      id: promptId, kind: 'question', title: str(p['question'], 'Hermes has a question'), body: '', fields: [field], submitLabel: 'Answer', cancelLabel: 'Skip',
      hold: false, sensitive: false, origin: 'hermes', diff: [],
      source: { kind: 'hermes', sessionId, method: 'clarify.respond', promptId, generation, multi },
      spec: buildSpec({ id: promptId, kind: 'question', title: str(p['question'], 'Hermes has a question'), body: '', origin: originFor(model ? 'agent' : 'hermes', model),
        schema: { properties: { answer: { type: 'string', title: 'Answer', ...(choices.length ? { enum: choices, 'x-other': true, ...(multi ? { 'x-multi': true } : {}) } : {}) } }, required: [] }, submit: { label: 'Answer' }, cancel: { label: 'Skip' } })
    };
  }
  return null;
}

/** the choices a free-tier limit offers: Hermes never switches model on its own, so the person is asked */
export const LIMIT_CHOICES = ['choose', 'wait'] as const;

/** A turn the free tier refused, as a notice with the other ways on (docs/FORMS.md section 4): Hermes's own sentence and
    when it says the limit lifts, then "choose another model" (setup's models question, with every choice Hermes can still
    offer) or "wait". Nothing is invented: no allowance size, no time Hermes did not give. `now` and `key` make the form id
    unique per refusal, so a limit hit again later is shown again. */
export function fromFreeTierLimit(limit: LimitView, key: string, now = Date.now()): FormModel {
  const id = 'free-tier-limit:' + key;
  const title = limitTitle(limit.code);
  const body = [limit.message, resetText(limit.resetsAtMs, now)].filter(Boolean).join('\n');
  const names = ['Choose another model', limit.resetsAtMs ? 'Wait until it lifts' : 'Wait and try again'];
  const field: FormField = { name: 'choice', type: 'string', title: 'What next', description: '', required: true, options: LIMIT_CHOICES, optionNames: names, multi: false, other: false, secret: false, secretRef: null, default: 'choose' };
  return {
    id, kind: 'choice', title, body, fields: [field], submitLabel: 'Continue', cancelLabel: 'Dismiss', hold: false, sensitive: false, origin: 'hermes', diff: [],
    source: { kind: 'free-tier' },
    spec: buildSpec({ id, kind: 'choice', title, body, origin: { kind: 'hermes' }, schema: { properties: { choice: { type: 'string', title: 'What next', enum: [...LIMIT_CHOICES], enumNames: names, default: 'choose' } }, required: ['choice'] }, submit: { label: 'Continue' }, cancel: { label: 'Dismiss' } })
  };
}

export interface Reply { method: string; params: Obj }

/** the frame that answers (or cancels) a form of the gateway or the plugin; the host's own forms answer through `setup_advance`, and a
    server request of the gateway is answered by a response frame (`answerFor`), so none */
export function replyFor(form: FormModel, outcome: { cancelled: true } | { cancelled: false; values: Obj; provided?: readonly string[] }): Reply | null {
  const src = form.source;
  if (src.kind === 'host' || src.kind === 'free-tier' || src.kind === 'hermes-request') return null;
  if (src.kind === 'plugin') {
    if (outcome.cancelled) return { method: 'plugin.boopis.form.cancel', params: { session_id: src.sessionId, form_id: form.id } };
    return { method: 'plugin.boopis.form.submit', params: { session_id: src.sessionId, form_id: form.id, values: outcome.values, provided: [...(outcome.provided ?? [])] } };
  }
  const base = { session_id: src.sessionId, execution_generation: src.generation, prompt_id: src.promptId };
  if (src.method === 'approval.respond') {
    const choice = outcome.cancelled ? 'deny' : str(outcome.values['choice'], 'deny');
    return { method: src.method, params: { ...base, choice } };
  }
  const raw = outcome.cancelled ? '' : outcome.values['answer'];
  const answer = Array.isArray(raw) ? raw.map(String).join(', ') : typeof raw === 'string' ? raw : '';
  return { method: src.method, params: { ...base, answer } };
}

export interface SecretTarget { field: string; service: string; account: string; value: string }

/** Split submitted values into what may go to the agent and what belongs in the keychain. A secret field with no reference
    is an error (nothing could store it); an empty secret is left out. */
export function splitSecrets(form: FormModel, values: Obj): { plain: Obj; secrets: SecretTarget[] } {
  const plain: Obj = {};
  const secrets: SecretTarget[] = [];
  const secretFields = new Map(form.fields.filter((f) => f.secret).map((f) => [f.name, f]));
  for (const [name, value] of Object.entries(values)) {
    const field = secretFields.get(name);
    if (!field) { plain[name] = value; continue; }
    if (typeof value !== 'string' || value === '') continue;
    const m = /^secret:\/\/([a-z0-9][a-z0-9_.-]*)\/([a-z0-9][a-z0-9_.-]*)$/.exec(field.secretRef ?? '');
    if (!m) throw new Error('The secret field ' + name + ' names no place to store it');
    secrets.push({ field: name, service: 'boopis.' + (m[1] ?? ''), account: m[2] ?? '', value });
  }
  return { plain, secrets };
}

/* ───────── Hermes's one-string prompts: secret, sudo, vault.* (docs/FORMS.md section 6) ───────── */

/** The gateway's server requests that ask the person for one string (`tui_gateway/contracts/server_requests.py`, Hermes
    v0.23.2). They are JSON-RPC requests from the gateway with a string id (`srq-...`), not events: the answer is the
    response frame `{id, result: {value}}`, and an empty `value` is "skipped". The gateway withdraws one with the event
    `request.cancel {id, method, reason}`. Nothing else asks the person for a string, so nothing else is listed. */
export const REQUEST_METHODS = ['secret', 'sudo', 'vault.unlock_prompt', 'vault.save_login', 'vault.code'] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];
export const isRequestMethod = (m: string): m is RequestMethod => (REQUEST_METHODS as readonly string[]).includes(m);

/** the form's own copy and fields for one request */
interface RequestCopy { title: string; why: string; effect: string; schema: FormSchema; submit: string; cancel: string }
/** inline code, unless the text holds a backtick (then plain: a code chip could not show it whole) */
const chip = (s: string): string => (s.includes('`') ? s : '`' + s + '`');
const secretField = (title: string): FieldSchema => ({ type: 'string', title, 'x-secret': true });
/** sentences joined into one paragraph; a part Hermes wrote without a full stop gets one */
const sentence = (...parts: string[]): string => parts.map((x) => x.trim()).filter(Boolean).map((x) => (/[.!?]$/.test(x) ? x : x + '.')).join(' ');

function copyFor(method: RequestMethod, p: Obj): RequestCopy {
  switch (method) {
    case 'secret': {
      /* `metadata` is what the skill declared: its name, and the `help` and `required_for` it wrote */
      const env = str(p['env_var']), meta = obj(p['metadata']), skill = str(meta['skill_name']), needed = str(meta['required_for']);
      return {
        title: 'Hermes needs ' + (env || 'a credential'),
        why: sentence(str(p['prompt']) || 'Hermes needs a value to continue.', skill ? 'It is for the ' + chip(skill) + ' skill.' : '', needed ? 'Needed for ' + needed + '.' : '', str(meta['help'])),
        effect: 'Hermes saves it in this profile’s `.env`. The model never sees it.',
        schema: { properties: { value: secretField(env || 'Value') }, required: ['value'] }, submit: 'Send to Hermes', cancel: 'Skip'
      };
    }
    case 'sudo': {
      const command = str(p['command']).trim();
      return {
        title: 'Hermes needs your sudo password',
        why: command ? 'It wants to run ' + chip(command) + ' as an administrator.' : 'Hermes did not say which command this is for. Skip it if you cannot check the command in the conversation.',
        effect: 'Hermes uses it to run the command and keeps it for this session. It is not part of the conversation.',
        schema: { properties: { password: secretField('sudo password') }, required: ['password'] }, submit: 'Send to Hermes', cancel: 'Cancel'
      };
    }
    case 'vault.unlock_prompt': {
      const name = str(p['display_name']) || str(p['backend']) || 'the password manager';
      return {
        title: 'Unlock ' + name,
        why: 'Hermes wants to sign into a site with a login saved in ' + name + '. Enter your master password to unlock it for this session.',
        effect: 'It goes straight to ' + name + ' on this machine. The model never sees it.',
        schema: { properties: { password: secretField('Master password') }, required: ['password'] }, submit: 'Unlock', cancel: 'Keep locked'
      };
    }
    case 'vault.save_login': {
      const origin = str(p['origin']), site = str(p['site']) || origin;
      return {
        title: 'Save your ' + (site || 'site') + ' login?',
        why: origin ? 'Hermes reached a sign-in page at ' + origin + ' and has no login for it. Enter it once here.' : 'Hermes reached a sign-in page and has no login for it. Enter it once here.',
        effect: 'It goes to Hermes’s vault and is filled into the page. The model never sees the password.',
        schema: { properties: { identifier: { type: 'string', title: 'Email or username', placeholder: 'you@example.com' }, password: secretField('Password') }, required: ['identifier', 'password'] },
        submit: 'Save and sign in', cancel: 'Don’t save'
      };
    }
    case 'vault.code': {
      const site = str(p['site']);
      return {
        title: 'Verification code' + (site ? ' for ' + site : ''),
        why: sentence(site ? site + ' is asking for a one-time code (text message, email or an authenticator app).' : 'A site is asking for a one-time code (text message, email or an authenticator app).', str(p['hint'])),
        effect: 'Hermes types it into the page. The model never sees it.',
        schema: { properties: { code: secretField('Code') }, required: ['code'] }, submit: 'Enter code', cancel: 'Skip'
      };
    }
  }
}

/** A gateway server request that asks for a string, as a `credential` form. The value is for Hermes's own reply and no one
    else: it is not stored in the keychain (Hermes saves a secret itself) and boopis keeps no record of it, only that the
    form was answered. `null` for any other method, and for one with no id or session to answer it by. */
export function fromServerRequest(method: string, id: string | number, p: Obj): FormModel | null {
  if (!isRequestMethod(method)) return null;
  const requestId = String(id), sessionId = str(p['session_id']);
  if (!requestId || !sessionId) return null;
  const c = copyFor(method, p);
  return {
    id: requestId, kind: 'credential', title: c.title, body: c.why, fields: fieldsOf(c.schema), submitLabel: c.submit, cancelLabel: c.cancel,
    hold: false, sensitive: true, origin: 'hermes', diff: [], source: { kind: 'hermes-request', sessionId, requestId, method },
    /* Hermes gives no deadline on the request (it waits its own 120 or 180 seconds and then withdraws it), so none is drawn */
    spec: { ...buildSpec({ id: requestId, kind: 'credential', title: c.title, body: c.why, schema: c.schema, submit: { label: c.submit }, cancel: { label: c.cancel }, origin: { kind: 'hermes' } }), effect: c.effect, receipt: 'Sent to Hermes', busyText: 'Sending to Hermes' }
  };
}

/** what the gateway's response frame carries for a request (`ValueResult`): the string, or '' for "skipped" (Hermes reads that
    as declined). `values` are the form's plain fields and `secrets` its masked ones; this is the only place a secret is read. */
export function answerFor(form: FormModel, outcome: { cancelled: true } | { cancelled: false; values: Obj; secrets: Readonly<Record<string, string>> }): { value: string } | null {
  const src = form.source;
  if (src.kind !== 'hermes-request') return null;
  if (outcome.cancelled) return { value: '' };
  const secret = (name: string): string => outcome.secrets[name] ?? '';
  switch (src.method) {
    case 'secret': return { value: secret('value') };
    case 'sudo': case 'vault.unlock_prompt': return { value: secret('password') };
    /* the pair as one JSON string, as Hermes's own card sends it */
    case 'vault.save_login': {
      const identifier = str(outcome.values['identifier']).trim(), password = secret('password');
      return { value: identifier && password ? JSON.stringify({ identifier, password }) : '' };
    }
    /* a code is typed with spaces or dashes: Hermes types it into a page, so they go */
    case 'vault.code': return { value: secret('code').replace(/[\s-]/g, '') };
  }
}
