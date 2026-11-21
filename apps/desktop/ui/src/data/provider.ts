/* THE DATA SEAM. Every module reads data only through `DataProvider`, and every action a module takes is a command
   on it. The shapes are streams and commands, not one-shot getters, so live data fits:
     Watch<T>       the current value of something that changes: get() now, subscribe() to every change
     Feed<S, E>     a snapshot plus the events that follow it (a conversation, a bot's thread)
     commands       methods; they return when the provider has accepted them, the result arrives on the streams
   The mock provider (mock-provider.ts) serves today's v6 mock data through these; the live provider (Hermes gateway
   and the boopis plugin) implements the same interfaces. Nothing in a module may fabricate data a provider
   did not send: unknown is `null` or empty and the UI shows it as unknown. */
import type {
  ArchivedBot, Turn, Bot, BotCatalog, BotDraft, BotConfig, BotInfo, Change, ConversationEvent, Conversation, Connector, ContextUsage, DecisionKind, DiffFile, Environment, ArchivedGroup,
  Attached, DetailsCan, DetailsNotes, FieldSchema, FileCompletions, FormCan, FormOutcome, ModSession, ModsEvent, PickerItem, PickerKind, GovernanceState, LedgerStats, ProviderInfo, RunSnapshot, Schedule, SendMeta, SessionSummary, ThreadMessage, Todo, User, Wait, WaitOutcome, ModelChoice, CouncilSource, Group, GroupMessage
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
  /** stop one task the session handed to another model (a card's stop); the card ends when the engine says so */
  stopChild?(sessionId: string, childId: string): void;
  /** what a handed-off task did, read from its own session without opening it for writing; rejects with a sentence the card shows */
  childTranscript?(sessionId: string, childId: string): Promise<readonly Turn[]>;
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
  /** who can answer next: the ladder's tiers, then the other configured providers' models */
  choices: Watch<readonly ModelChoice[]>;
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
  | { type: 'run'; botId: string; running: boolean }
  /** the whole thread changed under the room (a session was opened or a new one started): draw it again */
  | { type: 'thread'; botId: string; messages: readonly ThreadMessage[] };
export interface BotsSnapshot { bots: readonly Bot[]; threads: Readonly<Record<string, readonly ThreadMessage[]>> }
/** a routine a bot is asked to take on: a job in its profile's cron store */
export interface RoutineDraft { name: string; prompt: string; schedule: string }
/** what the settings sheet asks to change in the real profile; a field left out is left alone */
export interface BotPatch {
  /** the profile's description (Hermes calls it the role) */
  role?: string;
  /** SOUL.md */
  instructions?: string;
  /** `provider/model`, one of `catalog().models` */
  model?: string;
  addRoutines?: readonly RoutineDraft[];
  /** ids of jobs to remove */
  removeRoutines?: readonly string[];
}
/** one file Hermes keeps that a change would write, and the change as diff lines ('+ added', '- removed', '  kept') */
export interface PlannedWrite { file: string; diff: string }
/** what creating a bot will do, for the user to confirm before anything is made */
export interface CreatePlan {
  /** the profile's name: the bot's name, numbered when it is taken */
  profile: string;
  /** the folder Hermes will make; null when this provider cannot tell yet */
  folder: string | null;
  /** the model the bot starts with, null when no provider is configured */
  model: string | null;
  /** what the user should know before confirming: a name turned into another, a missing key */
  notes: readonly string[];
}
/** what deleting a bot removes for good, counted on the disk */
export interface RemovalNote { folder: string; lines: readonly string[] }
/** The live provider's: a bot is a Hermes profile, and these are the things only a real profile has. The mock's bots have
 *  none of it, so a module that finds `admin` on the source runs the real flow and otherwise the mock's. */
export interface BotsAdmin {
  /** what Hermes reports about the bot is read (the profile, its routines, its recent sessions); resolves when it is in */
  open(id: string): Promise<BotInfo>;
  /** what creating a bot named `name` will do */
  planCreate(name: string): CreatePlan;
  /** makes the profile (Hermes's own `profiles.create`), sets its model, saves its look; the bot arrives as `bot-created` */
  create(draft: BotDraft & { instructions: string }, opts: { model: string | null }): Promise<Bot>;
  /** the writes a change would make, to show before saving */
  review(id: string, patch: BotPatch): readonly PlannedWrite[];
  /** Writes the change to the profile. Rejects with a sentence the sheet shows when Hermes refused part of it, or with
   *  `NeedsConfirmation` when Hermes wants the model pick confirmed (send `confirmModel` once the user has). */
  save(id: string, patch: BotPatch, opts?: { confirmModel?: boolean }): Promise<void>;
  /** pauses or resumes one routine at once */
  setRoutinePaused(id: string, jobId: string, paused: boolean): Promise<void>;
  /** boopis's own settings and the look: saved in the bot's own store */
  saveOwn(id: string, patch: { cfg?: Partial<Pick<BotConfig, 'gov' | 'cap' | 'workspace'>> & { approvals?: Readonly<Record<string, boolean>> }; look?: { shape?: string; color?: string } }): Promise<void>;
  /** what deleting would remove */
  removal(id: string): Promise<RemovalNote>;
  /** the profile is renamed out of the way (nothing is destroyed) and its routines paused; resolves with the way back */
  archive(id: string): Promise<{ undo(): Promise<void> }>;
  /** the profile and everything in it is deleted; `confirm` is its name */
  remove(id: string, confirm: string): Promise<void>;
  /** the models a bot can be set to, from the configured providers: [`provider/model`, ...] */
  models(): readonly string[];
  /** why the roster could not be read (Hermes said no), null when it could */
  note(): string | null;
}
/** The live provider's: a bot's conversation is a session of its own profile. The room's thread is the one session open; the
 *  recent sessions the room lists are opened with `open`. */
export interface BotSessions {
  /** opens a session of the bot (one of its recent sessions): its messages become the thread and the next message continues it.
   *  Rejects with a sentence for the user (the bot is replying; the session could not be read). */
  open(botId: string, sessionId: string): Promise<void>;
  /** starts over: the thread is empty and the next message begins a new session */
  fresh(botId: string): void;
  /** the id of the session the thread is, null before the first message */
  current(botId: string): string | null;
}
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
  /** archived teammates (profiles renamed out of the way, newest first): `id` is the profile's name now, `was` the name it returns to */
  archived: Watch<readonly ArchivedBot[]>;
  /** brings an archived teammate back under its old name (it arrives as `bot-created`); rejects, with a sentence for the user, when that name is taken again */
  restore(id: string): Promise<void>;
  /** the live provider's: real profiles (see `BotsAdmin`); absent on the mock */
  admin?: BotsAdmin;
  /** the live provider's: the bot's sessions as conversations; absent on the mock, whose threads are its own */
  sessions?: BotSessions;
}

/* ───────── groups: team chat, several bots and the user in one thread ───────── */
export type GroupsEvent =
  | { type: 'group'; group: Group }
  | { type: 'group-created'; group: Group }
  | { type: 'group-archived'; id: string }
  | { type: 'message'; groupId: string; message: GroupMessage }
  /** the whole thread is drawn again (a room read from the start) */
  | { type: 'thread'; groupId: string; messages: readonly GroupMessage[] };
export interface GroupsSnapshot { groups: readonly Group[]; threads: Readonly<Record<string, readonly GroupMessage[]>> }
export interface GroupsSource extends Feed<GroupsSnapshot, GroupsEvent> {
  /** what a group chat is in this build, in a sentence the room says: who answers, and what the members see of each other */
  nature: string;
  /** how many bots a group has: a room is a conversation among two to six */
  limits: { min: number; max: number };
  /** why group chat cannot be used now (the engine's room worker is off, the roster could not be read), null when it can */
  note(): string | null;
  /** reads the group's messages as it opens (the live provider reads a room's log when it is first shown); resolves when they are in */
  open(groupId: string): Promise<void>;
  /** the message reaches the members; an `@name` in it addresses that member alone. The replies arrive as `message` events */
  send(groupId: string, text: string): void;
  /** stops the members' replies; false when none was running */
  stop(groupId: string): boolean;
  /** lets a conversation that paused at its limit run on (`GroupNote.more` names what) */
  continueTalk(groupId: string, more: string): Promise<void>;
  /** makes a group of bots (profile names); rejects with a sentence for the user */
  create(draft: { name: string; bots: readonly string[] }): Promise<Group>;
  rename(id: string, name: string): Promise<void>;
  /** A room's members are fixed when it is made: a different set is a new room with the same name, and the old one is archived.
   *  Resolves with the new group. */
  setMembers(id: string, bots: readonly string[]): Promise<Group>;
  /** puts the group away (its messages are kept); resolves with the way back */
  archive(id: string): Promise<{ undo(): Promise<void> }>;
  archived: Watch<readonly ArchivedGroup[]>;
  restore(id: string): Promise<void>;
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
  /** what the host would run for a sign-in field that names a provider (display only), or null when it is not one boopis knows; absent where there is no table to check against */
  login?: (s: NonNullable<FieldSchema['x-signin']>) => { known: boolean; line?: string };
  /** the user cancelled a sign-in that is running (the card returns to its open state); the host ends the flow it started */
  cancelSignin?: (formId: string, field: string) => Promise<void>;
  /** what the fields that reach outside the page can do in this build: a control that cannot work is disabled and says so */
  can: FormCan;
  /** the choices of an `x-picker` field; a folder is picked with the host's own dialog */
  pickerItems(kind: PickerKind): readonly PickerItem[];
  pickFolder(): Promise<string | null>;
}

/* ───────── mods: what a session's Claude Code mods draw, and the user's answers to it ───────── */
export interface ModsSource {
  /** one session's mods as they are now (`active: false` when it has none); a new value on every change */
  session(sessionId: string): Watch<ModSession>;
  /** toasts and notifications: what a mod said that is not state */
  events: { subscribe(fn: (e: ModsEvent) => void): Unsubscribe };
  /* commands. The UI never runs mod code: it sends the id of the handler of the element the user used. */
  press(sessionId: string, handler: string): void;
  input(sessionId: string, handler: string, value: string): void;
  select(sessionId: string, handler: string, value: string): void;
  /** tells a site where it is (a pane's placement and title, the band's `isWorking`) and asks for a redraw; `id` is a pane's id */
  props(sessionId: string, component: string, id: string | null, props: Readonly<Record<string, unknown>>): void;
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
/** a drag over the window: `x` and `y` in CSS pixels; `attachments` only on `drop` */
export interface FileDrag { phase: 'enter' | 'over' | 'leave' | 'drop'; x: number; y: number; attachments: readonly Attached[] }
export interface FilesSource {
  /** ask the host for files or a folder (its own dialog); empty when the user declined */
  pick(kind: 'file' | 'folder'): Promise<Attached[]>;
  /** files dragged over the app or dropped on it (the desktop app only: the page's own drop has names and no paths) */
  drops?: { subscribe(fn: (e: FileDrag) => void): Unsubscribe };
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
  groups: GroupsSource;
  waits: WaitsSource;
  forms: FormsSource;
  run: RunSource;
  schedules: SchedulesSource;
  feedforward: FeedforwardSource;
  dictation: DictationSource;
  files: FilesSource;
  mods: ModsSource;
  /** asking a council: several models answer one message and one combines them (ADR-0035) */
  council: CouncilSource;
}
