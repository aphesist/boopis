/* Icons: any grid, one rendered stroke (components.css .ui-icon). [viewBox, inner]. Chrome glyphs sit on the
   shell's 20 grid, content glyphs on the session's 16 grid. */
import { cx } from '../core/dom';

const I20 = '0 0 20 20', I16 = '0 0 16 16';
const ICONS: Record<string, readonly [viewBox: string, inner: string | null]> = {
  'sidebar-left': [I20, '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path class="is-fill is-fill-on" d="M3.5 6.25a1.75 1.75 0 0 1 1.75-1.75H7.5v11H5.25A1.75 1.75 0 0 1 3.5 13.75z"/><path d="M7.75 4v12"/>'],
  'sidebar-right': [I20, '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path class="is-fill is-fill-on" d="M12.5 4.5h2.25a1.75 1.75 0 0 1 1.75 1.75v7.5a1.75 1.75 0 0 1-1.75 1.75H12.5z"/><path d="M12.25 4v12"/>'],
  back: [I20, '<path d="M12 5 7 10l5 5"/>'],
  forward: [I20, '<path d="m8 5 5 5-5 5"/>'],
  search: [I20, '<circle cx="8.75" cy="8.75" r="5"/><path d="m12.5 12.5 4 4"/>'],
  minimize: [I20, '<path d="M5 10.5h10"/>'],
  maximize: [I20, '<rect x="5.25" y="5.25" width="9.5" height="9.5" rx="1.5"/>'],
  restore: [I20, '<rect x="4.75" y="7.25" width="8" height="8" rx="1.5"/><path d="M7.25 4.75h6.5a1.5 1.5 0 0 1 1.5 1.5v6.5"/>'],
  close: [I20, '<path d="m5.5 5.5 9 9m0-9-9 9"/>'],
  plus: [I20, '<path d="M10 4.5v11M4.5 10h11"/>'],
  gear: ['0 0 24 24', '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'],
  session: [I20, '<path d="m4.5 6 4 4-4 4M10.5 14.5h5"/>'],
  bots: [I20, '<circle cx="10" cy="10" r="6.75"/><path d="M8 8.6v2.4M12 8.6v2.4"/>'],
  dock: [I20, '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path d="M6.5 16.25v-2a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2"/>'],
  send: [I16, '<path d="M8 13V3.5M3.8 7.6 8 3.4l4.2 4.2"/>'],
  mic: [I16, '<rect x="6" y="2.2" width="4" height="7.4" rx="2"/><path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2"/>'],
  stop: [I16, '<rect class="is-fill" x="4.5" y="4.5" width="7" height="7" rx="1.2"/>'],
  ladder: [I16, '<path d="M4 2.5v11M12 2.5v11M4 5.5h8M4 8.5h8M4 11.5h8"/>'],
  spark: [I16, '<path d="M8.8 1.8 3.6 9.2h4.1l-.6 5 5.2-7.4H8.2z"/>'],
  chevron: [I16, '<path d="m6 3.5 4.5 4.5L6 12.5"/>'],
  'chevron-down': [I16, '<path d="m4 6 4 4 4-4"/>'],
  fork: [I16, '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="11.5" cy="3.5" r="1.5"/><circle cx="8" cy="12.5" r="1.5"/><path d="M4.5 5v1.2a1.8 1.8 0 0 0 1.8 1.8h3.4a1.8 1.8 0 0 0 1.8-1.8V5M8 8v3"/>'],
  unarchive: [I16, '<rect x="2" y="2.8" width="12" height="3.2" rx=".8"/><path d="M3.2 6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V6M8 12V8.2M6.4 9.6 8 8l1.6 1.6"/>'],
  slash: [I16, '<path d="M10.5 2.5 5.5 13.5"/>'],
  copy: [I16, '<rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.2V3a1 1 0 0 0-1-1H3.4a1 1 0 0 0-1 1v6.1a1 1 0 0 0 1 1h.4"/>'],
  check: [I16, '<path d="m3.2 8.4 3 3 6.6-6.8"/>'],
  play: [I16, '<path d="M5 3.4v9.2L12.4 8z"/>'],
  pen: [I16, '<path d="M10.6 2.6a1.5 1.5 0 0 1 2.1 2.1L5.5 11.9l-2.8.7.7-2.8z"/>'],
  archive: [I16, '<rect x="2" y="2.8" width="12" height="3.2" rx=".8"/><path d="M3.2 6v6.2a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V6M6.5 8.6h3"/>'],
  file: [I16, '<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>'],
  folder: [I16, '<path d="M1.8 4.2a1 1 0 0 1 1-1h3.3l1.4 1.6h5.7a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>'],
  at: [I16, '<circle cx="8" cy="8" r="2.6"/><path d="M10.6 8v1.1a1.9 1.9 0 0 0 3.6.6A6.2 6.2 0 1 0 11 13.4"/>'],
  clock: [I16, '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>'],
  sliders: [I16, '<path d="M2.5 5h6M11.5 5h2M2.5 11h1.5M7 11h6.5"/><circle cx="10" cy="5" r="1.6"/><circle cx="5.5" cy="11" r="1.6"/>'],
  dice: [I16, '<rect x="2.5" y="2.5" width="11" height="11" rx="2.6"/><circle class="is-fill" cx="5.6" cy="5.6" r="1.05"/><circle class="is-fill" cx="8" cy="8" r="1.05"/><circle class="is-fill" cx="10.4" cy="10.4" r="1.05"/>'],
  /* the puzzle glyph: a mod's name is this and its name wherever it speaks (DESIGN-SYSTEM.md 14.29) */
  mod: [I16, '<path d="M3.5 4h2.7v-.5a1.8 1.8 0 0 1 3.6 0V4h2.7a1 1 0 0 1 1 1v2.2h-.5a1.8 1.8 0 0 0 0 3.6h.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/>'],
  info: [I16, '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6"/><circle class="is-fill" cx="8" cy="5.2" r=".8"/>'],
  more: [I16, '<circle class="is-fill" cx="3.5" cy="8" r="1.1"/><circle class="is-fill" cx="8" cy="8" r="1.1"/><circle class="is-fill" cx="12.5" cy="8" r="1.1"/>']
  };

export const iconNames: string[] = Object.keys(ICONS);
export interface IconOpts { size?: string | undefined; class?: string | undefined }

export function icon(name: string, o: IconOpts = {}): string {
  const ic = ICONS[name];
  if (!ic) return '';
  return '<svg class="' + cx('ui-icon', o.size && 'ui-icon--' + o.size, o.class) + '" viewBox="' + ic[0] + '" aria-hidden="true" focusable="false">' + (ic[1] ?? '') + '</svg>';
}
