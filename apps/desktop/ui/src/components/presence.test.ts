import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from './index';
import { elapsedWords, HOLD_MS, presence, presenceLabel, presenceLayout, presencePill, presenceWords } from './presence';
import type { PresenceActor, PresenceStatus } from './presence';

const bot = (name: string) => ({ id: name, name, shape: 'circle', color: '#5b8def' });
const a = (name: string, status: PresenceStatus = 'thinking', extra: Partial<PresenceActor> = {}): PresenceActor => ({ id: name, bot: bot(name), status, ...extra });
const text = (el: Element): string => el.querySelector('.ui-presence__words:not([data-leave])')?.textContent ?? '';
const orbOf = (el: Element, id: string): Element | null => el.querySelector('.ui-presence__slot[data-id="' + id + '"]:not([data-leave]) orb-avatar');
const SIX = ['atlas', 'nina', 'kai', 'moss', 'sol', 'vox'];

describe('what the presence says', () => {
  it('one bot: the state alone (its name is in the margin), or what it is doing in words', () => {
    expect(presenceLayout([a('atlas')])).toMatchObject({ mode: 'one' });
    expect(presenceLayout([a('atlas')]).rows[0]!.parts.map((p) => p.v).join('')).toBe('thinking');
    expect(presenceLayout([a('atlas', 'tool', { doing: 'reading a file' })]).rows[0]!.parts.map((p) => p.v).join('')).toBe('reading a file');
    expect(presenceLayout([a('atlas', 'tool', { compute: true })]).rows[0]!.parts.map((p) => p.v).join('')).toBe('running');
    expect(presenceWords([a('atlas', 'needs')])).toBe('atlas needs you');
  });
  it('names one, two and three, then counts (the stack and the accessible name keep every name)', () => {
    expect(presenceWords([a('atlas'), a('nina')])).toBe('atlas and nina are thinking');
    expect(presenceWords(['atlas', 'nina', 'kai'].map((n) => a(n)))).toBe('atlas, nina and kai are thinking');
    const six = SIX.map((n) => a(n));
    expect(presenceWords(six)).toBe('6 bots are thinking');
    expect(presenceLabel(six)).toBe('6 bots are thinking: atlas, nina, kai, moss, sol and vox');
    expect(presenceLayout(six).mode).toBe('line');
  });
  it('two different things are one sentence; three are rows; more than the rows allow are a count with Details', () => {
    const two = [a('atlas'), a('nina', 'tool', { doing: 'reading a file' })];
    expect(presenceLayout(two).mode).toBe('line');
    expect(presenceWords(two)).toBe('atlas is thinking, nina is reading a file');
    const three = [a('atlas'), a('nina', 'tool', { doing: 'reading a file' }), a('kai', 'replying')];
    const rows = presenceLayout(three);
    expect(rows.mode).toBe('rows');
    expect(rows.rows.map((r) => r.parts.map((p) => p.v).join(''))).toEqual(['atlas is thinking', 'nina is reading a file', 'kai is replying']);
    const tools = ['reading a file', 'in the terminal', 'searching the web', 'editing a file', 'running code', 'reading a page'];
    const many = SIX.map((n, i) => a(n, 'tool', { doing: tools[i] }));
    const sum = presenceLayout(many);
    expect(sum.mode).toBe('summary');
    expect(sum.rows).toHaveLength(1);
    expect(sum.rows[0]!.ids).toHaveLength(6);
    expect(sum.rows[0]!.parts.map((p) => p.v).join('')).toBe('6 bots are working');
    const open = presenceLayout(many, { open: true });
    expect(open.rows).toHaveLength(7);
    expect(open.rows[0]!.ids).toHaveLength(0);
  });
  it('a bot that needs the owner, or failed, always has its own row, and is said first', () => {
    const l = presenceLayout([a('atlas'), a('kai'), a('nina', 'needs')]);
    expect(l.mode).toBe('rows');
    expect(l.rows.map((r) => r.tone)).toEqual(['busy', 'attention']);
    expect(presenceWords([a('atlas'), a('nina', 'needs')])).toBe('nina needs you');
    expect(presenceWords([a('atlas'), a('nina', 'needs'), a('kai', 'needs')])).toBe('nina and kai need you');
    expect(presenceLayout([a('atlas'), a('nina', 'failed')]).rows[1]!.parts.map((p) => p.v).join('')).toBe('nina failed');
  });
  it('queued bots are next, in the same sentence', () => {
    expect(presenceWords([a('atlas'), a('nina', 'next'), a('kai', 'next')])).toBe('atlas is thinking, nina and kai are next');
  });
  it('the clock in words', () => {
    expect([0, 42_000, 185_000, 3_720_000].map(elapsedWords)).toEqual(['0s', '42s', '3m 05s', '1h 02m']);
  });
});

describe('the presence entry', () => {
  afterEach(() => { document.body.textContent = ''; vi.useRealTimers(); });
  const make = (actors: readonly PresenceActor[]) => { const el = presence({ actors, announce: false, now: () => 1_000_000 }); document.body.append(el); return el; };

  it('is an article in the thread, named by its sentence, and not re-read on every change', () => {
    const el = make([a('atlas'), a('nina')]);
    expect(el.tagName).toBe('ARTICLE');
    expect(el.classList.contains('ui-entry')).toBe(true);
    expect(el.getAttribute('aria-live')).toBe('off');
    expect(el.getAttribute('aria-label')).toBe('atlas and nina are thinking');
    expect(el.querySelector('.ui-presence__orbs')!.getAttribute('aria-hidden')).toBe('true');
    expect(text(el)).toBe('atlas and nina are thinking');
  });
  it('one bot shows its name and who asked it, when that was not the owner; several show no names in the margin', () => {
    const el = make([a('kai', 'thinking', { by: 'atlas', since: 1_000_000 - 72_000 })]);
    expect(el.querySelector<HTMLElement>('.ui-presence__name')!.hidden).toBe(false);
    expect(el.querySelector('.ui-presence__name')!.textContent).toBe('kai');
    expect(el.querySelector('.ui-presence__by')!.textContent).toBe('asked by atlas');
    expect(el.querySelector('.ui-presence__clock')!.textContent).toBe('1m 12s');
    el.update([a('kai', 'thinking', { by: 'you' }), a('nina')]);
    expect(el.querySelector<HTMLElement>('.ui-presence__name')!.hidden).toBe(true);
    expect(el.querySelector<HTMLElement>('.ui-presence__by')!.hidden).toBe(true);
  });
  it('keeps every orb from joining to leaving: an update writes faces and places, never a new orb', () => {
    const el = make([a('atlas')]);
    const atlas = orbOf(el, 'atlas');
    el.update([a('atlas', 'tool', { doing: 'reading a file' }), a('nina')]);
    expect(orbOf(el, 'atlas')).toBe(atlas);
    expect(atlas!.getAttribute('reaction')).toBe('working');
    const nina = orbOf(el, 'nina');
    expect(nina!.getAttribute('reaction')).toBe('thinking');
    expect((nina!.closest('.ui-presence__slot') as HTMLElement).style.getPropertyValue('--col')).toBe('1');
    el.update([a('nina', 'replying')]);
    expect(orbOf(el, 'nina')).toBe(nina);
    expect(nina!.getAttribute('reaction')).toBe('speaking');
    expect((nina!.closest('.ui-presence__slot') as HTMLElement).style.getPropertyValue('--col')).toBe('0');
    expect(el.querySelector('.ui-presence__slot[data-id="atlas"]')!.hasAttribute('data-leave')).toBe(true);
  });
  it('folds past five places into "+N" and travels the orbs into rows when the work differs', () => {
    const el = make(['atlas', 'nina', 'kai', 'moss', 'sol', 'vox', 'iris'].map((n) => a(n)));
    expect(el.querySelectorAll('.ui-presence__slot orb-avatar')).toHaveLength(4);
    expect(el.querySelector('.ui-stack__more')!.getAttribute('data-more')).toBe('+3');
    el.update([a('atlas'), a('nina', 'tool', { doing: 'reading a file' }), a('kai', 'replying')]);
    expect(el.dataset['mode']).toBe('rows');
    const rows = ['atlas', 'nina', 'kai'].map((n) => (orbOf(el, n)!.closest('.ui-presence__slot') as HTMLElement).style.getPropertyValue('--row'));
    expect(rows).toEqual(['0', '1', '2']);
    expect(el.querySelectorAll('.ui-presence__words:not([data-leave]) .ui-presence__row')).toHaveLength(3);
  });
  it('Details unfolds a summary into rows, by click or by its property', () => {
    const tools = ['reading a file', 'in the terminal', 'searching the web', 'editing a file', 'running code', 'reading a page'];
    const el = make(SIX.map((n, i) => a(n, 'tool', { doing: tools[i] })));
    const d = el.querySelector<HTMLButtonElement>('.ui-disclosure')!;
    expect(d.hidden).toBe(false);
    expect(d.getAttribute('aria-expanded')).toBe('false');
    d.click();
    expect(el.open).toBe(true);
    expect(d.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelectorAll('.ui-presence__words:not([data-leave]) .ui-presence__row')).toHaveLength(7);
    el.open = false;
    expect(el.querySelectorAll('.ui-presence__words:not([data-leave]) .ui-presence__row')).toHaveLength(1);
  });
  it('holds the words for a moment before a tool changes them, but says a newcomer at once', () => {
    vi.useFakeTimers();
    const el = make([a('atlas', 'tool', { doing: 'reading a file' })]);
    el.update([a('atlas', 'tool', { doing: 'editing a file' })]);
    expect(text(el)).toBe('reading a file');
    expect(orbOf(el, 'atlas')!.getAttribute('reaction')).toBe('working');
    vi.advanceTimersByTime(HOLD_MS + 10);
    expect(text(el)).toBe('editing a file');
    el.update([a('atlas', 'tool', { doing: 'in the terminal', compute: true }), a('nina')]);
    expect(text(el)).toBe('atlas is in the terminal, nina is thinking');
    expect(orbOf(el, 'atlas')!.getAttribute('reaction')).toBe('compute');
  });
  it('says the coarse changes once, politely: who starts, who joins, never each tool', () => {
    vi.useFakeTimers();
    const live = (): string => document.querySelector('.ui-sr[role="status"][aria-live="polite"]')?.textContent ?? '';
    const el = presence({ actors: [a('atlas')] });
    document.body.append(el);
    vi.advanceTimersByTime(50);
    expect(live()).toBe('atlas is thinking');
    el.update([a('atlas', 'tool', { doing: 'reading a file' })]);
    vi.advanceTimersByTime(50);
    expect(live()).toBe('atlas is thinking');
    el.update([a('atlas'), a('nina')]);
    vi.advanceTimersByTime(50);
    expect(live()).toBe('atlas and nina are thinking');
  });
  it('the kit offers it as ui.presence, with its pill', () => {
    expect(typeof ui.presence).toBe('function');
    expect(typeof ui.presence.pill).toBe('function');
  });
});

describe('the pill', () => {
  it('shows the bots at work still, at 16, and their words, or the replies that arrived; it keeps its orbs', () => {
    const p = presencePill();
    document.body.append(p);
    p.paint([a('atlas'), a('nina')]);
    const orbs = [...p.querySelectorAll('orb-avatar')];
    expect(orbs).toHaveLength(2);
    expect(orbs.every((o) => o.hasAttribute('static') && o.getAttribute('size') === '16')).toBe(true);
    expect(p.querySelector('.ui-presence-pill__label')!.textContent).toBe('atlas and nina are thinking');
    expect(p.getAttribute('aria-label')).toBe('atlas and nina are thinking. Go to the end');
    p.paint([a('atlas', 'tool', { doing: 'reading a file' }), a('nina')], 2);
    expect(p.querySelectorAll('orb-avatar')[0]).toBe(orbs[0]);
    expect(p.querySelector('.ui-presence-pill__label')!.textContent).toBe('2 new messages');
    p.paint([a('nina')]);
    expect([...p.querySelectorAll('orb-avatar')]).toEqual([orbs[1]]);
  });
});
