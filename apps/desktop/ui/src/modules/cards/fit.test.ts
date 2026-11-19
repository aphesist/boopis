// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setProvider, data } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { byline, mini, namesUnit, originOf, restOf } from './parts';
import { fitCard, fitNames, namesForms } from './fit';
import type { Ctx } from './types';

beforeAll(() => { setProvider(createMockProvider({ simulate: false, fixtures: ['long'] })); });
const ids = (): string[] => data().bots.snapshot().bots.map((b) => b.id);
const html = (s: string): HTMLElement => { const t = document.createElement('div'); t.innerHTML = s; document.body.append(t); return t; };

/* jsdom has no layout: text is 7px a character, and each part has the room a test gives it */
const room = new Map<string, number>();
function stubLayout(): void {
  const text = (el: Element): number => (el.textContent ?? '').length * 7;
  Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get(this: Element) { return text(this); } });
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get() { return 10; } });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get() { return 10; } });
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get(this: Element) {
    for (const [cls, w] of room) if (this.classList.contains(cls)) return w;
    return 0;
  } });
}
beforeEach(() => { document.body.replaceChildren(); room.clear(); stubLayout(); });
afterEach(() => { for (const p of ['scrollWidth', 'scrollHeight', 'clientHeight', 'clientWidth']) Reflect.deleteProperty(Element.prototype, p); });

describe('the names of an origin, as one unit', () => {
  it('one name is one part; several are the asker, then the others; a relay is a third part', () => {
    const [a, b, c, d] = ids() as [string, string, string, string];
    expect(namesUnit({ kind: 'teammate', ids: [a], via: null })).not.toContain('cd-names__rest');
    const two = namesUnit({ kind: 'teammate', ids: [a, b], via: null });
    expect(two).toContain('<span class="cd-names__first">' + a + '</span><span class="cd-names__rest"> and ' + b + '</span>');
    expect(namesUnit({ kind: 'teammate', ids: [a, b, c, d], via: null })).toContain(' and 3 others');
    expect(namesUnit({ kind: 'teammate', ids: [a], via: b })).toContain('<span class="cd-names__via">, via ' + b + '</span>');
  });
  it('says every name once, whole, to a screen reader, and hides the parts that may be cut', () => {
    const [a, b, c] = ids() as [string, string, string];
    const h = namesUnit({ kind: 'teammate', ids: [a, b, c], via: null });
    expect(h).toContain('class="cd-names__vis" aria-hidden="true"');
    expect(h).toContain('<span class="ui-sr">' + a + ', ' + b + ' and ' + c + '</span>');
    expect(h).toContain('data-full="' + a + ', ' + b + ' and ' + c + '"');
  });
  it('an MCP server in a row is its name alone', () => {
    const o = { kind: 'mcp', server: 'sentry', trust: 'trusted' } as const;
    expect(namesUnit(o)).toContain(' MCP server, trusted');
    expect(namesUnit(o, true)).not.toContain('cd-names__via');
    expect(namesUnit(o, true)).toContain('>sentry<');
  });
  it('the agent that came through a route asks as the model it ended on: one mark, one name', () => {
    const o = originOf({ model: 'qwen3-coder → sonnet 5.5' });
    expect(o).toEqual({ kind: 'agent', model: 'sonnet 5.5', route: 'qwen3-coder → sonnet 5.5' });
    expect(byline({ origin: o, size: 'inline' })).not.toContain('ui-model-route');
    expect(byline({ origin: o, size: 'inline' })).toContain('>sonnet 5.5<');
  });
  it('escapes a name', () => {
    expect(namesUnit({ kind: 'mcp', server: '<b>x</b>' })).not.toContain('<b>x</b>');
  });
  it('a row\'s lead is still: a stack in an aria-hidden slot takes no focus', () => {
    const c = { id: 'x', owe: '', origin: { kind: 'teammate', ids: ids().slice(0, 5), via: null } } as unknown as Ctx;
    expect(mini(c, { text: 'Ship it' })).not.toContain('tabindex');
    expect(byline({ origin: c.origin, size: 'inline' })).toContain('tabindex="0"');
  });
});

describe('the longest form of the others that is not cut', () => {
  const unit = (names: string[]): HTMLElement => html(namesUnit({ kind: 'teammate', ids: names, via: null })).querySelector<HTMLElement>('.cd-names') as HTMLElement;
  const some = (n: number): string[] => ids().slice(0, n);
  it('lists the forms longest first, ending with the asker alone', () => {
    expect(namesForms(['a', 'b', 'c'])).toEqual([', b and c', ' and 2 others', '']);
    expect(namesForms(['a', 'b'])).toEqual([' and b', ' and 1 other', '']);
    expect(namesForms(['a', 'b', 'c', 'd', 'e'])).toEqual([' and 4 others', '']);
    expect(restOf(['a', 'b', 'c', 'd'])).toBe(' and 3 others');
  });
  it('keeps everyone when there is room', () => {
    const u = unit(some(3)); room.set('cd-names__rest', 400);
    expect(fitNames(u)).toBe(false);
    expect(u.querySelector('.cd-names__rest')?.textContent).toMatch(/^, \w+ and \w+$/);
  });
  it('shortens to "and 2 others" when the names do not fit, and to nothing when even that does not', () => {
    const u = unit(some(3)), r = u.querySelector('.cd-names__rest') as HTMLElement;
    room.set('cd-names__rest', 13 * 7);                       // ' and 2 others' fits, ', iris and nina' (about 16 characters) does not
    expect(fitNames(u)).toBe(true);
    expect(r.textContent).toBe(' and 2 others');
    room.set('cd-names__rest', 20);
    expect(fitNames(u)).toBe(true);
    expect(r.textContent).toBe('');
  });
});

describe('a card never lets a name push it wider', () => {
  const card = (inner: string, width = 300): HTMLElement => {
    const c = html('<div class="host">' + inner + '</div>').firstElementChild as HTMLElement;
    room.set('host', width);
    return c;
  };
  it('a one-row card gives the who at most half the line, or what the request leaves', () => {
    const o = { kind: 'teammate', ids: [ids()[0] as string], via: null } as const;
    const c = card(mini({ id: 'x', owe: '', origin: o } as unknown as Ctx, { text: 'Deploy to staging' }));
    room.set('cd-mini__text', 300); room.set('cd-names', 150);
    const what = c.querySelector('.cd-mini__what') as HTMLElement;
    const who = (): string => (c.querySelector('.cd-mini__who') as HTMLElement).style.getPropertyValue('--cd-who-max');
    what.getBoundingClientRect = () => ({ width: 80 }) as DOMRect;
    fitCard(c);
    expect(who()).toBe('215px');                              // the request is short: the who gets what it leaves (the line less 0.3em)
    what.getBoundingClientRect = () => ({ width: 100 }) as DOMRect;
    fitCard(c);
    expect(who()).toBe('195px');
    what.getBoundingClientRect = () => ({ width: 290 }) as DOMRect;
    fitCard(c);
    expect(who()).toBe('150px');                              // a long request: the who still has half the line
  });
  it('a byline whose name is cut says the whole name on hover and takes focus only then', () => {
    const long = 'cassiopeia-staging-deploy-guardian';
    const c = card('<div class="cd-by"><span class="cd-by__label">' + namesUnit({ kind: 'mcp', server: long }) + '</span></div>');
    const label = c.querySelector('.cd-by__label') as HTMLElement;
    room.set('cd-names', 100); room.set('cd-names__first', 100);      // 34 characters of 7px do not fit in 100px
    fitCard(c);
    expect(label.getAttribute('data-tip')).toBe(long + ' MCP server');
    expect(label.tabIndex).toBe(0);
    room.set('cd-names__first', 600); room.set('cd-names__via', 600); room.set('cd-names', 600);
    fitCard(c);
    expect(label.hasAttribute('data-tip')).toBe(false);
    expect(label.hasAttribute('tabindex')).toBe(false);
  });
  it('a one-row card is the focusable thing already, so it gets the tooltip and no tabindex', () => {
    const long = ids()[0] as string;
    const c = card(mini({ id: 'x', owe: '', origin: { kind: 'mcp', server: long + long + long } } as unknown as Ctx, { text: 'Ask' }));
    room.set('cd-mini__text', 300); room.set('cd-names', 50); room.set('cd-names__first', 50);
    fitCard(c);
    const row = c.querySelector('.cd-mini') as HTMLElement;
    expect(row.hasAttribute('data-tip')).toBe(true);
    expect(row.hasAttribute('tabindex')).toBe(false);
  });
  it('the long-name fixture is the mock\'s, test-only: the default bots have none', () => {
    expect(ids()).toContain('cassiopeia-staging-deploy-guardian');
    const plain = createMockProvider({ simulate: false });
    expect(plain.bots.snapshot().bots.map((b) => b.id)).not.toContain('cassiopeia-staging-deploy-guardian');
  });
});
