// @vitest-environment jsdom
/* The sidebar's orbs under live updates. An orb draws on a canvas a worker owns: a node that is taken out of the page and put back, or
   drawn anew, shows nothing until the worker paints it again. That was the owner's flicker (22 November 2026): every state change
   of a bot redrew its row, and every change of a group redrew every group's orbs. A live update writes to the node it has. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import type { BotsEvent, DataProvider, Group, GroupsEvent } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { registered } from '../../core/registry';
import '../cards';
import './index';
import { S } from './model';

const bus: { bots: Set<(e: BotsEvent) => void>; groups: Set<(e: GroupsEvent) => void> } = { bots: new Set(), groups: new Set() };
function provider(): DataProvider {
  const p = createMockProvider({ simulate: false, fixtures: ['groups'] });
  return {
    ...p,
    bots: { ...p.bots, subscribe: (fn) => { bus.bots.add(fn); const off = p.bots.subscribe(fn); return () => { bus.bots.delete(fn); off(); }; } },
    groups: { ...p.groups, subscribe: (fn) => { bus.groups.add(fn); const off = p.groups.subscribe(fn); return () => { bus.groups.delete(fn); off(); }; } }
  };
}
let p: DataProvider;
const pushBot = (id: string, patch: Record<string, unknown>): void => { const b = S.bots.find((x) => x.id === id)!; for (const f of bus.bots) f({ type: 'bot', bot: { ...b, ...patch } as never }); };
const pushGroup = (patch: Partial<Group>): void => { const g = S.groups[0]!; for (const f of bus.groups) f({ type: 'group', group: { ...g, ...patch } }); };

beforeEach(() => {
  bus.bots.clear(); bus.groups.clear();
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
  p = provider(); setProvider(p);
  S.bots = []; S.rows.clear(); S.groupRows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null; S.groupSel = null; S.groups = []; S.groupThreads = {};
  document.body.replaceChildren();
  const list = document.createElement('div'), root = document.createElement('div');
  document.body.append(list, root);
  Element.prototype.scrollIntoView = (): void => undefined;
  (Element.prototype as unknown as { animate: () => void }).animate = (): void => undefined;
  Element.prototype.scrollTo = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** every orb that leaves the list's DOM, however briefly */
function watchOrbs(): { gone(): string[]; stop(): void } {
  const nav = document.querySelector('.bt-list') as HTMLElement, left: string[] = [];
  const mo = new MutationObserver((rs) => { for (const r of rs) for (const n of r.removedNodes) if (n instanceof Element) for (const o of n.matches('orb-avatar') ? [n] : n.querySelectorAll('orb-avatar')) left.push(o.getAttribute('label') ?? ''); });
  mo.observe(nav, { childList: true, subtree: true });
  return { gone: () => { for (const r of mo.takeRecords()) for (const n of r.removedNodes) if (n instanceof Element) for (const o of n.matches('orb-avatar') ? [n] : n.querySelectorAll('orb-avatar')) left.push(o.getAttribute('label') ?? ''); return left; }, stop: () => mo.disconnect() };
}

describe('a bot changes state while the sidebar shows it', () => {
  it('keeps the row, its button and its live orb: only the state word and the orb\'s reaction change', () => {
    const row = S.rows.get('atlas')!, orb = row.li.querySelector('orb-avatar')!, wrap = row.li.querySelector('.ui-orb')!;
    const w = watchOrbs();
    pushBot('atlas', { state: 'working', activity: 'reading the diff' });
    expect(S.rows.get('atlas')!.li).toBe(row.li);
    expect(row.li.querySelector('.ui-row')).toBe(row.btn);
    expect(row.li.querySelector('orb-avatar')).toBe(orb);
    expect(row.li.querySelector('.ui-orb')).toBe(wrap);
    expect(orb.getAttribute('reaction')).toBe('working');
    expect(row.btn.textContent).toContain('working');
    expect(row.btn.getAttribute('aria-label')).toMatch(/working$/);
    expect(w.gone()).toEqual([]);
    w.stop();
  });
  it('shows the flag when the bot needs you and drops it after, on the same orb', () => {
    const row = S.rows.get('atlas')!, orb = row.li.querySelector('orb-avatar')!;
    const w = watchOrbs();
    pushBot('atlas', { state: 'needs', attention: 'approval' });
    expect(row.li.querySelector('.ui-dot--flag')).not.toBeNull();
    expect(orb.getAttribute('reaction')).toBe('needs');
    pushBot('atlas', { state: 'idle', attention: null });
    expect(row.li.querySelector('.ui-dot--flag')).toBeNull();
    expect(orb.getAttribute('reaction')).toBe('idle');
    expect(row.li.querySelector('orb-avatar')).toBe(orb);
    expect(w.gone()).toEqual([]);
    w.stop();
  });
  it('several bots in a row of updates keep every orb', () => {
    const before = new Map([...S.rows].map(([id, r]) => [id, r.li.querySelector('orb-avatar')]));
    const w = watchOrbs();
    for (const [i, id] of ['atlas', 'iris', 'sol', 'kai', 'nina'].entries()) pushBot(id, { state: i % 2 ? 'speaking' : 'thinking' });
    for (const [id, r] of S.rows) expect(r.li.querySelector('orb-avatar'), id).toBe(before.get(id));
    expect(w.gone()).toEqual([]);
    w.stop();
  });
  it('keeps the keyboard focus on the row', () => {
    const btn = S.rows.get('atlas')!.btn;
    btn.focus();
    pushBot('atlas', { state: 'working' });
    expect(document.activeElement).toBe(btn);
  });
});

describe('a group starts and stops replying', () => {
  it('keeps the rows and their stacks of orbs: only the running dot comes and goes', () => {
    const row = S.groupRows.get(S.groups[0]!.id)!, stack = row.li.querySelector('.cd-stack')!, orbs = [...row.li.querySelectorAll('orb-avatar')];
    expect(orbs.length).toBeGreaterThan(1);
    const w = watchOrbs();
    pushGroup({ working: ['atlas'] });
    expect(S.groupRows.get(S.groups[0]!.id)!.li).toBe(row.li);
    expect(row.li.querySelector('.cd-stack')).toBe(stack);
    expect([...row.li.querySelectorAll('orb-avatar')]).toEqual(orbs);
    expect(row.btn.getAttribute('aria-label')).toMatch(/replying$/);
    expect(row.li.querySelector('.ui-row__end')).not.toBeNull();
    pushGroup({ working: [] });
    expect(row.li.querySelector('.ui-row__end')).toBeNull();
    expect(row.li.querySelector('.cd-stack')).toBe(stack);
    expect(w.gone()).toEqual([]);
    w.stop();
  });
  it('draws the stack again when who is in the group changes', () => {
    const row = S.groupRows.get(S.groups[0]!.id)!, stack = row.li.querySelector('.cd-stack')!;
    const members = S.groups[0]!.members;
    pushGroup({ members: members.slice(0, 2) });
    expect(S.groupRows.get(S.groups[0]!.id)!.li.querySelector('.cd-stack')).not.toBe(stack);
    expect(document.querySelectorAll('.bt-group-rows .ui-row')).toHaveLength(2);
  });
  it('a group row sits before New group, and the list keeps one of each', () => {
    pushGroup({ working: ['atlas'] });
    const rows = [...document.querySelectorAll('.bt-group-rows .ui-row')];
    expect(rows.map((r) => r.hasAttribute('data-new-group'))).toEqual([false, true]);
  });
});
