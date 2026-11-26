// @vitest-environment jsdom
/* The form card on the kit (REPASS.md 6d): every field, every kind, every state, who asks, the questions with options, the keys. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { data, setProvider } from '../../data';
import type { FormOutcome, FormSpec, FormsSource } from '../../data';
import { createMockProvider } from '../../data/mock-provider';
import { createCard } from './index';
import type { HxCard } from './index';
import { useFormsHost } from './forms-host';
import { questionShape } from './form';
import { FORM_LONG, FORM_SPECS } from '../../lab/fixtures';

class FakeForms implements FormsSource {
  submitted: { id: string; outcome: FormOutcome }[] = [];
  cancelled: string[] = [];
  signedIn: string[] = [];
  fail: string | null = null;
  can = { signin: true, upload: true, folder: false };
  submit(id: string, outcome: FormOutcome): Promise<void> {
    if (this.fail) return Promise.reject(new Error(this.fail));
    this.submitted.push({ id, outcome: { values: { ...outcome.values }, secrets: { ...outcome.secrets } } });
    return Promise.resolve();
  }
  cancel(id: string): Promise<void> { this.cancelled.push(id); return Promise.resolve(); }
  signin(id: string, field: string): Promise<void> { this.signedIn.push(id + ':' + field); return Promise.resolve(); }
  pickerItems(): never[] { return []; }
  pickFolder(): Promise<string | null> { return Promise.resolve(null); }
}

const spec = (props: Record<string, unknown>, required: string[] = [], extra: Partial<FormSpec> = {}): FormSpec => ({ id: 'f' + Math.random().toString(36).slice(2, 7), kind: 'choice', title: 'A form', schema: { properties: props as never, required }, ...extra });
const fixture = (k: string, extra: Record<string, unknown> = {}): FormSpec => ({ ...JSON.parse(JSON.stringify(FORM_SPECS[k])), id: k + Math.random().toString(36).slice(2, 6), ...extra }) as FormSpec;
const mount = (s: FormSpec, o: { size?: 'inline' | 'compact' | 'mini'; state?: string } = {}): HxCard => { const c = createCard('form', s as never, { size: o.size ?? 'inline', ...(o.state ? { state: o.state } : {}) }); document.body.append(c); return c; };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const press = (el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => { const e = new KeyboardEvent('keydown', { key, code: init.code ?? (key.length === 1 ? 'Key' + key.toUpperCase() : key), bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };
const block = (c: HxCard): HTMLElement => c.querySelector('[data-kit~="AskCard"]') as HTMLElement;
const answer = (c: HxCard, label: string): HTMLElement => Array.from(c.querySelectorAll<HTMLElement>('.k7-ask__answers .k7-chip')).find((x) => x.textContent?.replace(/esc$/, '').trim() === label) as HTMLElement;
const labels = (c: HxCard): string[] => Array.from(c.querySelectorAll('.k7-ask__answers .k7-chip .k7-chip__label')).map((x) => x.textContent ?? '');
const word = (c: HxCard): string => c.querySelector('.k7-ask__head .k7-word')?.textContent ?? '';
const type = (i: HTMLInputElement | HTMLTextAreaElement, v: string): void => { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
const commit = (c: HxCard): void => { c.querySelector('[data-hold]')?.dispatchEvent(new CustomEvent('ui:commit', { bubbles: true, cancelable: true })); };

let host: FakeForms;
beforeAll(() => { setProvider(createMockProvider({ simulate: false })); });
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); host = new FakeForms(); useFormsHost(host); document.body.replaceChildren(); });
afterEach(() => { useFormsHost(null); delete (data().info as { later?: ReadonlySet<string> }).later; });

describe('the block: the AskCard of boards 11 and K04', () => {
  it('is one AskCard block: the asker, "<asker> asks", the StatusWord, the ask, its why, the fields, the effect, the answers', () => {
    const c = mount(fixture('approval'));
    const b = block(c);
    expect(b.classList.contains('k7-block')).toBe(true);
    expect(b.dataset['variant']).toBe('form');
    expect(b.querySelector('.k7-ask__head .ui-orb, .k7-ask__head orb-avatar')).toBeTruthy();
    expect(b.querySelector('.k7-ask__who')?.textContent).toBe('nina asks');
    expect(word(c)).toBe('needs you');
    expect(b.querySelector('.k7-ask__ask')?.textContent).toBe('Deploy billing/cents to staging');
    expect(b.querySelector('.k7-ask__sub')?.textContent).toMatch(/^Tests are green/);
    expect(b.querySelector('.k7-ask__fields [data-kit~="Field"]')).toBeTruthy();
    expect(b.querySelector('.k7-ask__effect')?.textContent).toMatch(/^Deploys to staging/);
    expect(labels(c)).toEqual(['Hold to approve', 'Later', 'Deny']);
    expect(answer(c, 'Hold to approve').hasAttribute('data-hold')).toBe(true);
    expect(answer(c, 'Deny').hasAttribute('data-end')).toBe(true);
    expect(answer(c, 'Deny').querySelector('.k7-kbd')?.textContent).toBe('esc');
    expect(b.querySelector('[data-countdown]')?.textContent).toMatch(/expires in|min/);
  });
  it('the fields come before the answers in the Tab order, the primary first among the answers', () => {
    const c = mount(fixture('setup'));
    const order = Array.from(c.querySelectorAll<HTMLElement>('input, textarea, button')).filter((x) => x.tabIndex >= 0 && !x.closest('[hidden]'));
    const firstAnswer = order.findIndex((x) => x.closest('.k7-ask__answers'));
    expect(order.slice(0, firstAnswer).some((x) => x.matches('[data-name="gate"]'))).toBe(true);
    expect(order[firstAnswer]?.textContent).toContain('Hold to apply');
  });
});

describe('every field', () => {
  it('draws strings, numbers, formats and long text as kit Fields with their labels', () => {
    const c = mount(spec({ s: { type: 'string', title: 'Name' }, n: { type: 'integer', title: 'Minutes', minimum: 1 }, e: { type: 'string', format: 'email', title: 'Mail' }, u: { type: 'string', format: 'uri', title: 'Site' }, t: { type: 'string', title: 'Notes', 'x-multiline': true } }, ['s']));
    const input = (n: string): HTMLInputElement => c.querySelector(`[data-name="${n}"]`) as HTMLInputElement;
    expect(input('s').type).toBe('text');
    expect(input('s').closest('[data-kit~="Field"]')?.querySelector('label')?.textContent).toBe('Name');
    expect(input('n').getAttribute('inputmode')).toBe('numeric');
    expect(input('n').classList.contains('k7-mono')).toBe(true);
    expect(input('e').type).toBe('email');
    expect(input('u').type).toBe('url');
    expect(c.querySelector('textarea[data-name="t"]')).toBeTruthy();
    expect(input('e').closest('[data-kit~="Field"]')?.querySelector('.k7-field__opt')?.textContent).toBe('(Optional)');
  });
  it('a description is the Field\'s quiet hint line, and the control is described by it', () => {
    const c = mount(spec({ s: { type: 'string', title: 'Name', description: 'As on your badge' } }));
    const i = c.querySelector('[data-name="s"]') as HTMLInputElement;
    const hint = c.querySelector('.k7-field__hint') as HTMLElement;
    expect(hint.textContent).toBe('As on your badge');
    expect(i.getAttribute('aria-describedby')).toContain(hint.id);
  });
  it('a boolean is a Switch on the Field\'s line, and pressing it is the answer', async () => {
    const c = mount(spec({ b: { type: 'boolean', title: 'Allow network' } }));
    const sw = c.querySelector('[role="switch"]') as HTMLElement;
    expect(sw.closest('[data-kit~="Field"]')?.hasAttribute('data-inline')).toBe(true);
    sw.click();
    expect(sw.getAttribute('aria-checked')).toBe('true');
    answer(c, 'Use this').click(); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ b: true });
  });
  it('one of several is OptionRows named by enumNames, with their keys; arrows move and choose', () => {
    const c = mount(spec({ r: { type: 'string', title: 'Rule', enum: ['a', 'b', 'c', 'd'], enumNames: ['Alpha', 'Beta', 'Gamma', 'Delta'] } }));
    const rows = Array.from(c.querySelectorAll<HTMLElement>('.k7-orows .k7-orow'));
    expect(c.querySelector('.k7-orows')?.getAttribute('role')).toBe('radiogroup');
    expect(rows.map((r) => r.querySelector('.k7-orow__label')?.textContent)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(rows.map((r) => r.getAttribute('role'))).toEqual(['radio', 'radio', 'radio', 'radio']);
    expect(rows[1]?.querySelector('.k7-kbd')?.textContent).toBe('2');
    rows[0]?.focus();
    press(rows[0] as HTMLElement, 'ArrowDown');
    expect(rows[1]?.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(rows[1]);
  });
  it('a few short words to choose one of are the kit Segmented', () => {
    const c = mount(fixture('feedback'));
    const seg = c.querySelector('.k7-seg[data-group="verdict"]') as HTMLElement;
    expect(seg).toBeTruthy();
    (seg.querySelectorAll<HTMLElement>('[role="radio"]')[1] as HTMLElement).click();
    expect(seg.querySelectorAll('[role="radio"]')[1]?.getAttribute('aria-checked')).toBe('true');
  });
  it('several picks are OptionRows with checks, and every pick is kept in the answer', async () => {
    const c = mount(spec({ s: { type: 'string', title: 'Suites', 'x-multi': true, enum: ['a', 'b', 'c'] } }));
    const rows = Array.from(c.querySelectorAll<HTMLElement>('.k7-orow'));
    expect(rows[0]?.getAttribute('role')).toBe('checkbox');
    expect(rows[0]?.querySelector('.k7-orow__ring[data-check]')).toBeTruthy();
    rows[0]?.click(); rows[2]?.click();
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true']);
    answer(c, 'Use this').click(); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ s: ['a', 'c'] });
  });
  it('"Something else" is the last row, and choosing it opens a Field for your own words, which is the answer', async () => {
    const c = mount(spec({ r: { type: 'string', title: 'Rule', enum: ['a', 'b', 'c', 'd'], 'x-other': true } }));
    const other = c.querySelector<HTMLElement>('.k7-orow[data-other]') as HTMLElement;
    expect(other.textContent).toContain('Something else');
    other.click();
    const own = c.querySelector('input[data-own="r"]') as HTMLInputElement;
    expect(own).toBeTruthy();
    expect(c.querySelector('.k7-orow[data-other]')?.getAttribute('aria-checked')).toBe('true');
    type(own, 'my rule');
    press(own, 'Enter'); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ r: 'my rule' });
  });
  it('the chosen option\'s code preview is K04\'s Well under the rows', () => {
    const c = mount(spec({ r: { type: 'string', title: 'Rule', enum: ['a', 'b', 'c', 'd'], 'x-preview': [{ code: 'round(x)' }, { text: 'Banker' }, null, null] } }));
    (c.querySelector('.k7-orow') as HTMLElement).click();
    expect(c.querySelector('[data-preview-for="r"] [data-kit~="Well"]')?.textContent).toContain('round(x)');
  });
  it('colours to choose one of are Swatches, a radio group of circles', () => {
    const c = mount(spec({ a: { type: 'string', title: 'Accent', enum: ['#5b5bd6', '#4f46e5'], enumNames: ['Iris', 'Indigo'] } }));
    const g = c.querySelector('.k7-swatches[role="radiogroup"]') as HTMLElement;
    const items = g.querySelectorAll<HTMLElement>('[role="radio"]');
    expect(items[1]?.getAttribute('aria-label')).toBe('Indigo');
    items[1]?.click();
    expect(items[1]?.getAttribute('aria-checked')).toBe('true');
  });
  it('a secret is a password Field that never holds a value in markup, with Show and Hide', () => {
    const c = mount(fixture('credential'));
    const i = c.querySelector('input[data-secret="key"]') as HTMLInputElement;
    expect(i.type).toBe('password');
    expect(i.getAttribute('autocomplete')).toBe('off');
    type(i, 'sk-abc');
    expect(c.innerHTML).not.toContain('sk-abc');
    const show = c.querySelector('[data-reveal]') as HTMLButtonElement;
    show.click();
    expect(i.type).toBe('text');
    expect(show.getAttribute('aria-pressed')).toBe('true');
    expect(show.textContent).toBe('Hide');
    show.click();
    expect(i.type).toBe('password');
  });
  it('a sign-in this build cannot run, or one boopis does not know, says so on its row and its Sign in does nothing', () => {
    const c = mount(spec({ s: { 'x-signin': { provider: 'Acme', command: 'rm -rf /' } } }, ['s'], { kind: 'signin' }));
    const row = c.querySelector('[data-signin-row]') as HTMLElement;
    expect(row.dataset['known']).toBe('false');
    expect(row.textContent).toContain('not one boopis knows');
    answer(c, 'Sign in').click();
    expect(c.state).toBe('open');
    expect(host.signedIn).toEqual([]);
  });
  it('a picker is S17\'s SelectorItem; the model picker opens the kit\'s option Menu and puts the choice in the field', async () => {
    const c = mount(fixture('choice'));
    const pk = c.querySelector('.k7-sel[data-picker="model"]') as HTMLElement;
    expect(pk.dataset['variant']).toBe('field');
    pk.click();
    const menu = document.querySelector('[data-kit~="Menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    const first = menu.querySelector<HTMLElement>('.k7-orow') as HTMLElement;
    const v = first.dataset['value'] ?? '';
    first.click(); await tick();
    expect(pk.querySelector('.k7-sel__value')?.textContent).toBe(v);
    answer(c, 'Use this').click(); await tick();
    expect(host.submitted[0]?.outcome.values['model']).toBe(v);
  });
  it('files are the composer\'s attachment chips after "+ Add files"; a chip removes its file', () => {
    const c = mount(fixture('multi'));
    const add = c.querySelector('[data-add-file]') as HTMLButtonElement;
    expect(add.textContent).toContain('Add files');
    const input = c.querySelector('[data-drop] input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'run.log')], configurable: true });
    input.dispatchEvent(new Event('change'));
    const chip = c.querySelector('[data-drop] [data-kit~="InlineChip"][data-kind="reference"]') as HTMLElement;
    expect(chip.textContent).toBe('run.log');
    chip.click();
    expect(c.querySelector('[data-drop] [data-kit~="InlineChip"]')).toBeNull();
  });
});

describe('every kind', () => {
  it('credential: one secret Field, "Stored in your system\'s keychain" when the form says nothing else, Save key; the key goes to the host alone', async () => {
    const c = mount(fixture('credential', { effect: undefined }));
    expect(c.querySelectorAll('.k7-ask__fields [data-kit~="Field"]').length).toBe(1);
    expect(c.querySelector('.k7-ask__effect')?.textContent).toBe('Stored in your system’s keychain');
    expect(labels(c)[0]).toBe('Save key');
    const events: unknown[] = [];
    document.addEventListener('hx:card-action', (e) => events.push((e as CustomEvent).detail.value), { once: true });
    type(c.querySelector('input[data-secret="key"]') as HTMLInputElement, 'sk-' + 'a'.repeat(24));
    answer(c, 'Save key').click(); await tick();
    expect(host.submitted[0]?.outcome.secrets).toEqual({ key: 'sk-' + 'a'.repeat(24) });
    expect(JSON.stringify(events)).not.toContain('aaaa');
    expect(JSON.stringify(events)).toContain('"provided":["key"]');
    expect(c.state).toBe('done');
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('You saved the key for OpenAI');
    expect(word(c)).toBe('done');
  });
  it('permission: exactly the AskCard; "Always allow" only where approval rules exist', () => {
    let c = mount(fixture('permission'));
    expect(labels(c)).toEqual(['Hold to allow once', 'Allow this session', 'Deny']);
    expect(c.querySelector('.k7-ask__fields')).toBeNull();
    (data().info as { later?: ReadonlySet<string> }).later = new Set(['approval-rules']);
    c = mount(fixture('permission'));
    expect(labels(c)).toEqual(['Hold to allow once', 'Allow this session', 'Always allow', 'Deny']);
  });
  it('permission: the hold allows once, "Allow this session" and Deny answer at once, and each receipt says what you did', async () => {
    const a = mount(fixture('permission'));
    commit(a); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ scope: 'once' });
    expect(a.querySelector('.k7-ask__who')?.textContent).toBe('You allowed it once');
    const b = mount(fixture('permission'));
    answer(b, 'Allow this session').click(); await tick();
    expect(host.submitted[1]?.outcome.values).toEqual({ scope: 'session' });
    const d = mount(fixture('permission'));
    answer(d, 'Deny').click(); await tick();
    expect(host.submitted[2]?.outcome.values).toEqual({ scope: 'deny' });
    expect(d.querySelector('.k7-ask__who')?.textContent).toBe('You denied it');
  });
  it('approval with a note: the AskCard and a text Field under the ask; the note goes with the approval on the hold', async () => {
    const c = mount(fixture('approval'));
    const note = c.querySelector('textarea[data-name="note"]') as HTMLTextAreaElement;
    type(note, 'watch the cents');
    answer(c, 'Hold to approve').click(); await tick();
    expect(host.submitted).toEqual([]);   /* a click is not a hold */
    commit(c); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ note: 'watch the cents' });
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('You approved it');
  });
  it('setup: the config change as the kit DiffView in a Well, then "Hold to apply"', async () => {
    const c = mount(fixture('setup'));
    const dv = c.querySelector('.k7-ask__fields [data-kit~="Well"] [data-kit~="DiffView"]') as HTMLElement;
    expect(dv.querySelector('.k7-diff__head')?.textContent).toContain('boopis.yaml');
    expect(dv.querySelectorAll('[data-sign="add"]').length).toBeGreaterThan(2);
    expect(labels(c)[0]).toBe('Hold to apply');
    commit(c); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ gate: 'npm test', timeout: 5, network: false });
  });
  it('plan: board 17\'s steps not started, "Hold to approve plan", and "Change it" sends your reply to the asker', async () => {
    const c = mount(fixture('plan'));
    const steps = Array.from(c.querySelectorAll('.k7-ask__fields .k7-step'));
    expect(steps.length).toBe(4);
    expect(steps.every((s) => s.getAttribute('data-state') === 'todo')).toBe(true);
    expect(steps[0]?.textContent).toBe('Move src/billing to integer cents behind a Cents type');
    expect(labels(c).slice(0, 2)).toEqual(['Hold to approve plan', 'Change it']);
    type(c.querySelector('textarea[data-name="changes"]') as HTMLTextAreaElement, 'skip the PR');
    answer(c, 'Change it').click(); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ changes: 'skip the PR', approved: false });
    expect(c.state).toBe('done');
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('You asked for changes to the plan');
  });
  it('theme: the colours as Swatches; Keep answers in the app, Reject leaves the theme', async () => {
    const c = mount(fixture('theme'));
    expect(c.querySelectorAll('.k7-swatches .k7-swatches__item').length).toBe(3);
    expect(word(c)).toBe('');
    answer(c, 'Keep').click(); await tick();
    expect(host.submitted).toEqual([]);   /* a theme is answered by the UI itself */
    expect(c.state).toBe('done');
    const r = mount(fixture('theme'));
    answer(r, 'Reject').click();
    expect(r.state).toBe('cancelled');
    expect(word(r)).toBe('rejected');
  });
  it('sign-in: the provider\'s row and "Sign in", which opens the browser through the host; signing in ends the form', async () => {
    const s = fixture('signin');
    const c = mount(s);
    expect(c.querySelector('[data-signin-row] .k7-ask__item-name')?.textContent).toBe('Linear');
    expect(c.querySelector('[data-signin-row] .k7-ask__item-line')?.textContent).toBe('Opens linear.app in your browser.');
    answer(c, 'Sign in').click(); await tick();
    expect(host.signedIn).toEqual([s.id + ':linear']);
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('You signed in to Linear');
  });
  it('connector: O-B06\'s block (its tile, its name, what it can reach), and "Hold to add"', async () => {
    const c = mount(fixture('connector'));
    const item = c.querySelector('.k7-ask__item') as HTMLElement;
    expect(item.querySelector('.k7-ask__item-name')?.textContent).toBe('sentry-mcp 0.9.2');
    expect(item.querySelector('.k7-ask__item-line')?.textContent).toContain('sentry.io only');
    expect(labels(c)[0]).toBe('Hold to add sentry-mcp');
    commit(c); await tick();
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('You added sentry-mcp 0.9.2');
  });
  it('choice: a folder and a model as S17\'s SelectorItems', () => {
    const c = mount(fixture('choice'));
    expect(Array.from(c.querySelectorAll<HTMLElement>('.k7-sel[data-picker]')).map((x) => x.dataset['picker'])).toEqual(['folder', 'model']);
    expect(c.querySelector('.k7-sel[data-picker="folder"] .k7-sel__value')?.textContent).toBe('~/code/billing-api');
  });
  it('feedback: a Segmented and a multi-line Field; Send stores it', async () => {
    const c = mount(fixture('feedback'));
    expect(c.querySelector('textarea[data-name="note"]')).toBeTruthy();
    (c.querySelector('.k7-seg [role="radio"]') as HTMLElement).click();
    answer(c, 'Send').click(); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ verdict: 'right' });
  });
  it('a model endpoint of your own: the URL Field, the key\'s secret Field, then "Models found" as OptionRows with checks', () => {
    const t = mount(fixture('endpoint'));
    expect(t.querySelector('input[data-name="base_url"]')?.getAttribute('type')).toBe('url');
    expect(t.querySelector('input[data-secret]')).toBeTruthy();
    expect(labels(t)[0]).toBe('Test');
    const c = mount(fixture('endpoint-found'));
    const rows = c.querySelectorAll('.k7-orows .k7-orow[role="checkbox"]');
    expect(rows.length).toBe(3);
  });
});

describe('questions with options (conflict 5, decided at 6d)', () => {
  it('up to three short options are S23\'s chips, and a chip answers at once', async () => {
    const s = spec({ b: { type: 'string', title: 'Build', enum: ['staging', 'linux'], enumNames: ['staging', 'the Linux app'] } }, ['b'], { kind: 'question', title: 'Check the fix on which build?', origin: { kind: 'agent', model: 'sonnet 5.5' } });
    expect(questionShape(s)).toBe('chips');
    const c = mount(s);
    expect(block(c).dataset['variant']).toBe('question');
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('asked during the turn');
    expect(labels(c)).toEqual(['staging', 'the Linux app']);
    answer(c, 'the Linux app').click(); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ b: 'linux' });
    expect(c.querySelector('.k7-ask__who')?.textContent).toBe('You answered: the Linux app');
  });
  it('more than three, or a long one, are K02-11\'s lettered rows; a row answers at once', async () => {
    const s = spec({ w: { type: 'string', title: 'For', enum: ['p', 'd', 'b', 'x'], enumNames: ['People who use boopis', 'Developers building on the Local API', 'Both, in two sections', 'Nobody'] } }, ['w'], { kind: 'question', title: 'Who are the notes for?' });
    expect(questionShape(s)).toBe('letters');
    const c = mount(s);
    const rows = c.querySelectorAll<HTMLElement>('.k7-ask__choice');
    expect(Array.from(rows).map((r) => r.querySelector('.k7-ask__letter')?.textContent)).toEqual(['A', 'B', 'C', 'D']);
    rows[2]?.click(); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ w: 'b' });
  });
  it('"Something else" opens a Field for your own words where the asker takes them; Enter answers', async () => {
    const c = mount(fixture('question'));
    expect(labels(c).at(-1)).toBe('Something else');
    answer(c, 'Something else').click();
    const own = c.querySelector('input[data-own]') as HTMLInputElement;
    type(own, 'round at the end');
    press(own, 'Enter'); await tick();
    expect(host.submitted[0]?.outcome.values).toEqual({ rule: 'round at the end' });
  });
  it('no "Something else" where the asker takes only its options', () => {
    const c = mount(spec({ b: { type: 'string', enum: ['yes', 'no'] } }, ['b'], { kind: 'question' }));
    expect(labels(c)).toEqual(['yes', 'no']);
  });
});

describe('who asks', () => {
  const who = (c: HxCard): string => c.querySelector('.k7-ask__who')?.textContent ?? '';
  it('a bot: its orb at 16 and "<name> asks"; a relay says through whom', () => {
    expect(who(mount(fixture('approval')))).toBe('nina asks');
    const r = mount(spec({}, [], { origin: { kind: 'teammate', ids: ['nina'], via: 'atlas' } }));
    expect(who(r)).toBe('nina asks, via atlas');
  });
  it('the agent of a session: its model\'s mark and "asked during the turn"', () => {
    const c = mount(fixture('credential'));
    expect(c.querySelector('.k7-ask__head .k7-head__mark')).toBeTruthy();
    expect(who(c)).toBe('asked during the turn');
  });
  it('several: three orbs overlapped and the rail\'s "+N" chip clear of them', () => {
    const c = mount({ ...FORM_LONG['five'], id: 'f5' } as unknown as FormSpec);
    const lead = c.querySelector('.k7-ask__askers') as HTMLElement;
    expect(lead.querySelectorAll('orb-avatar, .ui-orb').length).toBeGreaterThanOrEqual(3);
    expect(lead.querySelector('.k7-ask__more')?.getAttribute('data-more')).toBe('+2');
    expect(who(c)).toBe('nina and 4 others ask');
  });
  it('a connector: its tile; a mod: its glyph; the app: the boopis mark; nobody named: "Needs your answer" and no avatar', () => {
    const m = mount(spec({}, [], { origin: { kind: 'mcp', server: 'sentry' } }));
    expect(m.querySelector('.k7-ask__head .k7-ask__tile')?.textContent).toBe('S');
    expect(who(m)).toBe('sentry asks');
    const mod = mount(spec({}, [], { origin: { kind: 'mod', plugin: 'sunset' } }));
    expect(mod.querySelector('.k7-ask__head .k7-ic')).toBeTruthy();
    expect(who(mod)).toBe('sunset mod asks');
    const app = mount(spec({}, [], { origin: { kind: 'host' } }));
    expect(app.querySelector('.k7-ask__head .k7-logomark')).toBeTruthy();
    const none = mount(spec({}));
    expect(who(none)).toBe('Needs your answer');
    expect(none.querySelector('.k7-ask__head')?.firstElementChild?.classList.contains('k7-ask__who')).toBe(true);
  });
});

describe('every state', () => {
  it('invalid: the kit Field\'s error line under the field, the control invalid and described by it, the first said and focused; the primary stays and checks again', async () => {
    const c = mount(fixture('credential'));
    const i = c.querySelector('input[data-secret="key"]') as HTMLInputElement;
    const say = vi.spyOn(c, 'announce');
    answer(c, 'Save key').click(); await tick();
    expect(c.state).toBe('invalid');
    const err = c.querySelector('[data-field="key"] .k7-field__error') as HTMLElement;
    expect(err.textContent).toBe('Enter openai api key');
    expect(i.getAttribute('aria-invalid')).toBe('true');
    expect(i.getAttribute('aria-describedby')).toContain(err.id);
    expect(document.activeElement).toBe(i);
    expect(say).toHaveBeenCalledWith(expect.stringMatching(/^Check OpenAI API key/));
    expect(answer(c, 'Save key').getAttribute('aria-disabled')).toBeNull();
    type(i, 'nope'); answer(c, 'Save key').click(); await tick();
    expect(c.querySelector('[data-field="key"] .k7-field__error')?.textContent).toMatch(/doesn’t look like an OpenAI key/);
    type(i, 'sk-' + 'b'.repeat(24));
    expect(c.querySelector('[data-field="key"] .k7-field__error')).toBeNull();
    expect(c.state).toBe('open');
  });
  it('submitting: the primary shows the kit\'s working state and the block\'s controls are inert', async () => {
    let done = (): void => undefined;
    host.submit = (): Promise<void> => new Promise((r) => { done = r; });
    const c = mount(fixture('feedback'));
    (c.querySelector('.k7-seg [role="radio"]') as HTMLElement).click();
    answer(c, 'Send').click(); await tick();
    expect(c.state).toBe('submitting');
    const p = c.querySelector('.k7-ask__answers .k7-chip[data-busy]') as HTMLElement;
    expect(p.querySelector('.k7-chip__label')?.classList.contains('k7-shimmer')).toBe(true);
    expect(p.getAttribute('aria-busy')).toBe('true');
    expect(c.querySelector('.k7-ask__fields')?.hasAttribute('inert')).toBe(true);
    expect(c.querySelector('.k7-ask__answers')?.hasAttribute('inert')).toBe(true);
    done(); await tick(); await tick();
    expect(c.state).toBe('done');
  });
  it('a failed send opens the form again with why, in the Field\'s error words', async () => {
    host.fail = 'The engine is not running';
    const c = mount(fixture('feedback'));
    (c.querySelector('.k7-seg [role="radio"]') as HTMLElement).click();
    answer(c, 'Send').click(); await tick(); await tick();
    expect(c.state).toBe('open');
    expect(c.querySelector('.k7-ask__error')?.textContent).toBe('The engine is not running');
  });
  it('done, later, expired and cancelled are the one-row receipt with a quiet StatusWord', () => {
    const rows = (['done', 'deferred', 'expired', 'cancelled'] as const).map((s) => mount(fixture('approval'), { state: s }));
    expect(rows.map((c) => block(c).dataset['state'])).toEqual(['answered', 'answered', 'answered', 'answered']);
    expect(rows.map(word)).toEqual(['done', 'later', 'expired', 'denied']);
    expect(rows.map((c) => c.querySelector('.k7-word')?.getAttribute('data-tone'))).toEqual(['neutral', 'neutral', 'neutral', 'neutral']);
    expect(rows.every((c) => !c.querySelector('.k7-ask__fields, .k7-ask__answers'))).toBe(true);
  });
  it('later: "Later" puts it off to one row whose "Open" opens it again; an expired one asks again', () => {
    const c = mount(fixture('approval'));
    answer(c, 'Later').click();
    expect(c.state).toBe('deferred');
    const open = c.querySelector('.k7-ask__head .k7-btn[data-action="reopen"]') as HTMLButtonElement;
    expect(open.textContent).toBe('Open');
    open.click();
    expect(c.state).toBe('open');
    const x = mount(fixture('approval'), { state: 'expired' });
    (x.querySelector('[data-action="reopen"]') as HTMLButtonElement).click();
    expect(x.state).toBe('open');
  });
  it('cancel tells the host and leaves the cancelled row', () => {
    const s = fixture('setup');
    const c = mount(s);
    answer(c, 'Cancel').click();
    expect(c.state).toBe('cancelled');
    expect(host.cancelled).toEqual([s.id]);
    expect(word(c)).toBe('cancelled');
  });
  it('mini and the dock\'s compact: the same block; mini is the one row', () => {
    const m = mount(fixture('approval'), { size: 'mini' });
    expect(block(m).dataset['state']).toBe('answered');
    expect(m.querySelector('.k7-ask__who')?.textContent).toBe('Deploy billing/cents to staging');
    expect(word(m)).toBe('needs you');
    const k = mount(fixture('approval'), { size: 'compact' });
    expect(block(k).dataset['variant']).toBe('form');
  });
});

describe('the keys', () => {
  it('Enter submits from a single-line field, not from long text; mod+Enter does', async () => {
    const c = mount(spec({ s: { type: 'string', title: 'Name' }, t: { type: 'string', title: 'Notes', 'x-multiline': true } }));
    const t = c.querySelector('textarea') as HTMLTextAreaElement;
    expect(press(t, 'Enter').defaultPrevented).toBe(false);
    press(t, 'Enter', { ctrlKey: true }); await tick();
    expect(host.submitted.length).toBe(1);
    const d = mount(spec({ s: { type: 'string', title: 'Name' } }));
    press(d.querySelector('input') as HTMLInputElement, 'Enter'); await tick();
    expect(host.submitted.length).toBe(2);
  });
  it('Enter on a hold form asks for the hold and sends nothing', async () => {
    const c = mount(fixture('setup'));
    const say = vi.spyOn(c, 'announce');
    press(c.querySelector('[data-name="gate"]') as HTMLInputElement, 'Enter'); await tick();
    expect(host.submitted).toEqual([]);
    expect(say).toHaveBeenCalledWith(expect.stringMatching(/^Hold the space bar/));
    expect(document.activeElement).toBe(c.querySelector('[data-hold]'));
  });
  it('Esc cancels; a permission\'s Esc denies; a form with no Cancel ignores it', async () => {
    const c = mount(fixture('setup'));
    press(c.querySelector('[data-name="gate"]') as HTMLInputElement, 'Escape');
    expect(c.state).toBe('cancelled');
    const p = mount(fixture('permission'));
    press(p.querySelector('.k7-chip') as HTMLElement, 'Escape'); await tick();
    expect(host.submitted.at(-1)?.outcome.values).toEqual({ scope: 'deny' });
    const f = mount(fixture('feedback'));
    expect(press(f.querySelector('textarea') as HTMLElement, 'Escape').defaultPrevented).toBe(false);
    expect(f.state).toBe('open');
  });
  it('1-9 pick an option when focus is not in a text field, and not while typing', () => {
    const c = mount(spec({ r: { type: 'string', enum: ['a', 'b', 'c', 'd'] }, s: { type: 'string', title: 'Name' } }));
    const rows = c.querySelectorAll('.k7-orow');
    press(rows[0] as HTMLElement, '3', { code: 'Digit3' });
    expect(rows[2]?.getAttribute('aria-checked')).toBe('true');
    press(c.querySelector('[data-name="s"]') as HTMLElement, '1', { code: 'Digit1' });
    expect(rows[0]?.getAttribute('aria-checked')).toBe('false');
  });
});

describe('every kind of the lab\'s fixtures draws on the kit alone', () => {
  it('no v6 form markup is left in any kind or state', () => {
    for (const k of Object.keys(FORM_SPECS)) for (const s of ['open', 'invalid', 'submitting', 'done', 'deferred', 'expired', 'cancelled']) {
      const c = mount(fixture(k), { state: s });
      expect(c.querySelector('[class*="cd-form"], [class*="cd-field"], [class*="cd-opt"], .ui-input, .ui-btn'), k + ' ' + s).toBeNull();
    }
  });
});
