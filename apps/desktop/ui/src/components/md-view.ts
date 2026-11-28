/* The markdown renderer's element side: `markdown(text, ctx)` draws a text and wires its code wells (Copy, Wrap, the fold);
   `streamMarkdown(root, text, ctx)` keeps the blocks already drawn and redraws only the one still being written, so a reply
   arriving block by block never rewrites what the reader is on; `arrive(root)` is the arrival (each block fades up 6px, one
   after another; reduced motion: a short crossfade). Mentions and paths are the surface's to answer (`data-mention`,
   `data-path`). */
import { reduced, tokenMs } from '../core/dom';
import { copyText } from './clipboard';
import { addressesYou, blockHTML, markdownHTML, splitBlocks } from './markdown';
import type { MarkdownCtx } from './markdown';

interface MdRoot extends HTMLElement { _md?: string[] }

/** the code a well holds, every line (the folded ones too) */
export const codeOf = (well: Element): string => [...well.querySelectorAll('.ui-codeblock__l')].map((l) => l.textContent ?? '').join('\n');

function onClick(e: MouseEvent): void {
  const t = e.target as Element | null;
  const b = t?.closest<HTMLButtonElement>('.ui-codeblock button'); if (!b) return;
  const well = b.closest('.ui-codeblock'); if (!well) return;
  if (b.dataset['code'] === 'copy') { void copyText(codeOf(well), 'Copied the code'); return; }
  if (b.dataset['code'] === 'wrap') {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    well.toggleAttribute('data-wrap', on);
    return;
  }
  if (b.dataset['code'] === 'fold') {
    const rest = well.querySelector<HTMLElement>('.ui-codeblock__rest'); if (!rest) return;
    const open = rest.hidden;
    rest.hidden = !open;
    well.toggleAttribute('data-folded', !open);
    b.setAttribute('aria-expanded', String(open));
    const label = b.querySelector('.k7-btn__label');
    if (label) label.textContent = open ? 'Show fewer lines' : 'Show ' + (b.dataset['more'] ?? '') + ' more lines';
  }
}
/** wire the code wells under `root` once (one listener on the root) */
export function wireMarkdown<E extends HTMLElement>(root: E): E {
  if (root.dataset['mdWired'] == null) { root.dataset['mdWired'] = ''; root.addEventListener('click', onClick); }
  return root;
}
/** a text as a wired prose element */
export function markdown(text: string, ctx: MarkdownCtx = {}, o: { class?: string } = {}): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markdownHTML(text, ctx, o);
  const root = tpl.content.firstElementChild as MdRoot;
  root._md = splitBlocks(text).map((b) => b.src);
  return wireMarkdown(root);
}

const fadeUp = (n: Element, delay: number): void => {
  if (!(n instanceof HTMLElement) || typeof n.animate !== 'function') return;
  if (reduced()) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, delay, fill: 'backwards' }); return; }
  n.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: tokenMs('--dur-2', 200), easing: 'cubic-bezier(.2,.8,.2,1)', delay, fill: 'backwards' });
};
/** the arrival: each block of `root` fades up in turn, 40ms apart (reduced motion: one short crossfade). A message addressed to the
    person flashes its glow once as it lands (`data-arrived`, CSS: never under reduced motion; the glow itself stays) */
export function arrive(root: Element, o: { stagger?: number } = {}): void {
  const kids = [...root.children];
  if (root.hasAttribute('data-to-you')) { root.setAttribute('data-arrived', ''); root.addEventListener('animationend', () => { root.removeAttribute('data-arrived'); }, { once: true }); }
  if (reduced()) { fadeUp(root, 0); return; }
  kids.forEach((k, i) => fadeUp(k, i * (o.stagger ?? 40)));
}

/** redraw `root` (made by `markdown`) for a longer text: finished blocks stay, the changed one is redrawn, new ones fade in.
    Returns the blocks drawn anew, for the surface to finish (its paths, its mentions). */
export function streamMarkdown(root: HTMLElement, text: string, ctx: MarkdownCtx = {}, o: { animate?: boolean } = {}): HTMLElement[] {
  const r = root as MdRoot;
  const blocks = splitBlocks(text);
  const had = r._md ?? [];
  const drawn: HTMLElement[] = [];
  const make = (i: number): HTMLElement => { const tpl = document.createElement('template'); tpl.innerHTML = blockHTML(blocks[i] ?? { kind: 'p', src: '' }, ctx); return tpl.content.firstElementChild as HTMLElement; };
  let fresh = 0;
  blocks.forEach((b, i) => {
    const cur = root.children[i];
    if (cur && had[i] === b.src) return;
    const n = make(i);
    if (cur) cur.replaceWith(n);
    else { root.append(n); if (o.animate !== false) fadeUp(n, fresh++ * 40); }
    drawn.push(n);
  });
  while (root.children.length > blocks.length) root.lastElementChild?.remove();
  r._md = blocks.map((b) => b.src);
  root.toggleAttribute('data-to-you', addressesYou(text, ctx));
  wireMarkdown(root);
  return drawn;
}
