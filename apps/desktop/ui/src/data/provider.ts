/* THE DATA SEAM. Every module reads data only through `DataProvider`, and every action a module takes is a command
   on it. The shapes are streams and commands, not one-shot getters, so live data fits:
     Watch<T>       the current value of something that changes: get() now, subscribe() to every change
     Feed<S, E>     a snapshot plus the events that follow it (a conversation, a bot's thread)
     commands       methods; they return when the provider has accepted them, the result arrives on the streams
   The mock provider (mock-provider.ts) serves today's v6 mock data through these; the live provider (Hermes gateway
   and the hypotaxis plugin) implements the same interfaces. Nothing in a module may fabricate data a provider
   did not send: unknown is `null` or empty and the UI shows it as unknown. */
import type {
  Bot, BotCatalog, BotDraft, BotConfig, Change, ConversationEvent, Conversation, Connector, ContextUsage, DecisionKind, DiffFile, Environment,
  GovernanceState, LedgerStats, RunSnapshot, Schedule, SendMeta, SessionSummary, ThreadMessage, Todo, User, Wait, WaitOutcome
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
  /** frees what can be compacted; resolves with the tokens freed (0 when there is nothing to compact) */
  compactContext(): Promise<number>;
  setGovernance(patch: Partial<Pick<GovernanceState, 'governed' | 'smart' | 'model' | 'cap'>>): void;
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

/* ───────── what waits on the user (approvals and open questions), for the dock and the shell ───────── */
export type WaitsEvent = { type: 'added'; wait: Wait } | { type: 'resolved'; id: string; outcome: WaitOutcome };
export interface WaitsSource extends Feed<readonly Wait[], WaitsEvent> {
  /** decide an approval ('approved' | 'denied') or answer an open question (the chosen option or free text) */
  resolve(id: string, outcome: WaitOutcome): void;
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
}

export interface DataProvider {
  /** resolves when the first snapshot of everything is in: the app boots after it */
  ready: Promise<void>;
  user: Watch<User>;
  sessions: SessionsSource;
  details: DetailsSource;
  bots: BotsSource;
  waits: WaitsSource;
  run: RunSource;
  schedules: SchedulesSource;
  feedforward: FeedforwardSource;
  dictation: DictationSource;
  files: FilesSource;
}
