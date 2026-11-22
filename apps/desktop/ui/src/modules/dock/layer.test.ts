// @vitest-environment jsdom
/* The dock's orb layer: an orb is connected once and only ever moved by style. jsdom has no layout, so every slot's box is
   given; what is checked is the arithmetic of the pose and, above all, that nothing is taken out of the page and put back. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { X, motion } from './ctx';
import { adoptOrb, dropOrb, initLayer, magClear, magOrb, orbPose, orbShows, orbsIn, placeOrbs, slotBot } from './layer';

interface Box { l: number; t: number; w: number; h: number }
const at = (el: HTMLElement, b: Box): void => {
  el.getBoundingClientRect = () => ({ left: b.l, top: b.t, right: b.l + b.w, bottom: b.t + b.h, width: b.w, height: b.h, x: b.l, y: b.t, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: b.w });
  el.getClientRects = () => ([{ width: b.w, height: b.h }] as unknown as DOMRectList);
};
const orbEl = (id: string): HTMLElement => { const w = document.createElement('span'); w.className = 'ui-orb'; w.dataset['bot'] = id; w.innerHTML = '<orb-avatar></orb-avatar>'; return w; };

/** an element's translation as numbers (the style serialises 60.00px as 60px) */
const xy = (el: HTMLElement | null): number[] => (/translate\(([-\d.]+)(?:px)?,\s*([-\d.]+)/.exec(el?.style.transform ?? '') ?? []).slice(1).map(parseFloat);
/** its scale, 1 when it has none */
const scale = (el: HTMLElement | null): number => parseFloat(/scale\(([-\d.]+)\)/.exec(el?.style.transform ?? '')?.[1] ?? '1');

let layer: HTMLElement, view: HTMLElement;
const slot = (id: string, host: HTMLElement, b: Box): HTMLElement => { const s = document.createElement('span'); s.className = 'dk-orb'; s.setAttribute('data-slot', 'orb:' + id); host.append(s); at(s, b); return s; };
const viewOf = (key: string): HTMLElement => { const v = document.createElement('div'); v.className = 'dk-view'; v.dataset['view'] = key; X.root.append(v); at(v, { l: 0, t: 0, w: 10, h: 10 }); return v; };

beforeEach(() => {
  document.body.replaceChildren();
  X.root = document.createElement('div'); document.body.append(X.root);
  layer = document.createElement('div'); layer.className = 'dk-orbs'; X.root.append(layer);
  at(layer, { l: 100, t: 500, w: 0, h: 0 });
  initLayer(layer);
  view = viewOf('bots:norm');
  motion.reduce = true;
});

afterEach(() => { for (const id of ['a', 'b']) dropOrb(id); });

describe('the orb layer', () => {
  it('an orb stands where its slot is, from the layer\'s origin, sized by the slot', () => {
    const o = orbEl('a'); adoptOrb('a', o);
    slot('a', view, { l: 140, t: 450, w: 40, h: 40 });
    placeOrbs();
    const pos = o.parentElement as HTMLElement;
    expect(xy(pos)).toEqual([60, -30]);          /* centre (160, 470) less the origin (100, 500) */
    expect(o.style.getPropertyValue('--o')).toBe('40');
    expect(o.getAttribute('data-in')).toBe('norm');
    expect(pos.hasAttribute('data-away')).toBe(false);
    expect(orbShows('a')).toBe(true);
  });

  it('an orb that changes place is never taken out of the page: only its style changes', () => {
    const o = orbEl('a'); adoptOrb('a', o);
    const row = slot('a', view, { l: 140, t: 450, w: 40, h: 40 });
    placeOrbs();
    const exp = viewOf('bots:exp');
    const rosterSlot = slot('a', exp, { l: 300, t: 300, w: 26, h: 26 });
    row.remove();
    const log: string[] = [];
    new MutationObserver((ms) => { for (const m of ms) { for (const n of m.removedNodes) log.push('out ' + (n as Element).className); for (const n of m.addedNodes) log.push('in ' + (n as Element).className); } }).observe(X.root, { childList: true, subtree: true });
    const pos = o.parentElement;
    placeOrbs();
    expect(o.parentElement).toBe(pos);
    expect(o.isConnected).toBe(true);
    expect(orbPose('a')?.slot).toBe(rosterSlot);
    expect(xy(pos as HTMLElement)).toEqual([213, -187]);
    expect(o.style.getPropertyValue('--o')).toBe('26');
    expect(o.getAttribute('data-in')).toBe('exp');
    return Promise.resolve().then(() => expect(log).toEqual([]));
  });

  it('a slot in a view that is leaving is not where the orb goes', () => {
    const o = orbEl('a'); adoptOrb('a', o);
    const old = viewOf('bots:exp'); old.classList.add('is-leaving');
    slot('a', old, { l: 300, t: 300, w: 26, h: 26 });
    slot('a', view, { l: 140, t: 450, w: 40, h: 40 });
    placeOrbs();
    expect(xy(o.parentElement as HTMLElement)).toEqual([60, -30]);
  });

  it('magnification scales the item about its bottom centre, and the orb takes the same pose', () => {
    const o = orbEl('a'); adoptOrb('a', o);
    slot('a', view, { l: 140, t: 450, w: 40, h: 40 });
    placeOrbs();
    const pos = o.parentElement as HTMLElement;
    magOrb('a', 10, 1.5, 40);          /* the button grows 1.5 about its bottom edge and shifts 10 to the right */
    expect(xy(pos)).toEqual([70, -40]);          /* up by (1.5 - 1) * 40 / 2 */
    expect(scale(pos)).toBe(1.5);
    magClear('a');
    expect(xy(pos)).toEqual([60, -30]);
    expect(scale(pos)).toBe(1);
  });

  it('placing the orbs while the row is magnified finds the place the slot is at rest', () => {
    const o = orbEl('a'); adoptOrb('a', o);
    const s = slot('a', view, { l: 140, t: 450, w: 40, h: 40 });
    placeOrbs();
    magOrb('a', 10, 1.5, 40);
    at(s, { l: 140, t: 430, w: 60, h: 60 });   /* the button's scale moves the slot's box: its centre is (160 + 10, 470 - 10) */
    placeOrbs();
    expect(orbPose('a')?.bx).toBe(60);
    expect(orbPose('a')?.by).toBe(-30);
  });

  it('a bot with nothing showing for it leaves; under reduced motion at once', () => {
    const o = orbEl('a'); adoptOrb('a', o);
    const s = slot('a', view, { l: 140, t: 450, w: 40, h: 40 });
    placeOrbs();
    s.remove();
    placeOrbs();
    expect((o.parentElement as HTMLElement).hasAttribute('data-away')).toBe(true);
    expect(orbShows('a')).toBe(false);
    expect(o.isConnected).toBe(true);
  });

  it('the roster scrolls its orbs, and one scrolled far out is paused', () => {
    const exp = viewOf('bots:exp');
    const roster = document.createElement('ul'); roster.className = 'dk-roster'; exp.append(roster);
    at(roster, { l: 100, t: 300, w: 300, h: 200 });
    Object.defineProperty(roster, 'scrollTop', { configurable: true, writable: true, value: 0 });
    const near = orbEl('a'), far = orbEl('b'); adoptOrb('a', near); adoptOrb('b', far);
    slot('a', roster, { l: 120, t: 320, w: 26, h: 26 });
    slot('b', roster, { l: 120, t: 460, w: 26, h: 26 });
    placeOrbs();
    expect(orbShows('b')).toBe(true);
    roster.scrollTop = 20;
    roster.dispatchEvent(new Event('scroll'));
    expect(xy(near.parentElement as HTMLElement)).toEqual([33, -187]);   /* 20 up from (33, -167) */
    roster.scrollTop = 600;                       /* far down the list: both rows are well above the roster now */
    roster.dispatchEvent(new Event('scroll'));
    expect(orbShows('b')).toBe(false);
    expect(orbShows('a')).toBe(false);
  });

  it('the live orbs of the slots under an element are what enters with it', () => {
    const a = orbEl('a'), b = orbEl('b'); adoptOrb('a', a); adoptOrb('b', b);
    const sa = slot('a', view, { l: 140, t: 450, w: 40, h: 40 });
    slot('b', view, { l: 200, t: 450, w: 40, h: 40 });
    placeOrbs();
    expect(orbsIn(sa)).toEqual([a]);
    expect(orbsIn(view)).toEqual([a, b]);
    expect(slotBot(view)).toBe('a');
  });

  it('a bot that is archived takes its orb with it, and only then', () => {
    const o = orbEl('a'); adoptOrb('a', o);
    dropOrb('a');
    expect(o.isConnected).toBe(false);
    expect(orbPose('a')).toBeUndefined();
  });
});
