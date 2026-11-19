/* Placed rows (docs/MODS.md section 3; DESIGN-SYSTEM.md 14.29): a row in the conversation from the mod, never from the agent. Its
   glyph and name sit in the call-number margin with the time; the tree sits on the ground at 14px. Two things become one:
   what a mod logs (`$.ui.log`, a quiet line the model does not read; `plugin: ''` is boopis speaking about the mods) and a
   row a mod places (the `Placed` site, which the plugin does not send yet: `$.ui.place` is not in boopis, docs/MODS.md
   section 9). They are gone when the conversation is redrawn and not kept on resume, as in Claude Code. */
import { hhmm } from '../../core/dom';
import { logger } from '../../core/log';
import { ui } from '@boopis/ui';
import type { ModLogLine, ModPlaced, ModTree } from '../../data';
import { surface } from './surfaces';
import { dispatcher } from './ctl';

const log = logger('mods');
const clock = (ms: number): string => hhmm(new Date(ms));

/** one row: `plugin` is the mod (null or '' when it is not known or boopis speaks about the mods) */
export function placedRow(plugin: string | null, tree: ModTree, at: number, sessionId: string): HTMLElement | null {
  const t = clock(at), name = plugin || 'Mods';
  const art = ui.entry({ kind: 'mod', who: ui.html.mod(name), callno: [t], label: (plugin ? plugin + ' mod' : 'Mods') + ', ' + t, body: '' });
  art.setAttribute('data-mod-row', plugin ?? '');
  const root = ui.modView(tree, { surface: 'ground', dispatch: dispatcher(sessionId), onInvalid: (r) => { log.warn(name + ': row skipped, ' + r); } });
  if (!root) return null;
  art.querySelector('.ui-entry__body')?.append(root);
  return art;
}

/** a log line as a tree: quiet text, in the warning ink when it warns */
export const logTree = (l: ModLogLine): ModTree => ({ type: 'Text', props: { color: l.level === 'warn' ? 'warning' : 'subtle' }, children: [l.text] });

export function placeLog(l: ModLogLine, sessionId: string, quiet: boolean): HTMLElement | null {
  const row = placedRow(l.plugin, logTree(l), l.at, sessionId);
  if (row) { row.setAttribute('data-mod-log', l.level); surface.place?.(row, { quiet }); }
  return row;
}
export function placePlaced(p: ModPlaced, sessionId: string, quiet: boolean): HTMLElement | null {
  const row = placedRow(p.plugin, p.tree, p.at, sessionId);
  if (row) { row.setAttribute('data-mod-placed', p.id); surface.place?.(row, { quiet }); }
  return row;
}
