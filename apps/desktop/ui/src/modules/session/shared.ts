/* Helpers the session module's files share. */
import { el } from '../../core/dom';
import { ui } from '../../components';

/** data strings joined with " · " never reach the screen as dots (F22): their parts sit apart */
export const parts = (s: string): string[] => String(s).split(/\s+·\s+/).map((x) => x.trim()).filter(Boolean);
export const partsEl = (s: string, cls?: string): HTMLSpanElement => el('span', { class: 'ss-parts' + (cls ? ' ' + cls : '') }, parts(s).map((p) => el('span', { text: p })));
export async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); } catch { /* blocked on file:// */ }
  ui.toast('Copied');
}
export const splitPath = (p: string): [string, string] => { const i = p.lastIndexOf('/') + 1; return [p.slice(0, i), p.slice(i)]; };
export const counts = (add: number, del: number): HTMLElement => el('span', { class: 'ss-n ui-mono' }, [el('span', { class: 'ss-add', text: '+' + add }), el('span', { class: 'ss-del', text: '−' + del })]);
export const kTokens = (n: number): string => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
export const mdOf = (node: HTMLElement): string => node.innerText.replace(/\n{3,}/g, '\n\n');
export const randomId = (prefix: string): string => prefix + Math.random().toString(36).slice(2, 7);
