/* What the desktop host holds for the owner (6e): the team changes a bot proposed (`team_plans_list`, `team_plan_get`, `team_plan_apply`
   (the hold), `team_plan_reject`, `team_plan_undo`; the event `plans-changed-event`) and the steps a rule paused while the owner was away
   (`parked_list`, `parked_answer`). The host's JSON is read here and turned into the data seam's shapes; nothing is invented: a field the
   host did not send is left empty. The host sends the UI no event when a step is parked (its `rule.refused` notification goes to the
   desktop and the Local API), so the parked list is read again when the window comes back to the front and once a minute while a
   thread shows it. */
import type { ParkedChoice, ParkedSource, ParkedStep, PlanState, TeamPlan, TeamPlansSource } from '../../data/types';
import { BOOPIS_ID } from '../../data/types';

type Obj = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? str((x as Obj)['text']) || str((x as Obj)['message']) : '')).filter(Boolean) : []);
const STATES: readonly PlanState[] = ['proposed', 'applied', 'rejected', 'expired', 'failed'];

/** a plan as the host shows it (`team_plan_get`), in the data seam's shape */
export function planFrom(v: unknown): TeamPlan | null {
  const o = (v && typeof v === 'object' ? v : {}) as Obj;
  const hash = str(o['plan_hash']);
  if (!hash) return null;
  const st = str(o['state']) as PlanState;
  const report = o['report'];
  return {
    hash, title: str(o['title']), reason: str(o['reason']),
    actions: (Array.isArray(o['actions']) ? o['actions'] : []).map((a) => ({ mark: str((a as Obj)['mark']), target: str((a as Obj)['target']), what: str((a as Obj)['what']) })),
    problems: strs(o['problems']), notes: strs(o['notes']), state: STATES.includes(st) ? st : 'proposed', permanent: o['permanent'] === true,
    undoes: str(o['undoes']) || null, words: str(o['words']) || null,
    report: typeof report === 'string' ? report : report && typeof report === 'object' ? str((report as Obj)['summary']) || str((report as Obj)['message']) || null : null,
    bot: str(o['bot']) || BOOPIS_ID, createdAt: str(o['created_at']), expiresAt: str(o['expires_at']) || null
  };
}
/** a parked step as the host shows it (`parked_list`): its rule by its words, its tool by its safe words; never its arguments */
export function parkedFrom(v: unknown): ParkedStep | null {
  const o = (v && typeof v === 'object' ? v : {}) as Obj;
  const id = str(o['id']);
  if (!id) return null;
  return { id, bot: str(o['bot']) || str(o['profile']), rule: strs(o['rules']).join(' · '), tool: str(o['summary']), at: str(o['at']), expiresAt: str(o['expires_at']) || null, choices: strs(o['choices']) };
}

export interface HeldDeps {
  plansList(all: boolean): Promise<unknown>; planGet(hash: string): Promise<unknown>; planApply(hash: string): Promise<unknown>;
  planReject(hash: string, words: string | null): Promise<unknown>; planUndo(hash: string): Promise<unknown>;
  onPlansChanged(cb: () => void): Promise<() => void>;
  parkedList(): Promise<unknown>; parkedAnswer(id: string, choice: string): Promise<unknown>;
  /** the window came back to the front */ onFront(cb: () => void): () => void;
}
const why = (e: unknown): Error => new Error(e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e));

export function teamPlansSource(d: HeldDeps): TeamPlansSource {
  const subs = new Set<() => void>();
  let off: Promise<() => void> | null = null;
  const one = async (hash: string, ran: Promise<unknown>): Promise<TeamPlan> => {
    try { const p = planFrom(await ran) ?? planFrom(await d.planGet(hash)); if (!p) throw new Error('There is no such plan. Make a new one.'); subs.forEach((f) => { f(); }); return p; } catch (e) { throw why(e); }
  };
  return {
    async list() {
      const got = await d.plansList(true) as { plans?: unknown[] };
      /* the listing carries no actions: each plan is read whole, as its card shows it */
      const full = await Promise.all((got?.plans ?? []).map((p) => d.planGet(str((p as Obj)['plan_hash'])).then(planFrom, () => null)));
      return full.filter((p): p is TeamPlan => !!p);
    },
    apply: (hash) => one(hash, d.planApply(hash)),
    reject: (hash, words) => one(hash, d.planReject(hash, words.trim() || null)),
    undo: (hash) => one(hash, d.planUndo(hash)),
    subscribe(fn) {
      subs.add(fn);
      off ??= d.onPlansChanged(() => { subs.forEach((f) => { f(); }); });
      return () => { subs.delete(fn); if (!subs.size && off) { void off.then((u) => { u(); }); off = null; } };
    }
  };
}

export function parkedSource(d: HeldDeps): ParkedSource {
  const subs = new Set<() => void>();
  let timer = 0, offFront: (() => void) | null = null;
  const tell = (): void => { subs.forEach((f) => { f(); }); };
  return {
    async list() {
      const got = await d.parkedList() as { parked?: unknown[] };
      return (got?.parked ?? []).map(parkedFrom).filter((p): p is ParkedStep => !!p);
    },
    async answer(id: string, choice: ParkedChoice) {
      try {
        const r = await d.parkedAnswer(id, choice) as Obj;
        tell();
        return { state: str(r?.['state']) === 'denied' ? 'denied' : 'rerun', draftId: str(r?.['draft_id']) || null };
      } catch (e) { throw why(e); }
    },
    subscribe(fn) {
      subs.add(fn);
      if (!timer) { timer = window.setInterval(tell, 60_000); offFront = d.onFront(tell); }
      return () => { subs.delete(fn); if (!subs.size) { clearInterval(timer); timer = 0; offFront?.(); offFront = null; } };
    }
  };
}
