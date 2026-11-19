// @vitest-environment jsdom
/* The lab's coverage gate (docs/UI-LAB.md): every library component, card kind, form kind, surface and page has a
   story, and every story has its minimum states. A new component ships with stories; an exception goes in
   coverage.ts with its reason. */
import { describe, expect, it } from 'vitest';
import { ui, variants } from '@boopis/ui';
import { STORIES } from './registry';
import { AREAS } from './types';
import { EMPTY_APPLIES, ERROR_APPLIES, HTML_ONLY_EXCUSED, MIN_COMPONENT, MIN_SURFACE_STATES, MOD_SURFACES, NOT_COMPONENTS, PAGES, STATE_EXCUSED, SURFACES } from './coverage';
import { KINDS } from '../modules/cards/kinds';
import { FORM_KINDS } from '../modules/cards/form-model';
import { CARD_STATES } from './stories/cards/cards.stories';
import { DRAWERS, VARIANTS_ELSEWHERE } from './variant-drawers';

const covered = new Set(STORIES.flatMap((s) => s.covers));
const missing = (want: readonly string[]): string[] => want.filter((w) => !covered.has(w));
const applies = (list: readonly string[], covers: readonly string[]): boolean => covers.some((c) => list.includes(c) || list.includes(c.replace(/:.*/, ':*')));

describe('the lab covers', () => {
  it('every library component (an export of `ui`)', () => {
    const want = Object.keys(ui).filter((k) => !(k in NOT_COMPONENTS)).map((k) => 'ui.' + k);
    expect(missing(want), 'components with no story; add one under src/lab/stories, or excuse it in coverage.ts').toEqual([]);
  });
  it('every html template that has no factory', () => {
    const want = Object.keys(ui.html).filter((k) => !(k in ui) && !(k in HTML_ONLY_EXCUSED)).map((k) => 'html.' + k);
    expect(missing(want)).toEqual([]);
  });
  it('every card kind, in every state the card layer has', () => {
    const kinds = Object.keys(KINDS).filter((k) => k !== 'form');
    expect(missing(kinds.map((k) => 'card:' + k))).toEqual([]);
    for (const k of kinds) expect(CARD_STATES[k], 'the card story\'s states for ' + k).toEqual(KINDS[k as keyof typeof KINDS].states);
    expect(covered.has('card:form')).toBe(true);
  });
  it('every component that exports variants: a variants story draws each axis, or its own story does', () => {
    const open = Object.keys(variants).filter((k) => !(k in DRAWERS) && !(k in VARIANTS_ELSEWHERE));
    expect(open, 'add base props to DRAWERS in stories/components/variants.stories.ts').toEqual([]);
    for (const k of Object.keys(DRAWERS)) expect(STORIES.some((s) => s.id === 'components/variants-' + k), k).toBe(true);
  });
  it('every form kind', () => {
    expect(missing(Object.keys(FORM_KINDS).map((k) => 'form:' + k))).toEqual([]);
  });
  it('every surface, mod surface and page', () => {
    expect(missing(SURFACES.map((s) => 'surface:' + s))).toEqual([]);
    expect(missing(MOD_SURFACES.map((s) => 'mod:' + s))).toEqual([]);
    expect(missing(PAGES.map((s) => 'page:' + s))).toEqual([]);
  });
});

describe('every story', () => {
  it('has a unique id, a known area and at least one state, each tagged', () => {
    const ids = STORIES.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(50);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STORIES) {
      expect(Object.keys(AREAS), s.id).toContain(s.area);
      expect(Object.keys(s.states).length, s.id).toBeGreaterThan(0);
      for (const [n, st] of Object.entries(s.states)) {
        expect(st.tags.length, s.id + ' · ' + n).toBeGreaterThan(0);
        expect(!!st.render !== !!st.app || (!!st.render && !st.app), s.id + ' · ' + n + ' draws on the stage or in the app, not both').toBe(true);
      }
    }
  });
  it('has the minimum states: typical and long; empty and error where they apply', () => {
    const short: string[] = [];
    for (const s of STORIES) {
      const tags = new Set(Object.values(s.states).flatMap((st) => st.tags));
      const excused = STATE_EXCUSED[s.id] ?? {};
      const need = (t: (typeof MIN_COMPONENT)[number] | 'empty' | 'error'): void => { if (!tags.has(t) && !excused[t]) short.push(s.id + ' needs a "' + t + '" state'); };
      if (s.kind === 'component' || s.kind === 'card') {
        if (!s.covers.length) continue;   /* a variant story (a second form of a kind): the kind's own story carries the minimum */
        for (const t of MIN_COMPONENT) need(t);
        if (applies(EMPTY_APPLIES, s.covers)) need('empty');
        if (applies(ERROR_APPLIES, s.covers)) need('error');
      } else if (s.kind === 'surface') {
        if (!tags.has('typical')) short.push(s.id + ' needs a "typical" state');
        if (Object.keys(s.states).length < MIN_SURFACE_STATES) short.push(s.id + ' needs ' + MIN_SURFACE_STATES + ' states');
      }
    }
    expect(short).toEqual([]);
  });
  it('covers the owner\'s cases: the composer with text and its send button, the dock with zero, one and many bots', () => {
    const composer = STORIES.find((s) => s.id === 'composer/composer');
    expect(Object.keys(composer?.states ?? {})).toEqual(expect.arrayContaining(['with text', 'send hover', 'send focus', 'send pressed', 'attach hover', 'attach tooltip', 'compact, with text']));
    const dock = STORIES.find((s) => s.id === 'dock/dock');
    expect(Object.keys(dock?.states ?? {})).toEqual(expect.arrayContaining(['no bots (the empty shape)', 'one bot', '120 bots']));
  });
});
