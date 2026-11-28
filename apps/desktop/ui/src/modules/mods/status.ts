/* A mod's status (docs/MODS.md section 3; 2b, the lead's decision for conflict 32): it joins the composer's own line, after the line's
   items, as a plain item that only says: the mod's glyph, its name, then what it says, in mono. Nothing rises: the line is the composer's
   and keeps its height. In a narrow composer a status is left out first, as the branch is (`fold`). */
import type { LineItem } from '@boopis/ui';
import type { ModStatus } from '../../data';
import { surface } from './surfaces';

let shown: readonly ModStatus[] = [];

/** the mods' status as items of the composer's line */
export const statusItems = (): LineItem[] => shown.map((s) => ({ plain: true, still: true, icon: 'mod', mono: true, fold: true, label: s.plugin + ' mod', value: s.plugin + ' ' + s.text, attrs: { 'data-mod-status': s.plugin } }));

/** the status lines of the session: the composer's line is drawn again when they change */
export function setStatus(list: readonly ModStatus[]): void {
  const same = list.length === shown.length && list.every((s, i) => s.plugin === shown[i]?.plugin && s.text === shown[i]?.text);
  shown = list;
  if (!same) surface.redrawLine?.();
}
