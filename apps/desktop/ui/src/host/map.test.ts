import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '../vendor/hermes-shared/gateway-contract.generated';
import type { AgentTurn, UserTurn } from '../data/types';
import { bookFrom } from './live/attribution';
import { approvalToWait, choiceFor, elapsed, failedStep, paragraphs, reduceLedger, sessionRowToSummary, toolStep, transcriptToTurns, whenLabel } from './map';
import { recorded } from './testing';

const NOW = new Date(2026, 10, 18, 15, 30, 0);
const secs = (d: Date): number => d.getTime() / 1000;

describe('the session list', () => {
  it('labels how long ago a session started', () => {
    const ago = (ms: number): string => whenLabel(secs(new Date(NOW.getTime() - ms)), NOW);
    expect(ago(20_000)).toBe('now');
    expect(ago(5 * 60_000)).toBe('5m');
    expect(ago(2 * 3_600_000)).toBe('2h');
    expect(whenLabel(secs(new Date(2026, 10, 17, 9, 0)), NOW)).toBe('yesterday');
    expect(whenLabel(secs(new Date(2026, 10, 14, 9, 0)), NOW)).toBe('sat');
    expect(whenLabel(secs(new Date(2026, 9, 1, 9, 0)), NOW)).toBe('01/10');
    expect(whenLabel(undefined, NOW)).toBe('');
  });

  it('shows what the gateway sends and nothing it does not', () => {
    const s = sessionRowToSummary({ id: 'local-1', title: '', preview: 'refactor the proration helpers', started_at: secs(NOW) - 120 }, NOW);
    expect(s).toEqual({ id: 'local-1', project: '', title: 'refactor the proration helpers', when: '2m' });
    expect(sessionRowToSummary({ id: 'x', title: 'Named' }, NOW).title).toBe('Named');
    /* R-copy-9: the gateway titles a session from its first line, which can be a tool call; that never reaches the interface */
    expect(sessionRowToSummary({ id: 'x', title: '@@call todo_list {"todos": [{"id": "1"…', preview: 'round once per invoice' }, NOW).title).toBe('round once per invoice');
    expect(sessionRowToSummary({ id: 'x', title: '{"todos": []}', preview: '' }, NOW).title).toBe('Untitled session');
  });
});

describe('the answer text', () => {
  it('splits on blank lines', () => {
    expect(paragraphs('one\n\n\ntwo\nstill two\n\n  ')).toEqual(['one', 'two\nstill two']);
    expect(paragraphs(null)).toEqual([]);
    expect(elapsed(3400)).toBe('3s');
    expect(elapsed(72_000)).toBe('1m 12s');
  });
});

describe('tool calls, from recorded frames', () => {
  const events = recorded.turn.filter((f) => f['method'] === 'event').map((f) => f['params'] as { type: string; payload: Record<string, unknown> });
  it('a tool.start is a step named for the tool, with its context', () => {
    const start = events.find((e) => e.type === 'tool.start');
    expect(start).toBeDefined();
    expect(toolStep(start?.payload)).toEqual({ title: 'hx_echo', mono: true, meta: ['plain-echo'], time: '' });
  });
  it('a failed tool.complete is a fail step with its duration', () => {
    const step = failedStep({ name: 'terminal', context: 'pnpm test dock', is_error: true, duration_s: 0.125 });
    expect(step).toEqual({ title: 'terminal', mono: true, meta: ['pnpm test dock'], kind: 'fail', time: '0s' });
  });
});

describe('the stored transcript', () => {
  const rows: TranscriptMessage[] = [
    { role: 'user', text: 'rename the helper', timestamp: secs(new Date(2026, 10, 18, 9, 5)) },
    { role: 'assistant', text: 'Looking.' },
    { role: 'tool', name: 'grep', context: 'prorate' },
    { role: 'assistant', text: 'Done.\n\nTests pass.' },
    { role: 'user', text: 'thanks' }
  ];
  it('is a user turn, then one finished agent turn made of everything until the next user message', () => {
    const turns = transcriptToTurns(rows, 's:');
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
    expect((turns[0] as UserTurn).at).toBe('09:05');
    const a = turns[1] as AgentTurn;
    expect(a.status).toBe('done');
    expect(a.steps).toEqual([{ title: 'grep', mono: true, meta: ['prorate'], time: '' }]);
    expect(a.paragraphs).toEqual(['Looking.', 'Done.', 'Tests pass.']);
    expect(a.model).toBe('');   /* nothing recorded who answered: unknown, not the session's current model */
    expect(a.cost).toBe('');
    expect(new Set(turns.map((t) => t.id)).size).toBe(3);
  });
  it('an empty transcript is no turns', () => { expect(transcriptToTurns([], 's:')).toEqual([]); });
});

describe('approvals, from recorded frames', () => {
  const request = recorded.approval.find((r) => (r.frame['params'] as { type?: string } | undefined)?.type === 'approval.request')?.frame['params'] as Parameters<typeof approvalToWait>[0];
  it('an approval.request is a wait the dock shows', () => {
    const w = approvalToWait(request);
    expect(w?.kind).toBe('approval');
    expect(w?.id).toBe((request.payload as { prompt_id: string }).prompt_id);
    expect(w?.title).toBe('chmod -R 777 /tmp/hx_spike_nonexistent_dir');
    expect(w?.data.meta).toBe('world/other-writable permissions');
    expect(w?.who).toBe('agent');
  });
  it('has no wait without a prompt id', () => { expect(approvalToWait({ type: 'approval.request', payload: {} })).toBeNull(); });
  it('approved is "once"; everything else denies', () => {
    expect(choiceFor('approved')).toBe('once');
    expect(choiceFor('denied')).toBe('deny');
    expect(choiceFor('anything else')).toBe('deny');
  });
});

describe('the ledger', () => {
  it('sums tokens and counts round trips from usage.recorded; other events add nothing', () => {
    // A synthetic envelope: no recorded ledger frame exists yet (the plugin's stream is another workstream).
    let t = { tokens: 0, trips: 0 };
    t = reduceLedger(t, { type: 'usage.recorded', payload: { model: 'm', input_tokens: 100, output_tokens: 10, cache_read_tokens: 5, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 } });
    t = reduceLedger(t, { type: 'gate.decided', payload: {} });
    t = reduceLedger(t, { type: 'usage.recorded', payload: { input_tokens: 1, output_tokens: 1 } });
    expect(t).toEqual({ tokens: 117, trips: 2 });
  });
});

describe('transcriptToTurns: who answered each turn', () => {
  const P = 'claude-subscription-directsdk-experimental';
  const rows: TranscriptMessage[] = [
    { role: 'user', row_id: 1, text: 'one' }, { role: 'assistant', row_id: 2, text: 'A' },
    { role: 'user', row_id: 3, text: '[Model switched to gpt-6-luna via provider openai-codex. From this point forward ...]', display_kind: 'model_switch' },
    { role: 'user', row_id: 4, text: 'two' }, { role: 'tool', row_id: 5, name: 'pack' }, { role: 'assistant', row_id: 6, text: 'B' },
    { role: 'user', row_id: 7, text: 'three' }, { role: 'assistant', row_id: 8, text: 'C' },
    { role: 'user', row_id: 9, text: 'four' }, { role: 'assistant', row_id: 10, text: 'D' }
  ];
  const book = bookFrom({ turns: [
    { model: P + '/haiku', route: [], ungoverned: false, user_row_id: 1, row_ids: [1, 2] },
    { model: 'openai-codex/gpt-6-luna', route: [], ungoverned: true, user_row_id: 4, row_ids: [4, 5, 6] },
    { model: P + '/orch', route: [P + '/haiku', P + '/sonnet'], ungoverned: false, user_row_id: 7, row_ids: [7, 8] }
  ] });
  const agents = (): AgentTurn[] => transcriptToTurns(rows, 's:', book).filter((t): t is AgentTurn => t.role === 'assistant');
  it('each past turn has its own recorded model; a governed turn keeps its tier route', () => {
    const [a, b, c] = agents();
    expect(a?.model).toBe(P + '/haiku');
    expect(b?.model).toBe('openai-codex/gpt-6-luna');
    expect(c?.model).toBe(P + '/haiku → ' + P + '/sonnet');
  });
  it('a turn with no record is unknown, and the ungoverned one says so', () => {
    const t = agents();
    expect(t[3]?.model).toBe('');
    expect(t.map((x) => x.ungoverned === true)).toEqual([false, true, false, false]);
  });
  it('the engine\'s own "[Model switched to ...]" row is not a turn', () => {
    const turns = transcriptToTurns(rows, 's:', book);
    expect(turns.filter((t) => t.role === 'user').map((t) => (t as UserTurn).text)).toEqual(['one', 'two', 'three', 'four']);
  });
  it('a book that is not a list, or has no models, is empty', () => {
    expect(bookFrom(null).size).toBe(0);
    expect(bookFrom({ turns: [{ model: '', row_ids: [1] }, { row_ids: 'x' }] }).size).toBe(0);
  });
});
