/* The one `SessionCapabilities` map (ADR-0057; docs/specs/session-launch.md section 4): built from `runtime.describe`
   (what `session.create` takes), the method probes, and the plugin's `describe` (its RPC, hx, approvals, a folder's gate
   and sandbox, the session's own state). Every control of the Session tab reads it; none probes or reads a flag on its
   own. Pure: the details source (`details.ts`) holds the inputs and publishes the map.

   Unknown is never yes: a source that was not read gives `ok: false` with the reason (invariant 5). The reasons are the
   person's words: never the engine's name (ADR-0031), never a code. */
import { CAREFUL, CAREFUL_STEPS, YES, no } from '../../data/session-s0';
import type { Avail, CarefulStep, SessionCapabilities } from '../../data/session-s0';

/** the engine's effort levels in its order (`hermes_constants.py`; session-launch.md 3.1) */
export const EFFORTS: readonly string[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface PluginDescribe {
  version?: string | undefined;
  capabilities?: readonly string[] | undefined;
  hx?: { ok?: boolean; why?: string } | null | undefined;
  approvals?: { mode?: string | null } | null | undefined;
}
export interface FolderDescribe {
  folder?: { cwd?: string; gate?: { command?: boolean; trusted?: boolean }; error?: string } | undefined;
  sandbox?: { ok?: boolean; why?: string } | undefined;
}
export interface SessionDescribe {
  careful?: string | null; surface?: string; running?: boolean; rewind?: { ok?: boolean; why?: string } | null; mode?: string;
}
export interface CapsInput {
  /** `runtime.describe` as the client holds it */
  runtime: { capabilities?: readonly string[]; session_create?: { parameters?: readonly string[] } } | null;
  /** the method probes' refusals (`sessions.fork`, `sessions.compact`), in words */
  unavailable: Readonly<Record<string, string>>;
  /** the plugin's `describe {}`; null when it is absent or the read failed */
  plugin: PluginDescribe | null;
  /** the plugin's `describe {cwd}` for the launch folder; null until a folder is chosen and read */
  folder: FolderDescribe | null;
  /** the followed session's part of `describe {session_id}`; null before it exists */
  session: SessionDescribe | null;
  /** whether governed mode can run on the models chosen (ADR-0037): null unknown, else the reason when it cannot */
  frontier: { available: boolean; why: string } | null;
  /** the launch folder chosen, if any */
  launchFolder: string | null;
  /** the followed session has had its first message; it is running a turn now */
  started: boolean;
  running: boolean;
}

const NO_PLUGIN = 'boopis\'s own part is not loaded in its engine, so a session here cannot be governed or recorded.';
const OLD_ENGINE = 'This version of boopis\'s engine cannot start a session in a folder with boopis\'s tools.';
const ASKS_OFF = 'Approvals are off in boopis\'s engine settings, so boopis cannot ask you.';
const ASKS_UNKNOWN = 'Whether boopis\'s engine asks you before acting could not be read.';
const NEEDS_GATE = new Set<CarefulStep>(['auto_edits', 'auto']);

/** why a gate cannot let changes apply on their own in this folder, or null when it can */
function gateWhy(i: CapsInput): string | null {
  if (!i.launchFolder && !i.started) return 'Choose a folder first: this step needs the project\'s gate.';
  const f = i.folder;
  if (!f?.folder) return 'The project\'s gate could not be read.';
  if (f.folder.error) return 'The folder could not be read: ' + f.folder.error + '.';
  if (!f.folder.gate?.command) return 'This project has no gate command, so changes cannot apply on their own.';
  if (!f.folder.gate.trusted) return 'This project\'s gate command is not trusted yet, so changes cannot apply on their own.';
  if (f.sandbox && f.sandbox.ok === false) return 'The gate cannot run here: ' + (f.sandbox.why ?? 'its sandbox is not available') + '.';
  return null;
}

function stepAvail(step: CarefulStep, i: CapsInput, base: Avail): Avail {
  if (!base.ok) return base;
  const p = i.plugin as PluginDescribe;
  if (step === 'full') {
    if (p.hx?.ok === false) return no(p.hx.why ? cap(p.hx.why) + '.' : 'Nothing can be shipped here.');
    if (!p.hx) return no('Whether changes can be shipped here could not be read.');
    return YES;
  }
  if (i.frontier && !i.frontier.available) return no(i.frontier.why);
  const mode = p.approvals?.mode;
  if (mode === 'off') return no(ASKS_OFF);
  if (mode == null) return no(ASKS_UNKNOWN);
  if (NEEDS_GATE.has(step)) { const why = gateWhy(i); if (why) return no(why); }
  return YES;
}
const cap = (s: string): string => s.slice(0, 1).toUpperCase() + s.slice(1);

export function capabilitiesFrom(i: CapsInput): SessionCapabilities {
  const caps = new Set(i.runtime?.capabilities ?? []);
  const params = new Set(i.runtime?.session_create?.parameters ?? []);
  const rpc = new Set(i.plugin?.capabilities ?? []);
  const present = i.plugin != null;
  const create: Avail = !present ? no(NO_PLUGIN) : !params.has('cwd') || !params.has('toolsets') ? no(OLD_ENGINE) : YES;
  const param = (name: string, what: string): Avail => (!create.ok ? create : params.has(name) ? YES : no('This version of boopis\'s engine cannot set ' + what + ' when a session starts.'));
  const careful = Object.fromEntries(CAREFUL_STEPS.map((s) => [s, stepAvail(s, i, create)])) as Record<CarefulStep, Avail>;
  const started = i.started;
  const notYet = no('The session has not started yet.');
  const has = (m: string): boolean => rpc.has(m);
  const now = i.session?.careful as CarefulStep | null | undefined;
  const changeCareful = Object.fromEntries(CAREFUL_STEPS.map((s) => {
    if (!started) return [s, careful[s]];
    if (!present) return [s, no(NO_PLUGIN)];
    const governedNow = now != null ? now !== 'full' : i.session?.mode === 'governed';
    const inPlace = governedNow === (s !== 'full');
    if (inPlace && !has('careful.set')) return [s, no('This version of boopis cannot change that while a session runs.')];
    if (!inPlace && !(has('continue.arm') && create.ok)) return [s, no('This version of boopis cannot continue a session with new settings.')];
    const a = stepAvail(s, i, YES);
    return [s, a.ok ? { ok: true as const, inPlace } : a];
  })) as Record<CarefulStep, Avail & { inPlace?: boolean }>;
  const rewind: Avail = !started ? notYet : !present ? no(NO_PLUGIN) : !has('checkpoint.rewind') ? no('This version of boopis cannot rewind files.')
    : i.session?.rewind?.ok === true ? (i.running ? no('Rewind when this turn has finished.') : YES)
    : no(i.session?.rewind?.why ? cap(i.session.rewind.why) + (i.session.rewind.why.endsWith('.') ? '' : '.') : 'Whether files can be rewound here could not be read.');
  const continued: Avail = !started ? notYet : has('continue.arm') && create.ok ? YES : no('This version of boopis cannot continue a session with new settings.');
  return {
    engine: { caps, createParams: params },
    plugin: { present, version: i.plugin?.version ?? null, rpc },
    launch: {
      create,
      folder: create.ok ? YES : create,
      model: param('model', 'the model'),
      effort: param('reasoning', 'the effort'),
      skills: param('skills', 'skills'),
      efforts: params.has('reasoning') ? EFFORTS : [],
      careful
    },
    session: {
      fork: !started ? notYet : i.unavailable['sessions.fork'] ? no(i.unavailable['sessions.fork']) : YES,
      compact: !started ? notYet : i.unavailable['sessions.compact'] ? no(i.unavailable['sessions.compact']) : YES,
      rewind,
      changeModel: started ? YES : notYet,
      changeEffort: !started ? notYet : caps.size || params.size ? YES : no('This version of boopis\'s engine cannot change the effort while a session runs.'),
      changeCareful, changeFolder: continued, changeSkills: continued
    }
  };
}

/** the step a new session starts on: the person's pick, else the default; a pick that cannot be honoured falls back to
    Supervised (owner pick S02 B: "a project without a trusted gate falls back to Supervised and says so") */
export function launchStep(pick: CarefulStep, caps: SessionCapabilities): { step: CarefulStep; fellBack: boolean } {
  if (caps.launch.careful[pick].ok) return { step: pick, fellBack: false };
  if (NEEDS_GATE.has(pick) && caps.launch.careful.supervised.ok) return { step: 'supervised', fellBack: true };
  return { step: pick, fellBack: false };
}

/** the words of a step, for lines and labels */
export const stepName = (s: CarefulStep): string => CAREFUL[s].name;
