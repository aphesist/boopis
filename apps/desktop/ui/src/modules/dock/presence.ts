/* When the dock exists (owner decision, 19 November 2026): what is in it decides whether it shows. Pure, no DOM, so every
   combination can be tested.

   The dock has two parts.
   - The bots part is the roster and its "+" (the Bots page, and the Scheduled page, which is the bots' own). It exists
     when at least one bot exists.
   - The session part is the Run page (and the Context page, which is the run's). It exists once a session has been
     started: a run with a title, live or the latest one. Opening a blank new session does not start one.
   The Needs you page belongs to neither: it is there whenever the dock is.

   The dock is visible when either part exists and the "Show the dock" setting is on. With neither it is not drawn at
   all: no empty slab and no lone "+". With a session and no bots only the session part shows, and the roster never
   appears. A first install has no bots and no session, so no dock. */

export interface PresenceInput {
  /** how many bots exist */
  bots: number;
  /** a session has been started (`sessionStarted`) */
  session: boolean;
  /** the user's "Show the dock" setting */
  setting: boolean;
}
export interface Presence {
  bots: boolean;
  session: boolean;
  /** the dock draws at all: a part exists and the setting is on */
  visible: boolean;
}

export const presenceOf = (i: PresenceInput): Presence => {
  const bots = i.bots > 0, session = i.session;
  return { bots, session, visible: i.setting && (bots || session) };
};

/** a session has been started when the run has a title: the first message names it, and a blank new session has none */
export const sessionStarted = (run: { readonly title: string } | null | undefined): boolean => !!run && run.title.trim() !== '';

export type PresenceChange = 'none' | 'appear' | 'leave' | 'parts';
/** what a change of presence does to the dock: it rises in, it leaves, a part joins or goes (it grows or shrinks in place), or nothing */
export function changeOf(before: Presence, after: Presence): PresenceChange {
  if (!before.visible && after.visible) return 'appear';
  if (before.visible && !after.visible) return 'leave';
  if (!after.visible) return 'none';
  return before.bots !== after.bots || before.session !== after.session ? 'parts' : 'none';
}

export type Part = 'bots' | 'session' | 'any';
/** the part a page belongs to */
export const partOf = (page: string): Part => (page === 'bots' || page === 'sched' ? 'bots' : page === 'run' || page === 'ctx' ? 'session' : 'any');
export const hasPage = (page: string, p: Pick<Presence, 'bots' | 'session'>): boolean => {
  const part = partOf(page);
  return part === 'any' ? p.bots || p.session : part === 'bots' ? p.bots : p.session;
};

/** The pages the dock shows: the ones the user arranged (in their order) whose part exists. When none of them does (a
    session and no bots, with only the Bots page switched on) the existing part's own page stands in, so a dock that exists
    always has a page. No part, no pages. */
export function pagesFor(pages: ReadonlyArray<{ readonly id: string; readonly on: boolean }>, p: Pick<Presence, 'bots' | 'session'>): string[] {
  const shown = pages.filter((x) => x.on && hasPage(x.id, p)).map((x) => x.id);
  if (shown.length) return shown;
  return p.bots ? ['bots'] : p.session ? ['run'] : [];
}

/** the page to be on: the current one while it is shown, else the first shown, else `fallback` */
export const pageOf = (current: string, shown: readonly string[], fallback = 'bots'): string => (shown.includes(current) ? current : shown[0] ?? fallback);
