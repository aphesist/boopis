/* What a session's turn says, as the options of the kit's parts (boards 10, S09, S20 and S23): the work line's words, the steps
   under it, the tool row a change or a command waits on, the approval a ship asks for, the turn's foot and the status line. Pure:
   the conversation (conversation.ts) builds the kit's components from these and wires them; the tests read them as data. */
import { modelMark } from '@boopis/ui';
import type { AskAnswer, AskCardOpts, StepOpts, ToolRowOpts, TurnFootOpts } from '@boopis/ui';
import { cap1 } from '../../core/dom';
import type { AgentTurn, FormSpec, FormStatus, Step, Todo } from '../../data';
import { toolWords, workKind, workSummary } from '../../data/tool-words';
import { UNGOVERNED_TIP, UNKNOWN_MODEL } from './attribution';

/* ───────── the work line ───────── */
/** "Read 6 files, ran 2 commands" while the turn works or waits; "Worked for 59s: changed 2 files, ran 1 command" once it ended
    ("Stopped after ..." when it was stopped) */
export function workLine(a: Pick<AgentTurn, 'steps' | 'stepCount' | 'status' | 'time'>): string {
  const what = workSummary(a.steps, a.stepCount);
  if (a.status === 'running') return what;
  const lead = a.status === 'stopped' ? 'Stopped after ' : 'Worked for ';
  /* a duration under a minute is said as its seconds ("Worked for 59s", where the foot's clock reads "0m 59s") */
  return a.time ? lead + a.time.replace(/^0m\s+/, '') + ': ' + what.charAt(0).toLowerCase() + what.slice(1) : what;
}
/** a file's own name, as a step says it ("Changed dock.css"): its path is in the changed files' card */
const baseName = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
/** a step as the kit's step row: a failure in red, a step that moved to a stronger model with the ladder, the one being done now; a
    step a provider says in words as it is. A tool call is a line of the work log as board S10 writes it, led by its kind's glyph:
    "Read dock.css", "Changed dock.css, +12 −3" (`counts`: the file's changed lines, where they are known), "Ran pnpm test dock" */
export function stepRow(s: Step, now = false, counts?: (path: string) => readonly [number, number] | null): StepOpts {
  const more = { ...(s.time ? { time: s.time } : {}) };
  if (s.kind === 'fail' && !s.mono) return { text: [s.title, ...(s.meta ?? [])].join('  '), state: 'failed', ...more };
  if (s.kind === 'escalate') return { text: [s.title, ...(s.meta ?? [])].join('  '), state: now ? 'now' : 'log', icon: 'ladder', ...more };   /* the ladder in the words' colour, as S10's glyphs are */
  const what = s.meta?.[0] ?? '', kind = s.mono ? workKind(s.title) : null;
  if (!s.mono) return { text: [s.title, ...(s.meta ?? [])].join('  '), state: now ? 'now' : 'done', ...more };
  const n = kind === 'changed' && what ? counts?.(what) ?? null : null;
  const text = kind === 'read' ? 'Read ' + (what ? baseName(what) : 'a file')
    : kind === 'searched' ? 'Searched' + (what ? ' for ' + what : '')
    : kind === 'changed' ? 'Changed ' + (what ? baseName(what) : 'a file') + (n ? ', +' + n[0] + ' −' + n[1] : '')
    : kind === 'ran' ? 'Ran ' + (what || 'a command')
    : cap1(toolWords(s.title)) + (what ? '  ' + what : '');
  /* a tool call that failed keeps its words and its glyph; the failure is the row's word, in red, before its time (S10's row) */
  return { text, state: now ? 'now' : 'log', icon: kind === 'changed' ? 'pen' : kind === 'ran' ? 'terminal' : 'session', ...(s.kind === 'fail' ? { word: 'failed' } : {}), ...more };
}
const sameCall = (a: Step, b: Step): boolean => a.title === b.title && (a.meta?.[0] ?? '') === (b.meta?.[0] ?? '');
/** the open work line's rows (board S10): reads that follow one another are one row ("Read 6 files"), as are searches; every change and
    every command has its own */
export function stepRows(a: Pick<AgentTurn, 'steps' | 'status'>, counts?: (path: string) => readonly [number, number] | null): StepOpts[] {
  const out: StepOpts[] = [];
  let run: { kind: 'read' | 'searched'; n: number; at: number } | null = null;
  a.steps.forEach((s, i) => {
    const now = a.status === 'running' && i === a.steps.length - 1;
    const kind = s.mono && !s.kind ? workKind(s.title) : null;
    /* a failure tells of the call just before it: one row, with the failure and its time */
    const prev = a.steps[i - 1];
    if (s.kind === 'fail' && s.mono && prev && !prev.kind && sameCall(prev, s) && !run && out.length) { out[out.length - 1] = stepRow(s, false, counts); return; }
    if ((kind === 'read' || kind === 'searched') && !now) {
      if (run && run.kind === kind) { run.n++; out[run.at] = { text: kind === 'read' ? 'Read ' + run.n + ' files' : 'Searched ' + run.n + ' patterns', state: 'log', icon: 'session' }; return; }
      run = { kind, n: 1, at: out.length };
    } else run = null;
    out.push(stepRow(s, now, counts));
  });
  return out;
}

/** the agent's own list of what it means to do, as the kit's card of steps (board 17: "Release 0.2.0, step 3 of 5"): what is done with
    its check, the one being done with its dot, the rest waiting. While the turn works the head says the step it is on; once it ended,
    how many were done (a task left "doing" when the turn ended is no longer being done: it waits) */
export function tasksCard(todos: readonly Todo[], running = true): ToolRowOpts {
  const doing = todos.findIndex((t) => t[1] === 'doing'), done = todos.filter((t) => t[1] === 'done').length;
  const at = doing >= 0 ? doing + 1 : Math.min(todos.length, done + 1);
  return {
    variant: 'bot', tool: 'Tasks', target: running ? 'step ' + at + ' of ' + todos.length : done + ' of ' + todos.length + ' done', state: running ? 'running' : 'done',
    steps: todos.map(([text, st]) => ({ text: cap1(text), state: st === 'done' ? 'done' : st === 'doing' && running ? 'now' : 'todo' })), attrs: { 'data-tasks': '' }
  };
}

/* ───────── what waits on the person ───────── */
/** how a form the turn raised is drawn: on a tool row (a change or a command asking to run, S09), as an approval (the AskCard with its
    hold and Deny), or as the form card (every other kind: fields, sign-ins, plans) */
export type AskShape = 'tool' | 'approval' | 'card';
const choiceOf = (f: FormSpec): { names: readonly string[] } | null => {
  const props = Object.entries(f.schema.properties ?? {});
  const only = props.length === 1 ? props[0] : undefined;
  const list = only?.[1].enum;
  return only && only[0] === 'choice' && list?.length ? { names: list.map(String) } : null;
};
export function askShape(f: FormSpec): AskShape {
  if (f.kind === 'permission' && choiceOf(f)) return 'tool';
  if (f.kind === 'approval' && !Object.keys(f.schema.properties ?? {}).length) return 'approval';
  return 'card';
}
/** the answers of a change waiting on its tool row, as S20 draws them: Deny (the app's one word for refusing, with esc), the wider
    grants the engine offers, then the hold that allows it once */
const GRANT: Readonly<Record<string, string>> = { session: 'Always allow this session', always: 'Always allow' };
export function toolAnswers(f: FormSpec): AskAnswer[] {
  const names = choiceOf(f)?.names ?? [];
  const out: AskAnswer[] = [{ label: 'Deny', value: 'deny', outline: true, keys: 'esc' }];
  for (const n of names) if (n !== 'once' && n !== 'deny') out.push({ label: GRANT[n] ?? cap1(n), value: n });
  if (names.includes('once')) out.push({ label: 'Hold to allow once', value: 'once', primary: true, hold: true });
  return out;
}
const count = (diff: string | undefined, sign: string): number => (diff ?? '').split('\n').filter((l) => l.startsWith(sign)).length;
/** what the answer is called afterwards, at the row's end: "Allowed once 09:43", "Denied 09:44" */
export const RECEIPT: Readonly<Record<string, string>> = { once: 'Allowed once', session: 'Allowed for this session', always: 'Always allowed', deny: 'Denied' };
export interface AskState { status?: FormStatus | undefined; choice?: string | undefined; at?: string | undefined; note?: string | undefined }
/** a change or a command that asked to run, as its tool row: waiting with its answers, or with what became of it */
export function toolRow(f: FormSpec, model: string, st: AskState = {}): ToolRowOpts {
  const edit = !!f.file;
  const command = (f.why ?? '').split('\n').filter(Boolean).pop() ?? '';
  const status = st.status ?? f.resolved;
  const word = status === 'cancelled' ? RECEIPT['deny'] : status === 'submitted' ? RECEIPT[st.choice ?? 'once'] ?? 'Allowed' : '';
  return {
    kind: edit ? 'edit' : 'command', tool: f.file ?? (command || f.title), ...(model ? { model } : {}),
    ...(edit && f.diff ? { add: count(f.diff, '+'), del: count(f.diff, '-') } : {}),
    ...(status ? { state: 'done', word: [word, st.at].filter(Boolean).join(' '), ...(st.note ? { note: st.note } : {}) } : { state: 'waiting', ask: { variant: 'attached', ask: f.title, answers: toolAnswers(f) } }),
    attrs: { 'data-form-id': f.id }
  };
}
/** a ship (or any step) that asks before it goes on, as the kit's approval: who asks, the ask, why, the hold and Deny */
export function approvalCard(f: FormSpec, model: string, st: AskState = {}): AskCardOpts {
  const status = st.status ?? f.resolved;
  const base = { ask: f.title, who: f.name ?? 'asked during the turn', ...(model ? { model } : {}), attrs: { 'data-form-id': f.id } };
  if (status === 'submitted' || status === 'cancelled') return { ...base, state: 'answered', receipt: [status === 'submitted' ? 'approved' : 'denied', st.at].filter(Boolean).join(' ') };
  if (status === 'expired') return { ...base, state: 'lapsed', ...(f.why ? { sub: f.why } : {}), answers: [] };
  return {
    ...base, variant: 'standalone', state: 'needs', ...(f.why ? { sub: f.why } : {}),
    answers: [{ label: f.submit?.label ?? 'Hold to approve', value: 'approve', primary: true, hold: f.submit?.hold !== false }, ...(f.cancel === false ? [] : [{ label: 'Deny', value: 'deny', keys: 'esc', outline: true }])]
  };
}
/** a change whose approval lapsed (300 s): it becomes the ask card, as a lapsed blank does (S09) */
export const lapsedCard = (f: FormSpec, model: string): AskCardOpts => ({ state: 'lapsed', ...(model ? { model } : {}), who: 'asked during the turn', ask: f.title, ...(f.file ? { sub: f.file } : f.why ? { sub: f.why } : {}), answers: [], attrs: { 'data-form-id': f.id } });
/** whether a form still waits for an answer */
export const isOpen = (f: FormSpec, st?: AskState): boolean => !(st?.status ?? f.resolved);

/* ───────── the foot and the status line ───────── */
const names = (model: string): string => modelMark.parse(model).map((m) => modelMark.short(m) || modelMark.called(m) || m).join(' → ');
/** what a finished turn's foot can do: each action only where it exists */
export interface FootCan { /** the checkpoint the turn left, counted over the session (0: it kept nothing) */ checkpoint: number; undo: { ok: boolean; why?: string } | null; edit: boolean; fork: boolean }
/** a finished turn's foot (board S23): "Checkpoint 3", Undo (the rewind), Edit from here and Fork where they exist, then who answered,
    how long it took and what it cost; none while the turn runs */
export function footOf(a: AgentTurn, can: FootCan): TurnFootOpts | null {
  if (a.status === 'running') return null;
  const last = modelMark.last(a.model);
  const note = [a.why, !a.steps.length && a.stepCount ? a.stepCount + (a.stepCount === 1 ? ' step' : ' steps') : ''].filter(Boolean).join(', ');
  return {
    kind: 'session', ...(last ? { model: last, modelName: names(a.model) } : { modelName: UNKNOWN_MODEL }), ...(note ? { note } : {}),
    ...(a.ungoverned ? { badge: 'ungoverned', badgeTip: UNGOVERNED_TIP } : {}), ...(a.time ? { time: a.time } : {}), ...(a.cost ? { cost: a.cost } : {}),
    ...(can.checkpoint ? { label: 'Checkpoint ' + can.checkpoint } : {}),
    actions: [
      ...(can.undo ? [{ label: 'Undo', value: 'undo', icon: 'back', ...(can.undo.ok ? { tip: 'Rewind the files to before this turn' } : { disabled: true, tip: can.undo.why }) }] : []),
      ...(can.edit ? [{ label: 'Edit from here', value: 'edit', icon: 'pen' }] : []), ...(can.fork ? [{ label: 'Fork', value: 'fork', icon: 'fork' }] : [])
    ]
  };
}
/** the turn as a screen reader names it */
export const sayTurn = (a: AgentTurn): string => (modelMark.parse(a.model).map((m) => modelMark.called(m) || m).join(' then ') || 'unknown model') + (a.status === 'running' ? ', working' : ', ' + a.time + ', ' + a.cost) + (a.ungoverned ? ', ungoverned' : '');
/** what the status line says while the turn runs: what it waits on you for (at rest), or what it is doing (the sweep) */
export function statusOf(a: AgentTurn, waiting: boolean): { phrase: string; working: boolean } | null {
  if (a.status !== 'running') return null;
  if (waiting) return { phrase: 'Waiting for your approval', working: false };
  const last = a.steps[a.steps.length - 1];
  const doing = last ? (last.mono ? toolWords(last.title) : last.title) : '';
  return { phrase: cap1(doing || 'Working'), working: true };
}
