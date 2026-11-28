// @vitest-environment jsdom
/* The lab's coverage gate (docs/UI-LAB.md): every library component, card kind, form kind, surface and page has a
   story, and every story has its minimum states. A new component ships with stories; an exception goes in
   coverage.ts with its reason. */
import { describe, expect, it } from 'vitest';
import { kit } from '@boopis/ui';
import { STORIES } from './registry';
import { AREAS } from './types';
import { EMPTY_APPLIES, ENGINES, ERROR_APPLIES, MIN_COMPONENT, MIN_SURFACE_STATES, MOD_SURFACES, PAGES, STATE_EXCUSED, SURFACES } from './coverage';
import { KINDS } from '../modules/cards/kinds';
import { FORM_KINDS } from '../modules/cards/form-model';

const covered = new Set(STORIES.flatMap((s) => s.covers));
const missing = (want: readonly string[]): string[] => want.filter((w) => !covered.has(w));
const applies = (list: readonly string[], covers: readonly string[]): boolean => covers.some((c) => list.includes(c) || list.includes(c.replace(/:.*/, ':*')));

describe('the lab covers', () => {
  /* the v7 kit (DESIGN-SYSTEM.md v7 21.2; LAB-v7 section 2): every template is a component, covered as kit.<name> by a story
     in its folder (src/components/v7/<name>/<name>.stories.ts) with its typical and long states */
  it('the v7 kit: every component, in a story of its own in its folder', () => {
    const want = Object.keys(kit.html).map((k) => 'kit.' + k);
    expect(missing(want), 'v7 components with no story in their folder (src/components/v7/<name>/)').toEqual([]);
    for (const s of STORIES.filter((x) => x.id.startsWith('kit/'))) {
      const tags = new Set(Object.values(s.states).flatMap((st) => st.tags));
      expect(['typical', 'long'].filter((t) => !tags.has(t as never)), s.id + ' lacks states').toEqual([]);
      expect(s.covers.every((c) => c.startsWith('kit.') || c.startsWith('pattern:')), s.id + ' covers only kit components').toBe(true);
    }
  });
  it('every engine the kit draws with (the orbs, the stack, the model marks, the markdown, the card host)', () => {
    expect(missing(ENGINES.map((e) => 'engine:' + e)), 'engines with no story; add one under src/lab/stories').toEqual([]);
  });
  it('the card host: it draws the form alone (the v6 kinds are the kit\'s since step 6f), and the form has its stories', () => {
    expect(Object.keys(KINDS)).toEqual(['form']);
    expect(covered.has('card:form')).toBe(true);
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
    const composer = STORIES.find((s) => s.id === 'kit/composer');
    expect(Object.keys(composer?.states ?? {})).toEqual(expect.arrayContaining(['typed', 'the send hovered', 'the send focused', 'the send pressed', 'add hovered', 'the add tooltip', 'dock, typed']));
    const dock = STORIES.find((s) => s.id === 'v7/dock');
    expect(Object.keys(dock?.states ?? {})).toEqual(expect.arrayContaining(['no bots of your own (no dock)', 'one bot', '120 bots (N more)']));
  });
});
