// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from './model';
import { checkClips, isClipped, tipIfClipped } from './clips';

/* jsdom has no layout: say how wide the text is and how much room it has */
function layout(el: HTMLElement, o: { scrollW: number; clientW: number; scrollH?: number; clientH?: number }): void {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: o.scrollW });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: o.clientW });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: o.scrollH ?? 20 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: o.clientH ?? 20 });
}
const mk = (cls: string, text: string, parent: HTMLElement = document.body): HTMLElement => { const n = document.createElement('span'); n.className = cls; n.textContent = text; parent.append(n); return n; };
const LONG = 'cassiopeia-staging-deploy-guardian';

beforeEach(() => { document.body.replaceChildren(); });
afterEach(() => { S.viewRoot = null; S.rows.clear(); S.draftRow = null; });

describe('a long name: an ellipsis, and the whole name as a tooltip only while it is cut', () => {
  it('sees a name cut in width (an ellipsis) or in height (the two-line header)', () => {
    const n = mk('x', LONG);
    layout(n, { scrollW: 300, clientW: 120 });
    expect(isClipped(n)).toBe(true);
    layout(n, { scrollW: 120, clientW: 120 });
    expect(isClipped(n)).toBe(false);
    layout(n, { scrollW: 120, clientW: 120, scrollH: 60, clientH: 40 });
    expect(isClipped(n)).toBe(true);
  });
  it('gives the host the whole name when it is cut, and takes it back when it fits', () => {
    const host = mk('h', LONG);
    layout(host, { scrollW: 300, clientW: 120 });
    tipIfClipped(host, host, LONG);
    expect(host.getAttribute('data-tip')).toBe(LONG);
    expect(host.hasAttribute('data-tip-auto')).toBe(true);
    layout(host, { scrollW: 100, clientW: 120 });
    tipIfClipped(host, host, LONG);
    expect(host.hasAttribute('data-tip')).toBe(false);
    expect(host.hasAttribute('data-tip-auto')).toBe(false);
  });
  it('never touches a tooltip the host brought itself (the rail has its own)', () => {
    const host = mk('h', LONG);
    host.setAttribute('data-tip', 'kai');
    layout(host, { scrollW: 300, clientW: 120 });
    tipIfClipped(host, host, LONG);
    expect(host.getAttribute('data-tip')).toBe('kai');
    layout(host, { scrollW: 100, clientW: 120 });
    tipIfClipped(host, host, LONG);
    expect(host.getAttribute('data-tip')).toBe('kai');
  });
  it('ignores a name that is not on the page', () => {
    const host = document.createElement('span');
    layout(host, { scrollW: 300, clientW: 120 });
    tipIfClipped(host, host, LONG);
    expect(host.hasAttribute('data-tip')).toBe(false);
  });
  it('checks the header, the thread, the sheet and the buttons one frame after a render, once', () => {
    let frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => frames.push(fn));
    const root = document.createElement('div');
    document.body.append(root);
    S.viewRoot = root;
    const row = document.createElement('div'); row.setAttribute('data-clip-name', ''); root.append(row);
    const head = mk('bt-p-name', LONG, root), who = mk('bt-who-name', LONG, root), fits = mk('k7-row__label', 'atlas', row);
    const archive = document.createElement('button'), label = mk('k7-btn__label', 'Archive ' + LONG, archive);
    archive.setAttribute('data-clip-label', '');
    root.append(archive);
    layout(head, { scrollW: 200, clientW: 100 }); layout(who, { scrollW: 200, clientW: 100 }); layout(fits, { scrollW: 40, clientW: 100 }); layout(label, { scrollW: 200, clientW: 100 });
    checkClips(); checkClips(); checkClips();
    expect(frames).toHaveLength(1);
    frames.forEach((f) => f()); frames = [];
    expect(head.getAttribute('data-tip')).toBe(LONG);
    expect(who.getAttribute('data-tip')).toBe(LONG);
    expect(fits.hasAttribute('data-tip')).toBe(false);
    expect(archive.getAttribute('data-tip')).toBe('Archive ' + LONG);
    vi.unstubAllGlobals();
  });
});
