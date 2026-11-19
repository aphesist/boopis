/* The command palette: sessions, bots and commands. `>` limits to commands, `@` to bots. "Restore bot…" opens it again on the archived
   bots alone (the Bots tab's Archived group has the same action) and restores the one chosen. */
import { emit } from '../../core/bus';
import { esc } from '../../core/dom';
import { callProvided, getDockApi, hasProvider } from '../../core/registry';
import { setState, state, toggle } from '../../core/state';
import { themeApi } from '../../styles/theme';
import { ui } from '@boopis/ui';
import { data } from '../../data';
import { archivedWhen, restoreBot, restoredWords } from '../../data/restore';
import { updateTitle } from './attention';
import { els, sh } from './ctx';
import { newThing, openPanel, toggleDockExpand, toggleLightDark, toggleOrbGrow, togglePanel } from './actions';
import { openKeys, openSettings, closeMenu } from './dialogs';
import { REGION_NAME, focusRegion, nextAttention } from './regions';
import { pushHistory } from './history';
import type { RegionName } from '../../core/bus';

type Group = 'sessions' | 'bots' | 'commands' | 'archived';
interface Item { group: Group; label: string; meta?: string; trail?: string; icon: string; keys: string; kbd?: string; attn?: boolean; run: () => void; s?: number }
const pal: { items: Item[]; active: number; scope: string | null; ret: Element | null } = { items: [], active: 0, scope: null, ret: null };
const GROUPS: Record<Group, string> = { sessions: 'Sessions', bots: 'Bots', commands: 'Commands', archived: 'Archived bots' };
const ICON = (name: string): string => ui.icon(name);
// the library's orb: 16px is a still thumbnail, its state reaction and dark-body eyes come with it
const botIcon = (b: Parameters<typeof ui.html.orb>[0]): string => ui.html.orb(b, { size: 16 });

function paletteItems(): Item[] {
  const out: Item[] = [];
  for (const s of data().sessions.list.get()) {
    out.push({ group: 'sessions', label: s.title, meta: s.project, trail: s.when, icon: ICON('session'), keys: s.project + ' session',
      run: () => { setState({ tab: 'session' }); sh.selection.session = s.id; emit('hx:session-select', { id: s.id, from: 'palette' }); pushHistory({ tab: 'session', sel: s.id }); updateTitle(); } });
  }
  for (const b of data().bots.snapshot().bots) {
    out.push({ group: 'bots', label: b.name, meta: b.role, icon: botIcon(b), keys: 'bot ' + (b.attention || ''), trail: data().info.preview.has('bots') ? 'preview' : b.attention ? 'needs you' : '', attn: !!b.attention && !data().info.preview.has('bots'),
      run: () => { setState({ tab: 'bots' }); sh.selection.bots = b.id; emit('hx:bot-select', { id: b.id, from: 'palette' }); pushHistory({ tab: 'bots', sel: b.id }); updateTitle(); } });
  }
  /* the archived bots, only while "Restore bot…" has narrowed the palette to them */
  const archivedBots = data().bots.archived.get();
  if (pal.scope === 'archived') {
    for (const a of archivedBots) {
      out.push({ group: 'archived', label: a.was || a.name, meta: archivedWhen(a.when), icon: ICON('unarchive'), keys: 'archived restore bot',
        run: () => { const back = pal.ret as HTMLElement | null; void restoreBot(data().bots, a.id).then((r) => { ui.toast(restoredWords(r)); back?.focus?.(); }); } });
    }
  }
  const cmd = (label: string, kbd: string, run: () => void, icon?: string, keys?: string): void => { out.push({ group: 'commands', label, kbd, run, icon: icon || '', keys: keys || '' }); };
  const api = getDockApi();
  cmd('New session', state.tab === 'session' ? 'mod+shift+O' : '', () => newThing('session'), ICON('plus'));
  cmd('New bot', state.tab === 'bots' ? 'mod+shift+O' : '', () => newThing('bots'), ICON('plus'));
  if (archivedBots.length) cmd('Restore bot…', '', () => { const back = pal.ret; openPalette({ scope: 'archived' }); pal.ret = back; }, ICON('unarchive'), 'archived archive undo bring back bots');
  cmd(state.tab === 'session' ? 'Go to bots' : 'Go to sessions', state.tab === 'session' ? 'alt+2' : 'alt+1', () => toggle('tab'), ICON(state.tab === 'session' ? 'bots' : 'session'), 'tab switch');
  cmd(state.left === 'open' ? 'Hide sidebar' : 'Show sidebar', 'mod+B', () => toggle('left'), ICON('sidebar-left'), 'sidebar left');
  if (state.left !== 'rail') cmd('Collapse the sidebar to a rail', '', () => setState({ left: 'rail' }), ICON('sidebar-left'), 'sidebar left rail');
  if (state.left !== 'closed') cmd('Hide the sidebar completely', 'mod+shift+B', () => setState({ left: 'closed' }), ICON('sidebar-left'), 'sidebar left close');
  cmd(state.tab === 'bots' ? 'Show or hide bot settings' : state.right === 'open' ? 'Hide session details' : 'Show session details', 'mod+I', togglePanel, ICON('sidebar-right'), 'right panel sidebar context details inspector');
  if (hasProvider('stop')) cmd('Stop the running turn', 'mod+.', () => callProvided('stop', { tab: state.tab, from: 'palette' }), ICON('stop'), 'cancel interrupt halt');
  if (hasProvider('find')) cmd('Find in this conversation', 'mod+F', () => callProvided('find', { tab: state.tab, from: 'palette' }), ICON('search'), 'search text');
  cmd('Next thing that needs you', 'F8', () => nextAttention(1), ICON('forward'), 'attention blank approval waiting');
  for (const [r, key] of [['list', 'L'], ['messages', 'M'], ['composer', 'I'], ['panel', 'P'], ['dock', 'D']] as Array<[RegionName, string]>) cmd('Focus the ' + REGION_NAME[r].toLowerCase(), 'mod+G ' + key, () => focusRegion(r), ICON('forward'), 'focus region go to keyboard');
  for (const [p, words] of [['Context', 'tokens window'], ['Connectors', 'mcp tools'], ['Output', 'terminal logs'], ['Environment', 'sandbox runtime'], ['Tasks', 'todo'], ['Changes', 'diff files'], ['Governance', 'models cost ladder']] as Array<[string, string]>) {
    cmd('Open ' + p.toLowerCase(), '', () => openPanel(p.toLowerCase()), ICON('sidebar-right'), 'panel right details ' + words);
  }
  cmd(state.dock === 'on' ? 'Hide the dock' : 'Show the dock', 'mod+J', () => toggle('dock'), ICON('dock'), 'dock bottom');
  cmd('Expand or collapse the dock', 'mod+shift+J', toggleDockExpand, ICON('dock'), 'dock bottom widgets');
  if (api) cmd('Minimise the dock', '', () => { if (state.dock !== 'on') setState({ dock: 'on' }); api.setMode('minimal'); }, ICON('dock'), 'dock small minimal');
  cmd('Toggle grow bots on hover', '', toggleOrbGrow, ICON('bots'), 'dock orb magnify size hover grow ' + (state.orbGrow ? 'on' : 'off'));
  cmd('Settings', 'mod+,', () => openSettings(), ICON('gear'), 'preferences');
  cmd('Keyboard shortcuts', 'mod+/', openKeys, ICON('gear'), 'keys help keymap');
  cmd('Appearance and theme', 'mod+shift+,', () => openSettings('appearance'), ICON('sliders'), 'theme colours fonts logo');
  cmd('Light or dark theme', 'mod+shift+L', toggleLightDark, ICON('sliders'), 'theme appearance');
  const cur = themeApi.get().preset;
  for (const [id, p] of Object.entries(themeApi.presets)) if (id !== cur) cmd('Use the ' + p.name + ' theme', '', () => setState({ theme: id }), ICON('sliders'), 'theme preset appearance ' + p.note);
  return out;
}
/** how well an item matches a query: 0 is no match (exported for the unit tests) */
export function score(item: { label: string; meta?: string | undefined; keys?: string | undefined }, q: string): number {
  if (!q) return 1;
  const hay = (item.label + ' ' + (item.meta || '') + ' ' + (item.keys || '')).toLowerCase();
  let s = 0;
  for (const w of q.split(/\s+/).filter(Boolean)) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    s += (i === 0 ? 4 : hay[i - 1] === ' ' ? 2 : 1) + (item.label.toLowerCase().includes(w) ? 2 : 0);
  }
  return s;
}
function highlight(label: string, q: string): string {
  const w = (q || '').split(/\s+/).filter(Boolean)[0];
  if (!w) return esc(label);
  const i = label.toLowerCase().indexOf(w);
  if (i < 0) return esc(label);
  return esc(label.slice(0, i)) + '<mark>' + esc(label.slice(i, i + w.length)) + '</mark>' + esc(label.slice(i + w.length));
}
export function renderPalette(): void {
  const el = els();
  let raw = el.palInput.value.trim(), scope = pal.scope;
  if (raw.startsWith('>')) { scope = 'commands'; raw = raw.slice(1).trim(); }
  else if (raw.startsWith('@')) { scope = 'bots'; raw = raw.slice(1).trim(); }
  const q2 = raw.toLowerCase();
  let items = paletteItems().filter((it) => !scope || it.group === scope || (scope === 'items' && it.group !== 'commands'));
  items = items.map((it) => Object.assign(it, { s: score(it, q2) })).filter((it) => (it.s ?? 0) > 0);
  if (q2) {
    const order: Record<Group, number> = { archived: 0, sessions: 1, bots: 2, commands: 3 };
    items.sort((a, b) => ((b.s ?? 0) - (a.s ?? 0)) || (order[a.group] - order[b.group]));
    // keep groups together, ordered by their best hit
    const best: Partial<Record<Group, number>> = {};
    items.forEach((it, i) => { if (!(it.group in best)) best[it.group] = i; });
    items.sort((a, b) => ((best[a.group] ?? 0) - (best[b.group] ?? 0)) || ((b.s ?? 0) - (a.s ?? 0)));
  }
  pal.items = items;
  pal.active = Math.min(pal.active, Math.max(0, items.length - 1));
  if (!items.length) {
    el.palList.innerHTML = '<div class="hx-pal-empty">Nothing matches <b>' + esc(el.palInput.value.trim()) + '</b>.<br>Try a session title, a bot’s name or a command.</div>';
    el.palInput.removeAttribute('aria-activedescendant');
    return;
  }
  let html = '', g: Group | null = null;
  items.forEach((it, i) => {
    if (it.group !== g) { g = it.group; html += '<div class="ui-group__head hx-pal-group" role="presentation">' + GROUPS[g] + '</div>'; }
    html += '<div class="ui-row hx-pal-row" role="option" id="hx-pal-' + i + '" data-i="' + i + '" data-kind="' + (it.group === 'commands' ? 'command' : 'item') + '" aria-selected="' + (i === pal.active) + '">' +
      '<span class="hx-pal-row__icon">' + (it.icon || '') + '</span>' +
      '<span class="hx-pal-row__label">' + highlight(it.label, q2) + '</span>' +
      (it.meta ? '<span class="hx-pal-row__meta">' + esc(it.meta) + '</span>' : '') +
      (it.trail ? '<span class="hx-pal-row__trail' + (it.attn ? ' is-attn' : '') + '">' + esc(it.trail) + '</span>' : '') +
      (it.kbd ? ui.html.keys(it.kbd) : '') + '</div>';
  });
  el.palList.innerHTML = html;
  el.palInput.setAttribute('aria-activedescendant', 'hx-pal-' + pal.active);
}
export function movePal(d: number): void {
  if (!pal.items.length) return;
  pal.active = (pal.active + d + pal.items.length) % pal.items.length;
  const el = els();
  for (const r of el.palList.querySelectorAll<HTMLElement>('.hx-pal-row')) r.setAttribute('aria-selected', String(+(r.dataset['i'] ?? -1) === pal.active));
  document.getElementById('hx-pal-' + pal.active)?.scrollIntoView({ block: 'nearest' });
  el.palInput.setAttribute('aria-activedescendant', 'hx-pal-' + pal.active);
}
export function runPal(i: number): void {
  const it = pal.items[i]; if (!it) return;
  closePalette(true);
  it.run();
}
export function openPalette(opts: { scope?: string; query?: string } = {}): void {
  const el = els();
  closeMenu(false); ui.tooltip.hide();
  const ks = document.getElementById('hx-keys-sheet') as HTMLDialogElement | null; if (ks && ks.open) ks.close();
  if (el.settings.open) return;
  pal.scope = opts.scope ?? null;
  pal.ret = document.activeElement;
  pal.active = 0;
  el.palInput.value = opts.query ?? '';
  el.palInput.placeholder = pal.scope === 'items' ? 'Go to a session or bot' : pal.scope === 'sessions' ? 'Switch session' : pal.scope === 'bots' ? 'Switch bot' : pal.scope === 'archived' ? 'Restore which bot' : 'Search, or type > for commands and @ for bots';
  el.palette.hidden = false;
  renderPalette();
  el.palInput.focus();
  el.btnSearch.setAttribute('aria-expanded', 'true');
}
export function closePalette(keepFocus?: boolean): void {
  const el = els();
  if (el.palette.hidden) return;
  el.palette.hidden = true;
  el.btnSearch.setAttribute('aria-expanded', 'false');
  if (!keepFocus && pal.ret && (pal.ret as HTMLElement).focus) (pal.ret as HTMLElement).focus();
}
export function resetActive(): void { pal.active = 0; }
export function setActive(i: number): void { pal.active = i; }
export const paletteActive = (): number => pal.active;
