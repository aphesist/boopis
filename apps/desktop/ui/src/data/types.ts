/* The entities the UI reads. They are plain data (no functions, no DOM): the mock provider fills them from
   mock-data.ts today and the live provider (Hermes gateway and the hypotaxis plugin's streams) fills the same
   shapes later. A field that is `null` is unknown and the UI shows it as unknown (AGENTS.md invariant 5). */

export interface User { name: string; initials: string }

/* ───────── bots ───────── */
export type BotState = 'idle' | 'listening' | 'thinking' | 'working' | 'compute' | 'speaking' | 'needs' | 'done' | 'happy' | 'sleeping' | 'error';
export type Governance = 'governed' | 'ungoverned';
export interface BotConfig {
  instructions: string;
  gov: Governance;
  model: string;
  /** dollars per run, as typed ("0.60") */
  cap: string;
  /** a five-field cron expression, or '' for "only when asked" */
  cron: string;
  channels: Readonly<Record<string, boolean>>;
  approvals: Readonly<Record<string, boolean>>;
  workspace: 'worktree' | 'sandbox';
}
export interface Bot {
  id: string; name: string; role: string;
  /** the orb2 look: bot data, not interface colour */
  shape: string; color: string; eyes: string;
  state: BotState | string;
  /** what the bot waits on the user for ('approval'), else null */
  attention: string | null;
  paused: boolean;
  /** what a busy bot is doing, in words ('' when unknown) */
  activity: string;
  /** dollars spent today, as shown ("0.11") */
  spent: string;
  /** its last message, for a bot with no thread yet; null when unknown */
  last: { t: string; text: string } | null;
  /** a few things to ask it, shown on an empty thread */
  ideas: readonly string[];
  cfg: BotConfig;
}
export interface BotDraft { name: string; role: string; shape: string; color: string; eyes: string }
export interface BotSuggestion { name: string; desc: string; shape: string; color: string }
export interface Choice { id: string; name: string; hint?: string }
export interface BotCatalog {
  models: readonly string[];
  /** where a bot can be reached; 'app' is always on */
  channels: readonly Choice[];
  /** what it asks before doing */
  approvals: readonly Choice[];
  suggestions: readonly BotSuggestion[];
}

/** an approval request: the data of an `approval` card */
export interface ApprovalData {
  id?: string; title: string; quote?: string; item?: readonly string[]; meta?: string; from?: string;
  actions?: readonly string[];
}
export interface TextMessage { kind: 'text'; id: string; who: string; t: string; text: string; via?: 'bots' | 'dock' }
export interface ApprovalMessage { kind: 'approval'; id: string; who: string; t: string; data: ApprovalData; resolved?: 'approved' | 'denied'; resolvedAt?: string }
export type ThreadMessage = TextMessage | ApprovalMessage;

/* ───────── what waits on the user ───────── */
export interface BlankData {
  question: string; short: string; options: readonly string[]; answer?: string | undefined; model?: string;
  /** what answering rewrites the sentence it sits in into: the words before the answer and after it */
  rewrites?: Readonly<Record<string, { lead: string; tail: string }>>;
  /** the live provider's: the blank's id on the plugin, and the words around an answer that matches no option */
  id?: string;
  free?: readonly [lead: string, tail: string];
}
export interface ApprovalWait { id: string; kind: 'approval'; bot: string; who: string; title: string; data: ApprovalData }
export interface BlankWait { id: string; kind: 'blank'; bot?: undefined; who: string; title: string; data: BlankData }
export interface FormWait { id: string; kind: 'form'; bot?: undefined; who: string; title: string; data: FormSpec }
export type Wait = ApprovalWait | BlankWait | FormWait;
export type WaitOutcome = 'approved' | 'denied' | string;

/* ───────── forms (docs/FORMS.md): one schema-driven card for everything that needs the user ───────── */
export type FormKind = 'credential' | 'question' | 'approval' | 'permission' | 'signin' | 'setup' | 'connector' | 'choice' | 'plan' | 'feedback';
export type PickerKind = 'folder' | 'file' | 'model' | 'repo' | 'host' | 'teammate' | 'branch';
/** who is asking (FORMS.md section 4a); the same slot draws every card, in every place a card can appear */
export type Origin =
  | { kind: 'teammate'; ids?: readonly string[]; id?: string; via?: string | null }
  | { kind: 'agent'; model: string }
  | { kind: 'plugin' | 'hermes' | 'host' }
  | { kind: 'mcp'; server?: string; trust?: string };
/** a field of MCP elicitation's `requestedSchema` plus the hypotaxis extensions */
export interface FieldSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean';
  title?: string; description?: string; default?: unknown; format?: string; placeholder?: string;
  enum?: readonly unknown[]; enumNames?: readonly string[];
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string;
  'x-secret'?: boolean; 'x-secret-ref'?: string; 'x-multi'?: boolean; 'x-other'?: boolean; 'x-multiline'?: boolean; 'x-mono'?: boolean; 'x-error'?: string;
  /** one preview per option, in the order of `enum` (code, text or a note) */
  'x-preview'?: ReadonlyArray<{ code?: string; text?: string; note?: string } | null>;
  'x-picker'?: PickerKind; 'x-upload'?: boolean;
  'x-signin'?: { provider?: string; flow?: 'browser' | 'device'; host?: string };
}
export interface FormSchema { type?: 'object'; properties?: Readonly<Record<string, FieldSchema>>; required?: readonly string[] }
/** a form as the card draws it */
export interface FormSpec {
  id: string; kind: FormKind; title: string; schema: FormSchema;
  /** why it is needed, and what happens on submit */
  why?: string; effect?: string;
  origin?: Origin;
  submit?: { label?: string; hold?: boolean };
  cancel?: { label?: string } | false;
  /** the form lapses at this time (ms since the epoch); `expires` is its words ("expires in 9 min") */
  expiresAt?: number; expires?: string;
  /** what shows before the fields: a config diff, a plan, a connector's contents */
  diff?: string; file?: string; plan?: readonly string[]; contents?: ReadonlyArray<readonly [string, string?]>; pinned?: string;
  provider?: string; name?: string; scope?: string; receipt?: string;
}
/** what a submitted form carries: the non-secret values, and the secret fields' values for the host's keychain alone */
export interface FormOutcome { values: Readonly<Record<string, unknown>>; secrets: Readonly<Record<string, string>> }
export type FormStatus = 'submitted' | 'cancelled' | 'expired';
/** what this build can do for the fields that reach outside the page */
export interface FormCan { signin: boolean; upload: boolean; folder: boolean }
export interface PickerItem { value: string; label: string; desc?: string }

/* ───────── sessions ───────── */
export interface SessionSummary { id: string; project: string; title: string; when: string; running?: boolean }
export interface Step { title: string; mono?: boolean; meta?: readonly string[]; time: string; kind?: 'step' | 'fail' | 'escalate' }
export interface Ship { title: string; quote: string; passed: number; rolledBack: number; files: number; add: number; del: number; branch: string }
export interface UserTurn { id: string; role: 'user'; at: string; text: string }
export interface AgentTurn {
  id: string; role: 'assistant';
  /** "qwen3-coder → sonnet 5.5": the models the turn ran on (the agent has no name) */
  model: string;
  /** elapsed and cost as shown ("3m 42s", "$0.37") */
  time: string; cost: string;
  stepCount: number; steps: readonly Step[];
  paragraphs: readonly string[]; bullets: readonly string[];
  blank?: BlankData | undefined; ship?: Ship | undefined;
  /** the forms the agent (or the plugin) opened in this turn, open or answered */
  forms?: readonly FormSpec[] | undefined;
  status: 'done' | 'running' | 'stopped';
}
export type Turn = UserTurn | AgentTurn;
export interface Conversation { turns: readonly Turn[] }
export type ConversationEvent =
  | { type: 'turn-added'; turn: Turn }
  | { type: 'step-added'; turnId: string; step: Step }
  | { type: 'turn-finished'; turnId: string; time: string; cost: string; stepCount: number; paragraphs: readonly string[]; stopped: boolean }
  | { type: 'blank-answered'; turnId: string; answer: string }
  /** a blank was opened while the turn runs (the live provider's, additive) */
  | { type: 'blank-opened'; turnId: string; blank: BlankData }
  /** a form was opened where this turn raised it, and later answered, cancelled or lapsed (here or in another place) */
  | { type: 'form-opened'; turnId: string; form: FormSpec }
  | { type: 'form-resolved'; turnId: string; formId: string; status: FormStatus; receipt?: string }
  /** the running turn's answer so far (the live provider streams it; the mock sends the whole answer with `turn-finished`) */
  | { type: 'turn-text'; turnId: string; paragraphs: readonly string[] }
  /** the whole conversation changed under the reader (a transcript loaded, or events were lost): read the snapshot again */
  | { type: 'reset' };

export interface DiffFile { path: string; add: number; del: number; hunks: ReadonlyArray<readonly [header: string, lines: readonly string[]]> }
export interface SendMeta { governed: boolean; smart: boolean; model: string; assume: readonly string[] }

/* ───────── the details panel ───────── */
export interface ContextUsage { total: number; parts: ReadonlyArray<readonly [label: string, tokens: number]> }
export type TodoState = 'done' | 'doing' | 'todo';
export type Todo = readonly [text: string, state: TodoState];
/** [path, added lines, removed lines] */
export type Change = readonly [path: string, add: number, del: number];
export interface Connector {
  name: string; tools: number; state: 'on' | 'off' | 'sign in';
  /** what to say instead of "N tools" when the count is unknown (a server only found in a project's Claude settings) */
  hint?: string;
}
export interface Environment { cwd: string; branch: string; sandbox: string; runtime: string; harness: string; gate: string }
export interface GovernanceState {
  governed: boolean; smart: boolean; model: string; cap: string; spent: string;
  /** the model ladder: [model, when it is used] */
  ladder: ReadonlyArray<readonly [model: string, rule: string]>;
  /** the station the session is on */
  current: number;
  /** the mode can no longer change: the first message was sent (prompt caching) */
  locked?: boolean;
}
export interface LedgerStats { tokens: string; cost: string; trips: number; escalations: number }

/** the run the dock shows */
export interface RunSnapshot {
  title: string; model: string; step: number; escalated: number;
  /** seconds */
  elapsed: number;
  /** dollars */
  cost: number | null; cap: number | null;
  ladder: ReadonlyArray<readonly [model: string, rule: string]>; current: number;
  tokens: string; trips: number; governed: boolean; network: boolean; stopped: boolean;
}
/** the honest "unknown" or "not available" sentence of a details panel, by panel (the live provider's; additive) */
export type DetailsNotes = Partial<Record<'context' | 'tasks' | 'changes' | 'output' | 'governance' | 'connectors' | 'environment' | 'run', string>>;
/** what the followed session's panels can do, so a control that would pretend is disabled (the live provider's) */
export interface DetailsCan { compact: boolean; connectors: boolean; signIn: boolean }
/** one completion of a `@` mention */
export interface FileCompletion { text: string; display: string; meta: string }
export interface FileCompletions { items: readonly FileCompletion[]; /** why there are none, when the gateway cannot say */ unavailable?: string }
/** what the provider is, so the UI marks what is a preview and hides what this Hermes cannot do */
export type PreviewSource = 'bots' | 'schedules' | 'feedforward';
export interface ProviderInfo {
  /** true for the live provider; a mock provider never claims it */
  live: boolean;
  /** sources that are the mock's own data in a live build: the UI marks them as preview and keeps them out of live counts */
  preview: ReadonlySet<PreviewSource>;
  /** features this Hermes does not have, with the reason (`sessions.fork`, ...) */
  unavailable: Readonly<Record<string, string>>;
}
export interface Schedule { id: string; bot: string; what: string; when: string; next: string; paused: boolean }

/* ───────── the composer's feedforward reading ───────── */
export interface DecisionOption { value: string; label: string; desc: string; mono?: boolean; assume?: string; start?: string }
export interface DecisionKind {
  id: string;
  /** a regular expression source, matched case-insensitively and globally */
  pattern: string;
  title: string;
  /** null: the options come from the matched text (a path) */
  options: readonly DecisionOption[] | null;
  /** the first rule that matches the text picks the value; else `fallback` ('self' is the matched text) */
  guess: ReadonlyArray<readonly [pattern: string, value: string]>;
  fallback: string;
  /** stop after the first match in a text */
  single: boolean;
}
