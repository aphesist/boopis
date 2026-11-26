import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetBus, on } from './bus';
import { setMounting, setState, state, toggle } from './state';

afterEach(() => { resetBus(); setMounting(false); setState({ tab: 'session', left: 'open', right: 'closed', dock: 'on', orbGrow: true, dockCentred: false, dockCompact: false }); });

describe('setState', () => {
  it('applies valid values, persists, and announces what changed', () => {
    const seen: string[][] = [];
    on('hx:state', (d) => seen.push([...d.changed]));
    setState({ left: 'rail', right: 'open' });
    expect(state.left).toBe('rail');
    expect(state.right).toBe('open');
    expect(seen).toEqual([['left', 'right']]);
    expect(JSON.parse(localStorage.getItem('hx.v6.shell') ?? '{}')).toMatchObject({ v: 1, left: 'rail', right: 'open' });
  });
  it('keeps the dock centred in the window as an owner setting: off by default, announced, and stored with the dock\'s others', () => {
    expect(state.dockCentred).toBe(false);
    const seen: string[][] = [];
    on('hx:state', (d) => seen.push([...d.changed]));
    setState({ dockCentred: true });
    expect(state.dockCentred).toBe(true);
    expect(seen).toEqual([['dockCentred']]);
    expect(JSON.parse(localStorage.getItem('hx.v6.shell') ?? '{}')).toMatchObject({ v: 1, dock: 'on', dockCentred: true });
  });
  it('ignores values it does not know, and changes that change nothing', () => {
    const fn = vi.fn();
    on('hx:state', fn);
    setState({ left: 'sideways', tab: 'nope', dock: '' });
    setState({ left: state.left });
    expect(fn).not.toHaveBeenCalled();
  });
  it('emits hx:tab with the new tab', () => {
    const tabs: string[] = [];
    on('hx:tab', (d) => tabs.push(d.tab));
    setState({ tab: 'bots' });
    expect(tabs).toEqual(['bots']);
  });
  it('while modules mount, the initial tab stays the shell\'s decision', () => {
    setMounting(true);
    setState({ tab: 'bots' });
    expect(state.tab).toBe('session');
    setMounting(false);
    setState({ tab: 'bots' });
    expect(state.tab).toBe('bots');
  });
  it('runs the hooks around the event: apply before it, after once it went out', () => {
    const order: string[] = [];
    on('hx:state', () => order.push('event'));
    setState({ orbGrow: false });
    expect(state.orbGrow).toBe(false);
    expect(order).toEqual(['event']);
  });
  it('toggle flips left (open <-> the collapse mode), right, dock and tab', () => {
    toggle('left'); expect(state.left).toBe('rail'); toggle('left'); expect(state.left).toBe('open');
    toggle('right'); expect(state.right).toBe('open');
    toggle('dock'); expect(state.dock).toBe('off');
    toggle('tab'); expect(state.tab).toBe('bots');
  });
});
