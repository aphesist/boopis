// @vitest-environment jsdom
/* One look, everywhere: a bot is drawn with the same shape and colour in every place an orb of it appears (the roster, its
   room's header, the dock, a group's row and header, a card's origin, the palette), from real-shaped data: the live
   provider over a fake gateway that answers `profiles.list` and the plugin's `bots.read` the way they answer, with the
   owner's six records (`<profile>/boopis/bot.json`, 22 November 2026) and a profile made outside boopis (no record).

   The owner's bug: the six profiles were made first and their records written afterwards, while the app ran, so the app
   drew each bot with the look its name gives (kai a blue star) and then read the saved look (kai a teal circle). The room
   drew the saved look; the roster row kept the orb it had drawn and the dock copied only the state, so both kept the
   name's look. The test walks that sequence. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kit, lookFor } from '@boopis/ui';
import { data, setProvider } from '../../data';
import type { DataProvider, Group } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createLiveBots } from '../../host/live/bots';
import type { LiveBots } from '../../host/live/bots';
import type { GatewayClient, GatewayEvent } from '../../host/gateway';
import { registered } from '../../core/registry';
import { emit } from '../../core/bus';
import { sh } from '../shell/ctx';
import type { Els } from '../shell/ctx';
import { openPalette } from '../shell/palette';
import '../cards';
import '../dock';
import './index';
import { S } from './model';
import { openGroup } from './group-room';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const HOME = '/home/owner/.local/share/dev.aphesist.boopis/engine';
const NOW = new Date('2026-11-22T23:58:00Z');

/** the owner's records, as the plugin's `bots.read` returns them (look, settings, approvals, schema_version) */
const LOOKS: Record<string, { color: string; shape: string }> = {
  kai: { color: '#4fc9a8', shape: 'circle' },
  nina: { color: '#f23b5a', shape: 'triangle' },
  moss: { color: '#2fd26a', shape: 'squircle' },
  iris: { color: '#3b82f6', shape: 'flower' },
  hex: { color: '#a6a6ab', shape: 'hexagon' },
  nimbus: { color: '#9b5cf6', shape: 'cloud' }
};
const record = (name: string): Json => ({
  schema_version: 1,
  look: { ...LOOKS[name] },
  settings: { gov: 'governed', cap: '0.60', workspace: 'worktree' },
  approvals: { deploys: true, push: true, network: true, spend: true, people: true, outside: true }
});
const TEAM = Object.keys(LOOKS);
/** a profile made with the hermes command that boopis never saved anything for */
const OUTSIDE = 'vox';

class FakeLink {
  private subs = new Set<(e: GatewayEvent) => void>();
  constructor(private readonly handle: (method: string, params: Json) => unknown) {}
  request(method: string, params: Json): Promise<unknown> { return this.requestRaw(method, params); }
  async requestRaw(method: string, params: Json): Promise<unknown> { return this.handle(method, params); }
  onEvent(fn: (e: GatewayEvent) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  onState(): () => void { return () => undefined; }
  close(): Promise<void> { return Promise.resolve(); }
  emit(ev: GatewayEvent): void { for (const f of this.subs) f(ev); }
}
/** profiles and the plugin's records, the way the gateway and the plugin answer */
class FakeEngine {
  own: Record<string, Json> = {};
  profiles: Json[] = [{ name: 'default', path: HOME, is_default: true, description: '' }, ...[...TEAM, OUTSIDE].map((name) => ({ name, path: HOME + '/profiles/' + name, description: name + ' of the Paper Past team' }))];
  main = new FakeLink((m, p) => this.call(m, p));
  linkTo = (profile: string): Promise<GatewayClient> => Promise.resolve(new FakeLink((m) => {
    if (m === 'cron.manage') return { success: true, jobs: [] };
    if (m === 'session.list') return { sessions: [] };
    throw new Error('unexpected ' + m + ' on ' + profile);
  }) as unknown as GatewayClient);
  private call(method: string, p: Json): unknown {
    switch (method) {
      case 'profiles.list': return { profiles: this.profiles };
      case 'profiles.describe': return { name: p['name'], description: p['name'] + ' of the Paper Past team', soul: '', model: { provider: 'claude-subscription-directsdk-experimental', default: 'sonnet' }, skills: [], toolsets: [] };
      case 'model.options': return { providers: [], provider: '', model: '' };
      case 'plugin.boopis.bots.read': return { root: HOME, bots: this.profiles.filter((x) => !x.is_default).map((x) => ({ name: x.name, path: x.path, record: this.own[x.name] ?? null, problem: null, archived: null })) };
      case 'plugin.boopis.bots.write': this.own[p['name']] = { ...(this.own[p['name']] ?? { schema_version: 1 }), ...(p['look'] ? { look: p['look'] } : {}) }; return { record: this.own[p['name']] };
      default: throw new Error('unknown method ' + method);
    }
  }
}

const PAPER_PAST: Group = { id: 'g-paper-past-', name: 'paper past', members: TEAM.map((id) => ({ id, profile: id, handle: id, name: id })), working: [], busy: false, queued: [] };
const tick = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const flush = async (ms = 20): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); await tick(); };

/** every orb of `id` on the page: its wrapper is `ui.orb`'s, marked with the bot's id */
const orbsOf = (id: string, root: ParentNode = document): Element[] => [...root.querySelectorAll('.ui-orb[data-bot="' + id + '"] > orb-avatar')];
const lookOn = (o: Element): string => o.getAttribute('shape') + ' ' + o.getAttribute('color');
const want = (l: { shape: string; color: string }): string => l.shape + ' ' + l.color;
/** the places that must agree, each found on its own so a place that draws nothing fails too */
function places(id: string): Record<string, Element[]> {
  const card = document.getElementById('one-look-card') as HTMLElement;
  return {
    roster: orbsOf(id, S.rows.get(id)?.li ?? document.createElement('i')),
    /* the dock's own orb of the bot (in its row or kept aside while another page shows), and any copy on the dock */
    dock: orbsOf(id, document.querySelector('.dk') ?? document.createElement('i')),
    'group row': orbsOf(id, document.querySelector('.bt-groups') ?? document.createElement('i')),
    'card origin': orbsOf(id, card),
    palette: orbsOf(id, document.getElementById('hx-palette-list') ?? document.createElement('i'))
  };
}

let engine: FakeEngine;
let live: LiveBots;
async function mount(): Promise<void> {
  engine = new FakeEngine();
  live = createLiveBots({ client: engine.main as unknown as GatewayClient, linkTo: engine.linkTo, now: () => NOW, pollMs: null });
  await live.ready; await live.settled();
  const mock = createMockProvider({ simulate: false });
  const provider: DataProvider = {
    ...mock, info: { live: true, preview: new Set(['feedforward']), unavailable: {} }, bots: live.source, schedules: live.schedules,
    groups: { ...mock.groups, snapshot: () => ({ groups: [PAPER_PAST], threads: { [PAPER_PAST.id]: [] } }) }
  };
  setProvider(provider);
  document.body.innerHTML = '<div id="list"></div><div id="room"></div><div id="dock"></div><div id="one-look-card"></div>' +
    '<div id="hx-palette" hidden><input id="hx-palette-input"><div id="hx-palette-list"></div></div><button id="hx-btn-search"></button>';
  sh.el = { palette: document.getElementById('hx-palette'), palInput: document.getElementById('hx-palette-input'), palList: document.getElementById('hx-palette-list'), btnSearch: document.getElementById('hx-btn-search'), settings: { open: false } } as unknown as Els;
  registered('bots-list')?.mount(document.getElementById('list') as HTMLElement);
  registered('bots')?.mount(document.getElementById('room') as HTMLElement);
  registered('dock')?.mount(document.getElementById('dock') as HTMLElement);
  await flush();
}
/** what the page shows now in every other place (redrawn each time, as they are when they open) */
function drawTransient(): void {
  const card = document.getElementById('one-look-card') as HTMLElement;
  /* an ask's lead, as the form's AskCard draws it (form.ts askerLead): one asker's orb, several askers' stack */
  const bots = data().bots.snapshot().bots, one = (id: string) => bots.find((b) => b.id === id) ?? { id, name: id };
  card.innerHTML = [...TEAM, OUTSIDE].map((id) => kit.html.avatar({ bot: one(id), size: 16 })).join('') + kit.html.avatar({ variant: 'stack', members: TEAM.map(one), size: 16, max: 6 });
  openPalette({ scope: 'bots' });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Element.prototype.scrollIntoView = (): void => undefined;
  Element.prototype.scrollTo = (): void => undefined;
  (Element.prototype as unknown as { animate: () => { finished: Promise<void>; cancel: () => void; onfinish: null } }).animate = () => ({ finished: Promise.resolve(), cancel: () => undefined, onfinish: null });
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => { fn(0); }, 0));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('a bot looks the same in every place', () => {
  it('before its record is written, everywhere wears the look its name gives; once it is written, everywhere wears the saved look', async () => {
    await mount();

    /* 1. the profiles exist, boopis has no record of them yet: the look each name gives, the same in every place */
    drawTransient();
    for (const id of [...TEAM, OUTSIDE]) {
      for (const [where, orbs] of Object.entries(places(id))) {
        if (where === 'group row') continue;   /* a group row draws a member that is a bot of the user, checked below */
        expect(orbs.length, id + ' in the ' + where).toBeGreaterThan(0);
        for (const o of orbs) expect(lookOn(o), id + ' in the ' + where).toBe(want(lookFor(id)));
      }
    }

    /* 2. the records are written from elsewhere (the team was set up through the plugin while the app ran) and the roster
          is read again: the six are drawn with the saved look in every place, the profile made outside keeps its name's */
    for (const id of TEAM) engine.own[id] = record(id);
    engine.main.emit({ type: 'profiles.changed', payload: {} } as unknown as GatewayEvent);
    await flush(500); await live.settled(); await flush();
    drawTransient();
    for (const id of TEAM) {
      for (const [where, orbs] of Object.entries(places(id))) {
        if (where === 'group row' && !orbs.length) continue;   /* folded into "+N" */
        expect(orbs.length, id + ' in the ' + where).toBeGreaterThan(0);
        for (const o of orbs) expect(lookOn(o), id + ' in the ' + where).toBe(want(LOOKS[id]!));
      }
    }
    for (const [where, orbs] of Object.entries(places(OUTSIDE))) {
      if (where === 'group row') continue;
      for (const o of orbs) expect(lookOn(o), OUTSIDE + ' in the ' + where).toBe(want(lookFor(OUTSIDE)));
    }
    expect(places('kai')['group row']!.length, 'the group row shows its first members').toBeGreaterThan(0);

    /* 3. a bot's room (it has no header of its own since board 11: the chrome's title pill and the details pane carry its orb; whatever
       orb of it the room draws, an ask's or the status line's, wears the same look), and the group's row: the same looks */
    for (const id of TEAM) {
      emit('hx:bot-select', { id, from: 'test' });
      await flush();
      for (const o of orbsOf(id, document.getElementById('room') as HTMLElement)) expect(lookOn(o), id + ' in its room').toBe(want(LOOKS[id]!));
    }
    openGroup(PAPER_PAST.id);
    await flush();
    /* a room has no header of its own (board 12): its members' stack is its row's in the sidebar (and the title pill's) */
    const gh = document.querySelector('.bt-group-rows [data-gid="' + PAPER_PAST.id + '"]') as HTMLElement;
    for (const id of TEAM.slice(0, 3)) {
      const orbs = orbsOf(id, gh);
      expect(orbs.length, id + ' in the group\'s row').toBe(1);
      expect(lookOn(orbs[0]!), id + ' in the group\'s row').toBe(want(LOOKS[id]!));
    }
    expect(gh.querySelector('.ui-stack__more')?.getAttribute('data-more')).toBe('+3');

    /* 4. nothing anywhere on the page draws one of the six in another look */
    for (const id of TEAM) for (const o of orbsOf(id)) expect(lookOn(o), id).toBe(want(LOOKS[id]!));
  }, 30_000);   /* it mounts the whole Bots tab and the dock and walks six rooms */
});
