/* What a live bot's room shows where a thread would be: only what Hermes reports about its profile (its recent sessions,
   its skills and toolsets, why something is unknown), and that talking to it comes with team chat. A bot you cannot talk to
   yet has no composer and no invented conversation; the mock's bots never come here (they have no `info`). */
import { el } from '../../core/dom';
import { data } from '../../data';
import type { Bot, BotCapability } from '../../data';

const on = (list: readonly BotCapability[] | null): BotCapability[] => (list ?? []).filter((c) => c.enabled);
const count = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many);

/** the line that says what a capability list holds: "3 skills on of 5", or that Hermes has not said */
export function inventoryLine(label: string, one: string, many: string, list: readonly BotCapability[] | null, note: string | undefined): string {
  if (list === null) return label + ': unknown' + (note ? '. ' + note : '');
  if (!list.length) return label + ': none';
  const names = on(list).map((c) => c.label || c.name);
  return label + ': ' + count(names.length, one, many) + ' on' + (names.length < list.length ? ' of ' + list.length : '') + (names.length && names.length <= 6 ? ' (' + names.join(', ') + ')' : '');
}

export function renderGlance(b: Bot, onOpen?: (sessionId: string) => void): HTMLElement {
  const info = b.info;
  const root = el('div', { class: 'bt-glance' });
  if (!info) return root;
  const head = (t: string): HTMLElement => el('h2', { class: 'ui-group__head bt-glance-h', text: t });
  const sessions = info.sessions;
  root.append(head('Recent sessions'));
  if (sessions === null) root.append(el('p', { class: 'bt-glance-line', text: 'Unknown. ' + (info.notes.sessions ?? '') }));
  else if (!sessions.length) root.append(el('p', { class: 'bt-glance-line', text: b.name + ' has not run a session yet.' }));
  else {
    root.append(el('ul', { class: 'bt-glance-list', 'aria-label': 'Recent sessions of ' + b.name }, sessions.map((s) => {
      const title = s.title || 'Untitled session';
      const meta = [s.source && s.source !== 'gui' ? s.source : '', s.messages != null ? count(s.messages, 'message', 'messages') : '', s.when].filter(Boolean).join(' · ');
      const inner = [el('span', { class: 'bt-glance-title', text: title }), el('span', { class: 'bt-glance-meta ui-mono', text: meta })];
      /* opening a session resumes it: its messages are the thread and the next message continues it */
      return el('li', { class: 'bt-glance-row' }, onOpen ? el('button', { class: 'bt-glance-open', type: 'button', 'aria-label': 'Open ' + title + (meta ? ', ' + meta : ''), onclick: () => { onOpen(s.id); } }, inner) : inner);
    })));
  }
  root.append(head('What it can use'));
  root.append(el('p', { class: 'bt-glance-line', text: inventoryLine('Skills', 'skill', 'skills', info.skills, info.notes.detail) }));
  root.append(el('p', { class: 'bt-glance-line', text: inventoryLine('Toolsets', 'toolset', 'toolsets', info.toolsets, info.notes.detail) }));
  for (const n of [info.notes.jobs, info.notes.store]) if (n) root.append(el('p', { class: 'bt-glance-line bt-glance-note', role: 'note', text: n }));
  const why = data().info.unavailable['bots.send'];
  if (why) root.append(el('p', { class: 'bt-glance-line bt-glance-note', role: 'note', text: why }));
  return root;
}
