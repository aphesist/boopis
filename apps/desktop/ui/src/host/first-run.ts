/* The first-run view: a plain, thin screen that shows setup's checklist and draws whatever form is open. It is driven by
   the host's Status (steps, the open form, the receipt); it knows no setup logic. It uses the design system's own button
   and field classes and its tokens, and invents nothing else: the owner may design the full form card later (ADR-0020). */
import { fromHostForm, splitSecrets } from './forms';
import type { FormField, FormModel } from './forms';
import type { SetupBridge, SetupStatus } from './setup-bridge';
import { asHostError } from './bridge';
import { logger } from '../core/log';

const log = logger('first-run');
type Values = Record<string, unknown>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}
const button = (text: string, variant: 'primary' | 'ghost' | '', onClick: () => void, type: 'button' | 'submit' = 'button'): HTMLButtonElement => {
  const b = el('button', { type, class: 'ui-btn' + (variant ? ' ui-btn--' + variant : '') }, el('span', {}, text));
  b.addEventListener('click', (e) => { if (type === 'button') { e.preventDefault(); onClick(); } });
  return b;
};
const STATE_WORD: Readonly<Record<string, string>> = { done: 'done', pending: 'waiting', needs_input: 'needs you', blocked: 'stopped', declined: 'not changed', skipped: 'skipped' };

function fieldControl(f: FormField, id: string): { node: HTMLElement; read: () => unknown; first: HTMLElement | null } {
  const wrap = el('div', { class: 'ui-field' });
  const label = (text: string, forId?: string) => el('label', { class: 'ui-field__label', ...(forId ? { for: forId } : {}) }, text);
  if (f.options && !f.secret) {
    const group = el('fieldset', { class: 'ui-field', style: 'border:0;padding:0;margin:0' }, el('legend', { class: 'ui-field__label' }, f.title));
    const inputs: { input: HTMLInputElement; value: string }[] = [];
    f.options.forEach((value, i) => {
      const input = el('input', { type: f.multi ? 'checkbox' : 'radio', name: id, id: id + '-' + String(i), value });
      if (!f.multi && (f.default === value || (f.default === undefined && i === 0 && f.required))) input.checked = true;
      inputs.push({ input, value });
      group.append(el('label', { for: id + '-' + String(i), style: 'display:flex;gap:var(--sp-2);align-items:center' }, input, f.optionNames[i] ?? value));
    });
    const other = f.other ? el('input', { type: 'text', class: 'ui-input', id: id + '-other', 'aria-label': f.title + ', other', placeholder: 'Other' }) : null;
    if (other) group.append(other);
    return {
      node: group, first: inputs[0]?.input ?? other,
      read: () => {
        const picked = inputs.filter((i) => i.input.checked).map((i) => i.value);
        const extra = other?.value.trim() ?? '';
        if (extra) picked.push(extra);
        return f.multi ? picked : (picked[0] ?? '');
      }
    };
  }
  if (f.type === 'boolean') {
    const input = el('input', { type: 'checkbox', role: 'switch', class: 'ui-switch', id });
    input.checked = f.default === true;
    wrap.append(label(f.title, id), input);
    return { node: wrap, first: input, read: () => input.checked };
  }
  const input = el('input', { type: f.secret ? 'password' : f.type === 'string' ? 'text' : 'number', class: 'ui-input', id, autocomplete: 'off', spellcheck: 'false' });
  if (f.secret) input.setAttribute('data-secret', '');
  if (typeof f.default === 'string') input.value = f.default;
  wrap.append(label(f.title, id), input);
  if (f.description) wrap.append(el('p', { class: 'ui-field__hint' }, f.description));
  return { node: wrap, first: input, read: () => (f.type === 'string' ? input.value : input.value === '' ? '' : Number(input.value)) };
}

function renderForm(model: FormModel, send: (values: Values, secrets: Values) => void, cancel: () => void): HTMLFormElement {
  const form = el('form', { 'aria-labelledby': 'fr-form-title', style: 'display:grid;gap:var(--sp-3)' });
  form.append(el('h2', { id: 'fr-form-title', style: 'margin:0;font:600 var(--fs-l)/var(--lh-tight) var(--sans)' }, model.title));
  if (model.body) form.append(el('p', { style: 'margin:0;color:var(--text-dim);white-space:pre-wrap' }, model.body));
  if (model.diff.length) {
    const table = el('table', { 'aria-label': 'The exact changes', style: 'border-collapse:collapse;font-family:var(--mono)' });
    table.append(el('tr', {}, el('th', { scope: 'col', style: 'text-align:left' }, 'Setting'), el('th', { scope: 'col', style: 'text-align:left' }, 'Now'), el('th', { scope: 'col', style: 'text-align:left' }, 'Becomes')));
    for (const d of model.diff) table.append(el('tr', {}, el('td', {}, d.key), el('td', {}, d.from === null ? 'not set' : JSON.stringify(d.from)), el('td', {}, JSON.stringify(d.to))));
    form.append(table);
  }
  const reads = model.fields.map((f, i) => ({ f, c: fieldControl(f, 'fr-' + String(i)) }));
  for (const { c } of reads) form.append(c.node);
  const row = el('div', { style: 'display:flex;gap:var(--sp-2)' });
  row.append(button(model.submitLabel, 'primary', () => undefined, 'submit'), button(model.cancelLabel, 'ghost', cancel));
  form.append(row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const all: Values = {};
    for (const { f, c } of reads) all[f.name] = c.read();
    try {
      const { plain, secrets } = splitSecrets(model, all);
      send(plain, Object.fromEntries(secrets.map((s) => [s.field, s.value])));
    } finally {
      form.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach((i) => { i.value = ''; });
    }
  });
  queueMicrotask(() => { reads.find((r) => r.c.first)?.c.first?.focus(); });
  return form;
}

/** Show first-run setup if it is needed and resolve when the user is through it (or setup was not needed). */
export async function runFirstRun(bridge: SetupBridge, mount: HTMLElement = document.body): Promise<void> {
  const check = await bridge.check();
  if (!check.needed) return;
  const root = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title', class: 'hx-first-run',
    style: 'position:fixed;inset:0;z-index:var(--z-palette);display:grid;place-content:center;gap:var(--sp-4);padding:var(--sp-6);background:var(--bg-0);color:var(--text);font:var(--fs-m)/var(--lh) var(--sans)' });
  mount.append(root);
  return new Promise<void>((resolve) => {
    let busy = false;
    const draw = (status: SetupStatus | null, error: string): void => {
      const card = el('div', { style: 'display:grid;gap:var(--sp-4);max-width:var(--measure);width:min(90vw,var(--measure))' });
      card.append(el('h1', { id: 'fr-title', style: 'margin:0;font:600 var(--fs-xl)/var(--lh-tight) var(--sans)' }, 'Set up hypotaxis'));
      if (error) card.append(el('p', { role: 'alert', style: 'margin:0;color:var(--red-text)' }, error));
      if (!status) {
        card.append(el('p', { style: 'margin:0;color:var(--text-dim)' }, 'hypotaxis installs its plugin into your Hermes profile and asks before it changes any Hermes setting. Nothing is installed without you.'));
        card.append(button('Set up', 'primary', () => { void run(null, false); }));
      } else {
        card.append(steps(status));
        if (status.install_command) {
          card.append(el('p', { style: 'margin:0' }, 'Install Hermes by running this in a terminal. hypotaxis never runs it for you.'), el('code', { class: 'ui-code', style: 'display:block;overflow-x:auto' }, status.install_command));
          card.append(button('Check again', 'primary', () => { void run(null, false); }));
        }
        if (status.steps.some((s) => s.state === 'declined')) card.append(button('Review again', 'ghost', () => { void run(null, true); }));
        if (status.form) {
          const model = fromHostForm(status.form);
          card.append(renderForm(model,
            (values, secrets) => { void run({ form_id: model.id, cancelled: false, values, secrets }, false); },
            () => { void run({ form_id: model.id, cancelled: true, values: {}, secrets: {} }, false); }));
        }
        if (status.done) {
          card.append(el('h2', { style: 'margin:0;font:600 var(--fs-l)/var(--lh-tight) var(--sans)' }, 'You are set'));
          const list = el('ul', { style: 'margin:0;padding-left:1.2em;color:var(--text-dim)' });
          for (const line of status.receipt?.lines ?? []) list.append(el('li', {}, line));
          card.append(list, button('Open hypotaxis', 'primary', () => { root.remove(); resolve(); }));
        }
      }
      root.replaceChildren(card);
    };
    const run = async (answer: Parameters<SetupBridge['advance']>[0], reconsider: boolean): Promise<void> => {
      if (busy) return;
      busy = true;
      root.setAttribute('aria-busy', 'true');
      try {
        draw(await bridge.advance(answer, reconsider), '');
      } catch (e) {
        const err = asHostError(e);
        log.warn('setup step failed', err.code);
        draw(null, err.code + ': ' + err.message);
      } finally {
        busy = false;
        root.removeAttribute('aria-busy');
      }
    };
    draw(null, '');
  });
}

function steps(status: SetupStatus): HTMLElement {
  const list = el('ol', { 'aria-label': 'Setup steps', style: 'margin:0;padding:0;list-style:none;display:grid;gap:var(--sp-2)' });
  for (const s of status.steps) {
    const item = el('li', { 'data-state': s.state }, el('strong', {}, s.title), ' ', el('span', { style: 'color:var(--text-quiet)' }, '(' + (STATE_WORD[s.state] ?? s.state) + ')'));
    if (s.detail) item.append(el('div', { style: 'color:var(--text-dim)' }, s.detail));
    list.append(item);
  }
  return list;
}
