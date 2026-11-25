/* back and forward: the shell's own history of tabs and selections */
import { emit } from '../../core/bus';
import { setState } from '../../core/state';
import type { Tab } from '../../core/types';
import { els, sh } from './ctx';
import { updateTitle } from './attention';

interface Entry { tab: Tab; sel: string | null }
const hist: { stack: Entry[]; i: number } = { stack: [], i: -1 };

export function pushHistory(entry: Entry): void {
  const cur = hist.stack[hist.i];
  if (cur && cur.tab === entry.tab && cur.sel === entry.sel) return;
  hist.stack = hist.stack.slice(0, hist.i + 1);
  hist.stack.push(entry);
  if (hist.stack.length > 60) hist.stack.shift();
  hist.i = hist.stack.length - 1;
  updateNav();
}
export function go(delta: number): void {
  const j = hist.i + delta;
  if (j < 0 || j >= hist.stack.length) return;
  hist.i = j;
  const e = hist.stack[j] as Entry;
  setState({ tab: e.tab, _fromHistory: true });
  if (e.sel) {
    sh.selection[e.tab] = e.sel;
    if (e.tab === 'bots') emit('hx:bot-select', { id: e.sel, from: 'history' }); else emit('hx:session-select', { id: e.sel, from: 'history' });
  }
  updateNav(); updateTitle();
}
export function updateNav(): void {
  const el = els();
  if (!el || !el.btnBack || !el.btnFwd) return;
  el.btnBack.disabled = hist.i <= 0;
  el.btnFwd.disabled = hist.i >= hist.stack.length - 1;
}
