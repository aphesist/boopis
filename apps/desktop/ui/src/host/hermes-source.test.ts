// @vitest-environment jsdom
/* Settings > General > Advanced > "Use my own Hermes" against a fake host that keeps the saved value as the real one does. */
import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_HINT, mountHermesSource, sourceNotes } from './hermes-source';
import type { SourceDeps } from './hermes-source';
import type { Source, SourceInfo } from './setup-bridge';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** the host's rules for `hermes_source_get` and `hermes_source_set`, in a few lines: BOOPIS_HERMES wins, then what is saved */
function host(init: { saved?: Source | null; env?: Source | null; running?: Source; carries?: boolean } = {}) {
  const st = { saved: init.saved ?? null, env: init.env ?? null, running: init.running ?? ('bundled' as Source), carries: init.carries ?? true, restarts: 0, toasts: [] as string[], fail: false };
  const view = (): SourceInfo => ({ saved: st.saved, from_env: st.env, next: st.env ?? st.saved ?? 'bundled', running: st.running, carries_runtime: st.carries });
  const deps: SourceDeps = {
    load: () => Promise.resolve(view()),
    save: (s) => { if (st.fail) return Promise.reject(new Error('the settings file is read-only')); if (!st.carries) return Promise.reject(new Error('this build carries no Hermes of its own')); st.saved = s; return Promise.resolve(view()); },
    restart: () => { st.restarts += 1; return Promise.resolve(); },
    toast: (t) => { st.toasts.push(t); }
  };
  return { st, deps };
}
const parts = (panel: HTMLElement) => ({
  sw: panel.querySelector<HTMLInputElement>('#hx-set-own-hermes')!,
  restart: panel.querySelector<HTMLElement>('#hx-set-own-restart')!,
  get hint() { return panel.querySelector('.ui-set__label small')?.textContent ?? ''; }
});
const flip = async (sw: HTMLInputElement, on: boolean) => { sw.checked = on; sw.dispatchEvent(new CustomEvent('ui:change', { detail: { value: on } })); await tick(); };

beforeEach(() => { document.body.replaceChildren(); });

describe('Use my own Hermes', () => {
  it('explains what it means, starts off with the bundled Hermes, and offers no restart for a choice nobody made', async () => {
    const h = host();
    const panel = document.createElement('div');
    await mountHermesSource(panel, h.deps);
    const p = parts(panel);
    expect(panel.querySelector('h3')?.textContent).toBe('Advanced');
    expect(panel.querySelector('label[for="hx-set-own-hermes"]')?.textContent).toContain('Use my own Hermes');
    expect(p.sw.checked).toBe(false);
    expect(p.sw.disabled).toBe(false);
    expect(p.hint).toContain('Hermes it carries, in a folder of its own');
    expect(p.hint).toContain('Setup then runs again there and asks before it changes any Hermes setting');
    expect(p.hint).toContain('the next time the app starts');
    expect(p.hint).toContain('Running now: the Hermes boopis carries.');
    expect(p.restart.hidden).toBe(true);
    expect(p.hint, 'interface copy has no em dash').not.toMatch(/—/);
  });

  it('saves the choice through the host, says it applies after a restart, and offers it', async () => {
    const h = host();
    const panel = document.createElement('div');
    await mountHermesSource(panel, h.deps);
    const p = parts(panel);
    await flip(p.sw, true);
    expect(h.st.saved).toBe('existing');
    expect(p.hint).toContain('Saved. It applies after a restart.');
    expect(p.restart.hidden).toBe(false);
    p.restart.click();
    await tick();
    expect(h.st.restarts).toBe(1);
    // turning it back off before restarting leaves nothing to restart for
    await flip(p.sw, false);
    expect(h.st.saved).toBe('bundled');
    expect(p.restart.hidden).toBe(true);
    expect(p.hint).not.toContain('Saved.');
  });

  it('round trip: what was saved is what a fresh mount shows, and after the restart nothing is due', async () => {
    const h = host();
    const first = document.createElement('div');
    await mountHermesSource(first, h.deps);
    await flip(parts(first).sw, true);
    // the app restarts: it now runs the saved choice
    h.st.running = 'existing';
    const again = document.createElement('div');
    await mountHermesSource(again, h.deps);
    const p = parts(again);
    expect(p.sw.checked).toBe(true);
    expect(p.restart.hidden).toBe(true);
    expect(p.hint).toContain('Running now: the Hermes on this computer.');
    expect(p.hint).not.toContain('Saved.');
  });

  it('a failed save puts the switch back and says why', async () => {
    const h = host();
    const panel = document.createElement('div');
    await mountHermesSource(panel, h.deps);
    h.st.fail = true;
    await flip(parts(panel).sw, true);
    expect(parts(panel).sw.checked).toBe(false);
    expect(h.st.toasts).toEqual(['the settings file is read-only']);
    expect(parts(panel).restart.hidden).toBe(true);
  });

  it('BOOPIS_HERMES wins: the switch shows it, is locked, and no restart is offered', async () => {
    const h = host({ env: 'existing', saved: 'bundled', running: 'existing' });
    const panel = document.createElement('div');
    await mountHermesSource(panel, h.deps);
    const p = parts(panel);
    expect(p.sw.checked).toBe(true);
    expect(p.sw.disabled).toBe(true);
    expect(p.hint).toContain('BOOPIS_HERMES is set to existing and overrides this choice.');
    expect(p.restart.hidden).toBe(true);
  });

  it('a build with no Hermes of its own says so, leaves the switch off the table and offers nothing', async () => {
    const h = host({ carries: false, running: 'existing' });
    const panel = document.createElement('div');
    await mountHermesSource(panel, h.deps);
    const p = parts(panel);
    expect(p.sw.disabled).toBe(true);
    expect(p.hint).toBe('This build carries no Hermes of its own, so it always uses the one on this computer.');
    expect(p.restart.hidden).toBe(true);
  });

  it('says so when the host cannot report the choice, and changes nothing', async () => {
    const h = host();
    h.deps.load = () => Promise.reject(new Error('no settings file'));
    const panel = document.createElement('div');
    await mountHermesSource(panel, h.deps);
    const p = parts(panel);
    expect(p.sw.disabled).toBe(true);
    expect(p.hint).toContain(BASE_HINT);
    expect(p.hint).toContain('The host could not report the choice: no settings file.');
  });

  it('notes, as sentences, for every state', () => {
    const v: SourceInfo = { saved: 'existing', from_env: null, next: 'existing', running: 'bundled', carries_runtime: true };
    expect(sourceNotes(v)).toEqual(['Running now: the Hermes boopis carries.', 'Saved. It applies after a restart.']);
    expect(sourceNotes({ ...v, from_env: 'bundled', next: 'bundled' })).toEqual(['BOOPIS_HERMES is set to bundled and overrides this choice.', 'Running now: the Hermes boopis carries.']);
  });
});
