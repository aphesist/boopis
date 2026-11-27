// @vitest-environment jsdom
/* FilesCard: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts and thread.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './files-card';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.filesCard>[0] = { files: [{ path: 'src/a.ts', add: 3, del: 1 }] };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: FilesCard', () => {
  it('draws the component its contract names (data-kit="FilesCard")', () => {
    const el = put(kit.filesCard(EX));
    expect(el.matches('[data-kit~="FilesCard"]') || !!el.querySelector('[data-kit~="FilesCard"]')).toBe(true);
    expect(contract.name).toBe('FilesCard');
  });
  it('FilesCard: the count and the turn\'s lines, an action at the head\'s end, a row per file; a long list folds', () => {
    const card = put(kit.filesCard({ files: [{ path: 'a.css', add: 12, del: 3 }, { path: 'b.ts', add: 2, del: 2 }], action: 'Open diff' }));
    expect(card.querySelector('.k7-files__title')?.textContent).toBe('2 changed files');
    expect(card.querySelector('.k7-files__head .k7-files__counts')?.textContent).toBe('+14−5');
    expect(card.querySelector('[data-files]')?.textContent).toBe('Open diff');
    expect(card.querySelectorAll('.k7-files__row').length).toBe(2);
    expect(card.hasAttribute('data-open')).toBe(true);
    expect(put(kit.filesCard({ files: [{ path: 'only.ts' }] })).querySelector('.k7-files__title')?.textContent).toBe('1 changed file');
    const long = put(kit.filesCard({ files: Array.from({ length: 12 }, (_, i) => ({ path: 'f' + i + '.ts' })), fold: true }));
    expect(long.hasAttribute('data-open')).toBe(false);
    (long.querySelector('.k7-files__fold') as HTMLElement).click();
    expect(long.hasAttribute('data-open')).toBe(true);
  });
});

describe('story: FilesCard, how a check on the change went (board S38)', () => {
  it('draws the check\'s name, its verdict as a StatusWord in its tone, the one action, what it printed in a Well, the files and the note', () => {
    const c = put(kit.filesCard({ files: [{ path: 'modules/dock/dock.css' }], action: 'Fix and retry', check: { title: 'Gate', word: 'failed', tone: 'red', output: 'FAIL centred.test.ts\n  expected 720 to be 744', note: 'Nothing was kept: every file is back as it was.' } }));
    expect(c.dataset['check']).toBe('red');
    expect(c.querySelector('.k7-files__name')?.textContent).toBe('Gate');
    const w = c.querySelector<HTMLElement>('[data-kit="StatusWord"]');
    expect([w?.textContent, w?.dataset['tone']]).toEqual(['failed', 'red']);
    expect([...c.querySelectorAll('button')].map((b) => [b.textContent?.trim(), b.dataset['variant']])).toEqual([['Fix and retry', 'tint']]);
    expect(c.querySelector('[data-kit="Well"] pre')?.textContent).toBe('FAIL centred.test.ts\n  expected 720 to be 744');
    expect([...c.querySelectorAll('.k7-files__row')].map((r) => r.textContent)).toEqual(['modules/dock/dock.css']);
    expect(c.querySelector('.k7-files__note')?.textContent).toBe('Nothing was kept: every file is back as it was.');
    expect(c.querySelector('.k7-files__counts')).toBeNull();   /* a check counts no lines */
  });
  it('with nothing printed and no action it is the head and the note alone', () => {
    const c = put(kit.filesCard({ files: [], check: { title: 'Gate', word: 'failed', tone: 'red', note: 'Nothing was kept.' } }));
    expect(c.querySelector('[data-kit="Well"]')).toBeNull();
    expect(c.querySelector('button')).toBeNull();
    expect(c.querySelector('.k7-files__list')).toBeNull();
  });
});

describe('story: FilesCard, 6e', () => {
  it('a row says what happens to its file in words, and the head can say its own words', () => {
    const c = put(kit.filesCard({ files: [{ path: 'a.ts', word: 'put back' }], title: '1 file' }));
    expect(c.querySelector('.k7-files__word')?.textContent).toBe('put back');
    expect(c.querySelector('.k7-files__counts')).toBeNull();
    expect(c.querySelector('.k7-files__title')?.textContent).toBe('1 file');
  });
  it('the check retrying shimmers its word', () => {
    const c = put(kit.filesCard({ files: [], check: { title: 'npm test', word: 'retrying', live: true } }));
    expect(c.querySelector('[data-kit~="StatusWord"] .k7-shimmer')?.textContent).toBe('retrying');
  });
});
