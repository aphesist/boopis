import { describe, expect, it } from 'vitest';
import { blockHTML, inlineHTML, markdownHTML, mentionHandles, pathCandidate, pathCandidates, resolveMentions, splitBlocks, upgradePaths } from './markdown';
import type { MarkdownCtx, MdBot } from './markdown';
import { codeOf, markdown, streamMarkdown } from './md-view';

const BOTS: Record<string, MdBot> = { kai: { id: 'kai', name: 'kai', role: 'showrunner', color: '#4fc9a8', shape: 'circle' }, nina: { id: 'nina', name: 'nina', color: '#f23b5a', shape: 'triangle' } };
const ctx: MarkdownCtx = { mention: (h) => BOTS[h.toLowerCase()] ?? null, everyone: Object.values(BOTS) };
const dom = (h: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = h; return d; };

describe('markdown blocks', () => {
  it('splits paragraphs on blank lines and keeps one newline as a line break', () => {
    const d = dom(markdownHTML('one\ntwo\n\nthree'));
    const ps = d.querySelectorAll('p');
    expect(ps).toHaveLength(2);
    expect(ps[0]?.innerHTML).toBe('one<br>two');
  });
  it('never draws raw HTML', () => {
    const d = dom(markdownHTML('<img src=x onerror=alert(1)> <b>hi</b>'));
    expect(d.querySelector('img, b')).toBeNull();
    expect(d.textContent).toContain('<b>hi</b>');
  });
  it('draws headings, rules, quotes, lists and tables', () => {
    const d = dom(markdownHTML('# Title\n\n---\n\n> **Before:** a\n> **After:** b\n\n- one\n- two\n  - nested\n3. three\n\n| a | b |\n|---|--:|\n| 1 | 2 |'));
    expect(d.querySelector('.ui-md__h')?.textContent).toBe('Title');
    expect(d.querySelector('.ui-md__h')?.getAttribute('role')).toBe('heading');
    expect(d.querySelector('hr.ui-md__hr')).not.toBeNull();
    expect(d.querySelector('blockquote strong')?.textContent).toBe('Before:');
    expect(d.querySelector('blockquote p')?.innerHTML).toContain('<br>');
    expect(d.querySelectorAll('.ui-md__lists > ul > li')).toHaveLength(2);
    expect(d.querySelector('.ui-md__lists > ol')?.textContent).toBe('three');
    expect(d.querySelector('ul li ul li')?.textContent).toBe('nested');
    expect(d.querySelector('td[data-align="right"]')?.textContent).toBe('2');
    expect(d.querySelector('.ui-md__table')?.getAttribute('role')).toBe('region');
  });
  it('starts an ordered list at its first number', () => {
    expect(markdownHTML('3. c\n4. d')).toContain('<ol start="3">');
  });
  it('reads a fence, its language and its lines; an unclosed fence is still code (a reply arriving)', () => {
    const b = splitBlocks('text\n\n```json\n{ "n": 5 }\n```\n\nafter');
    expect(b.map((x) => x.kind)).toEqual(['p', 'code', 'p']);
    const open = splitBlocks('```py\nprint(1)');
    expect(open[0]).toMatchObject({ kind: 'code', open: true });
    const d = dom(blockHTML(open[0]!));
    expect(d.querySelector('.ui-codeblock__lang')?.textContent).toBe('py');
    expect(d.querySelector('.ui-codeblock__n')?.textContent).toBe('1 line');
  });
  it('folds code past 14 lines to 12, with the rest one press away', () => {
    const src = '```\n' + Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n') + '\n```';
    const d = dom(markdownHTML(src));
    const well = d.querySelector('.ui-codeblock') as HTMLElement;
    expect(well.hasAttribute('data-folded')).toBe(true);
    expect(well.querySelectorAll('.ui-codeblock__l:not(.ui-codeblock__rest *)')).toHaveLength(12);
    expect(well.querySelector('.ui-codeblock__fold')?.textContent).toBe('Show 8 more lines');
    expect(codeOf(well).split('\n')).toHaveLength(20);
  });
  it('tints a diff', () => {
    const d = dom(markdownHTML('```diff\n@@ -1 +1 @@\n-old\n+new\n```'));
    expect([...d.querySelectorAll('.ui-codeblock__l')].map((l) => l.getAttribute('data-d'))).toEqual(['hunk', 'del', 'add']);
  });
});

describe('markdown inline', () => {
  it('styles bold, italics and struck text', () => {
    expect(inlineHTML('**a** *b* _c_ ~~d~~')).toBe('<strong>a</strong> <em>b</em> <em>c</em> <del>d</del>');
    expect(inlineHTML('snake_case_name and 2*3*4')).toBe('snake_case_name and 2*3*4');
  });
  it('keeps code as code, and styles nothing inside it', () => {
    expect(inlineHTML('`**x**`')).toBe('<code class="ui-code">**x**</code>');
  });
  it('draws web links, and only web links', () => {
    const h = inlineHTML('[docs](https://example.org/a) and [x](javascript:alert(1))');
    const d = dom(h);
    const a = d.querySelectorAll('a');
    expect(a).toHaveLength(1);
    expect(a[0]?.getAttribute('href')).toBe('https://example.org/a');
    expect(a[0]?.getAttribute('data-tip')).toBe('example.org');
    expect(d.textContent).toContain('x');
  });
  it('links a bare address and leaves the sentence\'s full stop outside', () => {
    const d = dom(inlineHTML('See https://example.org/path. Then (https://a.b/c_(d)).'));
    const a = [...d.querySelectorAll('a')].map((x) => x.getAttribute('href'));
    expect(a).toEqual(['https://example.org/path', 'https://a.b/c_(d)']);
  });
  it('makes an image an attachment chip, never a remote load', () => {
    const d = dom(inlineHTML('![contact sheet](https://example.org/sheet.png)'));
    expect(d.querySelector('img')).toBeNull();
    expect(d.querySelector('.ui-file')?.textContent).toBe('contact sheet');
  });
});

describe('mentions', () => {
  it('match the engine\'s pattern: a trailing full stop is part of the handle', () => {
    expect(mentionHandles('@kai, then @Nina. and @moss')).toEqual(['kai', 'nina.', 'moss']);
  });
  it('resolve as the engine does: "@kai." names nobody called kai', () => {
    const members = [{ handle: 'kai' }, { handle: 'nina' }];
    expect(resolveMentions('@kai.', members).members).toEqual([]);
    expect(resolveMentions('ask @KAI now', members).members).toEqual([{ handle: 'kai' }]);
    expect(resolveMentions('@all', members)).toEqual({ members, everyone: true });
    expect(resolveMentions('@nobody', members).members).toEqual([]);
  });
  it('draw a known handle as a chip and leave an unknown one, or "@kai.", as text', () => {
    const d = dom(inlineHTML('@kai look, @nobody here, and @kai. done', ctx));
    const chips = d.querySelectorAll('.ui-mention');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.getAttribute('data-mention')).toBe('kai');
    expect(chips[0]?.getAttribute('aria-label')).toBe('kai, showrunner. Open its chat');
    expect(d.textContent).toContain('@nobody');
    expect(d.textContent).toContain('@kai. done');
  });
  it('draw @all with the members', () => {
    const d = dom(inlineHTML('@all ready?', ctx));
    expect(d.querySelector('.ui-mention--all')?.getAttribute('aria-label')).toBe('@all: kai, nina');
  });
  it('are not chips inside code or link labels', () => {
    const d = dom(inlineHTML('`@kai` and [@kai](https://x.y)', ctx));
    expect(d.querySelector('.ui-mention')).toBeNull();
  });
});

describe('paths', () => {
  it('read a code span as a path only when it looks like one', () => {
    expect(pathCandidate('episodes/2026/episode.json')).toBe('episodes/2026/episode.json');
    expect(pathCandidate('factcheck.md')).toBe('factcheck.md');
    expect(pathCandidate('src/main.rs:42:7')).toBe('src/main.rs');
    expect(pathCandidate('~/notes')).toBe('~/notes');
    expect(pathCandidate('uv run shorts.py --dry')).toBeNull();
    expect(pathCandidate('https://a.b/c.json')).toBeNull();
    expect(pathCandidate('1/2')).toBeNull();
    expect(pathCandidate('foo')).toBeNull();
  });
  it('stay code until the host resolves them, then become buttons', () => {
    const d = dom(markdownHTML('Saved in `out/a/beat.png` and `nowhere/x.md`.'));
    expect(pathCandidates(d)).toEqual(['out/a/beat.png', 'nowhere/x.md']);
    expect(d.querySelector('.ui-path')).toBeNull();
    const n = upgradePaths(d, new Map([['out/a/beat.png', { path: 'out/a/beat.png', abs: '/w/out/a/beat.png', kind: 'file' as const }]]));
    expect(n).toBe(1);
    const b = d.querySelector('button.ui-path') as HTMLElement;
    expect(b.dataset['abs']).toBe('/w/out/a/beat.png');
    expect(b.querySelector('.ui-path__base')?.textContent).toBe('beat.png');
    expect(b.querySelector('.ui-path__dir')?.textContent).toBe('out/a/');
    expect(b.getAttribute('aria-label')).toContain('/w/out/a/beat.png');
    expect(d.querySelector('code[data-path="nowhere/x.md"]')).not.toBeNull();
  });
});

describe('the element side', () => {
  it('copies, wraps and unfolds a well', () => {
    const el = markdown('```\na\n```');
    const wrap = el.querySelector<HTMLButtonElement>('.ui-codeblock__wrap')!;
    wrap.click();
    expect(wrap.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.ui-codeblock')?.hasAttribute('data-wrap')).toBe(true);
  });
  it('streams block by block: finished blocks stay the same nodes', () => {
    const el = markdown('first paragraph');
    const first = el.firstElementChild;
    streamMarkdown(el, 'first paragraph\n\nsecond', {}, { animate: false });
    expect(el.firstElementChild).toBe(first);
    expect(el.children).toHaveLength(2);
    const drawn = streamMarkdown(el, 'first paragraph\n\nsecond, longer', {}, { animate: false });
    expect(el.firstElementChild).toBe(first);
    expect(drawn).toHaveLength(1);
    expect(el.lastElementChild?.textContent).toBe('second, longer');
  });
});
