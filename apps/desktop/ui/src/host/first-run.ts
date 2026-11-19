/* The first-run view: setup's checklist, and whatever form is open drawn by the same form card every other request to the
   user uses (docs/FORMS.md, ADR-0020). It is driven by the host's Status (steps, the open form, the receipt); it knows no
   setup logic. The form is answered through the host's `setup_advance`, so this screen gives the card its own answer sink
   (`useFormsHost`) while it is on screen: no data provider exists yet. A secret goes from the field to the host and no
   further. The rest is the design system's own button and tokens. */
import { ui } from '../components';
import { welcomeLogo } from '../components/logo';
import '../modules/cards';
import { useFormsHost } from '../modules/cards/forms-host';
import type { FormsSource } from '../data/provider';
import { fromHostForm } from './forms';
import type { FormModel } from './forms';
import type { Answer } from './bindings';
import type { SetupBridge, SetupStatus } from './setup-bridge';
import { asHostError } from './bridge';
import { reduced } from '../core/dom';
import { logger } from '../core/log';

const log = logger('first-run');

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

/** Show first-run setup if it is needed and resolve when the user is through it (or setup was not needed). */
export async function runFirstRun(bridge: SetupBridge, mount: HTMLElement = document.body): Promise<void> {
  const check = await bridge.check();
  if (!check.needed) return;
  const root = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title', class: 'hx-first-run',
    style: 'position:fixed;inset:0;z-index:var(--z-palette);display:grid;place-content:center;gap:var(--sp-4);padding:var(--sp-6);background:var(--bg-0);color:var(--text);font:var(--fs-m)/var(--lh) var(--sans)' });
  /* the welcome is a big moment: the logo's hero, once, above whatever step is drawn (it is not redrawn with the card) */
  root.append(welcomeLogo());
  mount.append(root);
  return new Promise<void>((resolve) => {
    let busy = false;
    const draw = (status: SetupStatus | null, error: string): void => {
      const card = el('div', { style: 'display:grid;gap:var(--sp-4);max-width:var(--measure);width:min(90vw,var(--measure))' });
      card.append(el('h1', { id: 'fr-title', style: 'margin:0;font:600 var(--fs-xl)/var(--lh-tight) var(--sans)' }, 'Set up boopis'));
      if (error) card.append(el('p', { role: 'alert', style: 'margin:0;color:var(--red-text)' }, error));
      if (!status) {
        card.append(el('p', { style: 'margin:0;color:var(--text-dim)' }, 'boopis installs its plugin into your Hermes profile and asks before it changes any Hermes setting. Nothing is installed without you.'));
        card.append(button('Set up', 'primary', () => { void run(null, false); }));
      } else {
        card.append(steps(status));
        if (status.install_command) {
          card.append(el('p', { style: 'margin:0' }, 'Install Hermes by running this in a terminal. boopis never runs it for you.'), el('code', { class: 'ui-code', style: 'display:block;overflow-x:auto' }, status.install_command));
          card.append(button('Check again', 'primary', () => { void run(null, false); }));
        }
        if (status.steps.some((s) => s.state === 'declined')) card.append(button('Review again', 'ghost', () => { void run(null, true); }));
        if (status.form) card.append(formCard(fromHostForm(status.form)));
        if (status.done) {
          useFormsHost(null);
          card.append(el('h2', { style: 'margin:0;font:600 var(--fs-l)/var(--lh-tight) var(--sans)' }, 'You are set'));
          const list = el('ul', { style: 'margin:0;padding-left:1.2em;color:var(--text-dim)' });
          for (const line of status.receipt?.lines ?? []) list.append(el('li', {}, line));
          card.append(list, button('Open boopis', 'primary', () => { useFormsHost(null); root.remove(); resolve(); }));
        }
      }
      card.dataset['frCard'] = '';
      const shown = root.querySelector('[data-fr-card]');
      if (shown) shown.replaceWith(card); else root.append(card);
    };
    /* the form card's answer sink: `setup_advance` takes the answer, and what it returns is drawn once the receipt has shown */
    const hostForms = (): FormsSource => ({
      async submit(id, outcome) {
        let next: SetupStatus;
        try { next = await bridge.advance({ form_id: id, cancelled: false, values: outcome.values as Answer['values'], secrets: outcome.secrets as Answer['secrets'] }, false); } catch (e) { const err = asHostError(e); log.warn('setup step failed', err.code); throw new Error(err.message); }
        window.setTimeout(() => { draw(next, ''); }, reduced() ? 200 : 700);
      },
      async cancel(id) {
        try { draw(await bridge.advance({ form_id: id, cancelled: true, values: {}, secrets: {} }, false), ''); } catch (e) { const err = asHostError(e); draw(null, err.code + ': ' + err.message); }
      },
      signin: () => Promise.reject(new Error('Signing in is not part of setup.')),
      can: { signin: false, upload: false, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null)
    });
    const formCard = (model: FormModel): HTMLElement => {
      useFormsHost(hostForms());
      const c = ui.card('form', model.spec as unknown as Record<string, unknown>, { size: 'inline' });
      queueMicrotask(() => { c.querySelector<HTMLElement>('.cd-form .ui-input, .cd-form .cd-opt[tabindex="0"], .cd-form .ui-switch')?.focus(); });
      return c;
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
