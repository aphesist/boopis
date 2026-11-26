// @vitest-environment jsdom
/* The tasks handed to other models on the kit (REPASS.md 6e): a ToolRow each, its word, Stop only while it runs, the transcript. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildTask, Turn } from '../../data';
import { childRow, childWord, childrenBlock, resetChildren, transcriptHTML } from './children';
import type { ChildHost } from './children';

const NOW = 1_000_000;
const task = (o: Partial<ChildTask>): ChildTask => ({ id: 't1', subagentId: 'sa', childSession: 'cs', index: 0, goal: 'Review the diff', model: 'claude-opus-5-5', status: 'running', startedAt: NOW - 12_000, seconds: null, tools: 1, now: '', summary: '', ...o });
const host = (o: Partial<ChildHost> = {}): ChildHost => ({ col: () => document.body, now: () => NOW, stop: vi.fn(), transcript: vi.fn(() => Promise.resolve([] as Turn[])), ...o });
beforeEach(() => { document.body.replaceChildren(); resetChildren(); });

describe('a task\'s word', () => {
  it('queued, running with its clock, done with its time, error, stopped', () => {
    expect(childWord(task({ status: 'queued', startedAt: null }), NOW).text).toBe('queued');
    expect(childWord(task({}), NOW).text).toBe('running 12s');
    expect(childWord(task({ status: 'done', seconds: 64 }), NOW).text).toBe('done 1m 04s');
    expect(childWord(task({ status: 'failed' }), NOW)).toEqual({ text: 'error', tone: 'red' });
    expect(childWord(task({ status: 'stopped' }), NOW).text).toBe('stopped');
  });
});

describe('a task\'s row', () => {
  it('its model and task, Stop only while it runs, the transcript when it has a session', () => {
    const r = childRow(task({}), host());
    expect(r.target).toBe('Review the diff');
    expect(r.end).toContain('data-action="stop"');
    expect(r.after).toContain('Transcript');
    expect(childRow(task({ status: 'done', seconds: 3, summary: 'Two errors' }), host())).toMatchObject({ note: 'Two errors' });
    expect(childRow(task({ status: 'done' }), host()).end).toBeUndefined();
    expect(childRow(task({ childSession: '' }), host()).after).toBeUndefined();
    expect(childRow(task({}), host({ stop: undefined })).end).toBeUndefined();
  });
  it('an error says why in its Tooltip', () => {
    expect(childRow(task({ status: 'failed', summary: 'timed out' }), host()).wordTip).toBe('timed out');
  });
});

describe('the rows in a turn', () => {
  it('Stop stops it, once', () => {
    const h = host();
    document.body.append(childrenBlock([task({})], h));
    const b = document.querySelector<HTMLElement>('[data-action="stop"]') as HTMLElement;
    b.click(); b.click();
    expect(h.stop).toHaveBeenCalledOnce();
    expect(b.getAttribute('aria-disabled')).toBe('true');
  });
  it('opening the transcript reads it into the Well', async () => {
    const turns: Turn[] = [{ id: 'u', role: 'user', at: '', text: 'Do it' }];
    const h = host({ transcript: vi.fn(() => Promise.resolve(turns)) });
    document.body.append(childrenBlock([task({})], h));
    document.querySelector<HTMLElement>('.k7-disc__sum')?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.transcript).toHaveBeenCalledWith('t1');
    expect(document.querySelector('.k7-well__thread [data-role="user"]')?.textContent).toBe('Do it');
  });
  it('a transcript says what it did, and when it wrote nothing', () => {
    expect(transcriptHTML([])).toContain('It has not written anything yet.');
  });
});
