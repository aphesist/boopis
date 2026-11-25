/* The one capability map (docs/specs/session-launch.md section 4; acceptance tests 6, 11, 18): built from runtime.describe, the
   probes and the plugin's describe; unknown is never yes; each step's availability says why in the person's words. */
import { describe, expect, it } from 'vitest';
import { capabilitiesFrom, launchStep } from './capabilities';
import type { CapsInput } from './capabilities';

const PARAMS = ['source', 'cwd', 'cwd_explicit', 'model', 'provider', 'reasoning', 'skills', 'toolsets', 'client'];
const base = (over: Partial<CapsInput> = {}): CapsInput => ({
  runtime: { capabilities: ['plugin-rpc-v1'], session_create: { parameters: PARAMS } },
  unavailable: {},
  plugin: { version: '0.2.0', capabilities: ['careful.set', 'continue.arm', 'checkpoint.rewind'], hx: { ok: true }, approvals: { mode: 'manual' } },
  folder: { folder: { cwd: '/p', gate: { command: true, trusted: true } }, sandbox: { ok: true } },
  session: null, frontier: null, launchFolder: '/p', started: false, running: false,
  ...over
});
const why = (a: { ok: boolean; why?: string }): string => (a.ok ? '' : a.why ?? '');

describe('the launch', () => {
  it('offers every step when everything is known and allows it', () => {
    const c = capabilitiesFrom(base());
    expect(Object.values(c.launch.careful).every((a) => a.ok)).toBe(true);
    expect(c.launch.create.ok && c.launch.effort.ok && c.launch.model.ok).toBe(true);
    expect(c.launch.efforts).toContain('high');
  });
  it('an engine that takes no reasoning makes the effort unavailable, with its reason; no toolsets makes nothing start', () => {
    const noEffort = capabilitiesFrom(base({ runtime: { session_create: { parameters: PARAMS.filter((p) => p !== 'reasoning') } } }));
    expect(why(noEffort.launch.effort)).toMatch(/cannot set the effort/);
    expect(noEffort.launch.efforts).toEqual([]);
    const noTools = capabilitiesFrom(base({ runtime: { session_create: { parameters: PARAMS.filter((p) => p !== 'toolsets') } } }));
    expect(noTools.launch.create.ok).toBe(false);
    expect(Object.values(noTools.launch.careful).every((a) => !a.ok)).toBe(true);
  });
  it('without a trusted gate only Supervised and Full access are offered (owner decision)', () => {
    const none = capabilitiesFrom(base({ folder: { folder: { cwd: '/p', gate: { command: false, trusted: false } } } }));
    expect(none.launch.careful.supervised.ok && none.launch.careful.full.ok).toBe(true);
    expect(why(none.launch.careful.auto_edits)).toMatch(/Needs a gate command/);
    expect(why(none.launch.careful.auto)).toMatch(/Needs a gate command/);
    const untrusted = capabilitiesFrom(base({ folder: { folder: { cwd: '/p', gate: { command: true, trusted: false } } } }));
    expect(why(untrusted.launch.careful.auto)).toMatch(/trust this project/);
    const sandbox = capabilitiesFrom(base({ folder: { folder: { cwd: '/p', gate: { command: true, trusted: true } }, sandbox: { ok: false, why: 'no user namespaces' } } }));
    expect(why(sandbox.launch.careful.auto_edits)).toMatch(/no user namespaces/);
  });
  it('a non-frontier model makes the three governed steps unavailable; Full access stays', () => {
    const c = capabilitiesFrom(base({ frontier: { available: false, why: 'Governed steps run only on frontier models.' } }));
    expect(['supervised', 'auto_edits', 'auto'].map((s) => c.launch.careful[s as 'auto'].ok)).toEqual([false, false, false]);
    expect(c.launch.careful.full.ok).toBe(true);
  });
  it('approvals off, or not readable, make the governed steps unavailable: boopis could not ask', () => {
    const off = capabilitiesFrom(base({ plugin: { capabilities: [], hx: { ok: true }, approvals: { mode: 'off' } } }));
    expect(why(off.launch.careful.supervised)).toMatch(/Approvals are off/);
    expect(why(off.launch.careful.supervised)).not.toMatch(/Hermes/);
    const unknown = capabilitiesFrom(base({ plugin: { capabilities: [], hx: { ok: true }, approvals: { mode: null } } }));
    expect(unknown.launch.careful.supervised.ok).toBe(false);
  });
  it('no hx makes Full access unavailable: nothing could be shipped', () => {
    const c = capabilitiesFrom(base({ plugin: { capabilities: [], hx: { ok: false, why: 'the hx binary was not found, so nothing can be shipped' }, approvals: { mode: 'manual' } } }));
    expect(why(c.launch.careful.full)).toBe('The hx binary was not found, so nothing can be shipped.');
  });
  it('a failed or absent plugin makes every plugin-backed capability unavailable, with a reason (never a default yes)', () => {
    const c = capabilitiesFrom(base({ plugin: null }));
    expect(c.launch.create.ok).toBe(false);
    expect(Object.values(c.launch.careful).every((a) => !a.ok && !!a.why)).toBe(true);
    expect(c.plugin.present).toBe(false);
  });
  it('falls back to Supervised when the pick needs a gate the project lacks, and says so', () => {
    const gateless = capabilitiesFrom(base({ folder: { folder: { cwd: '/p', gate: { command: false } } } }));
    expect(launchStep('auto_edits', gateless)).toEqual({ step: 'supervised', fellBack: true });
    expect(launchStep('full', gateless)).toEqual({ step: 'full', fellBack: false });
    expect(launchStep('auto', capabilitiesFrom(base()))).toEqual({ step: 'auto', fellBack: false });
  });
});

describe('a started session', () => {
  const started = (careful: string, over: Partial<CapsInput> = {}): ReturnType<typeof capabilitiesFrom> => capabilitiesFrom(base({ started: true, session: { careful, mode: careful === 'full' ? 'ungoverned' : 'governed', rewind: { ok: true } }, ...over }));
  it('changes among the governed steps in place, and across the Full access line on a new engine session', () => {
    const c = started('supervised');
    expect(c.session.changeCareful.auto).toEqual({ ok: true, inPlace: true });
    expect(c.session.changeCareful.full).toEqual({ ok: true, inPlace: false });
    expect(started('full').session.changeCareful.supervised).toEqual({ ok: true, inPlace: false });
  });
  it('rewind follows the plugin\'s word, and waits for a running turn', () => {
    expect(started('auto').session.rewind.ok).toBe(true);
    expect(why(started('auto', { running: true }).session.rewind)).toBe('Rewind when this turn has finished.');
    const no = capabilitiesFrom(base({ started: true, session: { careful: 'auto', rewind: { ok: false, why: 'the session\'s folder is not a git work tree, so it has no checkpoints' } } }));
    expect(why(no.session.rewind)).toBe('The session\'s folder is not a git work tree, so it has no checkpoints.');
  });
  it('a plugin without rewind or careful.set says so', () => {
    const old = capabilitiesFrom(base({ started: true, session: { careful: 'supervised', rewind: { ok: true } }, plugin: { capabilities: [], hx: { ok: true }, approvals: { mode: 'manual' } } }));
    expect(old.session.rewind.ok).toBe(false);
    expect(old.session.changeCareful.auto.ok).toBe(false);
  });
});
