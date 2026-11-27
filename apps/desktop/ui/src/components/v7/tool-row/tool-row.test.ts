// @vitest-environment jsdom
/* ToolRow: its tests at the kit's two unit levels (docs/kit/TERMS.md). Story: its props drawn as markup and states. Scene: its
   behaviour in jsdom, keys and clicks to events and ARIA.
  Cases moved from kit-6e.test.ts and thread.test.ts keep their words. */
import { beforeEach, describe, expect, it } from 'vitest';
import { kit } from '../index';
import { contract } from './tool-row';

const put = <T extends HTMLElement>(n: T): T => { document.body.replaceChildren(n); return n; };
const EX: Parameters<typeof kit.html.toolRow>[0] = { tool: 'Edit', target: 'src/a.ts' };
beforeEach(() => { document.body.replaceChildren(); });

describe('story: ToolRow', () => {
  it('draws the component its contract names (data-kit="ToolRow")', () => {
    const el = put(kit.toolRow(EX));
    expect(el.matches('[data-kit~="ToolRow"]') || !!el.querySelector('[data-kit~="ToolRow"]')).toBe(true);
    expect(contract.name).toBe('ToolRow');
  });
  it('ToolRow, a session\'s: the model\'s mark, the name, an edit\'s lines, and at the end what waits or what became of it', () => {
    const waiting = put(kit.toolRow({ kind: 'edit', state: 'waiting', tool: 'dock.css', model: 'sonnet 5.5', add: 12, del: 3, ask: { ask: 'Allow?', answers: [{ label: 'Deny', value: 'deny', outline: true, keys: 'esc' }, { label: 'Hold to allow once', value: 'once', hold: true, primary: true }] } }));
    expect(waiting.querySelector('.k7-tool__head .k7-word')?.textContent).toBe('Waiting for you');
    expect(waiting.querySelector('.k7-files__counts')?.textContent).toBe('+12−3');
    expect([...waiting.querySelectorAll('.k7-ask[data-variant="attached"] .k7-chip__label')].map((x) => x.textContent)).toEqual(['Deny', 'Hold to allow once']);
    expect(waiting.querySelector('.k7-ask__head')).toBeNull();   /* attached: the answers alone, the row's head says the rest */
    const done = put(kit.toolRow({ kind: 'edit', state: 'done', tool: 'dock.css', word: 'Denied 09:44', note: 'Keep the transform' }));
    expect(done.querySelector('.k7-word')?.textContent).toBe('Denied 09:44');
    expect(done.querySelector('.k7-tool__note')?.textContent).toBe('“Keep the transform”');
    expect(done.querySelector('.k7-chip')).toBeNull();
    expect(done.querySelector('.k7-tool__head')?.tagName).toBe('DIV');   /* nothing to open: the head is not a control */
  });
});

describe('story: ToolRow, 6e', () => {
  it('a row of a Block has no frame of its own and no glyph where icon is empty', () => {
    const r = put(kit.toolRow({ tool: 'opus 5.5', model: 'claude-opus-5-5', icon: '', row: true, state: 'done', word: 'done' }));
    expect(r.hasAttribute('data-row')).toBe(true);
    expect(r.classList.contains('k7-block')).toBe(false);
    expect(r.hasAttribute('data-sq')).toBe(false);
    expect(r.querySelector('.k7-tool__ic')).toBeNull();
  });
  it('a name that is words (a model\'s) takes the regular face; a tool\'s name stays mono (6f)', () => {
    expect(put(kit.toolRow({ tool: 'opus 5.5', text: true })).querySelector('.k7-tool__name')?.getAttribute('data-face')).toBe('text');
    expect(put(kit.toolRow({ tool: 'Edited dock.css' })).querySelector('.k7-tool__name')?.hasAttribute('data-face')).toBe(false);
  });
  it('its word takes a tone, and a Tooltip the keyboard reaches', () => {
    const r = put(kit.toolRow({ tool: 'gpt', state: 'failed', wordTip: 'the request timed out' }));
    const w = r.querySelector<HTMLElement>('[data-kit~="StatusWord"]') as HTMLElement;
    expect(w.textContent).toBe('failed');
    expect(w.dataset['tone']).toBe('red');
    expect(w.dataset['tip']).toBe('the request timed out');
    expect(w.tabIndex).toBe(0);
    const amber = put(kit.toolRow({ tool: 'gemini', state: 'done', word: 'no answer', wordTone: 'owe' }));
    expect(amber.querySelector<HTMLElement>('[data-kit~="StatusWord"]')?.dataset['tone']).toBe('owe');
  });
  it('carries a control at its head\'s end and what stands under it', () => {
    const r = put(kit.toolRow({ tool: 'opus', state: 'running', word: 'running', end: kit.html.button({ label: 'Stop', variant: 'ghost', size: 28, attrs: { 'data-action': 'stop' } }), after: kit.html.disclosure({ summary: 'Transcript' }) }));
    expect(r.querySelector('.k7-tool__head > [data-action="stop"]')).not.toBeNull();
    expect(r.querySelector('.k7-tool__after [data-kit~="Disclosure"]')).not.toBeNull();
  });
});

describe('scene: ToolRow', () => {
  it('ToolRow with steps opens and closes on its head', () => {
    const row = put(kit.toolRow({ kind: 'command', tool: 'npm test', steps: [{ text: 'ran 142 tests' }] }));
    const head = row.querySelector('.k7-tool__head') as HTMLButtonElement;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    head.click();
    expect(row.hasAttribute('data-open')).toBe(true);
  });
});
