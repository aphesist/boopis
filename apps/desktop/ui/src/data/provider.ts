/* THE DATA SEAM. Every module reads data only through `DataProvider`, and every action a module takes is a command
   on it. The shapes are streams and commands, not one-shot getters, so live data fits:
     Watch<T>       the current value of something that changes: get() now, subscribe() to every change
     Feed<S, E>     a snapshot plus the events that follow it (a conversation, a bot's thread)
     commands       methods; they return when the provider has accepted them, the result arrives on the streams
   The mock provider (mock-provider.ts) serves today's v6 mock data through these; the live provider (Hermes gateway
   and the boopis plugin) implements the same interfaces. Nothing in a module may fabricate data a provider
   did not send: unknown is `null` or empty and the UI shows it as unknown. */
import type {
  Bot, BotCatalog, BotDraft, BotConfig, Change, ConversationEvent, Conversation, Connector, ContextUsage, DecisionKind, DiffFile, Environment,
  DetailsCan, DetailsNotes, FileCompletions, FormCan, FormOutcome, PickerItem, PickerKind, GovernanceState, LedgerStats, ProviderInfo, RunSnapshot, Schedule, SendMeta, SessionSummary, ThreadMessage, Todo, User, Wait, WaitOutcome
} from './types';

export type Unsubscribe = () => void;
export interface Watch<T> { get(): T; subscribe(fn: (value: T) => void): Unsubscribe }
export interface Feed<S, E> { snapshot(): S; subscribe(fn: (event: E) => void): Unsubscribe }

/* ───────── sessions (the Session tab, its list and the conversation) ───────── */
export interface SessionsSource {
  list: Watch<readonly SessionSummary[]>;
  archived: Watch<readonly SessionSummary[]>;
  /** the text the composer starts with */
  draft(): string;
  conversation(sessionId: string): Feed<Conversation, ConversationEvent>;
  /** the files of the change, for the diff view; the answer to the open question can change the diff */
  diff(sessionId: string, answers: { blank: string | null }): readonly DiffFile[];
  /* commands */
  create(project: string | null): SessionSummary;
  rename(id: string, title: string): void;
  fork(id: string): SessionSummary | null;
  archive(id: string): void;
  restore(id: string): void;
  /** send a message: the user's turn and the agent's working turn arrive on the conversation feed */
  send(sessionId: string, text: string, meta: SendMeta): void;
  stop(sessionId: string): void;
  answerBlank(sessionId: string, answer: string): void;
  openPullRequest(sessionId: string): void;
}

/* ───────── the details panel (right sidebar) ───────── */
export interface DetailsSource {
  context: Watch<ContextUsage & { used: number }>;
  todos: Watch<readonly Todo[]>;
  changes: Watch<readonly Change[]>;
  output: Watch<readonly string[]>;
  connectors: Watch<readonly Connector[]>;
  environment: Watch<Environment>;
  governance: Watch<GovernanceState>;
  ledger: Watch<LedgerStats>;
  /** the models a session can be pinned to */
  models: Watch<readonly string[]>;
  /** the panels follow this session; the live provider fetches its details when it is called */
  follow(sessionId: string): void;
  /** what a panel cannot know or this Hermes cannot do, in words */
  notes: Watch<DetailsNotes>;
  can: Watch<DetailsCan>;
  /** frees what can be compacted; resolves with the tokens freed (0 when there is nothing to compact) */
  compactContext(): Promise<number>;
  /** applies what it can; returns why not (a locked mode, a choice this Hermes cannot make) or null */
  setGovernance(patch: Partial<Pick<GovernanceState, 'governed' | 'smart' | 'model' | 'cap'>>): string | null;
  setConnector(name: string, on: boolean): void;
  /** starts a browser sign-in; resolves when the connector is connected or the sign-in failed */
  signIn(name: string): Promise<void>;
}

/* ───────── bots ───────── */
export type BotsEvent =
  | { type: 'bot'; bot: Bot }
  | { type: 'bot-created'; bot: Bot }
  | { type: 'bot-archived'; id: string }
  /** a message arrived; a streaming one starts with the text so far */
  | { type: 'message'; botId: string; message: ThreadMessage; streaming: boolean }
  | { type: 'message-text'; botId: string; messageId: string; text: string }
  | { type: 'message-end'; botId: string; messageId: string; text: string }
  | { type: 'message-resolved'; botId: string; messageId: string; resolved: 'approved' | 'denied'; resolvedAt: string }
  /** a reply is being worked on (true) or finished or was stopped (false) */
  | { type: 'run'; botId: string; running: boolean };
export interface BotsSnapshot { bots: readonly Bot[]; threads: Readonly<Record<string, readonly ThreadMessage[]>> }
export interface BotsSource extends Feed<BotsSnapshot, BotsEvent> {
  catalog(): BotCatalog;
  /* commands */
  send(botId: string, text: string, via: 'bots' | 'dock'): void;
  /** stops the bot's reply; false when it was not replying */
  stop(botId: string): boolean;
  /** decide an approval card in a thread (the dock decides through `waits`) */
  decide(botId: string, messageId: string, decision: 'approved' | 'denied'): void;
  /** changes the role or the settings; the change comes back as a `bot` event */
  update(id: string, patch: { role?: string; cfg?: Partial<BotConfig> }): void;
  create(draft: BotDraft & { instructions: string }): Bot;
  archive(id: string): void;
}

/* ───────── what waits on the user (approvals, open questions and forms), for the dock and the shell ───────── */
export type WaitsEvent = { type: 'added'; wait: Wait } | { type: 'resolved'; id: string; outcome: WaitOutcome };
export interface WaitsSource extends Feed<readonly Wait[], WaitsEvent> {
  /** decide an approval ('approved' | 'denied') or answer an open question (the chosen option or free text); a form is answered through `forms` */
  resolve(id: string, outcome: WaitOutcome): void;
}

/* ───────── forms: the answers (the questions arrive as `Wait`s and as turns' `forms`) ───────── */
export interface FormsSource {
  /** secrets go to the host's keychain alone and never reach the agent, the plugin, a log or an event; the rest is sent to whoever asked.
      Rejects with a message the card shows when the answer was not delivered (the form stays open). */
  submit(formId: string, outcome: FormOutcome): Promise<void>;
  /** the user declined; the asker continues without it */
  cancel(formId: string): Promise<void>;
  /** runs a sign-in (`x-signin`) in the host; resolves when it succeeded, rejects when it failed or was cancelled */
  signin(formId: string, field: string): Promise<void>;
  /** what the fields that reach outside the page can do in this build: a control that cannot work is disabled and says so */
  can: FormCan;
  /** the choices of an `x-picker` field; a folder is picked with the host's own dialog */
  pickerItems(kind: PickerKind): readonly PickerItem[];
  pickFolder(): Promise<string | null>;
}

/* ───────── the dock's run and schedules ───────── */
export interface RunSource {
  current: Watch<RunSnapshot>;
  stop(): void;
  setSetting(key: 'governed' | 'network', on: boolean): void;
}
export interface SchedulesSource {
  list: Watch<readonly Schedule[]>;
  runNow(id: string): void;
  setPaused(id: string, paused: boolean): void;
}

/* ───────── helpers the composer asks for ───────── */
export interface FeedforwardSource { catalog(): readonly DecisionKind[] }
export interface DictationSource {
  /** start listening; `onTranscript` gets what was heard; the returned function cancels */
  start(opts: { botId: string | null }, onTranscript: (text: string) => void): Unsubscribe;
}
export interface FilesSource {
  /** ask the host for a file or a folder; null when the user declined */
  pick(kind: 'file' | 'folder'): string | null;
  /** completions of the `@` word being typed, for the session the composer belongs to */
  complete(word: string, sessionId: string | null): Promise<FileCompletions>;
}

export interface DataProvider {
  info: ProviderInfo;
  /** resolves when the first snapshot of everything is in: the app boots after it */
  ready: Promise<void>;
  user: Watch<User>;
  sessions: SessionsSource;
  details: DetailsSource;
  bots: BotsSource;
  waits: WaitsSource;
  forms: FormsSource;
  run: RunSource;
  schedules: SchedulesSource;
  feedforward: FeedforwardSource;
  dictation: DictationSource;
  files: FilesSource;
}
