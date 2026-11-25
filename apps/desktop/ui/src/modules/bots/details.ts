/* A bot's details pane, as board 11 draws it (docs/design/v7/boards: botscreens.js `pane`): the kit's Pane at the window's right
   edge (356, --bg-pane), opened by the chrome's title pill or details button. Its head: the bot's 64 orb, its name, Activity |
   Library. Under it only what exists: Upcoming (the bot's routines, each with its switch) and Work (its model, what it spent
   against its cap, where it works). A value the provider does not have is left out, never guessed. The Library side, and any
   editing of the bot beyond a routine's switch, have no board yet (an owner question): Library says so in one line. */
import { on } from '../../core/bus';
import { el, esc } from '../../core/dom';
import { state } from '../../core/state';
import { kit, ui } from '@boopis/ui';
import { data } from '../../data';
import type { Bot, Schedule } from '../../data';
import { bot, S } from './model';

let host: HTMLElement | null = null;
let tab: 'activity' | 'library' = 'activity';
let sig = '';

const base = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
function schedulesOf(b: Bot): readonly Schedule[] { return data().schedules.list.get().filter((s) => s.bot === b.id); }

function bodyHTML(b: Bot): string {
  if (tab === 'library') return '<p class="bt-details__none">Nothing in ' + esc(b.name) + '’s library yet.</p>';
  const rows = schedulesOf(b);
  const upcoming = rows.length
    ? '<h3 class="k7-pane__sec">Upcoming</h3>' + kit.html.card({ variant: 'pane', rows: rows.map((s) => ({
      label: s.what, labelHTML: esc(s.what) + '<br><span class="bt-details__when">' + esc(s.when) + '</span>',
      control: kit.html.switch({ label: s.what, checked: !s.paused, attrs: { 'data-schedule': s.id } })
    })) })
    : '';
  const model = b.info?.model ?? b.cfg.model;
  const run = S.spend[b.id], cap = run?.cap ?? (b.cfg.cap ? '$' + b.cfg.cap : null), spent = run?.spent ?? (b.spent ? '$' + b.spent : null);
  const where = data().bots.workspace?.(b.id);
  const work = [
    ...(model ? [{ label: 'Model', control: '<span class="bt-details__val">' + ui.html.modelMark(model, { size: 14, label: false }) + esc(ui.modelMark.short(model) || model) + '</span>' }] : []),
    ...(spent ? [{ label: 'Spend', value: cap ? spent + ' of ' + cap : spent, mono: true }] : []),
    { label: 'Workspace', value: b.cfg.workspace + (where ? ' ' + base(where) : ''), mono: true }
  ];
  return upcoming + '<h3 class="k7-pane__sec">Work</h3>' + kit.html.card({ variant: 'pane', rows: work });
}

/** draw the pane for the open bot; `newSession` is kept for the pane's own actions as they arrive (no board draws one yet) */
export function paintDetails(_newSession?: () => void): void {
  const shell = document.getElementById('hx-right-shell');
  if (!shell) return;
  if (!host) {
    host = el('div', { class: 'bt-details', id: 'hx-right-bots' });
    shell.append(host);
    host.addEventListener('ui:change', (e) => {
      const t = e.target as HTMLElement;
      const seg = t.closest('[data-kit~="Segmented"]');
      if (seg) { tab = (e as CustomEvent<{ value: string }>).detail.value === 'library' ? 'library' : 'activity'; sig = ''; paintDetails(); return; }
      const sw = t.closest<HTMLElement>('[data-schedule]');
      if (sw) data().schedules.setPaused(sw.dataset['schedule'] as string, sw.getAttribute('aria-checked') !== 'true');
    });
    data().schedules.list.subscribe(() => { paintDetails(); });
    on('hx:state', () => { paintDetails(); });
  }
  const b = state.tab === 'bots' && S.view === 'bot' ? bot(S.sel) : undefined;
  const open = !!b && state.right === 'open';
  host.hidden = !open;
  if (!open || !b) { if (!b) { host.replaceChildren(); sig = ''; } return; }
  const body = bodyHTML(b);
  const next = [b.id, b.name, b.shape, b.color, b.state, tab, body].join('\u0000');
  if (next === sig) return;
  sig = next;
  /* written into the page as markup: an orb made in a template and moved in is not painted by its worker */
  host.innerHTML = kit.html.pane({ variant: 'details', bot: b, title: b.name, tab, body, label: b.name + ', details' });
  kit.wire(host);
}
