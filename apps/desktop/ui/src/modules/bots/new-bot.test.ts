// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { data, setProvider } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import '../cards';
import { S } from './model';
import { openNew } from './new-bot';
import { mountView } from './room';
import { NAME_POOL } from './names';

const q = <T extends HTMLElement>(sel: string): T => { const n = document.querySelector<T>(sel); if (!n) throw new Error('missing ' + sel); return n; };
const alt = (code: string, extra: KeyboardEventInit = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: 'r', code, altKey: true, bubbles: true, cancelable: true, ...extra });

beforeAll(() => {
  /* jsdom has no layout: an observer that never fires is all the form needs */
  vi.stubGlobal('ResizeObserver', class { observe(): void { /* no layout */ } unobserve(): void { /* no layout */ } disconnect(): void { /* no layout */ } });
});
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.useFakeTimers();
  setProvider(createMockProvider({ simulate: false }));
  S.bots = []; S.rows.clear(); S.draftRow = null; S.view = 'bot'; S.sel = null;
  document.body.replaceChildren();
  const root = document.createElement('div');
  document.body.append(root);
  mountView(root);
  openNew();
});
afterEach(() => { vi.useRealTimers(); });

describe('the new-bot form: names', () => {
  it('has a dice button that says what it does and what its key is', () => {
    const dice = q('.bt-dice');
    expect(dice.getAttribute('aria-label')).toBe('Surprise me with a name');
    expect(dice.getAttribute('data-tip')).toBe('Surprise me');
    expect(dice.getAttribute('aria-keyshortcuts')).toBe('Alt+R');
    expect(dice.querySelector('svg.ui-icon')).toBeTruthy();
    expect(q('.bt-name').getAttribute('aria-keyshortcuts')).toBe('Alt+R');
  });
  it('the button is never disabled for want of a name', () => {
    expect(q<HTMLButtonElement>('.bt-go').disabled).toBe(false);
    expect(q('.bt-go-label').textContent).toBe('Create bot');
  });
  it('the dice puts a free name from the list in the field and on the button', () => {
    q('.bt-dice').click();
    const name = q<HTMLInputElement>('.bt-name').value;
    expect(NAME_POOL).toContain(name);
    expect(data().bots.snapshot().bots.map((b) => b.id)).not.toContain(name);
    expect(q('.bt-go-label').textContent).toBe('Create ' + name);
    expect(S.draft?.name).toBe(name);
  });
  it('alt+R in the name field rolls a name, and the browser does not get the key', () => {
    const input = q<HTMLInputElement>('.bt-name');
    const e = alt('KeyR');
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(NAME_POOL).toContain(input.value);
    const before = input.value;
    input.dispatchEvent(alt('KeyR'));
    expect(input.value).not.toBe(before);                    // a reroll never lands on what is in the field
  });
  it('alt+R matches by code (Option+R types a symbol on a Mac) and ignores other chords', () => {
    const input = q<HTMLInputElement>('.bt-name');
    input.dispatchEvent(alt('KeyR', { key: '®' }));
    expect(NAME_POOL).toContain(input.value);
    input.value = ''; q('.bt-dice').click(); const rolled = input.value;
    const shifted = alt('KeyR', { shiftKey: true }); input.dispatchEvent(shifted);
    const plain = new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true }); input.dispatchEvent(plain);
    expect(shifted.defaultPrevented).toBe(false);
    expect(plain.defaultPrevented).toBe(false);
    expect(input.value).toBe(rolled);
  });
  it('an empty name is given one from the list when the bot is created', () => {
    const before = data().bots.snapshot().bots.length;
    q('.bt-go').click();
    const after = data().bots.snapshot().bots;
    expect(after.length).toBe(before + 1);
    expect(NAME_POOL).toContain(after[after.length - 1]?.name);
    expect(q<HTMLInputElement>('.bt-name').value).toBe(after[after.length - 1]?.name);
  });
  it('a name in use says it will be numbered, and the provider numbers it', () => {
    const input = q<HTMLInputElement>('.bt-name');
    input.value = 'atlas'; input.dispatchEvent(new Event('input'));
    expect(q('.bt-name-note').textContent).toBe('There is already a bot called atlas. This one will be atlas-2.');
    expect(input.getAttribute('aria-describedby')).toBe(q('.bt-name-note').id);
    q('.bt-go').click();
    expect(data().bots.snapshot().bots.map((b) => b.id)).toContain('atlas-2');
  });
  it('a long name stays whole in the field value, the accessible name and the tooltip, and is cut only by CSS', () => {
    const input = q<HTMLInputElement>('.bt-name');
    const long = 'cassiopeia-staging-deploy-g';
    input.value = long; input.dispatchEvent(new Event('input'));
    expect(q('.bt-go-label').textContent).toBe('Create ' + input.value);
    expect(q('.bt-go').getAttribute('data-tip')).toBe('Create ' + input.value);
    expect(q('.bt-stage button').getAttribute('aria-label')).toBe('Preview of ' + input.value);
  });
});
