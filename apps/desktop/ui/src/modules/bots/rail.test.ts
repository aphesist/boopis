// @vitest-environment jsdom
/* The Bots tab's collapsed sidebar, the rail (the owner's report on 0.1.9: "+ sign up there is over a bot, and the groups at the
   bottom are indistinguishible from bots themselves"). Top to bottom: the Session | Bots switch, New bot on a row of its own, the
   bots, then the groups (each a cluster of its members) and New group. Where each lands on the screen is the lab's (`bots/rail`:
   every state's setup fails when one overlaps another or leaves the x = 28 axis); this is the order and what each row draws. */
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
  const list = document.createElement('div'), root = document.createElement('div');
  document.body.append(list, root);
  Element.prototype.scrollIntoView = (): void => undefined;
  (Element.prototype as unknown as { animate: () => void }).animate = (): void => undefined;
  Element.prototype.scrollTo = (): void => undefined;
  registered('bots-list')?.mount(list); registered('bots')?.mount(root);
});
afterEach(() => { setState({ left: 'open' }); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the shell\'s rail', () => {
  it('holds the switch, then New bot, above the list', () => {
    const doc = new DOMParser().parseFromString(read('../../../index.html'), 'text/html');
    const side = q('.hx-side__inner', doc), rail = q('.hx-rail', side), list = q('#hx-sidebar-list', side);
    expect([...rail.children].map((c) => c.id || c.className)).toEqual(['hx-rail-seg', 'ui-ib hx-rail__new']);
    expect(rail.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    /* the rail and the open sidebar's pill and New share the head, which the list follows */
    expect(q('.hx-side__head', side).contains(rail)).toBe(true);
    expect(q('.hx-side__head', side).nextElementSibling).toBe(list);
  });
  it('puts the rail in the sidebar\'s flow while collapsed, so the list starts under New bot and never under it', () => {
    const css = read('../shell/shell.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.hx\[data-left="rail"\] \.hx-rail \{[^}]*position: relative;/);
    expect(css).toMatch(/\.hx-side__head > \* \{ grid-area: 1 \/ 1; \}/);
    /* New bot has a row of the rail's pitch: the list starts half of what that row leaves around it below it */
    expect(css).toMatch(/\.hx\[data-left="rail"\] \.hx-side__list \{ margin-top: calc\(\(var\(--rail-row\) - var\(--ctl-s\)\) \/ 2\); \}/);
    expect(read('./bots.css')).toMatch(/\.bt-list\.is-rail \.ui-row \{ height: var\(--rail-row/);
  });
});

describe('the bots list in the rail', () => {
  it('lists the bots, then the groups under a rule, then New group', () => {
    expect(state.left).toBe('rail');
    const nav = q('.bt-list');
    expect(nav.classList.contains('is-rail')).toBe(true);
    const order = [...nav.querySelectorAll<HTMLElement>('.ui-row')].filter((r) => !r.closest('.bt-archived')).map((r) => r.dataset['gid'] ? 'group:' + r.dataset['gid'] : r.hasAttribute('data-new-group') ? 'new group' : 'bot:' + r.dataset['value']);
    expect(order).toEqual([...S.bots.map((b) => 'bot:' + b.id), 'group:room-release', 'group:room-paper', 'new group']);
    /* the groups' block follows the bots' list: the rule is its top edge (bots.css) */
    expect(q('.bt-rows').nextElementSibling).toBe(q('.bt-groups'));
    expect(read('./bots.css')).toMatch(/\.bt-list\.is-rail \.bt-groups::before \{[^}]*background: var\(--hair\)/);
  });
  it('draws each bot as its orb at 24px, and each group as a cluster of its members, still at 16px', () => {
    for (const b of S.bots) expect(q('.ui-row__lead > .ui-orb > orb-avatar', S.rows.get(b.id)!.btn).getAttribute('size')).toBe('24');
    const release = q('.ui-row[data-gid="room-release"]'), paper = q('.ui-row[data-gid="room-paper"]');
    const cl = q('.ui-row__lead > .ui-stack--cluster', release);
    expect([...cl.querySelectorAll('orb-avatar')].map((o) => o.getAttribute('label'))).toEqual(S.groups[0]!.members.map((m) => m.name));
    for (const o of cl.querySelectorAll('orb-avatar')) { expect(o.getAttribute('size')).toBe('16'); expect(o.hasAttribute('static')).toBe(true); }
    /* six members: three orbs and "+3", the four places of the open row's stack */
    const six = q('.ui-row__lead > .ui-stack--cluster', paper);
    expect(six.querySelectorAll('orb-avatar')).toHaveLength(3);
    expect(q('.ui-stack__more', six).getAttribute('data-more')).toBe('+3');
  });
  it('says a group\'s name and who is in it in its tooltip, as a bot\'s says its name and state, and the cluster adds no tooltip of its own', () => {
    const release = q('.ui-row[data-gid="room-release"]');
    expect(release.getAttribute('data-tip')).toBe('release crew');
    expect(release.getAttribute('data-tip-state')).toBe('atlas, nina and kai');
    expect(release.getAttribute('data-tip-pos')).toBe('right');
    expect(release.getAttribute('aria-label')).toBe('release crew, atlas, nina and kai');
    expect(q('.ui-stack', release).hasAttribute('data-tip')).toBe(false);
    expect(q('[data-new-group]').getAttribute('data-tip')).toBe('New group');
  });
  it('draws a group whose members are no longer bots as what is left, with the rest in "+N", never as an empty row', () => {
    const g = S.groups[0]!;
    S.groups[0] = { ...g, members: [g.members[0]!, { id: 'gone', profile: 'gone', handle: 'gone', name: 'gone' }, { id: 'left', profile: 'left', handle: 'left', name: 'left' }] };
    setState({ left: 'open' }); setState({ left: 'rail' });
    const row = q('.ui-row[data-gid="room-release"]');
    expect(row.querySelectorAll('orb-avatar')).toHaveLength(1);
    expect(q('.ui-stack__more', row).getAttribute('data-more')).toBe('+2');
    S.groups[0] = { ...g, members: [{ id: 'gone', profile: 'gone', handle: 'gone', name: 'gone' }, { id: 'left', profile: 'left', handle: 'left', name: 'left' }] };
    setState({ left: 'open' }); setState({ left: 'rail' });
    expect(q('.ui-stack__more', q('.ui-row[data-gid="room-release"]')).getAttribute('data-more')).toBe('+2');
  });
  it('goes back to the open sidebar\'s stacks, and to clusters again, as the sidebar opens and collapses', () => {
    setState({ left: 'open' });
    expect(document.querySelector('.bt-groups .ui-stack--cluster')).toBeNull();
    expect(document.querySelectorAll('.bt-groups .ui-stack')).toHaveLength(2);
    expect(q('.ui-row[data-gid="room-release"]').hasAttribute('data-tip-state')).toBe(false);
    setState({ left: 'rail' });
    expect(document.querySelectorAll('.bt-groups .ui-stack--cluster')).toHaveLength(2);
  });
});
