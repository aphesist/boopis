/* THE DATA SEAM. Every module reads data only through `DataProvider`, and every action a module takes is a command
   on it. The shapes are streams and commands, not one-shot getters, so live data fits:
     Watch<T>       the current value of something that changes: get() now, subscribe() to every change
     Feed<S, E>     a snapshot plus the events that follow it (a conversation, a bot's thread)
     commands       methods; they return when the provider has accepted them, the result arrives on the streams
   The mock provider (mock-provider.ts) serves today's v6 mock data through these; the live provider (Hermes gateway
   and the boopis plugin) implements the same interfaces. Nothing in a module may fabricate data a provider
   did not send: unknown is `null` or empty and the UI shows it as unknown. */
import type { SessionControls } from './session-s0';
import type {
  ApprovalTier, ArchivedBot, Turn, Bot, LimitNotice, BotCatalog, BotDraft, BotConfig, BotInfo, Change, ConversationEvent, Conversation, Connector, ContextUsage, DecisionKind, DiffFile, Environment, ArchivedGroup,
  Attached, KanbanBoardInfo, KanbanView, DetailsCan, DetailsNotes, FieldSchema, FileCompletions, FormCan, FormOutcome, ModSession, ModsEvent, PickerItem, PickerKind, GovernanceState, LedgerStats, ProviderInfo, RunSnapshot, Schedule, SendMeta, SessionSummary, ThreadMessage, Todo, User, Wait, WaitOutcome, ModelChoice, CouncilSource, Group, GroupMessage,
  InstallPlan, InstallReceipt, TeamPlansSource, ParkedSource, InstallRequest, ProjectPolicy, StageResult, StoreBrowse, StoreDetail, StoreFilter, StoreScope, StoreSource, UninstallResult, UpdateDiff
} from './types';

export type Unsubscribe = () => void;
/** an answer to a bot's approval card: once, deny, or a rules card's two standing answers */
export type BotDecision = 'approved' | 'denied' | 'turn' | 'always';
/** how an approval was allowed, said back in its receipt */
export type ApprovalHow = 'once' | 'turn' | 'always' | 'edited';

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
  | { type: 'message-resolved'; botId: string; messageId: string; resolved: 'approved' | 'denied'; resolvedAt: string; how?: ApprovalHow | undefined; drafted?: boolean | undefined }
  /** a reply is being worked on (true) or finished or was stopped (false) */
  | { type: 'run'; botId: string; running: boolean }
  /** the whole thread changed under the room (a session was opened or a new one started): draw it again */
  | { type: 'thread'; botId: string; messages: readonly ThreadMessage[] }
  /** what the bot's current run has spent against its cap per run, as the plugin counts it (`plugin.boopis.budget.updated`):
      dollars as shown ("$0.24"), null when unknown (a model of the run has no price) or when it has no cap */
  | { type: 'spend'; botId: string; spent: string | null; cap: string | null };
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
  /** switches toolsets on and off, the same for its chats, kanban workers and room turns; applies from its next new session */
  setToolsets(id: string, on: readonly string[], off: readonly string[]): Promise<void>;
  /** its project folder (null: it has none). Rejects with a sentence when the folder is not there or cannot be read */
  setProject(id: string, folder: string | null): Promise<void>;
  /** boopis's own settings and the look: saved in the bot's own store */
  saveOwn(id: string, patch: { cfg?: Partial<Pick<BotConfig, 'gov' | 'cap' | 'workspace'>> & { approvals?: Readonly<Record<string, ApprovalTier>> }; look?: { shape?: string; color?: string } }): Promise<void>;
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
/** A bot's own cap on the turns `boopis run --bot` lets one task take: the engine's goal budget, kept in the bot's own configuration
 *  where the engine reads it, so the command line and the app see the same number */
export interface TurnLimit {
  /** the cap this bot keeps, null when it has none and the default applies */
  turns: number | null;
  /** the cap a bot without its own has */
  fallback: number;
}
export interface BotsSource extends Feed<BotsSnapshot, BotsEvent> {
  catalog(): BotCatalog;
  /* commands */
  send(botId: string, text: string, via: 'bots' | 'dock'): void;
  /** stops the bot's reply; false when it was not replying */
  stop(botId: string): boolean;
  /** the folder the bot works in, as the engine said (paths in its messages resolve there); null while unknown */
  workspace?(botId: string): string | null;
  /** decide an approval card in a thread (the dock decides through `waits`): `turn` and `always` are a rules card's
      standing answers (allow all this turn; always, kept as a draft for the owner to finish), as the dock sends them */
  decide(botId: string, messageId: string, decision: BotDecision): void;
  /** allow a request the owner edited first (approval-surfaces.md 7). The engine cannot take one (`approval.respond` takes only the choice), so
      no provider has it and the card's Edit stays hidden behind `approval-edit` */
  decideEdited?(botId: string, messageId: string, text: string): void;
  /** changes the role, the settings or the look (shape and colour, never the eyes); the change comes back as a `bot` event */
  update(id: string, patch: { role?: string; cfg?: Partial<BotConfig>; look?: { shape?: string; color?: string } }): void;
  create(draft: BotDraft & { instructions: string }): Bot;
  archive(id: string): void;
  /** archived teammates (profiles renamed out of the way, newest first): `id` is the profile's name now, `was` the name it returns to */
  archived: Watch<readonly ArchivedBot[]>;
  /** brings an archived teammate back under its old name (it arrives as `bot-created`); rejects, with a sentence for the user, when that name is taken again */
  restore(id: string): Promise<void>;
  /** the bot's cap on turns for a run from the command line; rejects with a sentence when it cannot be read */
  runLimit(id: string): Promise<TurnLimit>;
  /** keeps (or, with null, forgets) the bot's cap, 1 to 1000; resolves with what is kept */
  setRunLimit(id: string, turns: number | null): Promise<TurnLimit>;
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
/** boopis's own cap on the rounds `boopis run --group` lets a discussion take in one group: the engine has one pair of limits for every
 *  room and none per room, so the cap is boopis's (kept in the app's data folder, read by the command line too) */
export interface RoundLimit {
  /** the cap kept for this group, null when it has none and the default applies */
  rounds: number | null;
  /** the cap a group without its own has */
  fallback: number;
}

export interface GroupsSource extends Feed<GroupsSnapshot, GroupsEvent> {
  /** what a group chat is in this build, in a sentence the room says: who answers, and what the members see of each other */
  nature: string;
  /** how many bots a group has: a room is a conversation among two to six */
  limits: { min: number; max: number };
  /** why group chat cannot be used now (the engine's room worker is off, the roster could not be read), null when it can */
  note(): string | null;
  /** reads the group's messages as it opens (the live provider reads a room's log when it is first shown); resolves when they are in */
  open(groupId: string): Promise<void>;
  /** The message reaches the members; an `@name` in it addresses that member alone. The replies arrive as `message` events.
   *  `'when-done'` (the default) never interrupts: while the room is busy the message is held (`Group.queued`) and sent when the
   *  running turns have finished. `'now'` stops the running turns first, because the engine drops a running member's answer when a
   *  newer message arrives. Resolves with what happened. */
  send(groupId: string, text: string, how?: 'when-done' | 'now'): Promise<'sent' | 'queued'>;
  /** takes a held message back; resolves with its words (null when it was already sent) so the composer can show them again */
  unqueue(groupId: string, queuedId: string): string | null;
  /** sends a held message now, stopping the running turns first */
  sendNow(groupId: string, queuedId: string): Promise<void>;
  /** stops the members' replies; false when none was running */
  stop(groupId: string): boolean;
  /** lets a conversation that paused at its limit run on (`GroupNote.more` names what) */
  continueTalk(groupId: string, more: string): Promise<void>;
  /** makes a group of bots (profile names); rejects with a sentence for the user */
  create(draft: { name: string; bots: readonly string[] }): Promise<Group>;
  rename(id: string, name: string): Promise<void>;
  /** the group's cap on rounds for a run from the command line; rejects with a sentence when it cannot be read */
  roundLimit(id: string): Promise<RoundLimit>;
  /** keeps (or, with null, forgets) the group's cap, 1 to 1000; resolves with what is kept */
  setRoundLimit(id: string, rounds: number | null): Promise<RoundLimit>;
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

/* ───────── the store: browse, review and install everything installable (ADR-0038, docs/STORE.md) ─────────
   Browse and search read the host's local cache and never leave the machine; a module never fetches. Every call that can fail
   rejects with a `StoreError` (`{code, message}`): the stable `hx.store.*` code and a sentence to show. Nothing installs in a
   running session: an install takes effect in the next one. A mock serves the fixture items (data/mock-provider.ts). */
export interface StoreProvider {
  /** whether this build can install: the page build and a build with no host cannot, and say why; browsing works either way */
  can: { install: boolean; reason?: string };
  /** the sources, their state and when each was last read; a new value on every refresh or switch */
  sources: Watch<readonly StoreSource[]>;
  /** what is installed for the followed bot, one receipt each; a new value on every install, update, rollback and removal */
  installed: Watch<readonly InstallReceipt[]>;
  /** updates found by the last check, one diff per item that changed; empty until a check ran */
  updates: Watch<readonly UpdateDiff[]>;
  /** a page of the catalogue (the front page when unfiltered), from the cache */
  browse(filter?: StoreFilter, cursor?: string | null): Promise<StoreBrowse>;
  /** local search over the cached catalogue: name, summary, tags, publisher; nothing leaves the machine */
  search(query: string, filter?: StoreFilter, cursor?: string | null): Promise<StoreBrowse>;
  /** the detail page's data */
  detail(id: string): Promise<StoreDetail>;
  /** the review: fetch and verify the pin into staging, analyse without running anything, and return the plan (with its hash) for `scope` */
  review(id: string, scope?: StoreScope): Promise<{ stage: StageResult; plan: InstallPlan }>;
  /** install what the review showed, after the hold; rejects with `hx.store.plan_changed` when it is no longer the same plan */
  install(request: InstallRequest): Promise<InstallReceipt>;
  /** look for newer pins and return what changed; `id` limits it to one item. Nothing updates itself. */
  checkUpdates(id?: string): Promise<readonly UpdateDiff[]>;
  /** the review of an update: stage the new pin, and return the plan to approve (install it with `install`) */
  reviewUpdate(id: string): Promise<{ stage: StageResult; plan: InstallPlan }>;
  /** switch an installed item on or off; it takes effect in the next session (`store_set_enabled`, an addition to the contract) */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** go back to the version kept one step back */
  rollback(id: string): Promise<InstallReceipt>;
  /** remove an item; `deleteSecrets` is the user's agreement to delete its keys from the keychain */
  uninstall(id: string, opts?: { deleteSecrets?: boolean }): Promise<UninstallResult>;
  /** read the sources again (all, or one) */
  refresh(source?: string): Promise<readonly StoreSource[]>;
  /** ask the host for each source's state again without reading any of them: how old each copy is moves on with time, so what is due
      now is not what was due when the list was loaded. Optional: a provider whose sources never age leaves it out. */
  reloadSources?(): Promise<void>;
  setSourceEnabled(id: string, enabled: boolean): Promise<void>;
  /** add a marketplace address, a git repository or a local folder or file as a source */
  addSource(input: { url?: string; path?: string; label?: string }): Promise<StoreSource>;
  removeSource(id: string): Promise<void>;
  /** a project's "no engine plugins and no plugin hooks" switch (on by default for a governed project) */
  projectPolicy(project: string): Promise<ProjectPolicy>;
  setProjectPolicy(project: string, blockEnginePluginsAndHooks: boolean): Promise<ProjectPolicy>;
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

/* ───────── boopis's engine ───────── */
/** whether boopis's engine can be reached: `stopped` once the link to it was lost and it did not come back at once, or it cannot be used
    as it is; `why` is the host's sentence; `restarting` while a restart asked for here has not been answered */
export interface EngineState { stopped: boolean; restarting: boolean; why: string | null }
/** the engine's link, for what a thread says when it stops mid-session (board S36: "boopis's engine stopped", Start it again). A
    provider with no engine of its own (the page build's mock) has none. `restart` asks the host to start it again now; absent where
    the host cannot, and the line then shows without its action */
export interface EngineSource { state: Watch<EngineState>; restart?: () => Promise<void> }

/* ───────── helpers the composer asks for ───────── */
export interface FeedforwardSource { catalog(): readonly DecisionKind[] }
/** what a dictation reports while it runs, in the order a source may send them (the kit's Composer draws each: components/v7/compose.ts):
    `preparing` the speech model is being fetched, once, before the first dictation (bytes `done` of `total`; repeat it as it grows);
    `listening` the microphone is open and it hears; `partial` the words so far of what is being said (each replaces the last partial);
    `final` a finished stretch, which is written into the text (then more partials and finals may follow, until it is cancelled);
    `error` it could not start or go on: `reason` is one plain sentence for the person ("No microphone found", "Microphone access is
    off for boopis", "The speech model could not be downloaded"), and `retry: false` says trying again cannot help. After `error` the
    source sends nothing more, and the composer cancels it */
export type DictationEvent =
  | { kind: 'preparing'; done: number; total: number }
  | { kind: 'listening' }
  | { kind: 'partial'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; reason: string; retry?: boolean };
/** the mic: what a person says, transcribed into the composer's text. It is not the voice circle and needs no voice model (owner,
    26 November: "the microphone button is simply a transcription button") */
export interface DictationSource {
  /** start a dictation (for the open bot, null in a session); `onEvent` gets what it reports; the returned function stops listening: the microphone
      closes at once, and one last `final` (what was still being said) may follow, or an `error`; the composer waits up to 3 s for it
      and takes it although its mic is off. Nothing else follows a stop */
  start(opts: { botId: string | null }, onEvent: (e: DictationEvent) => void): Unsubscribe;
}
/** talking to a bot or a session, live (a composer's voice circle, pressed with no text). It is a capability: a provider has it once a
    voice model is set up (Settings, Models: a voice provider's key through the host's secret store, or a local model with live voice).
    Until then every composer still draws the circle, and pressing it says what voice needs (modules/chat/compose.ts `voiceTool`).
    Dictation (the mic) is another thing: transcription into the text (`dictation`) */
export interface VoiceSource {
  /** start talking with the open bot (null in a session); the returned function ends it */
  start(opts: { botId: string | null }): Unsubscribe;
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
  /** paths a message names, opened on this computer (the desktop app's host; absent where nothing can be opened) */
  paths?: PathsSource;
}
/** a path a message names, as the host found it: only inside one of the given workspaces, or an absolute path that exists */
export interface ResolvedPath { path: string; abs: string; kind: 'file' | 'folder'; /** the path inside the workspace it was found in */ rel: string | null }
/** an editor the host found on this computer, to open a file in */
export interface PathEditor { id: string; name: string }
export interface PathsSource {
  /** which of `paths` exist, relative to one of `roots` (the session's or room's workspaces) or absolute; null for the others */
  resolve(paths: readonly string[], roots: readonly string[]): Promise<ReadonlyArray<ResolvedPath | null>>;
  /** open a resolved path with the system's default app, or in one of `editors()` */
  open(abs: string, editor?: string | null): Promise<void>;
  /** show it in the file manager */
  reveal(abs: string): Promise<void>;
  editors(): Promise<readonly PathEditor[]>;
}

/** the engine's kanban boards, read only: no call moves or changes a task */
export interface KanbanSource {
  /** every board; rejects with a sentence when the engine cannot be asked */
  boards(): Promise<readonly KanbanBoardInfo[]>;
  /** one board and its tasks; rejects with a sentence */
  view(slug: string): Promise<KanbanView>;
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
  /** the link to boopis's engine (absent where there is none: the page build) */
  engine?: EngineSource;
  /** dictation (the mic). Absent only in a build that has none: the mic then says "Dictation is not available in this build" */
  dictation?: DictationSource;
  /** live voice, once a voice model is set up (absent until then: the voice circle then says what it needs) */
  voice?: VoiceSource;
  files: FilesSource;
  mods: ModsSource;
  /** asking a council: several models answer one message and one combines them (ADR-0035) */
  council: CouncilSource;
  /** the store: everything installable in one place (ADR-0038) */
  store: StoreProvider;
  /** the kanban boards behind a group (the live provider's; the mock has none, so a group's board view says so) */
  kanban?: KanbanSource;
  /** the Session tab's launch settings, permission scale and rewind (the live provider's; the mock has none) */
  sessionControls?: SessionControls;
  /** a usage limit that is close, null when none is (a provider that cannot tell leaves it out: nothing is said) */
  limits?: Watch<LimitNotice | null>;
  /** the team changes bots proposed, held for the owner (the desktop host's; absent elsewhere) */
  teamPlans?: TeamPlansSource;
  /** the steps a rule paused while the owner was away (the desktop host's; absent elsewhere) */
  parked?: ParkedSource;
}
