/* The Session tab's wave S0 as data (ADR-0057, ADR-0058; docs/specs/session-launch.md, checkpoint-rewind.md): the launch
   settings a new session is created with, the one capability map every control reads, the four-step permission scale,
   and the rewind. The live provider fills these from the engine and the plugin (`host/live/session-controls.ts`); the
   mock has none, so a mock session offers no launch row and no rewind. Unknown is never yes: a source that was not read
   gives `ok: false` with the reason (invariant 5). */
import type { Watch } from './provider';

/** how careful a session is: one choice of four (owner decision, 23 November 2026) */
export type CarefulStep = 'supervised' | 'auto_edits' | 'auto' | 'full';
export const CAREFUL_STEPS: readonly CarefulStep[] = ['supervised', 'auto_edits', 'auto', 'full'];
/** each step's name and its one-line meaning, as the boards write them (S41, S01 B) */
export const CAREFUL: Readonly<Record<CarefulStep, { name: string; meaning: string }>> = {
  supervised: { name: 'Supervised', meaning: 'Asks before every change and every command.' },
  auto_edits: { name: 'Auto-accept edits', meaning: 'Changes apply when the gate passes; commands ask.' },
  auto: { name: 'Auto', meaning: 'Only your approval rules ask.' },
  full: { name: 'Full access', meaning: 'Nothing asks. Every write is still recorded.' }
};
/** new sessions start here unless the person picked another (owner pick S02 B) */
export const DEFAULT_CAREFUL: CarefulStep = 'auto_edits';

/** a value that can or cannot be offered; `why` is read by the person, never a code */
export type Avail = { ok: true } | { ok: false; why: string };
export const YES: Avail = { ok: true };
export const no = (why: string): Avail => ({ ok: false, why });

export interface SessionCapabilities {
  engine: { caps: ReadonlySet<string>; createParams: ReadonlySet<string> };
  plugin: { present: boolean; version: string | null; rpc: ReadonlySet<string> };
  launch: {
    /** a Session tab session can be created at all: the engine takes a folder and the toolsets, the plugin is there */
    create: Avail;
    folder: Avail; model: Avail; effort: Avail; skills: Avail;
    /** the efforts the engine takes, in its order */
    efforts: readonly string[];
    careful: Readonly<Record<CarefulStep, Avail>>;
  };
  /** the followed session, once it has started */
  session: {
    fork: Avail; compact: Avail; rewind: Avail; changeModel: Avail; changeEffort: Avail;
    /** a step change, and whether it happens in the same engine session (`inPlace`) or continues on a new one */
    changeCareful: Readonly<Record<CarefulStep, Avail & { inPlace?: boolean }>>;
    changeFolder: Avail; changeSkills: Avail;
  };
}

/** what the launch row holds before the first message; nothing is sent until then */
export interface LaunchSettings {
  /** the project folder (an absolute path), null until one is chosen */
  folder: string | null;
  careful: CarefulStep;
  /** the engine's effort level, null: the profile's own */
  effort: string | null;
  /** the step the person picked fell back (no trusted gate): said in the row */
  fellBack: boolean;
}

/** one line in the thread about the thread itself (the v7 SystemLine): a setting changed, a rewind */
export type ThreadLine =
  | {
      kind: 'settings'; id: string;
      /** the agent turn it follows; null before the first */
      afterTurn: string | null;
      /** "Permissions changed to Auto", "Effort changed to High", "Settings changed: continued with Full access" */
      text: string;
      /** what the change costs on the next reply, at the line's end as board S33 draws it ("+$0.04"; where no price is known, the
          tokens read again without the cache); null when the change keeps the cache or its cost is not known */
      cost: string | null;
      /** the cost in full words, read from the line's tip ("The next reply reads about 18,000 tokens without the cache") */
      costWhy?: string;
      /** the line says the answering model changed: the thread then draws no second line where the next answer comes from it */
      what?: 'model';
    }
  | {
      kind: 'checkpoint'; id: string; afterTurn: string | null; at: string;
      action: 'rewound' | 'undone';
      /** the ship rewound to (null: before the session's changes) and the words for it */
      to: { shipId: string | null; label: string };
      files: number;
      rewindShipId: string;
      /** the ship to rewind to for its undo; null once a later change makes it meaningless to offer */
      undoShipId: string | null;
    };

/** a line as a source hands it over: the provider gives it its id and the turn it follows */
export type NewLine = ThreadLine extends infer T ? (T extends ThreadLine ? Omit<T, 'id' | 'afterTurn'> : never) : never;

export type RewindStatus = 'rewound' | 'planned' | 'nothing_to_do' | 'refused';
export interface RewindResult {
  status: RewindStatus;
  isolation: 'own_worktree' | 'shared_unchanged' | 'refused';
  why?: string;
  fromCommit?: string;
  toCommit?: string;
  files: readonly { path: string; action: 'restore' | 'delete' | 'recreate' }[];
  rewindShipId?: string;
  undo?: { shipId: string };
}

/** what the Session tab's S0 controls ask of the provider (the live one only) */
export interface SessionControls {
  /** the followed session's capability map */
  capabilities: Watch<SessionCapabilities>;
  /** the followed session's launch settings (a session that has not started) */
  launch: Watch<LaunchSettings>;
  /** change a launch setting; returns why not, or null */
  setLaunch(patch: Partial<Pick<LaunchSettings, 'folder' | 'careful' | 'effort'>>): string | null;
  /** change how careful the followed, started session is: in place, or continued on a new engine session.
      Resolves with why not, or null; the thread gets its line */
  setCareful(step: CarefulStep): Promise<string | null>;
  /** change the effort: the launch's before the first message; a started session's in place (the engine applies it to the next turn
      while one runs). Resolves with why not, or null; a started session's thread gets its line ("Effort changed to High") */
  setEffort(effort: string): Promise<string | null>;
  /** checkpoint.rewind, dry run or for real; never rejects for a refusal (`status: refused`, `why`) */
  /** `undo`: this rewind undoes the last one (its line says "Rewind undone") */
  rewind(sessionId: string, shipId: string | null, o?: { dryRun?: boolean; expectHead?: string; undo?: boolean }): Promise<RewindResult>;
  /** the head ship of the session (what a rewind expects), null when none is kept */
  head(sessionId: string): string | null;
  /** the host's folder chooser; null where there is none */
  pickFolder: (() => Promise<string | null>) | null;
}
