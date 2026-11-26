// @vitest-environment jsdom
/* The new session's canvas when something is missing (boards S37 and S41; s0.ts `launchCanvas`): with no model signed in the mark is
   asleep, the launch row asks for a model and the canvas offers the sign-ins; with no folder it asks for one. What each control does
   is said to the screen that owns the canvas (`LaunchActions`). */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_MODEL, launchCanvas } from './s0';
import type { LaunchActions, LaunchView } from './s0';

const VIEW: LaunchView = { folder: 'boopis', model: 'sonnet 5.5', effort: 'Default', effortTicks: 3, careful: 'auto_edits', fellBack: false, waiting: [] };
let asked: string[], act: LaunchActions;
const draw = (v: Partial<LaunchView>): HTMLElement => { const c = launchCanvas({ ...VIEW, ...v }, act); document.body.replaceChildren(c); return c; };
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  asked = [];
  act = { folder: () => { asked.push('folder'); }, model: () => { asked.push('model'); }, effort: () => { asked.push('effort'); }, careful: () => { asked.push('careful'); }, signin: (lab) => { asked.push('signin:' + lab); } };
});

describe('no model is signed in (board S37)', () => {
  it('the canvas says so kindly and offers the sign-ins: Claude, ChatGPT, Gemini, each with its mark, and More', () => {
    const c = draw({ model: null });
    const offer = c.querySelector<HTMLElement>('.k7-block[data-variant="offer"]') as HTMLElement;
    expect(offer.querySelector('.k7-block__say')?.textContent).toBe(NO_MODEL);
    const ways = [...offer.querySelectorAll<HTMLButtonElement>('.k7-block__ways button')];
    expect(ways.map((b) => b.textContent)).toEqual(['Claude', 'ChatGPT', 'Gemini', 'More']);
    expect(ways.slice(0, 3).every((b) => !!b.querySelector('.ui-mm'))).toBe(true);
    expect(ways[3]?.getAttribute('data-variant')).toBe('ghost');
    expect(c.querySelector('[data-launch="model"]')?.textContent).toContain('Choose a model');
    expect(c.querySelector('[data-launch="effort"]')).toBeNull();   /* no model, no effort to set yet */
  });
  it('a lab goes to that lab\'s sign-in, More to every way; "+ Choose a model" is the launch row\'s own', () => {
    const c = draw({ model: null });
    for (const b of c.querySelectorAll<HTMLElement>('.k7-block__ways button')) b.click();
    c.querySelector<HTMLElement>('[data-launch="model"]')?.click();
    expect(asked).toEqual(['signin:Claude', 'signin:ChatGPT', 'signin:Gemini', 'signin:', 'model']);
  });
  it('with a model signed in the canvas offers nothing of the kind', () => {
    expect(draw({}).querySelector('[data-variant="offer"]')).toBeNull();
  });
});

describe('no folder yet (board S41)', () => {
  it('the canvas asks for one and offers Add a project; nothing about a model is said before there is a folder', () => {
    const c = draw({ folder: null, model: null });
    expect(c.querySelector('.ss-new__h')?.textContent).toBe('Add a folder to start');
    expect([...c.querySelectorAll('.ss-new__launch button')].map((b) => b.textContent)).toEqual(['Add a project']);
    expect(c.querySelector('[data-variant="offer"]')).toBeNull();
    c.querySelector<HTMLElement>('[data-launch="folder"]')?.click();
    expect(asked).toEqual(['folder']);
  });
});

describe('the rewind sheet (6e)', () => {
  const PLAN = { status: 'planned', isolation: 'shared_unchanged', files: [{ path: 'src/a.ts', action: 'restore' }, { path: 'src/b.ts', action: 'delete' }] } as const;
  it('its files are the kit\'s FilesCard, each path with what happens to it', async () => {
    const { rewindBody } = await import('./s0');
    const box = document.createElement('div'); box.innerHTML = rewindBody(PLAN);
    expect([...box.querySelectorAll('.k7-files__row')].map((r) => r.textContent)).toEqual(['src/a.tsput back', 'src/b.tsremoved']);
    expect(box.querySelector('.k7-files__title')?.textContent).toBe('2 files');
  });
  it('where it cannot run, Rewind stays, disabled, and says why in its Tooltip; Cancel closes', async () => {
    const { rewindSheet } = await import('./s0');
    const confirm = vi.fn(), closed = vi.fn();
    const s = rewindSheet({ ...PLAN, status: 'refused', isolation: 'refused', why: 'A shared checkout changed.' }, 'Rewind', { onConfirm: confirm, closed });
    document.body.append(s.el);
    const btns = [...s.el.querySelectorAll<HTMLButtonElement>('.k7-dialog__foot .k7-btn')];
    const rw = btns.find((b) => b.textContent === 'Rewind') as HTMLButtonElement;
    expect(rw.getAttribute('aria-disabled')).toBe('true');
    expect(rw.dataset['tip']).toBe('A shared checkout changed.');
    rw.click();
    expect(confirm).not.toHaveBeenCalled();
    btns.find((b) => b.textContent === 'Cancel')?.click();
    expect(closed).toHaveBeenCalledOnce();
  });
});
