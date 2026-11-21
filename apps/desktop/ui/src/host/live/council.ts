/* The council: several models answer one message, and one of them combines the answers (ADR-0034). It is the engine's own
   mixture of agents, a virtual provider called `moa`: a preset names the members (each answers once, without tools) and the
   combiner (the "aggregator", the model that runs the turn and keeps its tools). Nothing is patched and nothing is added to the
   engine; this file does three things with what it already has:
     1. writes the preset into the profile's configuration with the engine's own command (`cli.exec` runs `config set
        moa.presets.council.<field> <value>`; the host never edits the file, ADR-0014);
     2. makes the next message of one session a council's with `config.set model "council --provider moa --once"`, then
        `prompt.submit` as always. The engine puts the session's model back after that turn;
     3. reads the turn's `moa.reference`, `moa.progress`, `moa.phase` and `moa.aggregating` events into a `CouncilTurn`.
   The pure parts (who sits by default, the preset's writes, the labels, the event reducer) are tested alone; the rest is thin. */
import { ui } from '@boopis/ui';
import { logger } from '../../core/log';
import { MIN_COUNCIL } from '../../data/types';
import type { CouncilChoice, CouncilForm, CouncilMember, CouncilSay, CouncilSlot, CouncilSource, CouncilTurn, ModelChoice } from '../../data/types';
import type { GatewayClient } from '../gateway';
import { choicesFrom, splitValue, valueOf } from './models';
import type { LadderTier } from './models';
import type { ModelOptionsWire } from './wire';
import { isUnknownMethod } from './wire';

const log = logger('live.council');

/** the preset boopis keeps in the profile's `moa:` section: it is written for the council form, so a preset of the user's own
    under another name is never touched */
export const COUNCIL_PRESET = 'council';
/** the one-turn switch: the preset, on the engine's virtual provider, for this turn only (the engine restores the model after it) */
export const onceValue = (preset = COUNCIL_PRESET): string => preset + ' --provider moa --once';

/* ───────── who sits by default ───────── */

/* Models the default never picks. Fable bills usage credits from its first request on a Pro plan (`claude.rs`, ALIASES: the
   ladder leaves it out for the same reason), so it is the user's to add in the form, never a default. */
const NOT_BY_DEFAULT = /fable|mythos/i;
/* a model that is the small or cheap one of its family loses to the family's main one */
const LIGHT = /mini|nano|lite|flash|haiku|small|air\b|instant/i;
/* a tier word, higher is stronger: the families name their top model by one of these */
const TIER: ReadonlyArray<readonly [RegExp, number]> = [[/opus|ultra|max\b|pro\b|large|405b|235b/i, 40], [/sonnet|plus|medium/i, 25], [/flash|mini|haiku|small|lite|nano/i, 8]];
const tierOf = (id: string): number => TIER.find(([re]) => re.test(id))?.[1] ?? 20;
/** the numbers in a model id as a version ('claude-opus-5-5[1m]' is [5, 5], 'gpt-5.1-codex' is [5, 1]); a context-size suffix is not one */
export function versionOf(id: string): number[] {
  const m = id.replace(/\[[^\]]*\]/g, '').match(/\d+(?:[.-]\d+)*/);
  return m ? m[0].split(/[.-]/).map(Number) : [];
}
const byVersion = (a: number[], b: number[]): number => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (b[i] ?? -1) - (a[i] ?? -1); if (d) return d; } return 0; };

/** the best model of a provider's list: not a small one while a main one exists, the strongest tier, the newest version; the order the engine
    lists them breaks a tie. A model that is never a default (see above) is skipped unless nothing else is left. */
export function bestOf(models: readonly string[]): string | null {
  const pool = models.filter((m) => !NOT_BY_DEFAULT.test(m));
  const list = pool.length ? pool : [...models];
  const ranked = list.map((m, i) => ({ m, i })).sort((a, b) => Number(LIGHT.test(a.m)) - Number(LIGHT.test(b.m)) || tierOf(b.m) - tierOf(a.m) || byVersion(versionOf(a.m), versionOf(b.m)) || a.i - b.i);
  return ranked[0]?.m ?? null;
}

/** the best model of each provider the user can use: a provider with tiers on the ladder gives its highest tier (the user's own
    configuration of what to trust), any other its `bestOf`; one member per provider, in the order the providers are offered */
export function defaultMembers(choices: readonly ModelChoice[]): CouncilSlot[] {
  const byProvider = new Map<string, ModelChoice[]>();
  for (const c of choices) {
    if (!c.provider || c.provider === 'moa') continue;
    byProvider.set(c.provider, [...(byProvider.get(c.provider) ?? []), c]);
  }
  const out: CouncilSlot[] = [];
  for (const [provider, list] of byProvider) {
    const tiers = list.filter((c) => c.tier !== undefined).sort((a, b) => (b.tier as number) - (a.tier as number));
    const model = tiers[0]?.model ?? bestOf(list.map((c) => c.model));
    if (model) out.push({ provider, model });
  }
  return out;
}

/** whether a slot is one of the models on offer (the same model under its alias or its pinned id is the same) */
export const isOffered = (choices: readonly ModelChoice[], s: CouncilSlot): boolean => choices.some((c) => c.provider === s.provider && ui.modelMark.same(c.model, s.model));
const sameSlot = (a: CouncilSlot, b: CouncilSlot): boolean => a.provider === b.provider && ui.modelMark.same(a.model, b.model);

/** a slot as 'provider/model', the value the rest of the UI names a model by */
export const valueOfSlot = (s: CouncilSlot): string => valueOf(s.provider, s.model);

/** where the form starts when nothing is remembered: the best of each provider, and the session's own model combining them */
export function defaultChoice(choices: readonly ModelChoice[], current: string): CouncilChoice {
  const members = defaultMembers(choices);
  const s = splitValue(current);
  const known = choices.find((c) => c.value === current) ?? choices.find((c) => ui.modelMark.same(c.value, current));
  const combiner: CouncilSlot | null = known ? { provider: known.provider, model: known.model } : current && s.provider ? { provider: s.provider, model: s.model } : null;
  return { members, combiner: combiner ?? members[0] ?? { provider: '', model: '' } };
}

/* ───────── the preset, as the engine keeps it ───────── */

interface PresetWire { enabled?: boolean; reference_models?: { provider?: string; model?: string; enabled?: boolean }[]; aggregator?: { provider?: string; model?: string }; fanout?: string }
const slotWire = (s: CouncilSlot): { provider: string; model: string } => ({ provider: s.provider, model: s.model });

/** what the engine remembers of the last council, as a choice; null when no preset is saved or it is not whole */
export function choiceFromPreset(p: PresetWire | null | undefined): CouncilChoice | null {
  if (!p || typeof p !== 'object') return null;
  const members = (Array.isArray(p.reference_models) ? p.reference_models : []).filter((m) => m && m.enabled !== false && m.provider && m.model).map((m) => ({ provider: String(m.provider), model: String(m.model) }));
  const a = p.aggregator;
  if (!a?.provider || !a.model || members.length < MIN_COUNCIL) return null;
  return { members, combiner: { provider: String(a.provider), model: String(a.model) } };
}

/** the writes that make the saved preset this choice, as `[key, value]` for the engine's `config set`; only what differs from `saved` (a
    council asked twice the same way writes nothing). `fanout: user_turn` is the cheapest cadence (the members answer once per message, not
    once per tool step) and is what the cost note says. */
export function presetWrites(choice: CouncilChoice, saved: PresetWire | null | undefined, preset = COUNCIL_PRESET): Array<[string, string]> {
  const key = (f: string): string => 'moa.presets.' + preset + '.' + f;
  const out: Array<[string, string]> = [];
  const was = choiceFromPreset(saved);
  const sameMembers = !!was && was.members.length === choice.members.length && choice.members.every((m, i) => m.provider === (was.members[i] as CouncilSlot).provider && m.model === (was.members[i] as CouncilSlot).model);
  if (!sameMembers) out.push([key('reference_models'), JSON.stringify(choice.members.map(slotWire))]);
  if (!was || was.combiner.provider !== choice.combiner.provider || was.combiner.model !== choice.combiner.model) out.push([key('aggregator'), JSON.stringify(slotWire(choice.combiner))]);
  if (saved?.fanout !== 'user_turn') out.push([key('fanout'), 'user_turn']);
  if (saved?.enabled === false) out.push([key('enabled'), 'true']);
  return out;
}

/* ───────── the engine's label for a slot, and back ───────── */

/** the label the engine puts on a slot in its events: `provider:model`, and `[reasoning=x]` after it when the slot sets an effort */
export const slotLabel = (s: CouncilSlot): string => s.provider + ':' + s.model;
/** the slot a label names: the known slot it is the label of (providers may have a colon of their own, `custom:name`), else split at
    the first colon. The effort suffix is dropped. */
export function slotOfLabel(label: string, known: readonly CouncilSlot[] = []): CouncilSlot {
  const bare = label.replace(/\[reasoning=[^\]]*\]$/, '');
  const hit = known.find((s) => slotLabel(s) === bare);
  if (hit) return hit;
  const i = bare.indexOf(':');
  return i < 0 ? { provider: '', model: bare } : { provider: bare.slice(0, i), model: bare.slice(i + 1) };
}

/* ───────── the turn: events into what the card shows ───────── */

/** a council turn that has just started, every member waiting */
export const startedCouncil = (c: CouncilChoice): CouncilTurn => ({
  members: c.members.map((slot): CouncilMember => ({ slot, state: 'waiting', text: '' })), combiner: c.combiner, phase: 'members', done: 0, total: c.members.length
});
/** the engine's note for a member that did not answer (`[failed: ...]`, `[skipped: ...]`): it never reaches the screen as written */
export const isFailedReference = (text: string): boolean => /^\s*\[(failed|skipped):/i.test(text);

interface MoaEvent { type: string; payload?: Record<string, unknown> | undefined }
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** `null` when the event is not a council's */
export function applyMoa(prev: CouncilTurn | null, ev: MoaEvent): CouncilTurn | null {
  if (!ev.type.startsWith('moa.')) return null;
  const p = ev.payload ?? {};
  const t: CouncilTurn = prev ?? { members: [], combiner: null, phase: 'members', done: 0, total: 0 };
  const known = t.members.map((m) => m.slot);
  const find = (slot: CouncilSlot): number => t.members.findIndex((m) => sameSlot(m.slot, slot));
  const upsert = (slot: CouncilSlot, patch: Partial<CouncilMember>): CouncilMember[] => {
    const i = find(slot);
    if (i < 0) return [...t.members, { slot, state: 'waiting', text: '', ...patch }];
    return t.members.map((m, j) => (j === i ? { ...m, ...patch } : m));
  };
  switch (ev.type) {
    case 'moa.progress': {
      const done = num(p['refs_done']), total = num(p['refs_total']);
      const label = str(p['label']);
      /* the member that just finished is known by its label; its text comes with the batch of `moa.reference` that follows */
      const members = label ? upsert(slotOfLabel(label, known), { state: 'answered' }) : t.members;
      return { ...t, members, done: done ?? t.done, total: total ?? Math.max(t.total, members.length) };
    }
    case 'moa.reference': {
      const text = str(p['text']);
      const slot = slotOfLabel(str(p['label']), known);
      const failed = isFailedReference(text);
      const members = upsert(slot, { state: failed ? 'failed' : 'answered', text: failed ? '' : text });
      const count = num(p['count']);
      return { ...t, members, total: count ?? Math.max(t.total, members.length), done: Math.max(t.done, members.filter((m) => m.state !== 'waiting').length) };
    }
    case 'moa.phase':
    case 'moa.aggregating': {
      const agg = str(p['aggregator']);
      return { ...t, phase: 'combining', combiner: agg ? slotOfLabel(agg, [...(t.combiner ? [t.combiner] : []), ...known]) : t.combiner, done: num(p['refs_done']) ?? t.done, total: num(p['refs_total']) ?? t.total };
    }
    default: return t;
  }
}
/** the turn is over: the combiner has answered */
export const finishedCouncil = (t: CouncilTurn): CouncilTurn => ({ ...t, phase: 'done' });
/** how many answers the combiner had to work from */
export const answersOf = (t: CouncilTurn): number => t.members.filter((m) => m.state === 'answered' && m.text !== '').length;

/* ───────── the source ───────── */

/** what the council needs to know of a session, from the details (the model it answers with, its mode, whether a turn runs) */
export interface CouncilDeps {
  client: GatewayClient;
  /** the gateway's id of a UI session, null while it is only a placeholder here */
  gwId(uiId: string): string | null;
  /** the models on offer, and the session's model ('provider/model') and mode */
  context(uiId: string): { options: ModelOptionsWire | null; ladder: readonly LadderTier[]; current: string; governed: boolean; running: boolean };
  /** the wait between tries while a new session's agent is being built (tests make it short) */
  wait?: (ms: number) => Promise<void>;
}

export const GOVERNED_WHY = 'A governed session climbs the model ladder only when a gate fails. A council would buy more models without a failure, so it is not offered here. Start an ungoverned session to ask one.';
const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface CouncilHost extends CouncilSource {
  /** before the message goes out: switch this one turn to the council. Resolves with the choice that ran it, null when nothing was armed. Rejects with a sentence when the engine refuses, so the message is not answered by a model nobody chose. */
  start(uiId: string): Promise<CouncilChoice | null>;
}

export function createCouncil(deps: CouncilDeps): CouncilHost {
  const { client } = deps;
  const wait = deps.wait ?? ((ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); }));
  const armedBy = new Map<string, CouncilChoice>();
  const subs = new Set<() => void>();
  const notify = (): void => { for (const f of [...subs]) f(); };

  /** the engine's own configuration, as it stands: the `moa` section of the profile (null when it cannot be read) */
  async function savedPreset(): Promise<PresetWire | null> {
    try {
      const r = (await client.requestRaw('config.get', { key: 'full' })) as { config?: { moa?: { presets?: Record<string, PresetWire> } } } | null;
      return r?.config?.moa?.presets?.[COUNCIL_PRESET] ?? null;
    } catch (e) { log.info('the council preset was not read', e); return null; }
  }
  /** `hermes config set` through the gateway: the engine writes its own file. A refusal says why in the engine's words, which go to the log, not the screen */
  async function configSet(key: string, value: string): Promise<void> {
    const r = (await client.requestRaw('cli.exec', { argv: ['config', 'set', key, value], timeout: 60 })) as { blocked?: boolean; code?: number; output?: string; hint?: string | null } | null;
    if (!r || r.blocked || r.code !== 0) {
      log.warn('config set ' + key + ' was refused', r);
      throw new Error('boopis\'s engine would not save the council (' + (r?.blocked ? 'it does not run settings here' : 'it refused a setting') + '), so nothing was changed. Try again, or choose other models.');
    }
  }

  return {
    can(uiId): CouncilSay {
      const c = deps.context(uiId);
      if (c.governed) return { ok: false, reason: GOVERNED_WHY };
      if (c.running) return { ok: false, reason: 'A council starts on an idle session. Wait for the answer, or stop it.' };
      return { ok: true };
    },
    async prepare(uiId): Promise<CouncilForm> {
      const c = deps.context(uiId);
      const options = choicesFrom(c.options, c.ladder).filter((x) => x.provider !== 'moa');
      const saved = choiceFromPreset(await savedPreset());
      /* the last council stands while every model of it is still on offer (a provider signed out since is not); the form shows what changed */
      const intact = saved && [...saved.members, saved.combiner].every((s) => isOffered(options, s)) ? saved : null;
      if (intact) return { options, choice: intact, remembered: true };
      const d = defaultChoice(options, c.current);
      /* a remembered council whose models are partly gone keeps the members that are left */
      const kept = saved ? saved.members.filter((s) => isOffered(options, s)) : [];
      return { options, choice: kept.length >= MIN_COUNCIL ? { members: kept, combiner: isOffered(options, saved?.combiner ?? { provider: '', model: '' }) ? (saved as CouncilChoice).combiner : d.combiner } : d, remembered: false };
    },
    async arm(uiId, choice): Promise<void> {
      if (choice.members.length < MIN_COUNCIL) throw new Error('A council needs at least ' + MIN_COUNCIL + ' members.');
      const said = this.can(uiId);
      if (!said.ok) throw new Error(said.reason);
      const writes = presetWrites(choice, await savedPreset());
      for (const [k, v] of writes) await configSet(k, v);   /* one after another: each is a read and a write of the same file */
      armedBy.set(uiId, choice);
      notify();
    },
    armed: (uiId) => armedBy.get(uiId) ?? null,
    disarm(uiId) { if (armedBy.delete(uiId)) notify(); },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    async start(uiId): Promise<CouncilChoice | null> {
      const choice = armedBy.get(uiId);
      if (!choice) return null;
      armedBy.delete(uiId);   /* one message: it is spent whether or not the engine takes it */
      notify();
      const gw = deps.gwId(uiId);
      if (!gw) throw new Error('The council could not start: this session is not on the engine yet.');
      /* a session made a moment ago has no agent until the engine has built it, and a one-turn switch needs one: it answers that it is
         "a live session" that is missing (code 5001) or says it is still starting (5032). The engine's words are not shown to us (the gateway
         keeps them for Diagnostics), so the code tells them apart from a refusal of the model itself (4002), which is not tried again */
      let last: unknown = null;
      for (let i = 0; i < 12; i++) {
        try {
          const r = (await client.requestRaw('config.set', { session_id: gw, key: 'model', value: onceValue(), confirm_expensive_model: true })) as { confirm_required?: boolean; confirm_message?: string; deferred?: boolean } | null;
          if (r?.confirm_required) throw new Error(r.confirm_message || 'the engine asked for a confirmation');
          return choice;
        } catch (e) {
          last = e;
          const code = (e as { rpcCode?: number } | null)?.rpcCode;
          if (isUnknownMethod(e) || (code !== 5001 && code !== 5032)) break;
          await wait(500);
        }
      }
      log.warn('the one-turn switch to the council failed', last);
      throw new Error('The council could not start (' + sentence(last) + '), so the message was not sent.');
    }
  };
}

export type { ModelChoice };
