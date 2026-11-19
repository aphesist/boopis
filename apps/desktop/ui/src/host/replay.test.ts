import { describe, expect, it } from 'vitest';
import { rebaseClock } from './replay';
import type { RecordedFrame } from './replay';

const frame = (params: Record<string, unknown>): RecordedFrame => ({ dir: 'in', frame: { jsonrpc: '2.0', method: 'event', params } });

describe('rebaseClock', () => {
  const recorded = [
    frame({ ts: '2026-11-19T01:35:43.751Z', payload: { session: { started_at: 1_763_516_143, last_active_at: 1_763_516_200 } } }),
    frame({ ts: '2026-11-19T01:35:44.383Z', payload: { expires_at: '2026-11-19T02:35:44.382Z', usage: { input_tokens: 1_900_000_000 } } }),
    frame({ ts: '2026-11-19T01:35:45.000Z', payload: { checked_at: 1_763_516_145_000 } })
  ];
  const now = Date.parse('2027-03-01T12:00:00.000Z');
  const out = rebaseClock(recorded, now);
  const params = (i: number) => out[i]!.frame['params'] as Record<string, any>;

  it('moves the recording to start now', () => {
    const first = Math.min(Date.parse('2026-11-19T01:35:43.751Z'), 1_763_516_143 * 1000, 1_763_516_145_000);
    const shift = now - first;
    expect(Date.parse(params(1)['payload']['expires_at'])).toBe(Date.parse('2026-11-19T02:35:44.382Z') + shift);
    expect(params(0)['payload']['session']['started_at']).toBe(1_763_516_143 + shift / 1000);
    expect(params(2)['payload']['checked_at']).toBe(1_763_516_145_000 + shift);
  });

  it('keeps every interval as recorded: a form that expired an hour after it was raised still does', () => {
    const raised = Date.parse(params(1)['ts']);
    expect(Date.parse(params(1)['payload']['expires_at']) - raised).toBe(Date.parse('2026-11-19T02:35:44.382Z') - Date.parse('2026-11-19T01:35:44.383Z'));
    expect(Date.parse(params(1)['payload']['expires_at'])).toBeGreaterThan(now);
  });

  it('leaves numbers that are not times alone, and never mutates the recording', () => {
    expect(params(1)['payload']['usage']['input_tokens']).toBe(1_900_000_000);
    expect((recorded[1]!.frame['params'] as Record<string, any>)['payload']['expires_at']).toBe('2026-11-19T02:35:44.382Z');
  });
});
