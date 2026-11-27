/* Settings › General (board 14; O-X02's Getting started, last): Layout (Show the dock, When the sidebar collapses, Rail size, Show search, Search shows as), Under
   the composer (what the session composer's line shows, one check each: the quick menu's list, S05 B), Appearance (Theme, Accent,
   Corners: board 14's card, the same choices as the Appearance page). Then what board 14 does not draw and today's General had:
   the dock's two choices (Keep the dock centred, Compact dock when idle; decided for General), Window (which title-bar buttons show)
   and, in the desktop app, the Local API. Every row writes at once and follows a change made elsewhere (mod+J, the account menu). */
import { emit, on } from '../../core/bus';
import { prefs, saveState, setState, state } from '../../core/state';
import { LINE_ITEMS, LINE_NAMES, loadChrome, loadLineHidden, saveChrome, saveLineHidden } from '../../core/settings';
import type { ChromePrefs, LineItemId, SearchAs, WindowControlsPref } from '../../core/settings';
import { data } from '../../data';
import { describeDesktop } from '../../host/window';
import { onWindowChange, setWindowPref, windowInfo, windowPref } from '../shell/window';
import { lookRows, wireLook } from './appearance';
import { mountLocalApi } from './local-api';
import { fill, pageEl } from './page';
import type { Page } from './page';
import { actionsHTML, buttonHTML, openSelect, section, segHTML, selectHTML, switchHTML } from './rows';
import { closeDialog } from './page';
import { inTauri } from '../../host/bridge';
import { ledger, writeLedger } from '../onboarding/ledger';
import { startBotsPart } from '../onboarding/bots';
import type { RowOpts } from '@boopis/ui';

/** Getting started (board O-X02): each part of the first run, where it stands, and the way to run it again. Setup's model question only
    in the desktop app (the host asks it); the boopis bot's part only where it exists (`DataProvider.onboarding`) */
export function gettingStartedRows(o: { desktop: boolean; bots: boolean }): RowOpts[] {
  const l = ledger();
  const word = (done: boolean, later = false): string => (later ? 'Later' : done ? 'Done' : 'Not yet');
  return [
    ...(o.desktop ? [{ label: 'Setup: the model', control: actionsHTML(buttonHTML('Run it again', { attrs: { 'data-start': 'setup' } })) }] : []),
    { label: 'Sessions', value: word(l.sessions === 'done', l.sessions === 'skipped'), control: actionsHTML(buttonHTML(l.sessions === 'skipped' ? 'Start' : 'Run it again', { attrs: { 'data-start': 'sessions' } })) },
    ...(o.bots ? [{ label: 'Bots, with the boopis bot', value: word(l.bots === 'done', l.bots === 'later'), control: actionsHTML(buttonHTML(l.bots === 'done' ? 'Run it again' : 'Start', { attrs: { 'data-start': 'bots' } })) }] : [])
  ];
}

const SEARCH_LABELS: Readonly<Record<SearchAs, string>> = { hint: 'A hint', button: 'A button', pill: 'A pill' };
const setChrome = (patch: Partial<ChromePrefs>): void => { saveChrome({ ...loadChrome(), ...patch }); emit('hx:chrome', {}); };

export function generalPage(): Page {
  const { el, body } = pageEl('general', 'General');
  const main = document.createElement('div'), api = document.createElement('div');
  main.className = 'hx-set__part'; api.className = 'hx-set__part';
  body.append(main, api);
  const draw = (): void => {
    const c = loadChrome(), hidden = loadLineHidden();
    const lines = LINE_ITEMS.filter((i) => i !== 'careful' || !!data().sessionControls);
    fill(main,
      section('Layout', [
        { label: 'Show the dock', control: switchHTML('dock', 'Show the dock', state.dock === 'on') },
        { label: 'When the sidebar collapses', control: segHTML('collapse', 'When the sidebar collapses', [{ value: 'rail', label: 'Rail' }, { value: 'closed', label: 'Hide' }], prefs.collapse) },
        { label: 'Rail size', control: segHTML('rail', 'Rail size', [{ value: 'auto', label: 'Automatic' }, { value: 'a', label: 'Standard' }, { value: 'b', label: 'Compact' }], c.rail) },
        { label: 'Show search', control: switchHTML('search', 'Show search', c.search) },
        ...(c.search ? [{ label: 'Search shows as', control: selectHTML('search-as', 'Search shows as', SEARCH_LABELS[c.searchAs]) }] : [])
      ], { 'data-part': 'layout' }) +
      section('Under the composer', lines.map((i) => ({ label: LINE_NAMES[i], check: !hidden.includes(i), attrs: { 'data-line': i } })), { 'data-part': 'line' }) +
      section('Appearance', lookRows(), { 'data-part': 'look' }) +
      section('Dock', [
        { label: 'Keep the dock centred in the window', control: switchHTML('dock-centre', 'Keep the dock centred in the window', state.dockCentred) },
        { label: 'Compact dock when idle', sub: 'Smaller until something needs you.', control: switchHTML('dock-compact', 'Compact dock when idle', state.dockCompact) }
      ]) +
      section('Window', [{ label: 'Window controls', sub: describeDesktop(windowInfo()), control: segHTML('window', 'Window controls', [{ value: 'auto', label: 'Automatic' }, { value: 'close', label: 'Close only' }, { value: 'all', label: 'All' }], windowPref()) }], { 'data-part': 'window' }) +
      /* O-X02 draws Getting started at the top of General, board 14 draws Layout there (COVERAGE conflict 17): board 14 keeps the top */
      section('Getting started', gettingStartedRows({ desktop: inTauri(), bots: !!data().onboarding }), { 'data-part': 'start' }));
  };
  draw();
  void mountLocalApi(api);
  wireLook(main, draw);
  main.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement, v = (e as CustomEvent<{ value: unknown }>).detail.value;
    switch (t.dataset['set']) {
      case 'dock': setState({ dock: v ? 'on' : 'off' }); return;
      case 'collapse': prefs.collapse = v === 'closed' ? 'closed' : 'rail'; saveState(); if (state.left !== 'open') setState({ left: prefs.collapse }); return;
      case 'rail': setChrome({ rail: v === 'a' || v === 'b' ? v : 'auto' }); return;
      case 'search': setChrome({ search: !!v }); draw(); main.querySelector<HTMLElement>('[data-set="search"]')?.focus(); return;
      case 'dock-centre': setState({ dockCentred: !!v }); return;
      case 'dock-compact': setState({ dockCompact: !!v }); return;
      case 'window': setWindowPref(v as WindowControlsPref); return;
      default: break;
    }
    const line = t.closest<HTMLElement>('[data-line]')?.dataset['line'] as LineItemId | undefined;
    if (line) {
      const hidden = loadLineHidden();
      saveLineHidden(v ? hidden.filter((x) => x !== line) : [...hidden, line]);
      emit('hx:session-line', {});
    }
  });
  main.addEventListener('click', (e) => {
    const start = (e.target as Element).closest<HTMLElement>('[data-start]')?.dataset['start'];
    if (start) {
      closeDialog(el.closest('dialog'));
      if (start === 'setup') void import('../../host/change-models').then((m) => m.changeModels()).catch((err: unknown) => { emit('hx:toast', { text: err instanceof Error ? err.message : String(err) }); });
      else if (start === 'sessions') { writeLedger({ sessions: 'careful' }); emit('hx:new-session', { from: 'settings' }); }
      else startBotsPart();
      return;
    }
    const sel = (e.target as Element).closest<HTMLElement>('[data-select="search-as"]');
    if (!sel) return;
    openSelect(sel, { label: 'Search shows as', value: loadChrome().searchAs, choices: (['hint', 'button', 'pill'] as const).map((v) => ({ value: v, label: SEARCH_LABELS[v] })), onPick: (v) => { setChrome({ searchAs: v as SearchAs }); draw(); } });
  });
  /* a change made elsewhere (mod+J, the account menu, the theme keys): the rows follow, unless the person is in the middle of one */
  on('hx:state', (d) => { if (d?.changed.some((k) => k === 'dock' || k === 'dockCentred' || k === 'dockCompact' || k === 'theme' || k === 'left') && !main.contains(document.activeElement)) draw(); });
  onWindowChange(() => { if (!main.contains(document.activeElement)) draw(); });
  return { el, refresh: async () => { draw(); } };
}
