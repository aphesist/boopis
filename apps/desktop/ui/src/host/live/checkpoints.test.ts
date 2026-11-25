/* A session's kept ships as the thread reads them (docs/specs/checkpoint-rewind.md section 8, acceptance test 15): which turn
   kept which ship, the rewinds as lines in order (an undo said as one), only the last change offering its undo; and the
   rewind's answer as the sheet reads it. */
import { describe, expect, it } from 'vitest';
import type { AgentTurn, Turn } from '../../data/types';
import { checkpointsFrom, headOf, keptByTurn, rewindLabel, rewindLines } from './checkpoints';
import { rewindFrom } from './session-controls';

const agent = (id: string, engineTurn: string, kept?: string[]): AgentTurn => ({ id, role: 'assistant', model: '', time: '', cost: '', stepCount: 0, steps: [], paragraphs: [], bullets: [], status: 'done', engineTurn, ...(kept ? { kept } : {}) });
const TURNS: Turn[] = [{ id: 'u1', role: 'user', at: '', text: 'a' }, agent('a1', 'T1'), { id: 'u2', role: 'user', at: '', text: 'b' }, agent('a2', 'T2')];
const ENTRIES = checkpointsFrom({ checkpoints: [
  { ship_id: 's1', kind: 'ship', turn_id: 'T1', files: ['a.ts'] },
  { ship_id: 's2', kind: 'ship', turn_id: 'T2', files: ['b.ts'] },
  { ship_id: 's3', kind: 'ship', turn_id: 'T2', files: ['a.ts', 'b.ts'] },
  { ship_id: 'r1', kind: 'rewind', turn_id: 'T2', rewind_to: 's1', files: ['a.ts', 'b.ts'] },
  { ship_id: 'r2', kind: 'rewind', turn_id: 'T2', rewind_to: 's3', files: ['a.ts', 'b.ts'] },
  { nope: true }
] });

describe('kept ships and rewinds from checkpoint.list', () => {
  it('maps kept ships to the turns that kept them, by the engine turn id', () => {
    expect([...keptByTurn(TURNS, ENTRIES)]).toEqual([['a1', ['s1']], ['a2', ['s2', 's3']]]);
  });
  it('makes one line per rewind, says an undo, and offers only the last change\'s undo', () => {
    const turns = TURNS.map((t) => (t.role === 'assistant' ? { ...t, kept: keptByTurn(TURNS, ENTRIES).get(t.id) } : t));
    const lines = rewindLines(turns, ENTRIES);
    expect(lines.map((l) => (l.kind === 'checkpoint' ? [l.action, l.to.label, l.files, l.undoShipId, l.afterTurn] : null))).toEqual([
      ['rewound', 'after turn 1', 2, null, 'a2'],
      ['undone', 'after turn 2', 2, 'r1', 'a2']
    ]);
  });
  it('names the base and a ship no turn here kept', () => {
    expect(rewindLabel(TURNS, null)).toBe('before this session\'s changes');
    expect(rewindLabel(TURNS, 'elsewhere')).toBe('after an earlier change');
  });
  it('the head is the last kept ship; nothing kept, none', () => {
    expect(headOf(ENTRIES)).toBe('r2');
    expect(headOf([])).toBeNull();
    expect(checkpointsFrom(null)).toEqual([]);
  });
});

describe('the rewind\'s answer', () => {
  it('is read as the sheet needs it', () => {
    expect(rewindFrom({ status: 'rewound', isolation: 'shared_unchanged', from_commit: 'h', to_commit: 't', files: [{ path: 'a', action: 'restore' }, { path: 'b', action: 'eat' }], rewind_ship_id: 'r', undo: { ship_id: 's3' } }))
      .toEqual({ status: 'rewound', isolation: 'shared_unchanged', fromCommit: 'h', toCommit: 't', files: [{ path: 'a', action: 'restore' }], rewindShipId: 'r', undo: { shipId: 's3' } });
  });
  it('a status it did not give is a refusal, never a success', () => {
    expect(rewindFrom(null)).toMatchObject({ status: 'refused', isolation: 'refused', why: 'The rewind was refused.' });
    expect(rewindFrom({ status: 'done?' }).status).toBe('refused');
  });
});
