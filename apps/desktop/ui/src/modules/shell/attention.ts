/* the title in the command field (where you are) and the dots that say a tab needs you */
import { $$ } from '../../core/dom';
import { state } from '../../core/state';
import { TABS } from '../../core/settings';
import { kbdLabel } from '../../core/keys';
import type { Tab } from '../../core/types';
import { data } from '../../data';
import { els, sh } from './ctx';
import { setTitle } from './chrome';
import type { TitleLead } from './chrome';

/* ───────── title: project / session, or bots / bot ───────── */
const titleOverride: Record<Tab, string | null> = { session: null, bots: null };
const leadOverride: Record<Tab, TitleLead | null> = { session: null, bots: null };
export function setTitleOverride(tab: Tab, title: string | null, lead?: TitleLead | null): void { titleOverride[tab] = title; leadOverride[tab] = lead ?? null; }
/** the title pill: the open session (its glyph and title), the open bot (its orb and name) or a room (its stack and name) */
export function updateTitle(): void {
  const el = els();
  if (!el || !el.btnTitle) return;
  let t: string | null = titleOverride[state.tab], lead: TitleLead = leadOverride[state.tab] ?? {};
  if (state.tab === 'session') {
    const ss = data().sessions.list.get();
    const s = ss.find((x) => x.id === sh.selection.session) ?? ss.find((x) => x.running) ?? ss[0];
    t = t || (s ? s.title : 'New session');
    lead = { icon: 'terminal' };
  } else {
    const b = data().bots.snapshot().bots.find((x) => x.id === sh.selection.bots);
    t = t || (b ? b.name : 'All bots');
    if (!leadOverride.bots) lead = b ? { bot: b } : { icon: 'bots' };
  }
  // the visible words stay in the name, in order (WCAG 2.5.3, label in name); the pill opens the details
  setTitle(t, lead, t + ', details');
  if (el.btnSearch) el.btnSearch.setAttribute('aria-label', 'Search, ' + kbdLabel('mod+K'));
}

/* ───────── attention ─────────
   One count per tab, from the module that owns the items: 'session' for the session tab, 'bots' for the bots tab.
   'cards' and 'dock' report the same items again (a card lives inside a session or a bot thread, the dock mirrors
   both), so they never add to a tab. Values seeded from the provider stand in only until the owner reports. Other
   sources add their unique ids when they send them, or their count. */
interface Count { count: number; tab: Tab; ids: readonly string[] | null }
const attention = new Map<string, Count>();
const TABNAME: Record<Tab, string> = { session: 'Sessions', bots: 'Bots' };
const OWNER: Record<Tab, string> = { session: 'session', bots: 'bots' };
const MIRRORS = new Set(['cards', 'dock']);
export function tabForSource(src: string, tab: string | undefined): Tab {
  if (tab && (TABS as readonly string[]).includes(tab)) return tab as Tab;
  const bots = data().bots.snapshot().bots.map((b) => b.id);
  if (bots.includes(src) || /^bot/.test(String(src))) return 'bots';
  return 'session';
}
export function reportAttention(source: string, count: number, tab: string | undefined, ids: readonly string[] | undefined): void {
  const n = Math.max(0, +count || 0);
  // an owner reporting zero is kept (zero is an answer), so stale seeds never come back
  if (n || source === 'session' || source === 'bots') attention.set(source, { count: n, tab: tabForSource(source, tab), ids: Array.isArray(ids) ? ids.slice() : null });
  else attention.delete(source);
  updateAttentionDots();
}
/** what waits on the user is counted on the tab it belongs to: a bot's approval on Bots, the agent's own (an approval or a blank) on Session */
const waitTab = (w: { kind: string; bot?: string | undefined }): Tab => (w.kind === 'approval' && w.bot ? 'bots' : 'session');
export function seedAttention(): void {
  for (const w of data().waits.snapshot()) attention.set('seed:' + w.id, { count: 1, tab: waitTab(w), ids: null });
  /* a wait that arrives later (a live approval or blank) and one that is decided */
  data().waits.subscribe((ev) => {
    if (ev.type === 'added') attention.set('seed:' + ev.wait.id, { count: 1, tab: waitTab(ev.wait), ids: null });
    else attention.delete('seed:' + ev.id);
    updateAttentionDots();
  });
}
export function attentionFor(tab: Tab): number {
  const owner = attention.get(OWNER[tab]);
  if (owner) {
    const ids = new Set(owner.ids ?? []);
    let n = owner.ids ? ids.size : owner.count;
    for (const [src, v] of attention) {
      if (src === OWNER[tab] || MIRRORS.has(src) || src.startsWith('seed:') || v.tab !== tab) continue;
      if (v.ids) { for (const id of v.ids) if (!ids.has(id)) { ids.add(id); n++; } } else n += v.count;
    }
    return n;
  }
  let n = 0;
  for (const [src, v] of attention) if (v.tab === tab && !MIRRORS.has(src)) n += v.count;
  return n;
}
export function updateAttentionDots(): void {
  const per: Record<Tab, number> = { session: attentionFor('session'), bots: attentionFor('bots') };
  const sg = sh.seg.tabs;
  if (sg) for (const b of $$('[role="tab"]', sg)) {
    const t = (b.dataset['value'] ?? 'session') as Tab, n = per[t] || 0;
    const dot = b.querySelector('.k7-seg__dot'); if (dot) dot.toggleAttribute('data-show', n > 0 && t !== state.tab);
    b.setAttribute('aria-label', n > 0 && t !== state.tab ? TABNAME[t] + ', needs you' : TABNAME[t]);
  }
}
