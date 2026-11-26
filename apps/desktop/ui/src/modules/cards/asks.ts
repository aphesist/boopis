/* What a thread says of a turn's own course, and what a teammate or a routine asks, on the v7 kit (REPASS.md step 6e; the lead's
   design, no board draws these). They replace the v6 card kinds escalation, error, teammate and schedule:
   - an escalation is a SystemLine: "Switched to <model> for this step: <reason>"; where the cap stopped it, the same line with an amber
     StatusWord "capped";
   - a failed turn is S38's pattern, the FilesCard in its check form: the check, a red "failed", what it printed, why; "retrying" with the
     kit's shimmer while it runs again; "passed" collapses to 6d's one-row receipt;
   - a teammate asked to help, and a routine proposed, are the AskCard's question form, as board 12 draws the routine line, answered with
     6d's "You …" receipts.
   Each builder returns a kit element and calls back what the person chose; nothing here holds state or talks to a provider. */
import { kit, ui } from '@boopis/ui';
import type { BotLike } from '@boopis/ui';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const named = (m: string): string => ui.modelMark.short(m) || ui.modelMark.called(m) || m;

/* ───────── an escalation ───────── */
export interface Escalation { /** the model it moved to (or would have) */ to: string; /** why, in a few words ("after 2 failed gate runs on cheaper models") */ reason: string; /** the cap stopped it: why, in the words of the cap ("the session's $0.60 cap is reached") */ capped?: string | undefined }
export function escalationText(e: Escalation): string {
  return e.capped ? 'Not switched to ' + named(e.to) + ': ' + e.capped : 'Switched to ' + named(e.to) + ' for this step: ' + e.reason;
}
export function escalationLine(e: Escalation): HTMLElement {
  return kit.systemLine({ text: escalationText(e), icon: 'ladder', ...(e.capped ? { word: { text: 'capped', tone: 'owe' } } : {}), attrs: { 'data-escalation': e.capped ? 'capped' : 'escalated' } });
}

/* ───────── a failed turn (S38) ───────── */
export type FailedState = 'failed' | 'retrying' | 'passed';
export interface FailedTurn { /** the check that failed ("npm test") */ gate: string; output?: readonly string[] | undefined; /** what became of it, in one sentence */ note?: string | undefined; /** the model the retry runs on */ retryWith?: string | undefined; /** when it passed ("09:52") */ at?: string | undefined }
export function failedTurn(f: FailedTurn, state: FailedState, on: { retry?: () => void; stop?: () => void } = {}): HTMLElement {
  if (state === 'passed') {
    return kit.askCard({ variant: 'form', state: 'answered', ask: f.gate + ' passed when it ran again' + (f.retryWith ? ' on ' + named(f.retryWith) : ''), word: { text: 'passed' + (f.at ? ' ' + f.at : ''), tone: 'ok' }, ...(f.retryWith ? { model: f.retryWith } : { lead: '' }), attrs: { 'data-failed': 'passed' } });
  }
  const retrying = state === 'retrying';
  const action = retrying ? (on.stop ? 'Stop' : '') : on.retry ? (f.retryWith ? 'Retry on ' + named(f.retryWith) : 'Retry') : '';
  const c = kit.filesCard({ files: [], check: { title: f.gate, word: retrying ? 'retrying' : 'failed', tone: retrying ? 'neutral' : 'red', live: retrying, ...(f.output?.length ? { output: f.output.join('\n') } : {}), ...(retrying ? { note: 'Running it again' + (f.retryWith ? ' on ' + named(f.retryWith) : '') + '.' } : f.note ? { note: f.note } : {}) }, ...(action ? { action, actionAttrs: { 'data-action': retrying ? 'stop' : 'retry' } } : {}), attrs: { 'data-failed': state } });
  c.querySelector('[data-files]')?.addEventListener('click', () => { if (retrying) on.stop?.(); else on.retry?.(); });
  return c;
}

/* ───────── a teammate asked to help, a routine proposed (the AskCard's question form) ───────── */
export type AskedState = 'needs' | 'yes' | 'no';
interface Answered { onYes?: () => void; onNo?: () => void }
function wireAsked(card: HTMLElement, on: Answered): HTMLElement {
  card.addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('[data-kit~="Chip"]'); if (!c) return;
    if (c.dataset['value'] === 'yes') on.onYes?.(); else if (c.dataset['value'] === 'no') on.onNo?.();
  });
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); on.onNo?.(); } });
  return card;
}

export interface TeammateAsk { from: BotLike; /** what it asks, after its name ("hands you a review") */ title: string; /** its own words */ quote?: string | undefined; /** what it is about, line by line */ item?: readonly string[] | undefined }
export function teammateAsk(t: TeammateAsk, state: AskedState, on: Answered = {}): HTMLElement {
  const name = t.from.name ?? 'A teammate';
  if (state !== 'needs') return kit.askCard({ variant: 'form', state: 'answered', bot: t.from, ask: state === 'yes' ? 'You accepted: ' + cap(t.title) : 'You denied it', word: { text: state === 'yes' ? 'accepted' : 'denied' }, attrs: { 'data-teammate': state } });
  return wireAsked(kit.askCard({ variant: 'question', state: 'needs', bot: { ...t.from, state: 'needs' }, who: name + ' asks', ask: cap(t.title), ...(t.quote ? { sub: t.quote } : {}), ...(t.item?.length ? { command: t.item.join('\n') } : {}),
    answers: [{ label: 'Accept', value: 'yes', primary: true }, { label: 'Deny', value: 'no', keys: 'esc', outline: true }], something: false, attrs: { 'data-teammate': 'needs' } }), on);
}

export interface RoutineAsk { from: BotLike; /** the routine's name ("Morning digest") */ name: string; /** when it runs, in words ("Every weekday at 02:00") */ when: string; /** what a run costs, when it is known */ cost?: string | undefined; /** what it does */ quote?: string | undefined; /** its first run ("tonight at 02:00") */ next?: string | undefined }
export function routineAsk(r: RoutineAsk, state: AskedState, on: Answered = {}): HTMLElement {
  const name = r.from.name ?? 'A bot';
  if (state === 'yes') return kit.askCard({ variant: 'form', state: 'answered', bot: r.from, ask: 'You created routine ' + r.name + (r.next ? ', first run ' + r.next : ''), word: { text: 'scheduled' }, attrs: { 'data-routine': 'yes' } });
  if (state === 'no') return kit.askCard({ variant: 'form', state: 'answered', bot: r.from, ask: 'You said not now to ' + r.name, word: { text: 'not now' }, attrs: { 'data-routine': 'no' } });
  /* board 12 says a routine made in the thread as "Created routine Weekly changelog" with the clock: the ask says the same thing to come */
  return wireAsked(kit.askCard({ variant: 'question', state: 'needs', bot: { ...r.from, state: 'needs' }, who: name + ' asks', ask: 'Create routine ' + r.name + '?', sub: [r.when, r.cost].filter(Boolean).join(' · ') + (r.quote ? ': ' + r.quote : ''),
    answers: [{ label: 'Create routine', value: 'yes', primary: true }, { label: 'Not now', value: 'no', keys: 'esc', outline: true }], something: false, attrs: { 'data-routine': 'needs' } }), on);
}
