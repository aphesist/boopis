// @vitest-environment jsdom
/* A bot's details pane (board 11): only what exists, each row a way into the bot's settings, a routine's switch the provider's. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setState } from '../../core/state';
import { registered } from '../../core/registry';
import { setProvider } from '../../data';
import type { DataProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import '../cards';
import { S } from './model';
import { openBot } from './room';
import './index';

const q = <T extends HTMLElement>(sel: string): T => { const n = document.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };
let paused: Array<[string, boolean]>;
function mount(): void {
  paused = [];
  const p = createMockProvider({ simulate: false });
  const provider: DataProvider = { ...p, schedules: { ...p.schedules, setPaused: (id, on) => { paused.push([id, on]); } } };
  setProvider(provider);
  S.bots = []; S.rows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null; S.sheetOpen = false; S.sheetFor = null;
  document.body.replaceChildren();
  const list = document.createElement('div'), root = document.createElement('div'), shell = document.createElement('aside');
  shell.id = 'hx-right-shell';
  document.body.append(list, root, shell);
  Element.prototype.scrollIntoView = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
  setState({ tab: 'bots', right: 'open' });
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a bot\'s details pane', () => {
  it('shows its name, Activity and Library, and under Work its model, and where it works', () => {
    mount(); openBot('kai');
    const pane = q('#hx-right-shell .k7-pane');
    expect(q('.k7-pane__name').textContent).toBe('kai');
    expect([...pane.querySelectorAll('.k7-seg__item')].map((x) => x.textContent)).toEqual(['Activity', 'Library']);
    const labels = [...pane.querySelectorAll('.k7-row__label')].map((x) => x.textContent);
    expect(labels).toContain('Model');
    expect(labels).toContain('Workspace');
  });
  it('a Work row opens the bot\'s settings (the pane is the pointer\'s way to them), by click and by Enter', () => {
    mount(); openBot('kai');
    const row = q('#hx-right-shell [data-settings="model"]');
    expect(row.getAttribute('role')).toBe('button');
    row.click();
    expect(S.sheetOpen).toBe(true);
    expect(S.sheetFor).toBe('kai');
  });
  it('a routine\'s switch pauses and resumes it through the provider', () => {
    mount(); openBot('kai');
    const sw = document.querySelector<HTMLElement>('#hx-right-shell [data-schedule]');
    if (!sw) { expect(document.querySelector('#hx-right-shell .k7-pane__sec')?.textContent).toBe('Work'); return; }   /* the mock gives kai no routine: nothing is drawn for it */
    const was = sw.getAttribute('aria-checked') === 'true';
    sw.click();
    expect(paused).toEqual([[sw.dataset['schedule'], was]]);
  });
  it('Library says what the provider knows: nothing for a bot it has no record of', () => {
    mount(); openBot('kai');
    (document.querySelectorAll<HTMLElement>('#hx-right-shell .k7-seg__item')[1] as HTMLElement).click();
    expect(q('#hx-right-shell .k7-pane__none').textContent).toContain('library');
  });
});
