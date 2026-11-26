/* What a session's turn holds, as the kit's parts read it (boards S09, S20, S23): the work line, the tool row a change waits on and
   what becomes of it, an approval, the foot's actions (each only where it exists), the status line. */
import { describe, expect, it } from 'vitest';
import type { AgentTurn, FormSpec, Step } from '../../data';
import { workSummary } from '../../data/tool-words';
import { approvalCard, askShape, footOf, lapsedCard, statusOf, stepRows, toolAnswers, toolRow, workLine } from './turn';

const tools = (name: string, n: number): Step[] => Array.from({ length: n }, () => ({ title: name, mono: true, time: '' }));
const turn = (o: Partial<AgentTurn> = {}): AgentTurn => ({ id: 't', role: 'assistant', model: 'sonnet 5.5', time: '', cost: '', stepCount: 0, steps: [], paragraphs: [], bullets: [], status: 'running', ...o });
const EDIT: FormSpec = {
  id: 'f1', kind: 'permission', title: 'Allow this change?', file: 'modules/dock/dock.css', diff: '+a\n+b\n-c',
  schema: { properties: { choice: { type: 'string', enum: ['once', 'session', 'always', 'deny'] } } }
};
const COMMAND: FormSpec = { id: 'f2', kind: 'permission', title: 'Allow this command?', why: 'Runs the tests\nnpm test', schema: { properties: { choice: { type: 'string', enum: ['once', 'deny'] } } } };
const SHIP: FormSpec = { id: 'f3', kind: 'approval', title: 'Write 2 files to the workspace?', why: 'Then the gate runs the tests.', schema: { properties: {} }, submit: { label: 'Hold to approve', hold: true } };
const NONE = { checkpoint: 0, undo: null, edit: false, fork: false };

describe('the work line', () => {
  it('counts what the steps did, by kind, in the order they first happened', () => {
    expect(workSummary([...tools('read_file', 6), ...tools('search_files', 2)])).toBe('Read 6 files, searched 2 patterns');
    expect(workSummary([...tools('patch', 1), ...tools('terminal', 1)])).toBe('Changed 1 file, ran 1 command');
    expect(workSummary([...tools('terminal', 2), ...tools('mcp__github__create_issue', 1)])).toBe('Ran 2 commands, 1 other step');
  });
  it('says steps that are not tool calls as a count, and none of what it does not know', () => {
    expect(workSummary([{ title: 'Read src/billing' }, { title: 'Edited 3 files' }])).toBe('2 steps');
    expect(workSummary([], 6)).toBe('6 steps');
  });
  it('is the plain count while the turn runs, and "Worked for ..." once it ended', () => {
    const steps = [...tools('patch', 2), ...tools('terminal', 1)];
    expect(workLine(turn({ steps }))).toBe('Changed 2 files, ran 1 command');
    expect(workLine(turn({ steps, status: 'done', time: '0m 59s' }))).toBe('Worked for 59s: changed 2 files, ran 1 command');
    expect(workLine(turn({ steps, status: 'stopped', time: '3m 02s' }))).toBe('Stopped after 3m 02s: changed 2 files, ran 1 command');
  });
  it('draws the step being done now, a failure and an escalation', () => {
    const rows = stepRows(turn({ steps: [{ title: 'read_file', mono: true, meta: ['a.ts'], time: '0:02' }, { title: 'npm test failed', kind: 'fail', time: '' }, { title: 'sonnet 5.5', kind: 'escalate', time: '' }] }));
    expect(rows.map((r) => r.state)).toEqual(['log', 'failed', 'now']);
    expect([rows[0]?.text, rows[0]?.icon, rows[0]?.time]).toEqual(['Read a.ts', 'session', '0:02']);
    expect(rows[2]?.icon).toBe('ladder');
  });
  it('a tool call that failed keeps its words: one row, "Ran pnpm test dock", with "failed" and its time', () => {
    const steps = [{ title: 'patch', mono: true, meta: ['modules/dock/dock.css'], time: '' }, { title: 'terminal', mono: true, meta: ['pnpm test dock'], time: '' }, { title: 'terminal', mono: true, meta: ['pnpm test dock'], kind: 'fail' as const, time: '3s' }];
    expect(stepRows(turn({ steps, status: 'done' }))).toEqual([
      { text: 'Changed dock.css', state: 'log', icon: 'pen' },
      { text: 'Ran pnpm test dock', state: 'log', icon: 'terminal', word: 'failed', time: '3s' }]);
    /* the failure is the command already counted, never another step, and never the tool's raw name */
    expect(workLine(turn({ steps, status: 'done', time: '0m 9s' }))).toBe('Worked for 9s: changed 1 file, ran 1 command');
    /* a failure with no call before it (a transcript read back) is its own row, in the same words */
    expect(stepRows(turn({ steps: [steps[2] as (typeof steps)[2]], status: 'done' }))[0]).toEqual({ text: 'Ran pnpm test dock', state: 'log', icon: 'terminal', word: 'failed', time: '3s' });
  });
  it('writes the open work line as board S10 does: reads that follow one another are one row, each change and each command its own, led by its kind\'s glyph', () => {
    const step = (title: string, what?: string): Step => ({ title, mono: true, ...(what ? { meta: [what] } : {}), time: '' });
    const rows = stepRows(turn({ status: 'done', steps: [...Array.from({ length: 6 }, (_, i) => step('read_file', 'src/f' + i + '.ts')), step('patch', 'modules/dock/dock.css'), step('patch', 'modules/dock/engine.ts'), step('terminal', 'pnpm test dock')] }),
      (p) => (p.endsWith('dock.css') ? [12, 3] : p.endsWith('engine.ts') ? [2, 2] : null));
    expect(rows.map((r) => [r.icon, r.text])).toEqual([['session', 'Read 6 files'], ['pen', 'Changed dock.css, +12 −3'], ['pen', 'Changed engine.ts, +2 −2'], ['terminal', 'Ran pnpm test dock']]);
    expect(rows.every((r) => r.state === 'log')).toBe(true);
  });
  it('a change whose lines are not known says its file alone; a tool with no word of its own says what it is doing; the running step is the one being done', () => {
    const rows = stepRows(turn({ status: 'running', steps: [{ title: 'patch', mono: true, meta: ['a/b.ts'], time: '' }, { title: 'web_search', mono: true, meta: ['webkit clip'], time: '' }, { title: 'cronjob', mono: true, time: '' }, { title: 'read_file', mono: true, meta: ['x.ts'], time: '' }] }));
    expect(rows.map((r) => [r.state, r.text])).toEqual([['log', 'Changed b.ts'], ['log', 'Searched for webkit clip'], ['log', 'Scheduling'], ['now', 'Read x.ts']]);
  });
});

describe('what waits on you', () => {
  it('a change or a command that asks to run sits on its tool row; a step with no fields is an approval; the rest is the form card', () => {
    expect(askShape(EDIT)).toBe('tool');
    expect(askShape(SHIP)).toBe('approval');
    expect(askShape({ id: 'x', kind: 'credential', title: 'A key', schema: { properties: { key: { type: 'string' } } } })).toBe('card');
    expect(askShape({ ...SHIP, schema: { properties: { note: { type: 'string' } } } })).toBe('card');
  });
  it('offers Deny first (the app\'s one word, with esc), the grants the engine offers, then the hold', () => {
    expect(toolAnswers(EDIT).map((a) => a.label)).toEqual(['Deny', 'Always allow this session', 'Always allow', 'Hold to allow once']);
    expect(toolAnswers(EDIT)[0]).toMatchObject({ value: 'deny', keys: 'esc', outline: true });
    expect(toolAnswers(EDIT).at(-1)).toMatchObject({ value: 'once', hold: true, primary: true });
    /* an answer the engine does not offer is not shown */
    expect(toolAnswers(COMMAND).map((a) => a.label)).toEqual(['Deny', 'Hold to allow once']);
  });
  it('an edit\'s row names the file and counts its lines; a command\'s names the command', () => {
    expect(toolRow(EDIT, 'sonnet 5.5')).toMatchObject({ kind: 'edit', tool: 'modules/dock/dock.css', add: 2, del: 1, state: 'waiting', model: 'sonnet 5.5' });
    expect(toolRow(COMMAND, '')).toMatchObject({ kind: 'command', tool: 'npm test', state: 'waiting' });
    expect(toolRow(COMMAND, '').model).toBeUndefined();
  });
  it('says what became of it at the row\'s end, with a decline\'s feedback quoted', () => {
    expect(toolRow(EDIT, '', { status: 'submitted', choice: 'once', at: '09:43' })).toMatchObject({ state: 'done', word: 'Allowed once 09:43' });
    expect(toolRow(EDIT, '', { status: 'submitted', choice: 'session', at: '09:43' }).word).toBe('Allowed for this session 09:43');
    expect(toolRow(EDIT, '', { status: 'cancelled', at: '09:44', note: 'Keep the transform' })).toMatchObject({ word: 'Denied 09:44', note: 'Keep the transform' });
    expect(toolRow({ ...EDIT, resolved: 'submitted' }, '').ask).toBeUndefined();
  });
  it('an approval is the hold and Deny; answered it is its receipt; lapsed it has no answers', () => {
    const open = approvalCard(SHIP, 'sonnet 5.5');
    expect(open).toMatchObject({ variant: 'standalone', state: 'needs', ask: 'Write 2 files to the workspace?', sub: 'Then the gate runs the tests.' });
    expect(open.answers?.map((a) => a.label)).toEqual(['Hold to approve', 'Deny']);
    expect(approvalCard(SHIP, '', { status: 'submitted', at: '10:00' })).toMatchObject({ state: 'answered', receipt: 'approved 10:00' });
    expect(approvalCard(SHIP, '', { status: 'expired' })).toMatchObject({ state: 'lapsed', answers: [] });
    expect(lapsedCard(EDIT, '')).toMatchObject({ state: 'lapsed', sub: 'modules/dock/dock.css', answers: [] });
  });
});

describe('the foot and the status line', () => {
  it('has no foot while the turn runs', () => { expect(footOf(turn(), NONE)).toBeNull(); });
  it('shows an action only where it exists: no Undo without a checkpoint, no Edit or Fork until they are built', () => {
    const done = turn({ status: 'done', time: '0m 59s', cost: '$0.08' });
    expect(footOf(done, NONE)).toMatchObject({ kind: 'session', modelName: 'sonnet 5.5', time: '0m 59s', cost: '$0.08', actions: [] });
    expect(footOf(done, NONE)?.label).toBeUndefined();
    const all = footOf(done, { checkpoint: 3, undo: { ok: true }, edit: true, fork: true });
    expect(all?.label).toBe('Checkpoint 3');
    expect(all?.actions?.map((a) => a.label)).toEqual(['Undo', 'Edit from here', 'Fork']);
  });
  it('an Undo that cannot run is disabled and says why', () => {
    const f = footOf(turn({ status: 'done' }), { checkpoint: 1, undo: { ok: false, why: 'Rewind needs a worktree.' }, edit: false, fork: false });
    expect(f?.actions?.[0]).toMatchObject({ label: 'Undo', disabled: true, tip: 'Rewind needs a worktree.' });
  });
  it('says the route, why Smart picked it, and a turn that ran outside governed mode; an unknown model is said as unknown', () => {
    expect(footOf(turn({ status: 'done', model: 'qwen3-coder → sonnet 5.5', why: 'debugging', ungoverned: true }), NONE)).toMatchObject({ modelName: 'qwen3 coder → sonnet 5.5', note: 'debugging', badge: 'ungoverned' });
    expect(footOf(turn({ status: 'done', model: '' }), NONE)).toMatchObject({ modelName: 'Model unknown' });
    expect(footOf(turn({ status: 'done', model: '' }), NONE)?.model).toBeUndefined();
  });
  it('the status line waits at rest while a change waits, sweeps while the turn works, and is gone once it ended', () => {
    expect(statusOf(turn(), true)).toEqual({ phrase: 'Waiting for your approval', working: false });
    expect(statusOf(turn({ steps: tools('read_file', 1) }), false)).toEqual({ phrase: 'Reading a file', working: true });
    expect(statusOf(turn(), false)).toEqual({ phrase: 'Working', working: true });
    expect(statusOf(turn({ status: 'done' }), true)).toBeNull();
  });
});
