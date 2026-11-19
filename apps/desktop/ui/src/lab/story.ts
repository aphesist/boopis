/* Small helpers stories share, so a state reads as data: put nodes in the cell, in a row, as HTML. */
import type { Force, State, StageCtx, Tag } from './types';

type Part = Node | string;
const toNode = (p: Part): Node => {
  if (typeof p !== 'string') return p;
  const t = document.createElement('template'); t.innerHTML = p.trim();
  return t.content.childNodes.length === 1 ? (t.content.firstChild as Node) : t.content;
};
/** appends parts to the cell, each on its own line */
export const put = (root: HTMLElement, ...parts: Part[]): void => { for (const p of parts) root.append(toNode(p)); };
/** appends parts side by side, wrapping */
export function line(root: HTMLElement, ...parts: Part[]): HTMLElement {
  const r = document.createElement('div'); r.className = 'lab-row';
  for (const p of parts) r.append(toNode(p));
  root.append(r);
  return r;
}
/** a block that takes the cell's whole width */
export function fill(root: HTMLElement, ...parts: Part[]): HTMLElement {
  const r = document.createElement('div'); r.className = 'lab-fill';
  for (const p of parts) r.append(toNode(p));
  root.append(r);
  return r;
}
/** an unordered list for rows (rows are <li>) */
export function list(root: HTMLElement, html: string, width = 280): HTMLElement {
  const ul = document.createElement('ul'); ul.className = 'ui-rows'; ul.style.width = width + 'px';
  ul.innerHTML = html;
  root.append(ul);
  return ul;
}

/** a stage state from a render function */
export const stage = (tags: readonly Tag[], render: (ctx: StageCtx) => void | Promise<void>, extra: Omit<State, 'tags' | 'render'> = {}): State => ({ tags, render, ...extra });

/** the same state with a pseudo-state forced on a selector: rest, hover, focus, pressed */
export function forced(base: State, sel: string, tagSuffix = true): Record<string, State> {
  const out: Record<string, State> = {};
  for (const [name, f] of [['hover', 'hover'], ['focus', 'focus'], ['pressed', 'active']] as const) {
    const force: Force[] = [...(base.force ?? []), { sel, state: f }];
    out[name] = { ...base, force, tags: tagSuffix ? [...base.tags, f === 'active' ? 'active' : f] : base.tags };
  }
  return out;
}
/** a wait for the next frames */
export const frames = (n = 2): Promise<void> => new Promise((r) => { const f = (): void => { if (--n <= 0) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
