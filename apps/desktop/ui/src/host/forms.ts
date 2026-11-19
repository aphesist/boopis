/* Forms (docs/FORMS.md): one model for every request to the user, whoever sends it. The renderer draws a FormModel and
   knows nothing of where it came from; these adapters turn each source into one and build the reply the source expects.
   - host: first-run setup (the host's `Form`), answered through `setup_advance`;
   - plugin: `plugin.hypotaxis.form.opened`, answered with `plugin.hypotaxis.form.submit` / `.cancel`;
   - hermes: the canonical `approval.request` and `clarify.request` events, answered through Hermes's own
     `approval.respond` / `clarify.respond` (never through the plugin).
   A secret field's value is split off by `splitSecrets` and goes to the host's keychain (`secret_set`), never into a frame
   to the gateway. Pure functions: no DOM, no host, no timers. */

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
  | { kind: 'hermes'; sessionId: string; method: 'approval.respond' | 'clarify.respond'; promptId: string; generation: number; multi: boolean };

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
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** the fields of an MCP-elicitation schema with the hypotaxis extensions; a field of an unsupported type is dropped */
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
    diff: f.diff.map((d) => ({ key: d.key, from: d.from ?? null, to: d.to })), source: { kind: 'host' }
  };
}

/** `plugin.hypotaxis.form.opened`'s payload */
export function fromPluginEvent(sessionId: string, p: Obj): FormModel | null {
  const id = str(p['form_id']);
  if (!id) return null;
  return {
    id, kind: str(p['kind'], 'question'), title: str(p['title'], 'hypotaxis needs something'), body: str(p['body']), fields: fieldsOf(p['schema']),
    submitLabel: label(p['submit'], 'Send'), cancelLabel: label(p['cancel'], 'Cancel'), hold: obj(p['submit'])['hold'] === true,
    sensitive: p['sensitive'] === true, origin: str(p['origin'], 'agent'), diff: [], source: { kind: 'plugin', sessionId }
  };
}

const CHOICE_NAMES: Readonly<Record<string, string>> = { once: 'Allow once', session: 'Allow for this session', always: 'Always allow', deny: 'Deny' };

/** Hermes's canonical `approval.request` and `clarify.request` events as forms; anything else is not a form */
export function fromGatewayEvent(type: string, sessionId: string, p: Obj): FormModel | null {
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
      source: { kind: 'hermes', sessionId, method: 'approval.respond', promptId, generation, multi: false }
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
      source: { kind: 'hermes', sessionId, method: 'clarify.respond', promptId, generation, multi }
    };
  }
  return null;
}

export interface Reply { method: string; params: Obj }

/** the frame that answers (or cancels) a form of the gateway or the plugin; the host's own forms answer through `setup_advance`, so none */
export function replyFor(form: FormModel, outcome: { cancelled: true } | { cancelled: false; values: Obj; provided?: readonly string[] }): Reply | null {
  const src = form.source;
  if (src.kind === 'host') return null;
  if (src.kind === 'plugin') {
    if (outcome.cancelled) return { method: 'plugin.hypotaxis.form.cancel', params: { session_id: src.sessionId, form_id: form.id } };
    return { method: 'plugin.hypotaxis.form.submit', params: { session_id: src.sessionId, form_id: form.id, values: outcome.values, provided: [...(outcome.provided ?? [])] } };
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
    secrets.push({ field: name, service: 'hypotaxis.' + (m[1] ?? ''), account: m[2] ?? '', value });
  }
  return { plain, secrets };
}
