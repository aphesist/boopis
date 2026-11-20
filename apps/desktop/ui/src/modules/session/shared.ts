/* Helpers the session module's files share. */
import { el } from '../../core/dom';
import { ui } from '@boopis/ui';

/** data strings joined with " · " never reach the screen as dots (F22): their parts sit apart */
export const parts = (s: string): string[] => String(s).split(/\s+·\s+/).map((x) => x.trim()).filter(Boolean);
export const partsEl = (s: string, cls?: string): HTMLSpanElement => el('span', { class: 'ss-parts' + (cls ? ' ' + cls : '') }, parts(s).map((p) => el('span', { text: p })));
/** copy to the clipboard and say so only when it happened (the async API first; the old copy command where a webview refuses it) */
export async function copyText(text: string): Promise<void> {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
  ui.toast(ok ? 'Copied' : 'Copy is blocked here');
}
function legacyCopy(text: string): boolean {
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.append(t); t.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { t.remove(); }
}
export const splitPath = (p: string): [string, string] => { const i = p.lastIndexOf('/') + 1; return [p.slice(0, i), p.slice(i)]; };
export const counts = (add: number, del: number): HTMLElement => el('span', { class: 'ss-n ui-mono' }, [el('span', { class: 'ss-add', text: '+' + add }), el('span', { class: 'ss-del', text: '−' + del })]);
export const kTokens = (n: number): string => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
export const mdOf = (node: HTMLElement): string => node.innerText.replace(/\n{3,}/g, '\n\n');
export const randomId = (prefix: string): string => prefix + Math.random().toString(36).slice(2, 7);
