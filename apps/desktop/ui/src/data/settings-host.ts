/* What Settings asks of the host beyond the shell's own preferences: the rules list (Settings › Approvals; ADR-0060,
   docs/specs/rules-engine.md 11 and 13) and speech (Settings › Models › Voice and speech: the dictation model, ADR-0059, and the
   voice choice for talking to bots). The live provider fills these in the desktop app; the mock and the page build have none, so
   the pages that read them are hidden (a thing shows only once it exists). No value here ever carries a key: a voice provider's
   key goes from its field to the host's keychain and is never read back. */
import type { Unsubscribe, Watch } from './provider';

/** one rule of `rules.json`, as Settings shows it */
export interface Rule {
  id: string;
  /** `ask`: bots ask before what it names; `exception`: what it names runs without asking */
  type: 'ask' | 'exception';
  /** the owner's words, one line of at most 200 characters */
  text: string;
  enabled: boolean;
  /** an exception kept from "Always allow" is a `draft` until the owner finishes it: never applied */
  state?: 'active' | 'draft';
  /** where it came from: shipped, typed in Settings, from a card's "Always allow", proposed in a chat */
  source: 'default' | 'owner' | 'card' | 'chat';
  /** null: every bot; else the bots' names */
  bots: readonly string[] | null;
  /** the kinds of action it is checked against (reads, writes, commands, ...), as the reviewer read them */
  kinds: readonly string[];
  /** an exception: the rules it lets through */
  excepts?: readonly string[];
  /** an exception: the narrow pattern it was drafted with */
  match?: readonly string[];
  /** a default whose words the owner changed */
  edited?: boolean;
}
export interface RulesReviewer { mode: 'auto' | 'pinned'; provider: string | null; model: string | null }
export interface RulesView {
  revision: number;
  rules: readonly Rule[];
  /** defaults the owner removed (Restore defaults puts them back) */
  removedDefaults: readonly string[];
  reviewer: RulesReviewer;
  /** `ok`: a route is set; `none`: no reviewer yet; `failing`: the plugin says it fails */
  reviewerStatus: 'ok' | 'none' | 'failing';
  /** the file changed outside boopis and changes wait until the owner keeps it or keeps theirs */
  changedOutside: boolean;
}
/** a model the reviewer can be, cheapest first (the plugin's `rules.reviewer.rank`) */
export interface ReviewerChoice { provider: string; model: string; estimateUsd: number | null }

/** Settings › Approvals' seam. Every change carries the revision the page read; a stale one rejects with the host's sentence */
export interface RulesSource {
  get(): Promise<RulesView>;
  /** add a rule (no `id`) or change one; resolves with the new revision and the rule's id */
  put(rule: Partial<Rule> & { text: string; type: Rule['type'] }, revision: number): Promise<{ revision: number; id: string }>;
  setEnabled(id: string, enabled: boolean, revision: number): Promise<number>;
  /** remove a rule; the token undoes it for 30 s */
  remove(id: string, revision: number): Promise<{ revision: number; undo: string }>;
  undo(token: string): Promise<number>;
  restoreDefaults(): Promise<number>;
  /** keep the change made outside boopis ("Use the new rules") */
  acceptOutside(): Promise<RulesView>;
  /** put back what boopis wrote ("Keep mine") */
  discardOutside(): Promise<RulesView>;
  /** the reviewer's reading of a rule's words: the kinds of action it catches (null when the reviewer could not read it, with why) */
  kinds(text: string): Promise<{ kinds: readonly string[] | null; why?: string }>;
  reviewers(): Promise<readonly ReviewerChoice[]>;
  /** auto (the cheapest connected model) or one pinned; resolves with the bots the route could not be written for */
  setReviewer(mode: 'auto' | 'pinned', choice: ReviewerChoice | null): Promise<readonly string[]>;
  /** the file changed outside boopis while the app runs */
  onChangedOutside(fn: () => void): Unsubscribe;
}

/** the dictation model as the host reports it */
export interface SpeechModel {
  id: string;
  /** bytes */
  size: number;
  state: 'absent' | 'fetching' | 'ready';
  /** bytes on disk while fetching */
  done: number;
  /** why the last fetch did not finish, in the host's plain words */
  failed: string | null;
  /** the language it listens for; null: it hears which one is spoken */
  language: string | null;
}
export type VoiceProvider = 'elevenlabs' | 'fish_audio' | 'local';
export interface VoiceSettings { provider: VoiceProvider | null; localUrl: string | null }

/** Settings › Models › Voice and speech */
export interface SpeechSource {
  model(): Promise<SpeechModel>;
  /** fetch the model now (as the first press of the mic would); resolves with its state, then `model()` says how far */
  fetchModel(): Promise<SpeechModel>;
  deleteModel(): Promise<SpeechModel>;
  voice(): Promise<VoiceSettings>;
  setVoice(v: VoiceSettings): Promise<VoiceSettings>;
  /** whether a provider's key is in the keychain (never the key) */
  hasKey(provider: Exclude<VoiceProvider, 'local'>): Promise<boolean>;
  /** keep a provider's key in the keychain; the value goes nowhere else */
  setKey(provider: Exclude<VoiceProvider, 'local'>, key: string): Promise<void>;
  deleteKey(provider: Exclude<VoiceProvider, 'local'>): Promise<void>;
  /** a voice is set up (a provider with its key, or a local server's address): the voice circle says it is, until talking exists */
  ready: Watch<boolean>;
}
