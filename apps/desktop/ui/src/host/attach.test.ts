import { describe, expect, it } from 'vitest';
import type { Attachment, FileDragEvent } from './bindings';
import { dropsFromHost, pickAttachments, toAttached, toDrag } from './attach';
import { refValue } from './live/attachments';

const A: Attachment = { path: '/home/u/a.txt', name: 'a.txt', kind: 'file', bytes: 12 };

describe('what the host hands over', () => {
  it('a pick becomes attachments with their paths; a cancelled dialog is nothing', async () => {
    expect(await pickAttachments('file', () => Promise.resolve([A, { path: '/home/u/src', name: 'src', kind: 'folder', bytes: null }]))).toEqual([
      { name: 'a.txt', kind: 'file', path: '/home/u/a.txt', bytes: 12 },
      { name: 'src', kind: 'folder', path: '/home/u/src' }
    ]);
    expect(await pickAttachments('folder', () => Promise.resolve([]))).toEqual([]);
  });
  it('a refused pick is a host error, not a silent nothing', async () => {
    await expect(pickAttachments('file', () => Promise.reject({ code: 'hx.host.os', message: 'no dialog' }))).rejects.toMatchObject({ code: 'hx.host.os' });
  });
  it('a drag reports its phase and place; a drop carries the files', () => {
    const e: FileDragEvent = { phase: 'drop', x: 10, y: 20, attachments: [A] };
    expect(toDrag(e)).toEqual({ phase: 'drop', x: 10, y: 20, attachments: [toAttached(A)] });
    expect(toDrag({ phase: 'weird', x: 0, y: 0, attachments: [] }).phase).toBe('leave');
  });
  it('listens once for all subscribers and stops with the last', async () => {
    let cb: (e: FileDragEvent) => void = () => undefined;
    let listening = 0, stopped = 0;
    const drops = dropsFromHost((f) => { listening++; cb = f; return Promise.resolve(() => { stopped++; }); });
    const seen: string[] = [];
    const off1 = drops.subscribe((d) => seen.push('1' + d.phase));
    const off2 = drops.subscribe((d) => seen.push('2' + d.phase));
    cb({ phase: 'over', x: 1, y: 1, attachments: [] });
    expect(seen).toEqual(['1over', '2over']);
    off1(); off2();
    await Promise.resolve(); await Promise.resolve();
    expect([listening, stopped]).toEqual([1, 1]);
  });
});

describe('a reference value', () => {
  it('is quoted the way the engine quotes it', () => {
    expect(refValue('/a/b.txt')).toBe('/a/b.txt');
    expect(refValue('/my dir/x')).toBe('`/my dir/x`');
    expect(refValue('/it`s (1)')).toBe('"/it`s (1)"');
  });
});
