// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S, X } from './ctx';
import type { DockBot } from './ctx';
import { onKey } from './input';
import { columnsOf, gridTarget, rove, rowIdxOf, rowItemOf, stepIndex, syncRoving } from './roving';
import { clip, tipOf } from './views';

const bots = (n: number): DockBot[] => Array.from({ length: n }, (_, i) => ({ id: 'b' + i, name: 'bot' + i, role: 'r' }) as unknown as DockBot);
const press = (el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => { const e = new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };

describe('where an arrow goes (KEYMAP section 8)', () => {
  it('Left and Up go back, Right and Down forward, Home and End to the ends', () => {
    expect(stepIndex('ArrowLeft', 3, 6)).toBe(2);
    expect(stepIndex('ArrowUp', 3, 6)).toBe(2);
    expect(stepIndex('ArrowRight', 3, 6)).toBe(4);
    expect(stepIndex('ArrowDown', 3, 6)).toBe(4);
    expect(stepIndex('Home', 3, 6)).toBe(0);
    expect(stepIndex('End', 3, 6)).toBe(5);
  });
  it('the grid knows its columns from the tops of its items', () => {
    expect(columnsOf([0, 0, 0, 0, 50, 50, 50, 50, 100])).toBe(4);
    expect(columnsOf([0, 0, 0])).toBe(3);
    expect(columnsOf([])).toBe(1);
  });
  it('the grid moves in two dimensions, wraps left and right by rows, and leaves from its last row', () => {
    const n = 9, cols = 4;                                    // rows: 0-3, 4-7, 8
    expect(gridTarget('ArrowRight', 3, n, cols)).toBe(4);     // wraps to the next row
    expect(gridTarget('ArrowLeft', 4, n, cols)).toBe(3);
    expect(gridTarget('ArrowUp', 5, n, cols)).toBe(1);
    expect(gridTarget('ArrowUp', 2, n, cols)).toBe(2);        // the first row stays
    expect(gridTarget('ArrowDown', 1, n, cols)).toBe(5);
    expect(gridTarget('ArrowDown', 6, n, cols)).toBe(8);      // clamped to the last item
    expect(gridTarget('ArrowDown', 8, n, cols)).toBeNull();   // the last row: back to the bot row
    expect(gridTarget('ArrowDown', 5, n, cols)).toBe(8);
    expect(gridTarget('Home', 6, n, cols)).toBe(0);
    expect(gridTarget('End', 2, n, cols)).toBe(8);
  });
});

describe('the dock\'s bot row', () => {
  let row: HTMLElement, items: HTMLButtonElement[];
  beforeEach(() => {
    S.bots = bots(4); S.rowIdx = 0; S.card = null; S.mode = 'normal';
    document.body.replaceChildren();
    X.root = document.createElement('div');
    X.root.addEventListener('keydown', onKey);
    X.root.innerHTML = '<div class="dk-row"></div>';
    document.body.append(X.root);
    row = X.root.querySelector('.dk-row') as HTMLElement;
    items = [...S.bots.map((b) => { const x = document.createElement('button'); x.className = 'dk-bot'; x.dataset['id'] = b.id; return x; }), Object.assign(document.createElement('button'), { className: 'dk-add' })];
    row.append(...items);
    syncRoving();
  });
  it('is one Tab stop: the current bot', () => {
    expect(items.map((x) => x.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    S.rowIdx = 2; syncRoving();
    expect(items.map((x) => x.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
  });
  it('Right and Left move real focus through the bots and "+", and stop at the ends', () => {
    (items[0] as HTMLElement).focus();
    const e = press(items[0] as HTMLElement, 'ArrowRight');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    expect(S.rowIdx).toBe(1);
    expect(items.map((x) => x.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    press(items[1] as HTMLElement, 'ArrowLeft'); press(items[0] as HTMLElement, 'ArrowLeft');
    expect(document.activeElement).toBe(items[0]);
  });
  it('End goes to "+", Home back to the first bot', () => {
    (items[0] as HTMLElement).focus();
    press(items[0] as HTMLElement, 'End');
    expect(document.activeElement).toBe(items[4]);
    expect(S.rowIdx).toBe(4);
    press(items[4] as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(items[4]);
    press(items[4] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
    expect(S.rowIdx).toBe(0);
  });
  it('a modified arrow is not the row\'s', () => {
    (items[0] as HTMLElement).focus();
    const e = press(items[0] as HTMLElement, 'ArrowRight', { shiftKey: true });
    expect(S.rowIdx).toBe(0);
    expect(document.activeElement).toBe(items[0]);
    expect(e.defaultPrevented).toBe(false);
  });
  it('rove clamps, and says where focus landed', () => {
    expect(rove(items, 0, 99)).toBe(4);
    expect(document.activeElement).toBe(items[4]);
    expect(rove([], 3, 0)).toBe(3);
  });
});

describe('a session\'s switcher and the queue at rest', () => {
  it('the switcher is one Tab stop (the open bot), and the queue\'s is its first row', () => {
    document.body.replaceChildren();
    X.root = document.createElement('div');
    X.root.addEventListener('keydown', onKey);
    X.root.innerHTML = '<div class="dk-strip"><button class="dk-strip-bot"></button><button class="dk-strip-bot" aria-current="true"></button><button class="dk-strip-bot"></button></div>' +
      '<div class="dk-v-wait-norm"><div class="dk-cards"><button class="cd-mini"></button><button class="cd-mini"></button></div></div>';
    document.body.append(X.root);
    S.bots = bots(2);
    syncRoving();
    expect([...X.root.querySelectorAll<HTMLElement>('.dk-strip-bot')].map((x) => x.tabIndex)).toEqual([-1, 0, -1]);
    expect([...X.root.querySelectorAll<HTMLElement>('.cd-mini')].map((x) => x.tabIndex)).toEqual([0, -1]);
  });
  it('Left and Right move through the switcher, and Up and Down move nothing but do not scroll', () => {
    const strip = X.root.querySelector('.dk-strip') as HTMLElement;
    const items = [...strip.querySelectorAll<HTMLElement>('.dk-strip-bot')];
    (items[1] as HTMLElement).focus();
    press(items[1] as HTMLElement, 'ArrowRight');
    expect(document.activeElement).toBe(items[2]);
    const down = press(items[2] as HTMLElement, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[2]);
  });
  it('Up and Down move between the queue\'s rows; Left and Right are the card\'s', () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);   // jsdom draws nothing: say the rows are drawn
    const rows = [...X.root.querySelectorAll<HTMLElement>('.cd-mini')];
    (rows[0] as HTMLElement).focus();
    press(rows[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(rows[1]);
    press(rows[1] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(rows[0]);
  });
});

describe('long bot names in the dock', () => {
  it('clip cuts at a length with an ellipsis and trims the space before it', () => {
    expect(clip('atlas', 18)).toBe('atlas');
    expect(clip('chief of staff for the billing migration', 18)).toBe('chief of staff fo…');
    expect(clip('abcd efghij', 5)).toBe('abcd…');
    expect(clip(undefined, 5)).toBe('');
  });
  it('a bot\'s tooltip is its name and role while they fit in about 26 characters, else the name alone', () => {
    expect(tipOf({ name: 'atlas', role: 'reviewer' })).toBe('atlas, reviewer');
    expect(tipOf({ name: 'cassiopeia-staging-deploy-guardian', role: 'watches every staging deploy' })).toBe('cassiopeia-stagin…');
    expect(tipOf({ name: 'nina', role: 'watches every staging deploy and rolls back' })).toBe('nina, watches every stagi…');
  });
});

describe('a row that leaves bots out (120 bots, 17 shown, then "All bots", then "+")', () => {
  it('a bot in the row is its own item; a bot left out is "All bots"; "+" is last', () => {
    expect(rowItemOf(3, 120, 17, true)).toBe(3);
    expect(rowItemOf(17, 120, 17, true)).toBe(17);
    expect(rowItemOf(90, 120, 17, true)).toBe(17);
    expect(rowItemOf(120, 120, 17, true)).toBe(18);
  });
  it('"All bots" stands for the first bot left out, so Up lands on it in the grid; "+" for "+"', () => {
    expect(rowIdxOf(16, 120, 17, true)).toBe(16);
    expect(rowIdxOf(17, 120, 17, true)).toBe(17);
    expect(rowIdxOf(18, 120, 17, true)).toBe(120);
  });
  it('a row that holds every bot is the plain index', () => {
    expect(rowItemOf(4, 11, 11, false)).toBe(4);
    expect(rowItemOf(11, 11, 11, false)).toBe(11);
    expect(rowIdxOf(11, 11, 11, false)).toBe(11);
  });
});
