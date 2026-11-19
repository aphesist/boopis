/* The first-run view: setup's checklist, and whatever form is open drawn by the same form card every other request to the
   user uses (docs/FORMS.md, ADR-0020). It is driven by the host's Status (steps, the open form, the receipt); it knows no
   setup logic. The form is answered through the host's `setup_advance`, so this screen gives the card its own answer sink
   (`useFormsHost`) while it is on screen: no data provider exists yet. A secret goes from the field to the host and no
   further. The rest is the design system's own button and tokens. */
import { ui } from '../components';
import { announce } from '../components/announce';
import { welcomeLogo } from '../components/logo';
import { progressDots, setProgress } from '../components/progress';
import '../modules/cards';
import { useFormsHost } from '../modules/cards/forms-host';
import type { FormsSource } from '../data/provider';
import { fromConnectorForm } from './forms';
import type { FormModel } from './forms';
import type { Answer } from './bindings';
import type { SetupBridge, SetupProgress, SetupStatus, SourceInfo } from './setup-bridge';
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
  const b = ui.button({ label: text, type, ...(variant ? { variant } : {}) });
  b.addEventListener('click', (e) => { if (type === 'button') { e.preventDefault(); onClick(); } });
  return b;
};
const STATE_WORD: Readonly<Record<string, string>> = { done: 'done', pending: 'waiting', needs_input: 'needs you', blocked: 'stopped', declined: 'not changed', skipped: 'skipped' };

/** what the first screen says setup is about to do, by which Hermes this run uses. The bundled one is unpacked and set up; the
    user's own is only set up (its profile gets the plugin). When the host cannot say, the sentence claims neither. */
export function introText(src: SourceInfo | null): string {
  const asks = 'It asks before it changes any Hermes setting.';
  if (!src) return `Setup gets Hermes, the agent that does the work, ready for boopis. ${asks}`;
  if (src.carries_runtime && src.running === 'bundled') {
    return `boopis comes with its own Hermes, the agent that does the work. Setup unpacks it into boopis's own folder, then sets it up with the boopis plugin. It never touches another Hermes on this computer. ${asks}`;
  }
  return `boopis uses the Hermes already on this computer. Setup installs the boopis plugin into its profile. ${asks}`;
}

/** bytes as the manifest counts them, in decimal units: "123 MB", "1.2 GB" */
export function bytesText(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${n >= 1e8 ? Math.round(n / 1e6).toString() : (n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${String(Math.round(n / 1e3))} kB`;
  return `${String(Math.round(n))} B`;
}

/** what the host's progress event says, in the view's words: the label of the pass, how far (a whole percent, or null when
    the event carries no figure) and the bytes of the archive. Nothing here is estimated: it is `read` of `total`. */
export function describeProgress(p: SetupProgress): { label: string; value: number | null; bytes: string } {
  const label = p.phase === 'verify' ? 'Checking the Hermes runtime' : 'Unpacking Hermes';
  const { read, total } = p;
  if (read === null || total === null || !(total > 0)) return { label, value: null, bytes: '' };
  return { label, value: Math.min(100, Math.floor((read / total) * 100)), bytes: `${bytesText(Math.min(read, total))} of ${bytesText(total)}` };
}

export interface FirstRunOptions {
  /** start the steps at once, with no first screen (the user already asked: "Change models") */
  autostart?: boolean;
  /** the heading */
  title?: string;
}

/** Show first-run setup if it is needed and resolve when the user is through it (or setup was not needed). */
export async function runFirstRun(bridge: SetupBridge, mount: HTMLElement = document.body, opts: FirstRunOptions = {}): Promise<void> {
  const check = await bridge.check();
  if (!check.needed) return;
  const intro = introText(await bridge.source().catch(() => null));
  const root = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title', class: 'hx-first-run', 'data-layer-host': '',
    style: 'position:fixed;inset:0;z-index:var(--z-palette);display:grid;place-content:center;gap:var(--sp-4);padding:var(--sp-6);background:var(--bg-0);color:var(--text);font:var(--fs-m)/var(--lh) var(--sans)' });
  /* the welcome is a big moment: the logo's hero, once, above whatever step is drawn (it is not redrawn with the card) */
  root.append(welcomeLogo());
  mount.append(root);
  return new Promise<void>((resolve) => {
    let busy = false;
    const draw = (status: SetupStatus | null, error: string): void => {
      const card = el('div', { style: 'display:grid;gap:var(--sp-4);max-width:var(--measure);width:min(90vw,var(--measure))' });
      card.append(el('h1', { id: 'fr-title', style: 'margin:0;font:600 var(--fs-xl)/var(--lh-tight) var(--sans)' }, opts.title ?? 'Set up boopis'));
      if (error) card.append(el('p', { role: 'alert', style: 'margin:0;color:var(--red-text)' }, error));
      if (!status) {
        card.append(el('p', { style: 'margin:0;color:var(--text-dim)' }, intro));
        card.append(button('Set up', 'primary', () => { void run(null, false); }));
      } else {
        card.append(steps(status, () => { void run(null, false); }));
        if (status.install_command) {
          card.append(el('p', { style: 'margin:0' }, 'Install Hermes by running this in a terminal. boopis never runs it for you.'), el('code', { class: 'ui-code', style: 'display:block;overflow-x:auto' }, status.install_command));
          card.append(button('Check again', 'primary', () => { void run(null, false); }));
        }
        if (status.steps.some((s) => s.state === 'declined')) card.append(button('Review again', 'ghost', () => { void run(null, true); }));
        if (status.form) card.append(formCard(fromConnectorForm(status.form)));
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
    /* while a call runs: one card with the heading and a dot indicator. It travels until the host says how far the unpack has
       come, then fills in proportion with the archive's bytes beside it. Every other step is quick and has no figure to show. */
    const drawWorking = (): ((p: SetupProgress) => void) => {
      const label = el('span', { id: 'fr-work-label' }, 'Setting up');
      const bytes = el('span', { id: 'fr-work-bytes', style: 'color:var(--text-quiet);font:var(--fs-2xs)/1.45 var(--mono);font-variant-numeric:tabular-nums' });
      const dots = progressDots({ value: null, label: 'Setting up' });
      const card = el('div', { style: 'display:grid;gap:var(--sp-4);max-width:var(--measure);width:min(90vw,var(--measure))' },
        el('h1', { id: 'fr-title', style: 'margin:0;font:600 var(--fs-xl)/var(--lh-tight) var(--sans)' }, opts.title ?? 'Set up boopis'),
        el('div', { style: 'display:grid;gap:var(--sp-2);justify-items:start', 'data-fr-working': '' }, label, dots, bytes));
      card.dataset['frCard'] = '';
      const shown = root.querySelector('[data-fr-card]');
      if (shown) shown.replaceWith(card); else root.append(card);
      let said = '';
      return (p) => {
        const d = describeProgress(p);
        label.textContent = d.label;
        bytes.textContent = d.bytes;
        setProgress(dots, d.value, d.label);
        if (said !== d.label) { said = d.label; announce(d.label); }
      };
    };
    const run = async (answer: Parameters<SetupBridge['advance']>[0], reconsider: boolean): Promise<void> => {
      if (busy) return;
      busy = true;
      root.setAttribute('aria-busy', 'true');
      let stop: () => void = () => undefined;
      try {
        const show = drawWorking();
        /* a host that cannot send events still runs the steps: the dot just keeps travelling */
        stop = await bridge.onProgress(show).catch(() => () => undefined);
        draw(await bridge.advance(answer, reconsider), '');
      } catch (e) {
        const err = asHostError(e);
        log.warn('setup step failed', err.code);
        draw(null, err.code + ': ' + err.message);
      } finally {
        stop();
        busy = false;
        root.removeAttribute('aria-busy');
      }
    };
    if (opts.autostart) void run(null, false); else draw(null, '');
  });
}

function steps(status: SetupStatus, retry: () => void): HTMLElement {
  const list = el('ol', { 'aria-label': 'Setup steps', style: 'margin:0;padding:0;list-style:none;display:grid;gap:var(--sp-2)' });
  for (const s of status.steps) {
    const item = el('li', { 'data-state': s.state }, el('strong', {}, s.title), ' ', el('span', { style: 'color:var(--text-quiet)' }, '(' + (STATE_WORD[s.state] ?? s.state) + ')'));
    if (s.detail) item.append(el('div', { style: 'color:var(--text-dim)' }, s.detail));
    /* a stopped step can be run again without restarting the app: setup recomputes every step from reality, so what is done
       stays done and the stopped one runs once more. Missing Hermes has its own "Check again", under the command to run. */
    if (s.state === 'blocked' && !status.install_command) {
      const b = button('Retry', 'ghost', retry);
      b.setAttribute('aria-label', 'Retry ' + s.title);
      b.dataset['retry'] = s.id;
      item.append(el('div', { style: 'margin-top:var(--sp-2)' }, b));
    }
    list.append(item);
  }
  return list;
}
