/* Dock: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Dock once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
import { slabPath } from '../../squircle-path';
import { DOCK_GEOMETRY } from './dock';
import type { DockKind } from './dock';

/** draw a row or compact dock's slab for its laid-out width (the width fits the content, 21.4): one path per size, written once */
export function paintDock(d: HTMLElement): void {
  const kind = d.getAttribute('data-dk') as DockKind | null;
  if (!kind || kind === 'open') return;
  const g = DOCK_GEOMETRY[kind];
  const draw = (): void => {
    const w = d.offsetWidth, h = g.h;
    if (!w || d.dataset['dkW'] === String(w)) return;
    d.dataset['dkW'] = String(w);
    const svg = d.querySelector('.k7-dock__slab'), path = svg?.querySelector('path');
    if (!svg || !path) return;
    svg.setAttribute('viewBox', '0 0 ' + (w + 2 * g.F) + ' ' + h); svg.setAttribute('width', String(w + 2 * g.F)); svg.setAttribute('height', String(h));
    path.setAttribute('d', slabPath(w, h, g.R, g.F));
  };
  draw();
  if (typeof ResizeObserver === 'function') new ResizeObserver(draw).observe(d);
}
