// @vitest-environment jsdom
/* The collapsed sidebar, the rail, on the v7 kit (DESIGN-SYSTEM.md v7 7, 21.2 row 40; screen 11): the bots' tiles, then the rooms (each a
   cluster of its members, owner decision, 23 November) under a rule, then New bot, Store and Settings at the foot. Where each lands on the
   screen is the lab's (`bots/rail`: every state's setup fails when one overlaps another or leaves the rail's middle); this is the order
   and what each tile draws. */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { registered } from '../../core/registry';
import { setState, state } from '../../core/state';
import '../cards';
import './index';
import { S } from './model';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const q = <T extends HTMLElement>(sel: string, root: ParentNode = document): T => { const n = root.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
  setProvider(createMockProvider({ simulate: false, fixtures: ['groups', 'paper-past'] }));
  S.bots = []; S.rows.clear(); S.groupRows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null; S.groupSel = null; S.groups = []; S.groupThreads = {};
  setState({ tab: 'bots', left: 'rail' });
  document.body.replaceChildren();
  const list = document.createElement('div'), root = document.createElement('div'), railHost = document.createElement('div');
  railHost.id = 'hx-rail';
  document.body.append(list, root, railHost);
  Element.prototype.scrollIntoView = (): void => undefined;
  (Element.prototype as unknown as { animate: () => void }).animate = (): void => undefined;
  Element.prototype.scrollTo = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
});
afterEach(() => { setState({ left: 'open' }); vi.unstubAllGlobals(); vi.restoreAllMocks(); });


describe('the shell\'s rail', () => {
  it('has a place of its own beside the open sidebar, which the bots module fills with the kit\'s Rail', () => {
    const doc = new DOMParser().parseFromString(read('../../../index.html'), 'text/html');
    const side = q('#hx-side', doc), inner = q('.hx-side__inner', side), rail = q('#hx-rail', side);
    expect(inner.contains(rail)).toBe(false);
    expect(rail.classList.contains('hx-rail')).toBe(true);
    /* the open sidebar's head: Sessions / Bots and New (screen 13); its foot: you, Store, Settings (screen 12) */
    expect(q('.hx-side__head', inner).nextElementSibling?.id).toBe('hx-sidebar-list');
    expect(q('#hx-foot', inner).previousElementSibling?.id).toBe('hx-sidebar-list');
  });
  it('shows the rail only while the sidebar is collapsed to it, and the compact rail under 1200 px', () => {
    const css = read('../shell/shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.hx\[data-left="rail"\] \.hx-rail \{ opacity: 1; visibility: visible;/);
    expect(css).toMatch(/\.hx\[data-left="rail"\] \.hx-side__inner \{ opacity: 0; visibility: hidden;/);
    expect(css).toMatch(/@media \(max-width: 1199px\) \{ \.hx, \.hx-probe \{ --sb-rail-w: 64px; --hx-rail-w: 64px; \} \}/);
  });
});

describe('the rail', () => {
  const rail = (): HTMLElement => q('#hx-rail [data-kit~="Rail"]');
  it('draws the bots\' tiles, then the rooms under a rule, then New bot, Store and Settings at the foot', () => {
    expect(state.left).toBe('rail');
    const order = [...rail().querySelectorAll<HTMLElement>('.k7-tile, .k7-rail__rule, .k7-rail__foot [data-rail-act]')].map((t) => t.dataset['bot'] ? 'bot:' + t.dataset['bot'] : t.dataset['gid'] ? 'group:' + t.dataset['gid'] : t.dataset['railAct'] ? 'foot:' + t.dataset['railAct'] : 'rule');
    expect(order).toEqual([...S.bots.map((b) => 'bot:' + b.id), 'rule', 'group:room-release', 'group:room-paper', 'foot:new', 'foot:store', 'foot:settings']);
  });
  it('draws each bot as its orb (36, or 28 on the compact rail) on the rest surface, and each room as a cluster of its members, still', () => {
    for (const b of S.bots) {
      const o = q('.k7-tile[data-bot="' + b.id + '"] orb-avatar', rail());
      expect(o.getAttribute('size')).toBe(window.innerWidth < 1200 ? '28' : '36');   /* the compact rail under 1200 px (jsdom's window is 1024) */
      expect(o.closest('.ui-orb')?.hasAttribute('data-orb-rest')).toBe(true);
    }
    const release = q('.k7-tile[data-gid="room-release"]', rail()), paper = q('.k7-tile[data-gid="room-paper"]', rail());
    /* the boards' cluster (kit.js cluster): each member's orb at rest in its place on the circle */
    const cl = q('.k7-rail__tri', release);
    expect([...cl.querySelectorAll('orb-avatar')].map((o) => o.getAttribute('label'))).toEqual(S.groups[0]!.members.map((m) => m.name));
    for (const o of cl.querySelectorAll('orb-avatar')) expect(o.closest('.ui-orb')?.hasAttribute('data-orb-rest')).toBe(true);
    /* six members: three orbs in their triangle, and "+3" beside the cluster, clear of it (decided, owner, 25 November 2026) */
    const six = q('.k7-rail__tri', paper);
    expect(six.querySelectorAll('orb-avatar')).toHaveLength(3);
    expect(six.querySelector('.ui-stack__more')).toBeNull();
    expect(q('.k7-rail__more', paper).getAttribute('data-more')).toBe('+3');
    expect(q('.k7-rail__more', paper).previousElementSibling).toBe(six);
  });
  it('says a room\'s name and who is in it, and the cluster adds no tooltip of its own', () => {
    const release = q('.k7-tile[data-gid="room-release"]', rail());
    expect(release.getAttribute('data-tip')).toBe('release crew');
    expect(release.getAttribute('data-tip-state')).toBe('atlas, nina and kai');
    expect(release.getAttribute('data-tip-pos')).toBe('right');
    expect(release.getAttribute('aria-label')).toBe('release crew, atlas, nina and kai');
    expect(q('.k7-rail__tri', release).hasAttribute('data-tip')).toBe(false);
  });
  it('draws a room whose members are no longer bots as what is left, with the rest in "+N"', async () => {
    const { drawRail } = await import('./list');
    const g = S.groups[0]!;
    S.groups[0] = { ...g, members: [g.members[0]!, { id: 'gone', profile: 'gone', handle: 'gone', name: 'gone' }, { id: 'left', profile: 'left', handle: 'left', name: 'left' }] };
    drawRail();
    const tile = q('.k7-tile[data-gid="room-release"]', rail());
    expect(tile.querySelectorAll('orb-avatar')).toHaveLength(1);
    expect(q('.k7-rail__more', tile).getAttribute('data-more')).toBe('+2');
  });
  it('marks the open bot\'s tile, and follows a bot\'s state in place, on the same orb', async () => {
    const { openBot } = await import('./room');
    const id = S.bots[1]!.id;
    openBot(id);
    expect(q('.k7-tile[data-bot="' + id + '"]', rail()).getAttribute('aria-current')).toBe('page');
    const orb = q('.k7-tile[data-bot="' + id + '"] orb-avatar', rail());
    const { onBotsEvent } = await import('./room');
    const b = S.bots[1]!;
    onBotsEvent({ type: 'bot', bot: { ...b, state: 'needs', attention: 'approval' } }, { announce: () => undefined });
    expect(q('.k7-tile[data-bot="' + id + '"] orb-avatar', rail())).toBe(orb);
    /* the open bot's tile carries no flag (board 11: its ask is in front of you); another bot's does */
    expect(q('.k7-tile[data-bot="' + id + '"]', rail()).querySelector('.k7-flag')).toBeNull();
    const other = S.bots[2]!;
    onBotsEvent({ type: 'bot', bot: { ...other, state: 'needs', attention: 'approval' } }, { announce: () => undefined });
    expect(q('.k7-tile[data-bot="' + other.id + '"]', rail()).querySelector('.k7-flag')).not.toBeNull();
  });
});
