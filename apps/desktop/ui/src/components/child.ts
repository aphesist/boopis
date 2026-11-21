/* A task a session handed to another model: the model's mark and name, the goal it was given, what it is doing now, how it ended.
   One card per child agent, in the turn that started it. The card is a row of facts and two quiet actions (open its own session,
   stop it); it never grows a form. Status is the design system's states in words and a dot, never colour alone (R-state-*): a running
   child breathes, a failed one carries the attention dot, a stopped or done one is still. Tokens only (components.css `.ui-child`). */
export const CHILD_STATUSES = ['queued', 'running', 'done', 'failed', 'stopped'] as const;
export type ChildStatus = (typeof CHILD_STATUSES)[number];
export interface ChildOpts {
  /** the child's id, kept on the card so the session can find it again */
  id?: string | undefined;
  /** the model the task runs on, as the engine reports it ("claude-opus-5-5") */
  model: string;
  /** the goal the child was given */
  goal: string;
  status: ChildStatus;
  /** how long it has run or ran ("12s", "1m 04s") */
  time?: string | undefined;
  /** what it is doing now: the tool it just called, or a line of its thinking (a running child only) */
  now?: string | undefined;
  /** how many tools it has called */
  tools?: number | undefined;
  /** what it reported when it ended, or why it failed */
  summary?: string | undefined;
  /** the child has a session of its own to open */
  canOpen?: boolean | undefined;
  /** the child can still be stopped */
  canStop?: boolean | undefined;
}

export const STATUS_WORD: Readonly<Record<ChildStatus, string>> = { queued: 'Waiting to start', running: 'Working', done: 'Done', failed: 'Failed', stopped: 'Stopped' };
export const STATUS_DOT: Readonly<Record<ChildStatus, string>> = { queued: '', running: 'run', failed: 'attention', done: '', stopped: '' };
