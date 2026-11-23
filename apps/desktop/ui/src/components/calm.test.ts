// @vitest-environment jsdom
/* The calm pass's pieces (R-calm-1, 4, 6, 9, 14). */
import { describe, expect, it } from 'vitest';
import { html, ui } from '@boopis/ui';

/* jsdom has no dialog methods */
const DP = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
DP['show'] = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
DP['close'] = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

describe('setRow', () => {
  it('is a label and a control with no sentence by default', () => {
    const d = new DOMParser().parseFromString(html.setRow({ label: 'Show the dock', control: '<b>x</b>' }), 'text/html');
    expect(d.querySelector('small')).toBeNull();
    expect(d.querySelector('.ui-set__value')).toBeNull();
  });
  it('puts a value in mono and the explanation behind an (i)', () => {
    const d = new DOMParser().parseFromString(html.setRow({ label: 'Model', value: 'sonnet', info: 'What it starts with' }), 'text/html');
    expect(d.querySelector('.ui-set__value.ui-mono')?.textContent).toBe('sonnet');
    expect(d.querySelector('.ui-set__info')?.getAttribute('aria-label')).toBe('What it starts with');
    expect(d.querySelector('small')).toBeNull();
  });
});
describe('section', () => {
  it('collapses to its heading and a muted value when empty, with no chevron and no toggle', () => {
    const el = ui.section({ label: 'Context', meta: 'unknown', empty: true, body: '<p>No context yet.</p>' });
    const head = el.querySelector('.ui-sec__head') as HTMLElement;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(head.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('.ui-icon')).toBeNull();
    expect(el.querySelector('.ui-sec__body')?.textContent).toBe('');
    head.click();
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });
  it('draws nothing when empty and hidden', () => { expect(html.section({ label: 'Output', empty: true, hideEmpty: true })).toBe(''); });
  it('still opens when it has content', () => {
    const el = ui.section({ label: 'Tasks', body: '<p>a</p>' });
    (el.querySelector('.ui-sec__head') as HTMLElement).click();
    expect(el.querySelector('.ui-sec__head')?.getAttribute('aria-expanded')).toBe('true');
  });
});
describe('empty', () => {
  it('is one line with at most one action', () => {
    const el = ui.empty({ title: 'What should change?', line: true });
    expect(el.querySelector('h2, .ui-empty__text')).toBeNull();
    expect(el.querySelector('.ui-empty__line')?.textContent).toBe('What should change?');
  });
});
describe('statusLine', () => {
  it('is one live region with a phrase and a mono count', () => {
    const el = ui.statusLine({ text: 'Reading sources', count: '0 of 1' });
    expect(el.getAttribute('role')).toBe('status');
    expect(el.querySelector('.ui-status__count')?.classList.contains('ui-mono')).toBe(true);
    expect(el.querySelector('.ui-dot--run')).not.toBeNull();
  });
  it('changes in place and cross-fades a new phrase', () => {
    const el = ui.statusLine({ text: 'Reading sources', count: '0 of 3' });
    ui.setStatus(el, { count: '1 of 3' });
    expect(el.querySelector('.ui-status__text')?.classList.contains('is-swap')).toBe(false);
    ui.setStatus(el, { text: 'Done', tone: 'idle' });
    expect(el.querySelector('.ui-status__text')?.textContent).toBe('Done');
    expect(el.querySelector('.ui-status__text')?.classList.contains('is-swap')).toBe(true);
    expect(el.querySelector('.ui-dot--run')).toBeNull();
  });
  it('the pulse look has no dot', () => { expect(ui.statusLine({ text: 'x', look: 'pulse' }).querySelector('.ui-dot')).toBeNull(); });
});
describe('dangerZone', () => {
  it('is collapsed, with one danger row and button per action', () => {
    const el = ui.dangerZone({ actions: [{ label: 'Archive bot', action: 'archive' }, { label: 'Delete bot', action: 'delete' }] });
    expect(el.querySelector('.ui-sec__head')?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelectorAll('.ui-set__row[data-tone="danger"]').length).toBe(2);
    expect(el.querySelector('[data-action="delete"]')).not.toBeNull();
  });
});
describe('long text', () => {
  it('previews the text and offers Edit; an empty text says so', () => {
    const el = ui.longText({ label: 'Instructions', value: 'a\n\nb', lines: 2 });
    expect(el.querySelector('[data-action="edit-long"]')?.textContent).toContain('Edit');
    ui.setLongText(el, '', 'None yet');
    expect(el.querySelector('.ui-long__preview')?.textContent).toBe('None yet');
    expect(el.querySelector('.ui-long__preview')?.hasAttribute('data-empty')).toBe(true);
  });
  it('the editor saves only a changed text, and resolves null when cancelled', async () => {
    const p = ui.editLong({ title: 'Instructions', value: 'one', inline: true });
    const d = document.querySelector('dialog.ui-editor') as HTMLElement;
    const save = d.querySelector('[data-action="save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const t = d.querySelector('textarea') as HTMLTextAreaElement; t.value = 'two'; t.dispatchEvent(new Event('input'));
    expect(save.disabled).toBe(false);
    save.click();
    expect(await p).toBe('two');
    const q = ui.editLong({ title: 'Instructions', value: 'one', inline: true });
    (document.querySelector('dialog.ui-editor [data-action="cancel"]') as HTMLElement).click();
    expect(await q).toBeNull();
  });
});
