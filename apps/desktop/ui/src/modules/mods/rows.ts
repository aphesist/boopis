/* A mod's rows in the conversation (docs/MODS.md section 3; 2b, the lead's decision for conflict 32: the kit's SystemLine and ToolRow).
   What a mod logs (`$.ui.log`, a quiet line the model does not read; `plugin: ''` is boopis speaking about the mods) is a SystemLine: the
   mod's glyph, its name and its words, the time at its end; a warning's name in amber. A row a mod places (the `Placed` site, which the
   plugin does not send yet: `$.ui.place` is not in boopis, docs/MODS.md section 9) is a ToolRow led by the mod's glyph and name with the
   time at its end, and what the mod draws under its head (the kit's ModView). They are gone when the conversation is redrawn and are not
   kept on resume, as in Claude Code. */
import { hhmm } from '../../core/dom';
import { logger } from '../../core/log';
import { kit } from '@boopis/ui';
import type { ModLogLine, ModPlaced, ModTree } from '../../data';
import { surface } from './surfaces';
import { viewOf } from './panes';

const log = logger('mods');
const clock = (ms: number): string => hhmm(new Date(ms));
const frag = (html: string): HTMLElement => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstElementChild as HTMLElement; };

/** a placed row: `plugin` is the mod (null or '' when it is not known or boopis speaks about the mods) */
export function placedRow(plugin: string | null, tree: ModTree, at: number, sessionId: string): HTMLElement | null {
  const t = clock(at), name = plugin || 'Mods';
  const root = viewOf(tree, { surface: 'row', sessionId, refused: (r) => { log.warn(name + ': row skipped, ' + r); } });
  if (!root) return null;
  const row = kit.wire(frag(kit.html.toolRow({ icon: 'mod', tool: name, text: true, word: t, attrs: { 'data-mod-row': plugin ?? '', 'aria-label': (plugin ? plugin + ' mod' : 'Mods') + ', ' + t } })));
  const after = document.createElement('div');
  after.className = 'k7-tool__after';
  after.append(root);
  row.append(after);
  return row;
}

/** a log line: the kit's SystemLine, the mod's glyph and name, its words, the time */
export function logLine(l: ModLogLine): HTMLElement {
  const name = l.plugin || 'Mods';
  return frag(kit.html.systemLine({ icon: 'mod', word: { text: name, tone: l.level === 'warn' ? 'owe' : 'neutral' }, text: l.text, meta: clock(l.at), attrs: { 'data-mod-log': l.level, 'data-mod-row': l.plugin ?? '' } }));
}

export function placeLog(l: ModLogLine, _sessionId: string, quiet: boolean): HTMLElement {
  const row = logLine(l);
  surface.place?.(row, { quiet });
  return row;
}
export function placePlaced(p: ModPlaced, sessionId: string, quiet: boolean): HTMLElement | null {
  const row = placedRow(p.plugin, p.tree, p.at, sessionId);
  if (row) { row.setAttribute('data-mod-placed', p.id); surface.place?.(row, { quiet }); }
  return row;
}
