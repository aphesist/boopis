/* Settings' lab fixtures (step 7a): a rules list as the host keeps it (the owner's eight defaults, a draft from "Always allow", an
   exception), the dictation model and the voice choice as the host reports them, and a desktop host for Diagnostics. Scripted, in
   memory: the pages draw every state from them without a host. The defaults' words are the shipped ones (plugins/boopis/data/
   default-rules.json). */
import { store } from '../data/store';
import type { BotsAdmin, DataProvider, LaterFeature, Rule, RulesSource, RulesView, SpeechModel, SpeechSource, VoiceSettings } from '../data';
import type { DiagnosticsHost } from '../modules/settings/host';

export const DEFAULT_RULES: readonly Rule[] = [
  { id: 'default.outside_files', type: 'ask', text: 'Ask before deleting or overwriting files outside the bot’s workspace, or running rm -rf on broad paths.', enabled: true, source: 'default', bots: null, kinds: ['writes', 'commands', 'code', 'computer'] },
  { id: 'default.root_packages', type: 'ask', text: 'Ask before running as root (sudo, pkexec, su), and before installing or removing packages.', enabled: true, source: 'default', bots: null, kinds: ['commands', 'code', 'computer'] },
  { id: 'default.system', type: 'ask', text: 'Ask before touching disks, partitions, the bootloader or firmware, system services, or system config under /etc.', enabled: true, source: 'default', bots: null, kinds: ['writes', 'commands', 'code', 'computer'] },
  { id: 'default.secrets', type: 'ask', text: 'Ask before reading or changing shell startup files, SSH keys, keyrings, .env and credential files.', enabled: true, source: 'default', bots: null, kinds: ['reads', 'writes', 'commands', 'code', 'computer'] },
  { id: 'default.git_cloud', type: 'ask', text: 'Ask before a git force-push or history rewrite, and before deleting branches, repositories or cloud resources.', enabled: true, source: 'default', bots: null, kinds: ['commands', 'code', 'connector_write', 'computer'] },
  { id: 'default.network_config', type: 'ask', text: 'Ask before opening ports, or changing the firewall, VPN or network settings.', enabled: true, source: 'default', bots: null, kinds: ['commands', 'code', 'computer'] },
  { id: 'default.messages', type: 'ask', text: 'Ask before sending messages, emails or posts to other people, and before publishing anything.', enabled: true, source: 'default', bots: null, kinds: ['messages', 'connector_write', 'commands', 'code', 'browser', 'computer'] },
  { id: 'default.purchases', type: 'ask', text: 'Ask before purchases and spending money.', enabled: true, source: 'default', bots: null, kinds: ['spend', 'connector_write', 'browser', 'commands', 'computer'] }
];
export const DRAFT: Rule = { id: 'x_draft1', type: 'exception', state: 'draft', text: 'kai may force-push feature branches of ~/repos/site.', enabled: true, source: 'card', bots: ['kai'], kinds: ['commands'], excepts: ['default.git_cloud'], match: ['Bash(git push --force origin feature/*)'] };
export const EXCEPTION: Rule = { id: 'x_active1', type: 'exception', state: 'active', text: 'nina may restart the staging services.', enabled: true, source: 'owner', bots: ['nina'], kinds: ['commands'], excepts: ['default.system'] };

export interface FakeRules extends RulesSource { calls: string[]; outside(): void }
/** a rules list in memory that answers as the host does (revisions, undo, outside changes) */
export function fakeRules(o: { rules?: readonly Rule[]; changedOutside?: boolean; unreadable?: boolean; reviewerStatus?: RulesView['reviewerStatus'] } = {}): FakeRules {
  let rules = [...(o.rules ?? DEFAULT_RULES)], revision = 3, changedOutside = !!o.changedOutside, removed: string[] = [];
  const undo = new Map<string, Rule>(), calls: string[] = [], subs = new Set<() => void>();
  let reviewer: RulesView['reviewer'] = { mode: 'auto', provider: 'gemini', model: 'gemini-2.5-flash' };
  const view = (): RulesView => ({ revision, rules, removedDefaults: removed, reviewer, reviewerStatus: o.reviewerStatus ?? 'ok', changedOutside });
  const check = (rev: number): void => { if (changedOutside) throw new Error('The rules were changed outside boopis: keep or discard the change first.'); if (rev !== revision) throw new Error('The rules changed since this page read them.'); };
  return {
    calls,
    outside() { changedOutside = true; for (const f of subs) f(); },
    async get() { calls.push('get'); if (o.unreadable) throw new Error('A newer boopis wrote it (schema 2).'); return view(); },
    async put(rule, rev) {
      check(rev); calls.push('put:' + (rule.id ?? 'new') + ':' + rule.text);
      const id = rule.id ?? 'r_new' + String(revision);
      const was = rules.find((r) => r.id === id);
      const next: Rule = { ...(was ?? { source: 'owner', enabled: true, bots: null, kinds: [] }), ...rule, id } as Rule;
      rules = was ? rules.map((r) => (r.id === id ? next : r)) : [...rules, next];
      revision += 1; return { revision, id };
    },
    async setEnabled(id, enabled, rev) { check(rev); calls.push('enabled:' + id + ':' + String(enabled)); rules = rules.map((r) => (r.id === id ? { ...r, enabled } : r)); revision += 1; return revision; },
    async remove(id, rev) { check(rev); calls.push('remove:' + id); const r = rules.find((x) => x.id === id); rules = rules.filter((x) => x.id !== id); if (id.startsWith('default.')) removed = [...removed, id]; revision += 1; const t = 'tok' + String(revision); if (r) undo.set(t, r); return { revision, undo: t }; },
    async undo(token) { calls.push('undo:' + token); const r = undo.get(token); if (!r) throw new Error('That can no longer be undone.'); rules = [...rules, r]; removed = removed.filter((x) => x !== r.id); undo.delete(token); revision += 1; return revision; },
    async restoreDefaults() { calls.push('restore'); rules = [...DEFAULT_RULES, ...rules.filter((r) => !r.id.startsWith('default.'))]; removed = []; revision += 1; return revision; },
    async acceptOutside() { calls.push('accept'); changedOutside = false; return view(); },
    async discardOutside() { calls.push('discard'); changedOutside = false; return view(); },
    async kinds(text) { calls.push('kinds:' + text); return { kinds: /email|message|post/i.test(text) ? ['messages'] : ['commands'] }; },
    async reviewers() { return [{ provider: 'gemini', model: 'gemini-2.5-flash', estimateUsd: 0.0003 }, { provider: 'anthropic', model: 'claude-haiku-4', estimateUsd: 0.0011 }]; },
    async setReviewer(mode, choice) { calls.push('reviewer:' + mode + ':' + (choice?.model ?? '')); reviewer = { mode, provider: choice?.provider ?? 'gemini', model: choice?.model ?? 'gemini-2.5-flash' }; return []; },
    onChangedOutside(fn) { subs.add(fn); return () => { subs.delete(fn); }; }
  };
}

export const MODEL = (over: Partial<SpeechModel> = {}): SpeechModel => ({ id: 'base-q5_1', size: 59_707_625, state: 'ready', done: 59_707_625, failed: null, language: null, ...over });
export interface FakeSpeech extends SpeechSource { calls: string[]; keys: Set<string> }
/** the host's dictation model and voice choice in memory; a key is only ever "kept" or not */
export function fakeSpeech(o: { model?: SpeechModel; voice?: VoiceSettings; keys?: readonly string[] } = {}): FakeSpeech {
  let model = o.model ?? MODEL(), voice = o.voice ?? { provider: null, localUrl: null };
  const keys = new Set(o.keys ?? []), calls: string[] = [];
  const ready = store(false);
  const recheck = (): void => { ready.set(voice.provider === 'local' ? !!voice.localUrl : voice.provider ? keys.has(voice.provider) : false); };
  recheck();
  return {
    calls, keys, ready,
    async model() { return model; },
    async fetchModel() { calls.push('fetch'); model = { ...model, state: 'fetching', done: 12_000_000 }; return model; },
    async deleteModel() { calls.push('delete'); model = { ...model, state: 'absent', done: 0 }; return model; },
    async voice() { return voice; },
    async setVoice(v) { calls.push('voice:' + String(v.provider) + ':' + String(v.localUrl)); voice = v; recheck(); return voice; },
    async hasKey(p) { return keys.has(p); },
    async setKey(p, key) { calls.push('key:' + p + ':' + String(key.length)); keys.add(p); recheck(); },
    async deleteKey(p) { calls.push('nokey:' + p); keys.delete(p); recheck(); }
  };
}

/** a provider with the rules list (and `rules-settings`), and speech */
export function withSettings(p: DataProvider, o: { rules?: RulesSource | null; speech?: SpeechSource | null; later?: readonly LaterFeature[] } = {}): DataProvider {
  const later = new Set<LaterFeature>([...(p.info.later ?? []), ...(o.later ?? []), ...(o.rules === null ? [] : ['approval-rules', 'rules-settings'] as LaterFeature[])]);
  return { ...p, info: { ...p.info, later }, ...(o.rules === null ? {} : { rules: o.rules ?? fakeRules() }), ...(o.speech === null ? {} : { speech: o.speech ?? fakeSpeech() }) };
}

/** a desktop host for Diagnostics: the GPU and what runs now, a report, frames */
export const fakeDiagnostics = (): DiagnosticsHost => ({
  report: async () => 'boopis 0.2.0\nrenderer: WebKitGTK 2.54.2, GPU',
  measure: async () => '60 fps, p95 17 ms over 5 s: Copy report includes it',
  gpuPage: async () => undefined,
  gpu: async () => ({ policy: 'auto', lines: (chosen) => ['Running on: the integrated GPU (on battery).', ...(chosen !== 'auto' ? ['Saved. It applies after a restart.'] : [])], restart: (chosen) => chosen !== 'auto' }),
  setGpu: async () => undefined,
  restart: async () => undefined
});

/** the bots' own settings as a provider that can delete keeps them (Settings › Bots' Delete, the sheet's flow): the removal note as the
    plugin counts it, archive with its way back, delete by name; scripted, nothing is removed but the roster's row */
export function withBotAdmin(p: DataProvider): DataProvider {
  const admin = {
    removal: async (id: string) => ({ folder: '~/.local/share/boopis/bots/' + id, lines: ['The folder ~/.local/share/boopis/bots/' + id + ' (3.2 MB in 240 files).', 'All its sessions and what they said.', 'Its memory (2 files).', 'Its 9 skills.', 'It has no routines.', 'Its look and its boopis settings.'] }),
    archive: async (id: string) => { p.bots.archive(id); return { undo: () => { const a = p.bots.archived.get().find((x) => x.was === id); return a ? p.bots.restore(a.id) : Promise.resolve(); } }; },
    remove: async (id: string) => { p.bots.archive(id); }
  } as unknown as BotsAdmin;
  return { ...p, bots: { ...p.bots, admin } };
}
/** bots with what Settings › Bots shows of them: kai a $5 cap, iris a rule of its own from the list (with `KAI_ASK` and `NINA_LET`) */
export const KAI_ASK: Rule = { id: 'r_kai_ask', type: 'ask', text: 'Ask before publishing the docs site.', enabled: true, source: 'owner', bots: ['kai'], kinds: ['commands'] };
export function withCaps(p: DataProvider, caps: Readonly<Record<string, string>>): DataProvider {
  const snap = p.bots.snapshot;
  return { ...p, bots: { ...p.bots, snapshot: () => { const s = snap(); return { ...s, bots: s.bots.map((b) => (caps[b.id] ? { ...b, cfg: { ...b.cfg, cap: caps[b.id] as string } } : b)) }; } } };
}
