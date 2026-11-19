/* The live bots against a fake Hermes that keeps profiles, cron jobs and the plugin's records the way Hermes and the plugin
   answer (the real ones are checked end to end by tests/e2e/test_bots_e2e.py). Every call is recorded, so the tests can say
   which Hermes method did what, and that nothing else was touched. */
import { describe, expect, it } from 'vitest';
import type { BotsEvent } from '../../data';
import type { GatewayClient, GatewayEvent } from '../gateway';
import { NeedsConfirmation } from '../../data/confirm';
import { lookFor } from '../../data/looks';
import { createLiveBots } from './bots';
import { madeOutside } from './map-bots';
import type { LiveBots } from './bots';

const NOW = new Date('2026-11-19T10:00:00Z');
const SEC = NOW.getTime() / 1000;
const HOME = '/home/u/.hermes';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

class FakeLink {
  calls: { method: string; params: Json }[] = [];
  closed = false;
  private subs = new Set<(e: GatewayEvent) => void>();
  constructor(private readonly handle: (method: string, params: Json) => unknown) {}
  request(method: string, params: Json): Promise<unknown> { return this.requestRaw(method, params); }
  async requestRaw(method: string, params: Json): Promise<unknown> { this.calls.push({ method, params }); return this.handle(method, params); }
  onEvent(fn: (e: GatewayEvent) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  onState(): () => void { return () => undefined; }
  close(): Promise<void> { this.closed = true; return Promise.resolve(); }
  emit(ev: GatewayEvent): void { for (const f of this.subs) f(ev); }
}

class FakeHermes {
  profiles: Json[] = [
    { name: 'default', path: HOME, is_default: true, description: '' },
    { name: 'atlas', path: HOME + '/profiles/atlas', description: 'reviews pull requests', provider: '', model: '', last_session: { id: 's1', title: 'review billing', last_active: SEC - 30, message_count: 4 } },
    { name: 'nina', path: HOME + '/profiles/nina', description: 'deploys', display_name: 'Nina', last_session: { id: 's2', title: 'old', last_active: SEC - 7200 } }
  ];
  describes: Record<string, Json> = {
    atlas: { name: 'atlas', description: 'reviews pull requests', soul: 'You review.\n', model: { provider: 'main', default: 'fake-a' }, skills: [{ name: 'git', enabled: true }, { name: 'web', enabled: false }], toolsets: [{ name: 'terminal', label: 'Terminal', enabled: true }], mcp_servers: [{ name: 'fs', enabled: true }] },
    nina: { name: 'nina', description: 'deploys', soul: '', model: { provider: '', default: '' }, skills: [], toolsets: [] }
  };
  jobs: Record<string, Json[]> = { atlas: [{ job_id: 'j1', name: 'morning', schedule: '0 9 * * 1-5', prompt_preview: 'Review what changed', enabled: true, next_run_at: '2026-11-19T12:00:00Z' }], nina: [] };
  own: Record<string, Json> = { atlas: { look: { shape: 'triangle', color: '#f23b5a', eyes: 'pill' }, settings: { gov: 'ungoverned' } } };
  archived: Record<string, Json> = {};
  failProfilesList = false;
  /** the plugin's read answers nothing, or reports a store it could not read */
  failOwn = false;
  problems: Record<string, string> = {};
  failLink = false;
  main = new FakeLink((m, p) => this.mainCall(m, p));
  links = new Map<string, FakeLink>();
  linkOpens: string[] = [];

  linkTo = (profile: string): Promise<GatewayClient> => {
    this.linkOpens.push(profile);
    if (this.failLink) return Promise.reject(new Error('the gateway does not serve ' + profile));
    const l = new FakeLink((m, p) => this.linkCall(profile, m, p));
    this.links.set(profile, l);
    return Promise.resolve(l as unknown as GatewayClient);
  };
  private mainCall(method: string, p: Json): unknown {
    switch (method) {
      case 'profiles.list': if (this.failProfilesList) throw new Error('gateway down'); return { profiles: this.profiles };
      case 'profiles.describe': return this.describes[p['name']] ?? (() => { throw new Error('not found'); })();
      case 'model.options': return { providers: [{ slug: 'main', name: 'Main', models: ['fake-a', 'fake-b'], authenticated: true }, { slug: 'nous', name: 'Nous', models: ['hermes-4'], featured_models: ['hermes-4'], authenticated: true }, { slug: 'old', name: 'Old', models: ['x'], authenticated: false }], provider: 'main', model: 'fake-a' };
      case 'profiles.create': {
        this.profiles.push({ name: p['name'], path: HOME + '/profiles/' + p['name'], description: p['description'] });
        this.describes[p['name']] = { name: p['name'], description: p['description'], soul: p['soul'] ?? '', model: { provider: p['provider'] ?? '', default: p['model'] ?? '' }, skills: [], toolsets: [] };
        this.jobs[p['name']] = [];
        return { ok: true, name: p['name'], path: HOME + '/profiles/' + p['name'], model_set: !!p['model'], mirrored: {}, warnings: [] };
      }
      case 'profiles.configure': {
        const d = this.describes[p['name']] as Json;
        const applied: Json = {};
        if ('soul' in p) { d['soul'] = p['soul']; applied['soul'] = true; }
        if ('description' in p) { d['description'] = p['description']; (this.profiles.find((x) => x['name'] === p['name']) as Json)['description'] = p['description']; applied['description'] = true; }
        if ('model' in p) { d['model'] = { provider: p['provider'], default: p['model'] }; applied['model'] = true; }
        return { ok: true, applied };
      }
      case 'plugin.boopis.bots.read': if (this.failOwn) throw new Error('the plugin is not there'); return { root: HOME, bots: this.profiles.filter((x) => !x['is_default']).map((x) => ({ name: x['name'], path: x['path'], record: this.own[x['name']] ?? null, problem: this.problems[x['name']] ?? null, archived: this.archived[x['name']] ?? null })) };
      case 'plugin.boopis.bots.write': { this.own[p['name']] = { ...(this.own[p['name']] ?? {}), ...(p['look'] ? { look: p['look'] } : {}), ...(p['settings'] ? { settings: { ...(this.own[p['name']]?.['settings'] ?? {}), ...p['settings'] } } : {}), ...(p['approvals'] ? { approvals: p['approvals'] } : {}) }; return { record: this.own[p['name']] }; }
      case 'plugin.boopis.bots.inspect': return { path: HOME + '/profiles/' + p['name'], bytes: 3 * 1024 * 1024, files: 240, truncated: false, has_sessions: true, memory_files: 2, skills: 9, boopis_bytes: 300 };
      case 'plugin.boopis.bots.archive': {
        const to = 'archived--' + p['name'];
        const row = this.profiles.find((x) => x['name'] === p['name']) as Json;
        row['name'] = to; row['path'] = HOME + '/profiles/' + to;
        this.archived[to] = { name: p['name'], at: '2026-11-19T10:00:00+00:00', paused_jobs: p['paused_jobs'] };
        this.jobs[to] = this.jobs[p['name']] ?? []; this.own[to] = this.own[p['name']] ?? {};
        return { name: to, path: row['path'], was: p['name'] };
      }
      case 'plugin.boopis.bots.restore': {
        const row = this.profiles.find((x) => x['name'] === p['name']) as Json;
        const rec = this.archived[p['name']] as Json;
        const was = rec['name'] as string;
        row['name'] = was; row['path'] = HOME + '/profiles/' + was;
        const paused = rec['paused_jobs'];
        delete this.archived[p['name']]; this.jobs[was] = this.jobs[p['name']] ?? []; this.own[was] = this.own[p['name']] ?? {};
        return { name: was, path: row['path'], paused_jobs: paused };
      }
      case 'plugin.boopis.bots.delete': { if (p['confirm'] !== p['name']) throw new Error('hx.bots.refused'); this.profiles = this.profiles.filter((x) => x['name'] !== p['name']); return { deleted: p['name'] }; }
      default: throw new Error('unknown method ' + method);
    }
  }
  private linkCall(profile: string, method: string, p: Json): unknown {
    const jobs = (this.jobs[profile] ??= []);
    if (method === 'session.list') return { sessions: [{ id: 's1', title: 'review billing', started_at: SEC - 600, message_count: 4 }, { id: 's0', title: '', preview: 'first words', started_at: SEC - 86400 * 2, source: 'cron' }] };
    if (method !== 'cron.manage') throw new Error('unexpected ' + method);
    switch (p['action']) {
      case 'list': return { success: true, jobs: jobs.map((j) => ({ ...j })) };
      case 'add': { const j = { job_id: 'j' + (jobs.length + 5), name: p['name'], schedule: p['schedule'], prompt_preview: p['prompt'], enabled: true }; jobs.push(j); return { success: true, job_id: j.job_id }; }
      case 'remove': this.jobs[profile] = jobs.filter((j) => j['job_id'] !== p['name']); return { success: true };
      case 'pause': case 'resume': { const j = jobs.find((x) => x['job_id'] === p['name']); if (!j) return { error: 'no such job' }; j['enabled'] = p['action'] === 'resume'; return { success: true }; }
      default: throw new Error('action');
    }
  }
}

async function open(h = new FakeHermes()): Promise<{ h: FakeHermes; bots: LiveBots; events: BotsEvent[] }> {
  const bots = createLiveBots({ client: h.main as unknown as GatewayClient, linkTo: h.linkTo, now: () => NOW, pollMs: null });
  const events: BotsEvent[] = [];
  bots.source.subscribe((e) => events.push(e));
  await bots.ready; await bots.settled();
  return { h, bots, events };
}
const botOf = (b: LiveBots, id: string) => b.source.snapshot().bots.find((x) => x.id === id);

describe('the roster is the user’s Hermes profiles, minus the default one', () => {
  it('lists each teammate with Hermes’s name and role, and never the default profile', async () => {
    const { bots } = await open();
    expect(bots.source.snapshot().bots.map((b) => [b.id, b.name, b.role])).toEqual([['atlas', 'atlas', 'reviews pull requests'], ['nina', 'Nina', 'deploys']]);
    expect(bots.source.snapshot().threads).toEqual({ atlas: [], nina: [] });
  });
  it('draws a stored look as stored and any other as the one its name gives, the same every time', async () => {
    const { bots } = await open();
    expect(botOf(bots, 'atlas')).toMatchObject({ shape: 'triangle', color: '#f23b5a' });
    expect(botOf(bots, 'atlas')).not.toHaveProperty('eyes');   // the record keeps its eyes; the UI ignores them
    const nina = botOf(bots, 'nina')!;
    expect({ shape: nina.shape, color: nina.color }).toEqual(lookFor('Nina'));
  });
  it('reports only what Hermes reports: model, skills, toolsets, routines, sessions, whether it runs', async () => {
    const { bots } = await open();
    const info = botOf(bots, 'atlas')!.info!;
    expect(info.model).toBe('main/fake-a');
    expect(info.skills).toEqual([{ name: 'git', label: 'git', enabled: true }, { name: 'web', label: 'web', enabled: false }]);
    expect(info.toolsets?.[0]).toMatchObject({ name: 'terminal', enabled: true });
    expect(info.jobs).toEqual([{ id: 'j1', name: 'morning', schedule: '0 9 * * 1-5', prompt: 'Review what changed', enabled: true, next: 'in 2 h', last: null }]);
    expect(info.sessions?.map((s) => s.title)).toEqual(['review billing', 'first words']);
    expect(info.running).toBe(true);                       // it wrote 30 s ago
    expect(botOf(bots, 'nina')!.info!.running).toBe(false);
    expect(botOf(bots, 'atlas')!.state).toBe('working');
    expect(botOf(bots, 'nina')!.info!.model).toBeNull();   // Hermes names none: unknown, not a guess
    expect(botOf(bots, 'atlas')!.cfg).toMatchObject({ instructions: 'You review.\n', model: 'main/fake-a', cron: '0 9 * * 1-5', gov: 'ungoverned' });
  });
  it('an archived profile is not a teammate, and its name is free', async () => {
    const h = new FakeHermes();
    h.profiles.push({ name: 'archived--hex', path: HOME + '/profiles/archived--hex', description: 'x' });
    h.archived['archived--hex'] = { name: 'hex', at: 't' };
    const { bots } = await open(h);
    expect(bots.source.snapshot().bots.map((b) => b.id)).toEqual(['atlas', 'nina']);
    expect(bots.source.archived.get()).toEqual([{ id: 'archived--hex', name: 'archived--hex', was: 'hex', at: 't', when: '' }]);
    expect(bots.source.admin!.planCreate('hex').profile).toBe('hex');
  });
  it('says why when Hermes cannot be read, and shows no bots instead of sample ones', async () => {
    const h = new FakeHermes(); h.failProfilesList = true;
    const { bots } = await open(h);
    expect(bots.source.snapshot().bots).toEqual([]);
    expect(bots.source.admin!.note()).toMatch(/gateway down/);
  });
  it('a teammate whose own link fails shows its schedule and sessions as unknown, with the reason', async () => {
    const h = new FakeHermes(); h.failLink = true;
    const { bots } = await open(h);
    const info = botOf(bots, 'atlas')!.info!;
    expect(info.jobs).toBeNull();
    expect(info.notes['jobs']).toMatch(/does not serve atlas/);
    expect(info.sessions?.[0]?.title).toBe('review billing');   // what the roster itself says of its newest session
    expect(bots.schedules.list.get()).toEqual([]);
  });
  it('reads the roster again on a sessions or cron change and announces what changed', async () => {
    const { h, bots, events } = await open();
    events.length = 0;
    h.profiles.push({ name: 'kai', path: HOME + '/profiles/kai', description: 'docs' });
    h.describes['kai'] = { name: 'kai', soul: '', model: { provider: '', default: '' } };
    (h.main as FakeLink).emit({ type: 'sessions.changed' });
    await new Promise((r) => setTimeout(r, 500)); await bots.settled();
    expect(events.filter((e) => e.type === 'bot-created').map((e) => (e as { bot: { id: string } }).bot.id)).toEqual(['kai']);
    h.profiles = h.profiles.filter((p) => p['name'] !== 'nina');
    await bots.source.admin!.open('atlas');
    (h.main as FakeLink).emit({ type: 'cron.changed' });
    await new Promise((r) => setTimeout(r, 500)); await bots.settled();
    expect(events.some((e) => e.type === 'bot-archived' && e.id === 'nina')).toBe(true);
  });
});

describe('the schedules are the teammates’ routines', () => {
  it('lists each job with its words, next run and state, and pauses and resumes through cron.manage on its own link', async () => {
    const { h, bots } = await open();
    expect(bots.schedules.list.get()).toEqual([{ id: 'atlas/j1', bot: 'atlas', what: 'morning', when: 'weekdays at 09:00', next: 'in 2 h', paused: false }]);
    bots.schedules.setPaused('atlas/j1', true);
    await bots.settled(); await new Promise((r) => setTimeout(r, 0)); await bots.settled();
    expect(h.links.get('atlas')!.calls.some((c) => c.method === 'cron.manage' && c.params['action'] === 'pause' && c.params['name'] === 'j1')).toBe(true);
    expect(bots.schedules.list.get()[0]).toMatchObject({ paused: true, next: '' });
  });
  it('cannot run a routine on demand and says so', async () => {
    const { bots } = await open();
    expect(bots.unavailable['schedules.runNow']).toMatch(/on demand/);
    expect(bots.unavailable['bots.send']).toMatch(/team chat/);
  });
});

describe('making a bot is Hermes’s profiles.create, then the look in boopis’s own store', () => {
  it('plans the folder, the model and a name that Hermes will accept', async () => {
    const { bots } = await open();
    const a = bots.source.admin!;
    expect(a.models()).toEqual(['main/fake-a', 'main/fake-b', 'nous/hermes-4']);   // the configured providers only, the current one first
    expect(a.planCreate('Kai')).toEqual({ profile: 'kai', folder: HOME + '/profiles/kai', model: 'main/fake-a', notes: [] });
    expect(a.planCreate('atlas').profile).toBe('atlas-2');
    expect(a.planCreate('default').profile).toBe('default-2');
    expect(a.planCreate('archived--x').profile).toBe('x');
    expect(a.planCreate('nova!').notes[0]).toMatch(/It will be called nova/);
  });
  it('creates the profile with no alias, the model of a configured provider and the role, saves the look, and opens it', async () => {
    const { h, bots, events } = await open();
    events.length = 0;
    const made = await bots.source.admin!.create({ name: 'kai', role: 'docs and changelog', shape: 'drop', color: '#4fc9a8', instructions: 'You write docs.' }, { model: 'nous/hermes-4' });
    const call = h.main.calls.find((c) => c.method === 'profiles.create')!;
    expect(call.params).toEqual({ name: 'kai', description: 'docs and changelog', no_alias: true, soul: 'You write docs.\n', provider: 'nous', model: 'hermes-4' });
    expect(h.own['kai']).toMatchObject({ look: { shape: 'drop', color: '#4fc9a8' }, settings: { gov: 'governed' } });
    expect(made).toMatchObject({ id: 'kai', shape: 'drop' });
    expect(made.info?.model).toBe('nous/hermes-4');
    expect(events.map((e) => e.type)).toContain('bot-created');
  });
  it('a model that no configured provider has is refused before anything is made', async () => {
    const { h, bots } = await open();
    await expect(bots.source.admin!.create({ name: 'kai', role: '', shape: 'circle', color: '#fff000', instructions: '' }, { model: 'ghost/none' })).rejects.toThrow(/not a model of a configured provider/);
    expect(h.main.calls.some((c) => c.method === 'profiles.create')).toBe(false);
  });
});

describe('the settings sheet edits the real profile, and shows the diff first', () => {
  it('plans each write by the file Hermes keeps it in', async () => {
    const { bots } = await open();
    const w = bots.source.admin!.review('atlas', { role: 'security reviewer', instructions: 'You review.\nBe terse.\n', model: 'main/fake-b', addRoutines: [{ name: 'weekly', prompt: 'p', schedule: '0 9 * * 1' }], removeRoutines: ['j1'] });
    expect(w).toEqual([
      { file: 'profiles/atlas/profile.yaml: role', diff: '- reviews pull requests\n+ security reviewer' },
      { file: 'profiles/atlas/SOUL.md', diff: '  You review.\n+ Be terse.' },
      { file: 'profiles/atlas/config.yaml: model', diff: '- main/fake-a\n+ main/fake-b' },
      { file: 'profiles/atlas/cron: routines', diff: '- weekdays at 09:00: morning\n+ mondays at 09:00: weekly' }
    ]);
    expect(bots.source.admin!.review('atlas', { role: 'reviews pull requests', instructions: 'You review.\n' })).toEqual([]);
  });
  it('saves through profiles.configure and cron.manage, then reads the profile again', async () => {
    const { h, bots } = await open();
    await bots.source.admin!.save('atlas', { role: 'security reviewer', instructions: 'New soul\n', model: 'main/fake-b', addRoutines: [{ name: 'weekly', prompt: 'look', schedule: '0 9 * * 1' }], removeRoutines: ['j1'] });
    expect(h.main.calls.find((c) => c.method === 'profiles.configure')!.params).toEqual({ name: 'atlas', description: 'security reviewer', soul: 'New soul\n', provider: 'main', model: 'fake-b' });
    expect(h.links.get('atlas')!.calls.filter((c) => c.method === 'cron.manage').map((c) => c.params['action'])).toEqual(expect.arrayContaining(['remove', 'add']));
    const b = botOf(bots, 'atlas')!;
    expect([b.role, b.cfg.instructions, b.cfg.model, b.info!.jobs?.map((j) => j.name)]).toEqual(['security reviewer', 'New soul\n', 'main/fake-b', ['weekly']]);
  });
  it('asks for confirmation when Hermes does, and sends the confirmed pick once', async () => {
    const { h, bots } = await open();
    const orig = h.main.requestRaw.bind(h.main);
    h.main.requestRaw = async (m: string, p: Json) => (m === 'profiles.configure' && !p['confirm_expensive_model'] && p['model'] ? { ok: true, applied: {}, confirm_required: true, confirm_message: 'This model is expensive.' } : orig(m, p));
    await expect(bots.source.admin!.save('atlas', { model: 'nous/hermes-4' })).rejects.toBeInstanceOf(NeedsConfirmation);
    expect(botOf(bots, 'atlas')!.info!.model).toBe('main/fake-a');          // nothing of the model was written
    await bots.source.admin!.save('atlas', { model: 'nous/hermes-4' }, { confirmModel: true });
    expect(botOf(bots, 'atlas')!.info!.model).toBe('nous/hermes-4');
  });
  it('says what Hermes refused and keeps what it accepted', async () => {
    const { h, bots } = await open();
    h.describes['atlas']!['soul'] = 'x';
    const orig = h.main.requestRaw.bind(h.main);
    h.main.requestRaw = async (m: string, p: Json) => (m === 'profiles.configure' ? { ok: false, applied: { soul: false, description: true } } : orig(m, p));
    await expect(bots.source.admin!.save('atlas', { role: 'r', instructions: 'y' })).rejects.toThrow(/did not save SOUL\.md/);
  });
  it('saves boopis’s own settings in the plugin’s store, never through a Hermes config method', async () => {
    const { h, bots } = await open();
    await bots.source.admin!.saveOwn('atlas', { cfg: { gov: 'governed', cap: '1.00', approvals: { push: false } }, look: { shape: 'star' } });
    expect(h.main.calls.at(-1)).toMatchObject({ method: 'plugin.boopis.bots.write', params: { name: 'atlas', look: { shape: 'star' }, settings: { gov: 'governed', cap: '1.00' }, approvals: { push: false } } });
    expect(h.main.calls.some((c) => c.method === 'profiles.configure')).toBe(false);
    expect(botOf(bots, 'atlas')).toMatchObject({ shape: 'star', cfg: { gov: 'governed', cap: '1.00' } });
  });
});

describe('archive keeps everything, delete asks first and says what goes', () => {
  it('archives by pausing the routines, closing the link and asking the plugin; undo brings it all back', async () => {
    const { h, bots, events } = await open();
    const link = h.links.get('atlas')!;
    events.length = 0;
    const done = await bots.source.admin!.archive('atlas');
    expect(link.calls.some((c) => c.params['action'] === 'pause' && c.params['name'] === 'j1')).toBe(true);
    expect(link.closed).toBe(true);
    expect(h.main.calls.find((c) => c.method === 'plugin.boopis.bots.archive')!.params).toEqual({ name: 'atlas', paused_jobs: ['j1'] });
    expect(events).toContainEqual({ type: 'bot-archived', id: 'atlas' });
    expect(bots.source.snapshot().bots.map((b) => b.id)).toEqual(['nina']);
    expect(bots.source.admin!.planCreate('atlas').profile).toBe('atlas');       // the name returned
    await done.undo();
    expect(bots.source.snapshot().bots.map((b) => b.id)).toContain('atlas');
    expect(h.jobs['atlas']![0]!['enabled']).toBe(true);                         // its routine runs again
  });
  it('a failed archive resumes the routines it paused', async () => {
    const { h, bots } = await open();
    const orig = h.main.requestRaw.bind(h.main);
    h.main.requestRaw = async (m: string, p: Json) => { if (m === 'plugin.boopis.bots.archive') throw new Error('hx.bots.hermes_failed'); return orig(m, p); };
    await expect(bots.source.admin!.archive('atlas')).rejects.toThrow(/hermes_failed/);
    expect(h.jobs['atlas']![0]!['enabled']).toBe(true);
    expect(bots.source.snapshot().bots.map((b) => b.id)).toContain('atlas');
  });
  it('says what deleting removes, counted by the plugin on the disk', async () => {
    const { bots } = await open();
    const note = await bots.source.admin!.removal('atlas');
    expect(note.folder).toBe(HOME + '/profiles/atlas');
    expect(note.lines).toEqual([
      'The folder ' + HOME + '/profiles/atlas (3.0 MB in 240 files).', 'All its sessions and what they said.', 'Its memory (2 files).', 'Its 9 skills.', 'Its 1 routine.', 'Its look and its boopis settings.'
    ]);
  });
  it('deletes only with the name, through the plugin, and the bot goes', async () => {
    const { h, bots } = await open();
    await expect(bots.source.admin!.remove('atlas', 'yes')).rejects.toThrow();
    expect(bots.source.snapshot().bots.map((b) => b.id)).toContain('atlas');
    await bots.source.admin!.remove('atlas', 'atlas');
    expect(h.links.get('atlas')!.closed).toBe(true);
    expect(bots.source.snapshot().bots.map((b) => b.id)).toEqual(['nina']);
  });
});

describe('which profiles boopis did not make (the "made outside boopis" mark)', () => {
  it('keeps the mark through an archive and a restore: those write only the `archived` note, never a look or a setting', () => {
    const p = (record: Record<string, unknown> | null) => ({ name: 'nina', path: '/p', record, problem: null, archived: null }) as Parameters<typeof madeOutside>[0];
    expect(madeOutside(p({ schema_version: 1, archived: { name: 'nina', at: '2026-11-19T12:00:00' } }))).toBe(true);
    expect(madeOutside(p({ schema_version: 1 }))).toBe(true);
    expect(madeOutside(p({ schema_version: 1, look: { color: '#4fc9a8' } }))).toBe(false);
    expect(madeOutside(p({ schema_version: 1, settings: { cap: '1.00' } }))).toBe(false);
    expect(madeOutside(p({ schema_version: 1, approvals: { deploy: true } }))).toBe(false);
  });
  it('a profile with no store of boopis’s own is marked, and one with a store is not', async () => {
    const { bots } = await open();
    expect(botOf(bots, 'nina')!.madeOutside).toBe(true);        // no boopis/bot.json: the plugin reads `record: null`
    expect(botOf(bots, 'atlas')!.madeOutside).toBeUndefined();   // atlas has its record
  });
  it('is marked only on what the plugin said: a plugin that did not answer, or a store it could not read, marks nothing', async () => {
    const none = new FakeHermes(); none.failOwn = true;
    expect(botOf((await open(none)).bots, 'nina')!.madeOutside).toBeUndefined();
    const broken = new FakeHermes(); broken.problems['nina'] = 'bot.json could not be read: bad json';
    expect(botOf((await open(broken)).bots, 'nina')!.madeOutside).toBeUndefined();
  });
  it('saving any boopis setting creates the store, and the next event says the mark is gone', async () => {
    const { bots, events } = await open();
    events.length = 0;
    await bots.source.admin!.saveOwn('nina', { cfg: { cap: '1.00' } });
    const bot = events.find((e) => e.type === 'bot') as { bot: { id: string; madeOutside?: true } };
    expect(bot.bot.id).toBe('nina');
    expect('madeOutside' in bot.bot).toBe(false);
    expect(botOf(bots, 'nina')!.madeOutside).toBeUndefined();
  });
  it('a look saved for it does the same', async () => {
    const { bots } = await open();
    await bots.source.admin!.saveOwn('nina', { look: { shape: 'star' } });
    expect(botOf(bots, 'nina')!.madeOutside).toBeUndefined();
  });
  it('writing a Hermes setting (the role) creates no store of boopis’s, so the mark stays', async () => {
    const { bots } = await open();
    await bots.source.admin!.save('nina', { role: 'ships things' });
    expect(botOf(bots, 'nina')!.madeOutside).toBe(true);
  });
});

describe('archived bots, restored from the Archived group and the palette', () => {
  const archive = (h: FakeHermes, name: string, was: string, at: string): void => {
    h.profiles.push({ name, path: HOME + '/profiles/' + name, description: 'x' });
    h.archived[name] = { name: was, at, paused_jobs: [] };
  };
  it('lists them newest first, by the name they return to, with when as the lists say it', async () => {
    const h = new FakeHermes();
    archive(h, 'archived--old', 'old', '2026-11-12T10:00:00+00:00');
    archive(h, 'archived--hex', 'hex', '2026-11-18T09:30:00+00:00');
    archive(h, 'archived--now', 'now', '2026-11-19T09:58:00+00:00');
    archive(h, 'archived--lost', 'lost', '');
    const { bots } = await open(h);
    expect(bots.source.archived.get().map((a) => [a.was, a.when])).toEqual([['now', '2m'], ['hex', 'yesterday'], ['old', '12/11'], ['lost', '']]);
  });
  it('restores one under its old name: the plugin renames it, the roster reads again, the routines it paused run again', async () => {
    const h = new FakeHermes();
    archive(h, 'archived--hex', 'hex', '2026-11-18T09:30:00+00:00');
    h.archived['archived--hex']!['paused_jobs'] = ['j9'];
    h.jobs['archived--hex'] = [{ job_id: 'j9', name: 'scan', schedule: '0 9 * * 1', prompt_preview: 'scan', enabled: false }];
    h.describes['hex'] = { name: 'hex', soul: '', model: { provider: '', default: '' } };
    const { bots, events } = await open(h);
    events.length = 0;
    await bots.source.restore('archived--hex');
    await bots.settled();
    expect(h.main.calls.find((c) => c.method === 'plugin.boopis.bots.restore')!.params).toEqual({ name: 'archived--hex' });
    expect(events.some((e) => e.type === 'bot-created' && e.bot.id === 'hex')).toBe(true);
    expect(bots.source.archived.get()).toEqual([]);
    expect(h.jobs['hex']![0]!['enabled']).toBe(true);
  });
  it('refuses a name that is in use again before anything moves, with the plugin’s own words, and the archived bot stays', async () => {
    const h = new FakeHermes();
    archive(h, 'archived--nina', 'nina', '2026-11-16T17:05:00+00:00');
    const { bots } = await open(h);
    await expect(bots.source.restore('archived--nina')).rejects.toThrow('there is a teammate called nina already; archive or delete it, then restore');
    expect(h.main.calls.some((c) => c.method === 'plugin.boopis.bots.restore')).toBe(false);
    expect(bots.source.archived.get().map((a) => a.was)).toEqual(['nina']);
  });
  it('a restore the plugin refuses reaches the user as the plugin said it', async () => {
    const h = new FakeHermes();
    archive(h, 'archived--hex', 'hex', '2026-11-18T09:30:00+00:00');
    const { bots } = await open(h);
    const orig = h.main.requestRaw.bind(h.main);
    h.main.requestRaw = async (m: string, p: Json) => { if (m === 'plugin.boopis.bots.restore') throw new Error('there is a teammate called hex already; archive or delete it, then restore'); return orig(m, p); };
    await expect(bots.source.restore('archived--hex')).rejects.toThrow(/already/);
  });
});

describe('what a teammate cannot do yet is not pretended', () => {
  it('sending to it does nothing and nothing is added to its thread', async () => {
    const { bots, events } = await open();
    events.length = 0;
    bots.source.send('atlas', 'hello', 'bots');
    expect(events).toEqual([]);
    expect(bots.source.stop('atlas')).toBe(false);
  });
  it('the catalog lists only this app as a channel, and reserves default', async () => {
    const { bots } = await open();
    expect(bots.source.catalog().channels).toEqual([{ id: 'app', name: 'This app', hint: 'always on' }]);
    expect(bots.source.catalog().reserved).toEqual(['default']);
  });
});
