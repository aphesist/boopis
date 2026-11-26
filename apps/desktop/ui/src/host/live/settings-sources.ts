/* The live provider's sources for Settings (data/settings-host.ts): the rules list over the host's rules commands and the plugin's
   `rules.*` RPCs (ADR-0060), and speech over the host's dictation-model and voice commands and its keychain (ADR-0059). In the desktop
   app only. A voice provider's key goes from its field to `secret_set` and is never read back: `hasKey` asks `secret_exists`. */
import type { Rule, RulesSource, RulesView, ReviewerChoice, SpeechModel, SpeechSource, VoiceProvider, VoiceSettings } from '../../data/settings-host';
import { store } from '../../data/store';
import type { Unsubscribe } from '../../data/provider';
import { logger } from '../../core/log';

const log = logger('settings-host');

/** the host's commands Settings uses (a subset of `bindings.ts` `commands`, so tests pass a fake) */
export interface SettingsCommands {
  rulesGet(): Promise<unknown>;
  rulesPut(rule: unknown, expectedRevision: number): Promise<unknown>;
  rulesSetEnabled(id: string, enabled: boolean, expectedRevision: number): Promise<unknown>;
  rulesRemove(id: string, expectedRevision: number): Promise<unknown>;
  rulesUndo(undoToken: string): Promise<unknown>;
  rulesRestoreDefaults(ids: string[] | null): Promise<unknown>;
  rulesAcceptOutside(): Promise<unknown>;
  rulesDiscardOutside(): Promise<unknown>;
  rulesReviewerSet(mode: string, provider: string | null, model: string | null): Promise<unknown>;
  dictationModel(): Promise<unknown>;
  dictationModelFetch(): Promise<unknown>;
  dictationModelDelete(): Promise<unknown>;
  voiceSettingsGet(): Promise<unknown>;
  voiceSettingsSet(provider: string | null, localUrl: string | null): Promise<unknown>;
  secretSet(service: string, account: string, value: string): Promise<unknown>;
  secretExists(service: string, account: string): Promise<boolean>;
  secretDelete(service: string, account: string): Promise<unknown>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const SOURCES = new Set(['default', 'owner', 'card', 'chat']);
/** one rule as the host's file holds it; a rule that is not one (no id or text) is left out */
export function ruleOf(v: unknown): Rule | null {
  const r = obj(v);
  const id = str(r['id']), text = str(r['text']);
  if (!id || text == null) return null;
  const source = str(r['source']) ?? 'owner';
  return {
    id, text, type: r['type'] === 'exception' ? 'exception' : 'ask', enabled: r['enabled'] !== false,
    ...(r['state'] === 'draft' ? { state: 'draft' as const } : r['type'] === 'exception' ? { state: 'active' as const } : {}),
    source: (SOURCES.has(source) ? source : 'owner') as Rule['source'],
    bots: Array.isArray(r['bots']) ? strs(r['bots']) : null, kinds: strs(r['kinds']),
    ...(Array.isArray(r['excepts']) ? { excepts: strs(r['excepts']) } : {}), ...(Array.isArray(r['match']) ? { match: strs(r['match']) } : {}),
    ...(r['edited'] === true ? { edited: true } : {})
  };
}
/** what `rules_get` (and accept or discard) answers, as Settings reads it */
export function rulesViewOf(v: unknown): RulesView {
  const top = obj(v), doc = obj(top['rules']), rev = obj(doc['reviewer']);
  const status = top['reviewer_status'];
  return {
    revision: num(doc['revision']),
    rules: (Array.isArray(doc['rules']) ? doc['rules'] : []).map(ruleOf).filter((r): r is Rule => !!r),
    removedDefaults: strs(doc['removed_defaults']),
    reviewer: { mode: rev['mode'] === 'pinned' ? 'pinned' : 'auto', provider: str(rev['provider']), model: str(rev['model']) },
    reviewerStatus: status === 'ok' || status === 'failing' ? status : 'none',
    changedOutside: top['changed_outside'] === true
  };
}

export function liveRules(o: { commands: SettingsCommands; plugin: (method: string, params: Record<string, unknown>) => Promise<unknown>; onOutside: (fn: () => void) => Unsubscribe }): RulesSource {
  const c = o.commands;
  return {
    get: async () => rulesViewOf(await c.rulesGet()),
    async put(rule, revision) { const r = obj(await c.rulesPut(rule, revision)); return { revision: num(r['revision']), id: str(r['id']) ?? '' }; },
    setEnabled: async (id, on, revision) => num(obj(await c.rulesSetEnabled(id, on, revision))['revision']),
    async remove(id, revision) { const r = obj(await c.rulesRemove(id, revision)); return { revision: num(r['revision']), undo: str(r['undo_token']) ?? '' }; },
    undo: async (token) => num(obj(await c.rulesUndo(token))['revision']),
    restoreDefaults: async () => num(obj(await c.rulesRestoreDefaults(null))['revision']),
    acceptOutside: async () => rulesViewOf(await c.rulesAcceptOutside()),
    discardOutside: async () => rulesViewOf(await c.rulesDiscardOutside()),
    async kinds(text) {
      const r = obj(await o.plugin('rules.kinds', { text }));
      return Array.isArray(r['kinds']) ? { kinds: strs(r['kinds']) } : { kinds: null, ...(str(r['held']) ? { why: str(r['held']) as string } : {}) };
    },
    async reviewers() {
      const r = obj(await o.plugin('rules.reviewer.rank', {}));
      const list = (Array.isArray(r['candidates']) ? r['candidates'] : []).map(obj).map((x): ReviewerChoice => ({ provider: str(x['provider']) ?? '', model: str(x['model']) ?? '', estimateUsd: typeof x['estimate_usd'] === 'number' ? x['estimate_usd'] : null }));
      const unpriced = (Array.isArray(r['unpriced']) ? r['unpriced'] : []).map(obj).map((x): ReviewerChoice => ({ provider: str(x['provider']) ?? '', model: str(x['model']) ?? '', estimateUsd: null }));
      return [...list, ...unpriced].filter((x) => x.provider && x.model);
    },
    async setReviewer(mode, choice) {
      /* auto takes the cheapest the plugin ranked: the window passes its pick (the host's contract) */
      const pick = choice ?? (mode === 'auto' ? (await this.reviewers())[0] ?? null : null);
      const r = obj(await c.rulesReviewerSet(mode, pick?.provider ?? null, pick?.model ?? null));
      return strs(r['problems']);
    },
    onChangedOutside: o.onOutside
  };
}

/** the keychain's name for a voice provider's key (the host's `voice.rs` `key_service`) */
export const voiceKeyService = (p: Exclude<VoiceProvider, 'local'>): string => 'boopis.voice.' + p;
const ACCOUNT = 'api_key';
export function speechModelOf(v: unknown): SpeechModel {
  const m = obj(v), state = m['state'];
  return { id: str(m['id']) ?? '', size: num(m['size']), state: state === 'ready' || state === 'fetching' ? state : 'absent', done: num(m['done']), failed: str(m['failed']), language: str(m['language']) };
}
export function voiceOf(v: unknown): VoiceSettings {
  const m = obj(v), p = m['provider'];
  return { provider: p === 'elevenlabs' || p === 'fish_audio' || p === 'local' ? p : null, localUrl: str(m['local_url']) };
}

export function liveSpeech(c: SettingsCommands): SpeechSource {
  const ready = store(false);
  const hasKey = async (p: Exclude<VoiceProvider, 'local'>): Promise<boolean> => c.secretExists(voiceKeyService(p), ACCOUNT);
  /** a voice is set up: a provider whose key is there, or a local server with its address */
  const recheck = async (v?: VoiceSettings): Promise<void> => {
    try {
      const now = v ?? voiceOf(await c.voiceSettingsGet());
      ready.set(now.provider === 'local' ? !!now.localUrl : now.provider ? await hasKey(now.provider) : false);
    } catch (e) { log.debug('the voice settings could not be read', e); ready.set(false); }
  };
  void recheck();
  return {
    model: async () => speechModelOf(await c.dictationModel()),
    fetchModel: async () => speechModelOf(await c.dictationModelFetch()),
    deleteModel: async () => speechModelOf(await c.dictationModelDelete()),
    voice: async () => voiceOf(await c.voiceSettingsGet()),
    async setVoice(v) { const out = voiceOf(await c.voiceSettingsSet(v.provider, v.localUrl)); await recheck(out); return out; },
    hasKey,
    async setKey(p, key) { await c.secretSet(voiceKeyService(p), ACCOUNT, key); await recheck(); },
    async deleteKey(p) { await c.secretDelete(voiceKeyService(p), ACCOUNT); await recheck(); },
    ready
  };
}
