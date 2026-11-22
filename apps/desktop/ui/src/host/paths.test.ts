import { describe, expect, it, vi } from 'vitest';
import { hostPaths } from './paths';
import type { PathCommands } from './paths';

const cmds = (o: Partial<PathCommands> = {}): PathCommands => ({
  resolve: vi.fn(() => Promise.resolve([{ path: 'a.md', abs: '/w/a.md', kind: 'file', rel: 'a.md' }, null, { path: 'x', abs: '/x', kind: 'socket', rel: null }])),
  open: vi.fn(() => Promise.resolve(null)), reveal: vi.fn(() => Promise.resolve(null)), editors: vi.fn(() => Promise.resolve([{ id: 'zed', name: 'Zed' }])), ...o
});

describe('host paths', () => {
  it('asks the host and keeps only files and folders', async () => {
    const c = cmds();
    const got = await hostPaths(c).resolve(['a.md', 'b.md', 'x'], ['/w', '']);
    expect(c.resolve).toHaveBeenCalledWith(['a.md', 'b.md', 'x'], ['/w']);
    expect(got).toEqual([{ path: 'a.md', abs: '/w/a.md', kind: 'file', rel: 'a.md' }, null, null]);
  });
  it('asks nothing for no paths', async () => {
    const c = cmds();
    expect(await hostPaths(c).resolve([], ['/w'])).toEqual([]);
    expect(c.resolve).not.toHaveBeenCalled();
  });
  it('opens, reveals, and reads the editors once', async () => {
    const c = cmds();
    const p = hostPaths(c);
    await p.open('/w/a.md'); await p.open('/w/a.md', 'zed'); await p.reveal('/w/a.md');
    expect(c.open).toHaveBeenNthCalledWith(1, '/w/a.md', null);
    expect(c.open).toHaveBeenNthCalledWith(2, '/w/a.md', 'zed');
    expect(c.reveal).toHaveBeenCalledWith('/w/a.md');
    await p.editors(); await p.editors();
    expect(c.editors).toHaveBeenCalledTimes(1);
  });
  it('says the host\'s refusal in its words', async () => {
    const c = cmds({ open: () => Promise.reject({ code: 'hx.invalid_params', message: 'boopis does not run programs from a message' }) });
    await expect(hostPaths(c).open('/w/run.sh')).rejects.toThrow('boopis does not run programs');
  });
});
