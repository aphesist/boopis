/* Who answered, drawn: the line where the answering model changes. Pure DOM over the turns the conversation already drew: each agent
   turn carries `data-answered` (the model that answered it: the last of its route, empty when nothing recorded it), and
   `syncDividers` places a line before every turn whose model differs from the last known one. A turn of unknown model neither draws a
   line nor hides one (nothing is guessed). The engine's own "[Model switched to ...]" rows are not shown; this line replaces them.
   The line is the kit's SystemLine, as the thread's other lines about itself (board S33). A turn sent to one model outside governed
   mode carries the "ungoverned" Badge in its foot (turn.ts `footOf`). */
import { kit, ui } from '@boopis/ui';
import { el } from '../../core/dom';

export const UNKNOWN_MODEL = 'Model unknown';
export const UNGOVERNED_TIP = 'You sent this message to one model with @. It ran without governance: no cascade, no gate. The next message is governed again.';

/** the model that answered a turn: the last of its route ('a → b' answered with b); empty when unknown */
export const answeredModel = (model: string): string => ui.modelMark.last(model);
const said = (m: string): string => ui.modelMark.called(m) || m;

/** the line between two answers by different models: "Claude Haiku → GPT-6 Luna" */
export function dividerRow(from: string, to: string): HTMLElement {
  /* the conversation is a feed, whose children are turns: the line is a note, said once in words */
  const line = kit.systemLine({ variant: 'info', icon: 'spark', text: said(from) + ' → ' + said(to), attrs: { 'aria-label': 'The answering model changed from ' + said(from) + ' to ' + said(to) } });
  return el('div', { class: 'ss-divider' }, line);
}

/** the thread already says that the model changed before this answer ("Model changed to X", the line the pick left): one line, not two */
function saidAlready(turn: HTMLElement): boolean {
  for (let n = turn.previousElementSibling; n; n = n.previousElementSibling) {
    if (n.matches('[data-line-what="model"]')) return true;
    if (n.matches('[data-hx-turn][data-answered]')) return false;
  }
  return false;
}
/** draw the lines of a conversation column again: one before each agent turn whose model differs from the last known one */
export function syncDividers(col: HTMLElement): void {
  col.querySelectorAll('.ss-divider').forEach((d) => { d.remove(); });
  let last = '';
  for (const t of col.querySelectorAll<HTMLElement>('[data-hx-turn][data-answered]')) {
    const now = t.dataset['answered'] ?? '';
    if (!now) continue;
    if (last && !ui.modelMark.same(last, now) && !saidAlready(t)) t.before(dividerRow(last, now));
    last = now;
  }
}
