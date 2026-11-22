/* The messages a group is holding back. The engine ends a conversation when a newer message arrives and drops the answer of a
   member still working, so boopis keeps a message written meanwhile and sends it when the members have finished (the provider's
   `send`, default "when done"). This strip shows each held message and lets the user take it back or send it at once. Sending
   at once stops the members' turns, and the strip's own sentence says so before the user presses anything.
   Built from the kit's group and rows (the archived list's pattern); the data and the actions are the provider's. */
import { frag } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { Group } from '../../data';

export interface QueueActions {
  /** sends the held message now (the members' turns stop first) */
  sendNow(groupId: string, queuedId: string): void;
  /** takes the held message back; its words go to `edit` */
  takeBack(groupId: string, queuedId: string): void;
}

/** who the held messages wait for, in a sentence the strip says */
export function waitingFor(names: readonly string[]): string {
  const who = names.length === 0 ? 'the conversation' : names.length === 1 ? (names[0] as string) : names.slice(0, -1).join(', ') + ' and ' + (names.at(-1) as string);
  const stops = names.length === 0 ? 'it' : names.length === 1 ? 'that turn' : 'those turns';
  return 'Waiting for ' + who + ' to finish. Send now stops ' + stops + '.';
}

export interface GroupQueue { readonly el: HTMLElement; paint(g: Group, working: readonly string[]): void }

/** mounts the strip into `host`, before `before` when it is given; hidden while nothing is held */
export function mountGroupQueue(host: HTMLElement, before: Element | null, act: QueueActions): GroupQueue {
  const el = document.createElement('div');
  el.className = 'bt-queue';
  el.hidden = true;
  host.insertBefore(el, before);
  let current = '';
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (!b || !current) return;
    e.preventDefault();
    const id = b.dataset['id'] ?? '';
    if (b.dataset['act'] === 'now') act.sendNow(current, id); else act.takeBack(current, id);
  });
  /* the row itself takes the message back (it is the row's one action; the buttons beside it are the other two), so every action
     is reachable by keyboard: the row is a button, and the actions appear with focus in it */
  el.addEventListener('ui:select', (e) => {
    const id = (e as CustomEvent<{ value?: string }>).detail.value;
    e.preventDefault();
    if (id && current) act.takeBack(current, id);
  });
  return {
    el,
    paint(g, working) {
      current = g.id;
      const held = g.queued;
      el.hidden = held.length === 0;
      if (!held.length) { el.replaceChildren(); return; }
      const names = g.members.filter((m) => working.includes(m.id)).map((m) => m.name);
      const rows = held.map((q) => ui.html.row({
        title: q.text, value: q.id,
        lead: ui.icon('send'),
        attrs: { 'aria-label': 'Take back: ' + q.text, 'data-tip': 'Take it back to edit', 'data-tip-pos': 'top' },
        acts: ui.html.iconButton({ icon: 'send', label: 'Send now: stops the running turns', size: 's', attrs: { 'data-act': 'now', 'data-id': q.id } }) +
          ui.html.iconButton({ icon: 'close', label: 'Take back', size: 's', attrs: { 'data-act': 'back', 'data-id': q.id } })
      })).join('');
      const next = frag(ui.html.group({ label: waitingFor(names), rows }));
      ui.hydrate(next);
      el.replaceChildren(next);
    }
  };
}
