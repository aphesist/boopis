/* Regions (F6, go to), the things that need you (F8), and the go-to leader (mod+G, or g outside text fields).
   The shell focuses a region's default target and remembers the last focused element of each region (KEYMAP section 3). */
import { emit } from '../../core/bus';
import { $, esc } from '../../core/dom';
import { getDockApi } from '../../core/registry';
import { setState, state } from '../../core/state';
import { ui } from '@boopis/ui';
import { data } from '../../data';
import type { RegionName } from '../../core/bus';
import type { Tab } from '../../core/types';
import { els, sh } from './ctx';
import { updateTitle } from './attention';

const toast = (m: string): void => { ui.toast(m); };
export const REGION_ORDER: readonly RegionName[] = ['bar', 'list', 'messages', 'composer', 'panel', 'dock'];
export const REGION_NAME: Record<RegionName, string> = { bar: 'Title bar', list: 'Sidebar list', messages: 'Conversation', composer: 'Composer', panel: 'Details panel', dock: 'Dock' };
const lastInRegion: Partial<Record<RegionName, Element>> = {};
export const visible = (n: Element | null | undefined): n is HTMLElement => !!n && n.isConnected && n.getClientRects().length > 0 && !n.closest('[inert]') && !n.closest('[hidden]');
export const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const activeView = (): HTMLElement | null => document.getElementById('hx-view-' + state.tab);
function composerIn(view: HTMLElement | null): HTMLElement | null {
  if (!view) return null;
  return [...view.querySelectorAll<HTMLElement>('[data-hx-focus="composer"], textarea, [contenteditable="true"], [role="textbox"]')].find(visible) ?? null;
}
export function panelRoot(): HTMLElement | null {
  if (state.tab === 'session') return state.right === 'open' ? els().rightSlot : null;
  const v = activeView();
  return v ? [...v.querySelectorAll<HTMLElement>('[data-hx-panel], .bt-sheet')].find(visible) ?? null : null;
}
function regionRoot(r: RegionName): HTMLElement | null {
  const app = sh.app;
  switch (r) {
    case 'bar': return app.querySelector<HTMLElement>('.hx-bar');
    case 'list': return state.left === 'closed' || (state.left === 'rail' && !app.querySelector('.hx-list.is-active[data-rail="ok"]')) ? null : app.querySelector<HTMLElement>('.hx-list.is-active');
    case 'messages': return activeView();
    case 'composer': return composerIn(activeView());
    case 'panel': return panelRoot();
    case 'dock': return state.dock === 'on' ? app.querySelector<HTMLElement>('#hx-dock') : null;
    default: return null;
  }
}
export function regionOf(node: Element | null): RegionName | null {
  const app = sh.app;
  if (!node || !app.contains(node)) return null;
  if (node.closest('.hx-bar')) return 'bar';
  if (node.closest('.hx-side')) return 'list';
  if (node.closest('#hx-dock')) return 'dock';
  if (node.closest('#hx-right-shell, [data-hx-panel], .bt-sheet')) return 'panel';
  const v = node.closest<HTMLElement>('.hx-view');
  if (v) { const c = composerIn(v); if (c && (c === node || c.contains(node) || node.closest('[data-hx-composer], .ssc, .bt-composer'))) return 'composer'; return 'messages'; }
  return null;
}
function defaultTarget(r: RegionName, root: HTMLElement): HTMLElement {
  if (r === 'bar') return els().btnSearch;
  if (r === 'composer') return root;
  const pref = root.querySelector<HTMLElement>('[data-hx-focus="' + r + '"]');
  if (visible(pref)) return pref;
  if (r === 'list' || r === 'dock') {
    const cur = [...root.querySelectorAll<HTMLElement>('[aria-current="true"], [aria-selected="true"]')].find(visible);
    if (cur) return cur;
  }
  if (r === 'messages') {
    const turns = [...root.querySelectorAll<HTMLElement>('[data-hx-turn]')].filter(visible);
    if (turns.length) return turns[turns.length - 1] as HTMLElement;
  }
  if (r !== 'messages') { const first = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible); if (first) return first; }
  return root;   // the region itself, made focusable
}
export function focusRegion(r: RegionName, opts?: { fresh?: boolean }): void {
  if (r === 'list' && !regionRoot('list')) setState({ left: 'open' });
  if (r === 'panel' && !regionRoot('panel')) { if (state.tab === 'session') setState({ right: 'open' }); else emit('hx:bot-settings', { open: true, from: 'keyboard' }); }
  if (r === 'dock' && state.dock !== 'on') setState({ dock: 'on' });
  const go2 = (): void => {
    const root = regionRoot(r);
    if (!root) { toast(REGION_NAME[r] + ' is not available here'); return; }
    const remembered = lastInRegion[r];
    const t = (!opts || !opts.fresh) && remembered && root.contains(remembered) && visible(remembered) ? (remembered as HTMLElement) : defaultTarget(r, root);
    if (!t.matches(FOCUSABLE) && !t.hasAttribute('tabindex')) { t.setAttribute('tabindex', '-1'); t.setAttribute('data-hx-region-focus', ''); }
    t.focus({ preventScroll: false });
    if (t.scrollIntoView && r === 'messages' && t !== root) t.scrollIntoView({ block: 'nearest' });
    const sr = document.getElementById('hx-sr'); if (sr) sr.textContent = REGION_NAME[r];
    emit('hx:region', { region: r });
  };
  // panels and sidebars that just opened need a frame to render
  if (regionRoot(r)) go2(); else setTimeout(go2, 60);
}
export function cycleRegion(dir: 1 | -1): void {
  const avail = REGION_ORDER.filter((r) => regionRoot(r));
  if (!avail.length) return;
  const cur = regionOf(document.activeElement);
  let i = cur ? avail.indexOf(cur) : -1;
  i = i < 0 ? (dir > 0 ? 0 : avail.length - 1) : (i + dir + avail.length) % avail.length;
  const target = avail[i]; if (target) focusRegion(target);
}
export function rememberFocus(target: Element): void { const r = regionOf(target); if (r) lastInRegion[r] = target; }

/* ───────── things that need you (F8) ───────── */
const ATTN = '[data-hx-attention], button.ss-blank, button.cd-blank:has(.cd-stamp), button.cd-hold[data-hold]';
function attentionTargets(): Array<{ n: HTMLElement; tab: Tab }> {
  const order: Tab[] = [state.tab, state.tab === 'session' ? 'bots' : 'session'];
  const out: Array<{ n: HTMLElement; tab: Tab }> = [];
  for (const t of order) {
    const v = document.getElementById('hx-view-' + t);
    if (!v) continue;
    for (const n of v.querySelectorAll<HTMLElement>(ATTN)) if (!out.some((o) => o.n === n) && n.getClientRects().length + (t === state.tab ? 0 : 1) > 0) out.push({ n, tab: t });
  }
  return out;
}
export function nextAttention(dir: 1 | -1): void {
  const list = attentionTargets();
  if (!list.length) { toast('Nothing needs you right now'); return; }
  const cur = list.findIndex((x) => x.n === document.activeElement || x.n.contains(document.activeElement));
  const i = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
  const { n, tab } = list[i] as { n: HTMLElement; tab: Tab };
  const show = (): void => {
    if (!n.matches(FOCUSABLE)) n.setAttribute('tabindex', '-1');
    n.scrollIntoView({ block: 'center', behavior: 'smooth' });
    n.focus({ preventScroll: true });
    const sr = document.getElementById('hx-sr'); if (sr) sr.textContent = (i + 1) + ' of ' + list.length + ' that need you';
  };
  if (tab !== state.tab) { setState({ tab }); setTimeout(show, 80); } else show();
}

/* ───────── go to (mod+G, or g outside text fields) ───────── */
let leader: { t: number; withMod: boolean } | null = null;
const GOTO: Record<string, RegionName> = { l: 'list', m: 'messages', i: 'composer', p: 'panel', d: 'dock' };
export const leaderActive = (): boolean => !!leader;
export function startLeader(withMod: boolean): void {
  if (leader) clearTimeout(leader.t);
  const hint = $('#hx-goto', sh.app);
  hint.hidden = false;
  hint.innerHTML = '<span class="hx-goto__title">Go to</span>' + ([['L', 'list'], ['M', 'conversation'], ['I', 'composer'], ['P', 'panel'], ['D', 'dock'], ['S', 'Session'], ['B', 'Bots'], ['1-9', 'bot in the dock']] as Array<[string, string]>).concat(withMod ? [] : [['G', 'first turn']])
    .map(([k, l]) => '<span class="hx-goto__opt">' + ui.html.kbd(k) + esc(l) + '</span>').join('');
  leader = { t: window.setTimeout(endLeader, 1600), withMod };
}
export function endLeader(): void { if (!leader) return; clearTimeout(leader.t); leader = null; const h = document.getElementById('hx-goto'); if (h) h.hidden = true; }
/** the second key of a go-to; true when it was consumed */
export function leaderKey(e: KeyboardEvent): boolean {
  if (!leader) return false;
  const code = e.code || '', k = (e.key || '').toLowerCase();
  const withMod = leader.withMod;
  endLeader();
  if (e.key === 'Escape') { e.preventDefault(); return true; }
  if (/^Digit[1-9]$/.test(code)) { e.preventDefault(); openDockBot(+code.slice(5)); return true; }
  const letter = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : k;
  const region = GOTO[letter];
  if (region) { e.preventDefault(); focusRegion(region); return true; }
  if (letter === 's' || letter === 'b') { e.preventDefault(); setState({ tab: letter === 's' ? 'session' : 'bots' }); return true; }
  if (letter === 'g' && !withMod) { e.preventDefault(); emit('hx:nav', { action: 'first', region: regionOf(document.activeElement) ?? 'messages' }); return true; }
  return false;
}
function openDockBot(n: number): void {
  const api = getDockApi();
  const id = api ? api.botAt(n) : (data().bots.snapshot().bots[n - 1] ?? { id: null }).id;
  if (!id) { toast('No bot ' + n + ' in the dock'); return; }
  setState({ tab: 'bots' }); sh.selection.bots = id;
  emit('hx:bot-select', { id, from: 'keyboard' }); updateTitle();
}
