// @vitest-environment jsdom
/* Settings > Models against fakes: the plan Hermes reports, the ladder the host read, and "Change models". */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ladderRows, mountModels } from './models-tab';
import type { ModelsDeps } from './models-tab';
import { changeModels } from './change-models';
import { planView } from './free-tier';
import type { ModelsView } from './setup-bridge';
import type { SetupBridge } from './setup-bridge';

const NOW = 1_800_000_000_000;
const free = planView({ status: { has_guest: true, enabled: true, available: true, notice_pending: false, model: 'nous/welcome', label: 'Nous · free tier' }, options: null, limit: null }, NOW);
const SET: ModelsView = { state: 'set', tiers: [{ name: 'small', model: 'openrouter/a-3b:free' }, { name: 'big', model: 'openrouter/b-120b:free' }] };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function deps(over: Partial<ModelsDeps> = {}): ModelsDeps & { calls: string[] } {
  const calls: string[] = [];
  return { calls, plan: () => Promise.resolve(free), ladder: () => Promise.resolve(SET), change: () => { calls.push('change'); return Promise.resolve(); }, closeSettings: () => { calls.push('close'); }, toast: (t) => { calls.push('toast:' + t); }, ...over };
}
beforeEach(() => { document.body.replaceChildren(); });

describe('Settings > Models', () => {
  it('shows the free plan Hermes reported and the ladder tier by tier, in the settings rows and the ladder list', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps());
    const heads = [...panel.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Plan', 'Model ladder', 'Change']);
    expect(panel.textContent).toContain('Free (Nous · free tier)');
    expect(panel.textContent).toContain('nous/welcome');
    const rows = [...panel.querySelectorAll('.ui-ladder--list > li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.ui-ladder__name')?.textContent).toContain('openrouter/a-3b:free');
    expect(rows[0]?.querySelector('.ui-ladder__rule')?.textContent).toBe('small');
    expect(rows[1]?.querySelector('.ui-ladder__rule')?.textContent).toBe('big');
    expect(rows[0]?.getAttribute('aria-current'), 'the first tier is where a task starts').toBe('step');
    expect(panel.textContent).toContain('moves to the next only when its gate fails');
    expect(panel.querySelector('[role=img][aria-label^="Model ladder"], ol[aria-label="Model ladder"]')).toBeTruthy();
  });

  it('says the ladder is the built-in one when none is saved, and lists no tiers it was not told of', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ ladder: () => Promise.resolve({ state: 'default', tiers: [] }) }));
    expect(panel.querySelector('.ui-ladder--list')).toBeNull();
    expect(panel.textContent).toContain('No ladder is saved here, so boopis uses its built-in Claude ladder');
  });

  it('says a saved ladder it cannot read is not shown, and that Hermes could not be asked when it could not', async () => {
    const odd = document.createElement('div');
    await mountModels(odd, deps({ ladder: () => Promise.resolve({ state: 'unreadable', tiers: [] }) }));
    expect(odd.textContent).toContain('does not read as a list of named tiers');
    expect(odd.querySelector('.ui-ladder--list')).toBeNull();
    const down = document.createElement('div');
    await mountModels(down, deps({ ladder: () => Promise.reject(new Error('hermes is not installed')) }));
    expect(down.textContent).toContain('Hermes could not be asked, so the ladder is not shown: hermes is not installed');
    expect(down.querySelector('#hx-models-change'), 'the button is still there: choosing models does not need the read').toBeTruthy();
  });

  it('says Hermes is not connected when the plan cannot be read, rather than drawing one', async () => {
    const panel = document.createElement('div');
    await mountModels(panel, deps({ plan: () => Promise.resolve(null) }));
    expect(panel.textContent).toContain('Hermes is not connected, so the plan cannot be read.');
    expect(panel.textContent).not.toContain('Free (');
  });

  it('asks both again on refresh, so a changed plan and a changed ladder show', async () => {
    const panel = document.createElement('div');
    let ladder: ModelsView = { state: 'default', tiers: [] };
    const m = await mountModels(panel, deps({ ladder: () => Promise.resolve(ladder) }));
    expect(panel.querySelectorAll('.ui-ladder--list > li')).toHaveLength(0);
    ladder = SET;
    await m.refresh();
    expect(panel.querySelectorAll('.ui-ladder--list > li')).toHaveLength(2);
    expect(panel.querySelectorAll('section'), 'redrawn in place, not appended').toHaveLength(3);
  });

  it('"Change models" asks the question again and steps the dialog aside; a refusal is said and the dialog stays', async () => {
    const panel = document.createElement('div');
    document.body.append(panel);
    const d = deps();
    await mountModels(panel, d);
    panel.querySelector<HTMLButtonElement>('#hx-models-change')?.click();
    await tick();
    expect(d.calls).toEqual(['change', 'close']);
    const bad = deps({ change: () => Promise.reject(new Error('setup.json is not valid')) });
    const other = document.createElement('div');
    await mountModels(other, bad);
    other.querySelector<HTMLButtonElement>('#hx-models-change')?.click();
    await tick();
    expect(bad.calls).toEqual(['toast:setup.json is not valid']);
  });

  it('rows are plain text with no markup from a tier name or model', () => {
    const rows = ladderRows({ state: 'set', tiers: [{ name: '<b>x</b>', model: 'a"b/c' }] }).join('');
    expect(rows).not.toContain('<b>x</b>');
    expect(rows).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('change models', () => {
  const bridge = {} as SetupBridge;
  it('forgets the choice first, then shows the first-run view at once, under its own heading', async () => {
    const order: string[] = [];
    const run = vi.fn((_b: SetupBridge, o: { autostart: boolean; title: string }) => { order.push('run:' + o.title + ':' + String(o.autostart)); return Promise.resolve(); });
    const { done } = await changeModels({ reopen: () => { order.push('reopen'); return Promise.resolve(); }, run, bridge: () => bridge });
    await done;
    expect(order).toEqual(['reopen', 'run:Change models:true']);
    expect(run.mock.calls[0]?.[0]).toBe(bridge);
  });
  it('shows nothing when the host will not forget the choice', async () => {
    const run = vi.fn(() => Promise.resolve());
    await expect(changeModels({ reopen: () => Promise.reject(new Error('refused')), run, bridge: () => bridge })).rejects.toThrow('refused');
    expect(run).not.toHaveBeenCalled();
  });
});
