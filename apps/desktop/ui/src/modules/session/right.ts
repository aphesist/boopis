/* right panel (KEYMAP section 9): collapsed, a quiet context measure; opened, every section. Reads the details
   streams of the provider and sends its commands (compact, governance, connectors). */
import { on } from '../../core/bus';
import { cap1, el, esc, frag, isMac } from '../../core/dom';
import { setState, state } from '../../core/state';
import { ui } from '../../components';
import { data } from '../../data';
import { renderDiff } from './diff';
import { setGovernance } from './composer';
import { VIEW } from './conversation';
import { modKeyOf } from './keys';
import { copyText, counts, kTokens, partsEl, splitPath } from './shared';
import { onChanged } from './state';

const SECTIONS = ['context', 'tasks', 'changes', 'output', 'governance', 'connectors', 'environment'];
const RIGHT = { open: {} as Record<string, boolean>, refresh: null as ((flash?: string) => void) | null, note: null as string | null };

export function openPanel(panel: string): void {
  if (state.right !== 'open') setState({ right: 'open' });
  RIGHT.open[panel] = true;
  RIGHT.refresh?.(panel);
}

export function mountRight(root: HTMLElement): void {
  const d = () => data().details;
  root.classList.add('ssr');
  SECTIONS.forEach((s) => (RIGHT.open[s] = s !== 'environment' && s !== 'connectors'));
  const isOpen = (): boolean => state.right === 'open';
  let last: boolean | null = null;
  const known = (): boolean => d().context.get().total > 0;
  const pct = (): number => { const c = d().context.get(); return c.total > 0 ? Math.round(c.used / c.total * 100) : 0; };
  /* what a panel cannot know or cannot do on this Hermes, in words, under its content */
  const noteOf = (name: string): HTMLElement[] => { const t = (d().notes.get() as Record<string, string | undefined>)[name]; return t ? [el('p', { class: 'ssr-note', role: 'status', text: t })] : []; };

  function strip(): HTMLElement {
    const c = d().context.get();
    const b = known()
      ? el('button', { class: 'ui-measure-btn', type: 'button', 'aria-label': 'Context ' + pct() + '% used, ' + kTokens(c.used) + ' of ' + kTokens(c.total) + ' tokens. Show session details', 'data-tip': 'Context ' + pct() + '% used', 'data-kbd': 'mod+I', 'aria-keyshortcuts': isMac ? 'Meta+I' : 'Control+I', html: ui.html.measure({ used: c.used, total: c.total, dots: 8 }) })
      : el('button', { class: 'ui-measure-btn', type: 'button', 'aria-label': 'Context size unknown. Show session details', 'data-tip': 'Context size unknown', 'data-kbd': 'mod+I', 'aria-keyshortcuts': isMac ? 'Meta+I' : 'Control+I', html: ui.html.measure({ used: 0, total: 1, dots: 8 }) });
    b.addEventListener('click', () => openPanel('context'));
    return el('div', { class: 'ssr-strip' }, b);
  }
  function section(name: string, label: string, meta: string, body: Node | Node[]): HTMLElement {
    const s = ui.section({ label, meta, open: !!RIGHT.open[name], name });
    s.querySelector('.ui-sec__body')?.append(...([] as Node[]).concat(body));
    s.querySelector('.ui-sec__head')?.addEventListener('ui:change', (e) => { RIGHT.open[name] = (e as CustomEvent<{ value: boolean }>).detail.value; });
    return s;
  }
  function contextBody(): Node[] {
    const c = d().context.get();
    const compact = ui.button({ label: 'Compact conversation', ...(d().can.get().compact ? {} : { disabled: true }) });
    const note = el('p', { class: 'ssr-note', text: RIGHT.note ?? 'Compacting summarises older turns. Files and project memory stay. It runs on its own at 90%.' });
    if (RIGHT.note) { note.setAttribute('role', 'status'); RIGHT.note = null; }
    compact.addEventListener('click', () => {
      void d().compactContext().then((freed) => { RIGHT.note = freed ? 'Compacted. Freed ' + kTokens(freed) + ' tokens.' : 'Nothing left to compact.'; draw(); });
    });
    const legendParts = c.parts.map((p) => [cap1(p[0]), p[1]] as const);
    if (!known()) return [el('p', { class: 'ssr-note', role: 'status', text: 'Context size: unknown' }), ...noteOf('context'), el('div', { class: 'ssr-actions' }, compact)];
    return [ui.measure({ variant: 'grid', total: c.total, parts: c.parts, label: 'Context' }), ui.legend(legendParts, kTokens), el('div', { class: 'ssr-actions' }, compact), note, ...noteOf('context')];
  }
  function tasksBody(): HTMLElement {
    if (!d().todos.get().length && data().info.live) return el('p', { class: 'ssr-note', text: 'No task list yet. The agent writes one when the work has steps.' });
    return el('ul', { class: 'ssr-tasks' }, d().todos.get().map(([t, s]) => el('li', { class: 'ssr-task', 'data-s': s }, [
      el('span', { class: 'ssr-task-mark', 'aria-hidden': 'true', html: s === 'done' ? ui.icon('check') : s === 'doing' ? ui.html.dot('run') : '<i></i>' }),
      el('span', { text: cap1(t) }), el('span', { class: 'ui-sr', text: s === 'done' ? ', done' : s === 'doing' ? ', in progress' : ', to do' })
    ])));
  }
  function changesBody(): HTMLElement[] {
    const files = data().sessions.diff(VIEW.current, { blank: VIEW.blank });
    if (!files.length && data().info.live) return [el('p', { class: 'ssr-note', text: 'Nothing has shipped in this session.' }), ...noteOf('changes')];
    return [...files.map((f) => {
      const [dir, base] = splitPath(f.path), slot = el('div');
      const b = el('button', { class: 'ssr-file', type: 'button', 'aria-expanded': 'false' }, [el('span', { class: 'ss-path ui-mono' }, [el('span', { class: 'ss-dir', text: dir }), base]), counts(f.add, f.del)]);
      b.addEventListener('click', () => { const o = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(o)); slot.replaceChildren(o ? renderDiff([f], true, true) : ''); });
      return el('div', {}, [b, slot]);
    }), ...noteOf('changes')];
  }
  function outputBody(): HTMLElement[] {
    const lines = d().output.get();
    const term = el('pre', { class: 'ssr-term ui-mono', tabindex: '0', 'aria-label': 'Terminal output' });
    lines.forEach((l, i) => {
      const span = el('span', { class: l.startsWith('$') ? 'cmd' : /FAIL/.test(l) ? 'fail' : '' });
      if (/PASS/.test(l)) { const j = l.indexOf('PASS'); span.append(l.slice(0, j), el('span', { class: 'pass', text: 'PASS' }), l.slice(j + 4)); } else span.textContent = l;
      term.append(span, i < lines.length - 1 ? '\n' : '');
    });
    const copy = ui.iconButton({ icon: 'copy', label: 'Copy output', size: 's' });
    copy.addEventListener('click', () => { void copyText(lines.join('\n')); });
    if (!lines.length && data().info.live) return [el('p', { class: 'ssr-note', text: 'No tool output yet.' })];
    return [el('div', { class: 'ssr-term-wrap' }, [term, copy])];
  }
  function governanceBody(): Node[] {
    const gv = d().governance.get();
    const seg = ui.segmented({ mode: 'radio', fill: true, label: 'Governance', value: gv.governed ? 'on' : 'off', options: [{ value: 'on', label: 'Governed' }, { value: 'off', label: 'Ungoverned' }] });
    seg.addEventListener('ui:change', (e) => setGovernance({ governed: (e as CustomEvent<{ value: string }>).detail.value === 'on' }));
    const ladder = ui.ladder({ stations: gv.ladder.map(([m, w]) => [m, cap1(w)] as const), current: gv.current, variant: 'list', off: !gv.governed });
    const capBtn = ui.button({ label: 'Change cap', size: 's', variant: 'ghost', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
    capBtn.addEventListener('click', () => ui.menu.open(capBtn, [{ title: 'Stop the session at' }, ...['$0.30', '$0.60', '$1.00', '$2.00'].map((v) => ({ label: v, value: v, mono: true, checked: v === gv.cap }))], { align: 'end', onSelect: (v) => setGovernance({ cap: v }) }));
    const capRow = gv.governed
      ? (gv.cap && gv.spent ? el('div', { class: 'ssr-cap' }, [el('span', { class: 'ssr-key', text: 'Spend' }), ui.capacity({ spent: gv.spent, cap: gv.cap }), capBtn]) : el('p', { class: 'ssr-note', text: gv.spent ? 'Spent ' + gv.spent + ', no cap set.' : 'Spend: unknown' + (gv.cap ? ', cap ' + gv.cap : '') }))
      : el('p', { class: 'ssr-note', text: 'Ungoverned: every turn runs on ' + gv.model + ' with no cost cap. The sandbox still applies.' });
    const ladderEl = gv.ladder.length ? [ladder] : [];
    return [seg, ...ladderEl, capRow, ...(gv.locked ? [el('p', { class: 'ssr-note', text: 'The mode is fixed once the first message is sent.' })] : []), ...noteOf('governance')];
  }
  function connectorsBody(): HTMLElement[] {
    return d().connectors.get().map((c) => {
      const id = 'ssr-conn-' + c.name;
      const can = d().can.get();
      const control = c.state === 'sign in' ? ui.html.button({ label: 'Sign in', size: 's', disabled: !can.signIn, attrs: { id, 'data-conn': c.name } }) : ui.html.switch({ id, checked: c.state === 'on', disabled: !can.connectors });
      const row = frag(ui.html.setRow({ label: cap1(c.name), hint: c.hint ?? c.tools + ' tools', for: c.state === 'sign in' ? null : id, control }));
      const sw = row.querySelector<HTMLInputElement>('.ui-switch'), sb = row.querySelector<HTMLButtonElement>('[data-conn]');
      if (sw) { ui.hydrate(row); sw.addEventListener('change', () => d().setConnector(c.name, sw.checked)); }
      if (sb) sb.addEventListener('click', () => { const l = sb.querySelector('span'); if (l) l.textContent = 'Connecting'; sb.disabled = true; void d().signIn(c.name); });
      return row;
    }).concat(d().connectors.get().length || !data().info.live ? [] : [el('p', { class: 'ssr-note', text: 'No MCP servers are configured in Hermes.' })]);
  }
  function envBody(): HTMLElement[] {
    const e = d().environment.get();
    const dl = el('dl', { class: 'ssr-env' });
    ([['Folder', e.cwd], ['Branch', e.branch], ['Sandbox', e.sandbox], ['Runtime', e.runtime], ['Harness', e.harness], ['Gate', e.gate]] as const).forEach(([a, b]) => b && dl.append(el('dt', { text: a }), el('dd', {}, partsEl(b, 'ui-mono'))));
    return [dl, ...noteOf('environment')];
  }
  function panel(): HTMLElement {
    const todos = d().todos.get(), done = todos.filter((t) => t[1] === 'done').length;
    const ch = d().changes.get(), add = ch.reduce((a, c) => a + c[1], 0), del = ch.reduce((a, c) => a + c[2], 0);
    const onN = d().connectors.get().filter((c) => c.state === 'on').length;
    const out = d().output.get().join('\n'), passed = (out.match(/(\d+) passed/) ?? [0, ''])[1];
    const mono = (t: string): string => '<span class="ui-mono">' + esc(t) + '</span>';
    const c = d().context.get(), G = d().governance.get();
    const body = el('div', { class: 'ui-panel__body' }, [
      section('context', 'Context', mono(kTokens(c.used) + ' / ' + kTokens(c.total)), contextBody()),
      section('tasks', 'Tasks', mono(done + ' of ' + todos.length), tasksBody()),
      section('changes', 'Changes', '<span class="ss-n ui-mono"><span class="ss-add">+' + add + '</span><span class="ss-del">−' + del + '</span></span>', changesBody()),
      section('output', 'Output', mono(passed ? passed + ' passed' : VIEW.running || !data().info.live ? 'running' : out ? 'done' : 'empty'), outputBody()),
      section('governance', 'Governance', mono(G.governed ? 'governed' : 'ungoverned'), governanceBody()),
      section('connectors', 'Connectors', mono(onN + ' on'), connectorsBody()),
      section('environment', 'Environment', mono(data().info.live && !d().environment.get().sandbox ? 'sandbox unknown' : 'sandboxed'), envBody())
    ]);
    body.querySelector('.ui-sec__head')?.setAttribute('data-hx-focus', 'panel');
    /* ↑ ↓ between section headers */
    body.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (!t.classList.contains('ui-sec__head') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.altKey || modKeyOf(e)) return;
      const heads = [...body.querySelectorAll<HTMLElement>('.ui-sec__head')], i = heads.indexOf(t);
      const n = heads[i + (e.key === 'ArrowDown' ? 1 : -1)]; if (n) { e.preventDefault(); n.focus(); }
    });
    return el('div', { class: 'ui-panel ssr-panel', role: 'region', 'aria-label': 'Session details' }, [el('div', { class: 'ui-panel__head' }, el('h2', { class: 'ui-panel__title', text: 'Session details' })), body]);
  }
  function draw(flash?: string): void {
    const prevBody = root.querySelector('.ui-panel__body'), keepScroll = prevBody ? prevBody.scrollTop : 0;
    const a = document.activeElement as HTMLElement | null, hadFocus = !!a && root.contains(a);
    const focusSec = hadFocus ? a.closest<HTMLElement>('[data-name]') : null, focusHead = hadFocus && a.classList.contains('ui-sec__head');
    const open = isOpen();
    root.replaceChildren(open ? panel() : strip());
    const body = root.querySelector('.ui-panel__body'); if (body) body.scrollTop = keepScroll;
    if (typeof flash === 'string' && open) {
      const sec = root.querySelector<HTMLElement>(`[data-name="${flash}"]`);
      if (sec) { sec.scrollIntoView({ block: 'nearest' }); sec.setAttribute('data-flash', ''); setTimeout(() => sec.removeAttribute('data-flash'), 1200); }
    } else if (hadFocus) {
      const f = open ? (focusSec && root.querySelector<HTMLElement>(`[data-name="${focusSec.dataset['name']}"] .ui-sec__head`)) || root.querySelector<HTMLElement>('.ui-sec__head') : root.querySelector<HTMLElement>('.ui-measure-btn');
      if (f && (focusHead || !open || !focusSec)) f.focus({ preventScroll: true });
    }
    last = open;
  }
  RIGHT.refresh = draw;
  on('hx:state', () => { if (isOpen() !== last) draw(); });
  on('hx:open-panel', (e) => { const p = e.panel || 'context'; RIGHT.open[p] = true; if (isOpen()) draw(p); else openPanel(p); });
  d().context.subscribe(() => draw());
  const whenOpen = (): void => { if (isOpen()) draw(); };
  d().governance.subscribe(whenOpen);
  d().notes.subscribe(whenOpen);
  d().can.subscribe(whenOpen);
  for (const w of [d().todos, d().changes, d().output, d().connectors, d().environment]) (w as { subscribe(fn: () => void): unknown }).subscribe(whenOpen);
  data().sessions.list.subscribe(whenOpen);
  onChanged(whenOpen);
  draw();
}
