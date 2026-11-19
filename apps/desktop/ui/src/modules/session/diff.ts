/* the inline diff of the change (the ship card's "View diff", the Changes section) */
import { el, frag } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { DiffFile } from '../../data';
import { counts, splitPath } from './shared';

export const chevron = (): HTMLElement => frag(ui.icon('chevron', { class: 'ss-chev' }));

export function renderDiff(files: readonly DiffFile[], openFirst: boolean, bare?: boolean): HTMLElement {
  const wrap = el('div', { class: 'ss-diff' + (bare ? ' ss-diff--bare' : '') });
  files.forEach((f, i) => {
    const [dir, base] = splitPath(f.path), open = !!(openFirst && i === 0);
    const file = el('div', { class: 'ss-diff-file', 'data-open': String(open) });
    const head = el('button', { class: 'ss-diff-head', type: 'button', 'aria-expanded': String(open) }, [chevron(), el('span', { class: 'ss-path ui-mono' }, [el('span', { class: 'ss-dir', text: dir }), base]), counts(f.add, f.del)]);
    head.addEventListener('click', () => { const o = file.dataset['open'] !== 'true'; file.dataset['open'] = String(o); head.setAttribute('aria-expanded', String(o)); });
    const body = el('div', { class: 'ss-diff-body ui-scroll ui-scroll--x ui-mono', role: 'region', 'aria-label': 'Diff of ' + f.path });
    f.hunks.forEach(([h, lines]) => {
      body.append(el('div', { class: 'ss-dl hunk', text: h }));
      let n = +((h.match(/\+(\d+)/) ?? [0, 1])[1] ?? 1);
      lines.forEach((l) => {
        const s = l[0];
        body.append(el('div', { class: 'ss-dl ' + (s === '+' ? 'add' : s === '-' ? 'del' : '') }, [el('span', { class: 'ln', text: s === '-' ? '' : String(n++) }), el('span', { class: 'sg', text: s === ' ' ? '' : s }), el('span', { text: l.slice(1) })]));
      });
    });
    file.append(head, body); wrap.append(file);
  });
  return wrap;
}
