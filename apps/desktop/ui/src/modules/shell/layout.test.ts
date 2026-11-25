import { describe, expect, it } from 'vitest';
import { solveLayout } from './layout';
import type { LayoutIn } from './layout';

const base: LayoutIn = { W: 1440, left: 'open', right: 'closed', tab: 'session', dock: 'on', sb: 288, rail: 56, rw: 340, rr: 28, col: 720, dockRest: 72, dockHeight: null, inset: { left: 0, right: 0 } };

describe('the layout (LAYOUT.md): the dock is always centred with the chatbox', () => {
  it('centres the column between the open sidebar and the details strip', () => {
    const s = solveLayout(base);
    expect(s.viewLeft).toBe(288);
    expect(s.viewRight).toBe(1440 - 28);
    expect(s.centerX).toBe((288 + 1412) / 2);
    expect(s.colWidth).toBe(720);
    expect(s.colLeft).toBe(s.centerX - 360);
  });
  it('closing or collapsing the sidebar moves the centre line the dock and the composer share', () => {
    const open = solveLayout(base).centerX, rail = solveLayout({ ...base, left: 'rail' }).centerX, closed = solveLayout({ ...base, left: 'closed' }).centerX;
    expect(rail).toBeLessThan(open);
    expect(closed).toBeLessThan(rail);
    expect(closed).toBe((0 + 1412) / 2);
  });
  it('the details panel pushes the column on a wide window and overlays it on a narrow one', () => {
    const wide = solveLayout({ ...base, right: 'open' });
    expect(wide.rightMode).toBe('push');
    expect(wide.rightPush).toBe(340);
    const mid = solveLayout({ ...base, W: 1000, right: 'open' });
    expect(mid.rightMode).toBe('overlay');
    expect(mid.rightPush).toBe(28);
  });
  it('the details pane is the window\'s in both tabs: a bot\'s details push the Bots view as a session\'s push the Session view (board 11)', () => {
    const s = solveLayout({ ...base, tab: 'bots', right: 'open' });
    expect(s.rightVW).toBe(340);
    expect(s.viewRight).toBe(1440 - 340);
    /* closed, v7 keeps no strip (shell.css sets --right-rail-w to 0) */
    const closed = solveLayout({ ...base, tab: 'bots', rr: 0 });
    expect(closed.rightVW).toBe(0);
    expect(closed.viewRight).toBe(1440);
  });
  it('an inset (the bot settings sheet) moves the centre away from it', () => {
    const plain = solveLayout({ ...base, tab: 'bots' }).centerX;
    expect(solveLayout({ ...base, tab: 'bots', inset: { left: 0, right: 340 } }).centerX).toBe(plain - 170);
  });
  it('the column never outgrows the room, and the margin folds away on a narrow column', () => {
    expect(solveLayout({ ...base, W: 700, left: 'closed' }).colWidth).toBe(700 - 28 - 48);   /* the boards' thread: max-width calc(100% - 48px) */
    expect(solveLayout(base).marginW).toBe(112);
    expect(solveLayout({ ...base, W: 700, left: 'closed' }).marginW).toBe(112);
    expect(solveLayout({ ...base, W: 600, left: 'closed' }).marginW).toBe(0);
  });
  it('breakpoints: phone under 640, narrow under 900, wide from 1200', () => {
    expect(solveLayout({ ...base, W: 600 }).bp).toBe('phone');
    expect(solveLayout({ ...base, W: 800 }).bp).toBe('narrow');
    expect(solveLayout({ ...base, W: 1000 }).bp).toBe('mid');
    expect(solveLayout({ ...base, W: 1200 }).bp).toBe('wide');
  });
  it('an open sidebar overlays on a narrow window and leaves the rail in place', () => {
    const s = solveLayout({ ...base, W: 800 });
    expect(s.leftMode).toBe('overlay');
    expect(s.leftPush).toBe(56);
  });
  it('the dock keeps its height free above the window edge, and none when it is off', () => {
    expect(solveLayout(base).dockSpace).toBe(72);
    expect(solveLayout({ ...base, dockHeight: 180 }).dockSpace).toBe(180);
    expect(solveLayout({ ...base, dock: 'off', dockHeight: 180 }).dockSpace).toBe(0);
    expect(solveLayout({ ...base, dockHeight: 0 }).dockSpace).toBe(0);   // an empty dock (nothing in it) keeps no room; unknown keeps the default
    expect(solveLayout({ ...base, dockHeight: null }).dockSpace).toBe(72);
  });
});
