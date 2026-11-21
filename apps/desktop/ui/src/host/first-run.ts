/* The first-run view: setup's checklist, and whatever form is open drawn by the same form card every other request to the
   user uses (docs/FORMS.md, ADR-0020). It is driven by the host's Status (steps, the open form, the receipt); it knows no
   setup logic. The form is answered through the host's `setup_advance`, so this screen gives the card its own answer sink
   (`useFormsHost`) while it is on screen: no data provider exists yet. A secret goes from the field to the host and no
   further. The rest is the design system's own button and tokens. */
import { ui } from '@boopis/ui';
import { announce } from '@boopis/ui';
import { welcomeLogo } from '@boopis/ui';
import { progressDots, setProgress } from '@boopis/ui';
import '../modules/cards';
import { useFormsHost } from '../modules/cards/forms-host';
import type { FormsSource } from '../data/provider';
import { fromConnectorForm } from './forms';
import type { FormModel } from './forms';
import type { Answer, ConnectorLogin, Form_Deserialize } from './bindings';
import { mountChatgptSignin, tauriChatgptBridge } from './chatgpt-signin';
import { mountXaiSignin, tauriXaiBridge } from './xai-signin';
import type { SigninBridge } from './xai-signin';
import type { ChatgptBridge } from './chatgpt-signin';
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
}
const STATE_WORD: Readonly<Record<string, string>> = { done: 'done', pending: 'waiting', needs_input: 'needs you', blocked: 'stopped', declined: 'not changed', skipped: 'skipped' };

/** what the first screen says setup is about to do, by which engine this run uses. The one boopis carries is unpacked and set
    up; the machine's own (`boopis --engine existing`, documented in the repository, never offered here) is only set up. When
    the host cannot say, the sentence claims neither. The engine is never named (ADR-0031). */
export function introText(src: SourceInfo | null): string {
  const asks = 'It asks before it changes any setting.';
  if (!src) return `Setup gets boopis's engine, the part that does the work, ready. ${asks}`;
  if (src.carries_runtime && src.running === 'bundled') {
    return `boopis comes with its own engine, the part that does the work. Setup unpacks it into boopis's own folder and sets it up. Nothing else on this computer is touched. ${asks}`;
  }
  return `boopis runs on the engine already installed on this computer, as you started it. Setup adds what boopis needs to it. ${asks}`;
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
  const label = p.phase === 'verify' ? 'Checking boopis\'s engine' : 'Unpacking boopis\'s engine';
  const { read, total } = p;
  if (read === null || total === null || !(total > 0)) return { label, value: null, bytes: '' };
  return { label, value: Math.min(100, Math.floor((read / total) * 100)), bytes: `${bytesText(Math.min(read, total))} of ${bytesText(total)}` };
}

/** What a setup form may offer beside its fields (ADR-0030): boopis's own ChatGPT sign-in, a provider's login from the host's
    own table (Claude Code's `claude auth login`), and pages to open (where to make a key). */
export interface SetupSignins {
  chatgpt: ChatgptBridge;
  /** boopis's own SuperGrok sign-in (ADR-0039); a form that offers it needs it */
  xai?: SigninBridge;
  /** the host's sign-in for a provider id in its table; it never runs a command a form names */
  login: (provider: string) => Promise<ConnectorLogin>;
  open: (url: string) => Promise<void>;
}

export function tauriSignins(): SetupSignins {
  const chatgpt = tauriChatgptBridge();
  return {
    chatgpt,
    xai: tauriXaiBridge(),
    login: async (provider) => (await import('./connectors-bridge')).tauriConnectorsBridge().login(provider),
    open: (url) => chatgpt.open(url)
  };
}

export interface FirstRunOptions {
  /** start the steps at once, with no first screen (the user already asked: "Change models") */
  autostart?: boolean;
  /** the heading */
  title?: string;
  /** the sign-ins and pages a form may offer; the host's own commands when absent */
  signins?: SetupSignins;
}

/** The sign-in and the pages a setup form offers, drawn under its card. `next` runs setup again once a sign-in finished
    (the host then finds it in place). Returns the element and what takes it away. */
export function formExtras(form: Form_Deserialize, deps: () => SetupSignins, next: () => void): { node: HTMLElement; destroy: () => void } | null {
  const links = form.links ?? [];
  if (!form.signin && links.length === 0) return null;
  const node = el('div', { 'data-form-extras': form.form_id, style: 'display:grid;gap:var(--sp-3);justify-items:start' });
  let destroy = (): void => undefined;
  for (const [label, url] of links) node.append(button(label, 'ghost', () => { void deps().open(url); }));
  const signin = form.signin;
  if (signin?.provider === 'chatgpt') {
    destroy = mountChatgptSignin(node, deps().chatgpt, { label: signin.label, onSignedIn: next }).destroy;
  } else if (signin?.provider === 'xai' && deps().xai) {
    destroy = mountXaiSignin(node, deps().xai as SigninBridge, { label: signin.label, onSignedIn: next }).destroy;
  } else if (signin) {
    const say = el('p', { role: 'status', style: 'margin:0;color:var(--text-dim)' });
    const out = el('pre', { class: 'ui-code', style: 'margin:0;white-space:pre-wrap;display:none' });
    const go = button(signin.label, 'primary', () => {
      go.disabled = true;
      say.textContent = 'Finish signing in in your browser. This card updates when it\u2019s done.';
      out.style.display = 'none';
      deps().login(signin.provider).then((r) => {
        if (r.ok) { say.textContent = 'Signed in.'; next(); return; }
        go.disabled = false;
        say.setAttribute('role', 'alert');
        say.textContent = r.timed_out ? 'The sign-in took too long and was stopped. Try again.' : 'The sign-in did not finish. Try again.';
        if (r.output.length) { out.textContent = r.output.slice(-4).join('\n'); out.style.display = 'block'; }
      }, (e: unknown) => {
        go.disabled = false;
        say.setAttribute('role', 'alert');
        say.textContent = e instanceof Error ? e.message : 'The sign-in did not start.';
      });
    });
    go.dataset['signin'] = signin.provider;
    node.append(go, say, out);
  }
  return { node, destroy };
}

/** Show first-run setup if it is needed and resolve when the user is through it (or setup was not needed). */
export async function runFirstRun(bridge: SetupBridge, mount: HTMLElement = document.body, opts: FirstRunOptions = {}): Promise<void> {
  const check = await bridge.check();
  if (!check.needed) return;
  const intro = introText(await bridge.source().catch(() => null));
  const root = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title', class: 'hx-first-run', 'data-layer-host': '',
    style: 'position:fixed;inset:0;z-index:var(--z-palette);display:grid;place-content:center;gap:var(--sp-4);padding:var(--sp-6);background:var(--bg-2);color:var(--text);font:var(--fs-m)/var(--lh) var(--sans)' });
  /* the welcome is a big moment: the logo's hero, once, above whatever step is drawn (it is not redrawn with the card) */
  root.append(welcomeLogo());
  mount.append(root);
  return new Promise<void>((resolve) => {
    let busy = false;
    let signins: SetupSignins | null = opts.signins ?? null;
    const deps = (): SetupSignins => (signins ??= tauriSignins());
    let extras = (): void => undefined;
    const draw = (status: SetupStatus | null, error: string): void => {
      extras();
      extras = () => undefined;
      const card = el('div', { style: 'display:grid;gap:var(--sp-4);max-width:var(--measure);width:min(90vw,var(--measure))' });
      card.append(el('h1', { id: 'fr-title', style: 'margin:0;font:600 var(--fs-xl)/var(--lh-tight) var(--sans)' }, opts.title ?? 'Set up boopis'));
      if (error) card.append(el('p', { role: 'alert', style: 'margin:0;color:var(--red-text)' }, error));
      if (!status) {
        card.append(el('p', { style: 'margin:0;color:var(--text-dim)' }, intro));
        card.append(button('Set up', 'primary', () => { void run(null, false); }));
      } else {
        card.append(steps(status, () => { void run(null, false); }));
        /* no engine on this computer (only with `--engine existing`): the step says what to do; boopis installs nothing */
        if (status.install_command) card.append(button('Check again', 'primary', () => { void run(null, false); }));
        if (status.steps.some((s) => s.state === 'declined')) card.append(button('Review again', 'ghost', () => { void run(null, true); }));
        if (status.form) {
          const form = status.form;
          card.append(formCard(fromConnectorForm(form)));
          const more = formExtras(form, deps, () => { void run({ form_id: form.form_id, cancelled: false, values: {}, secrets: {} }, false); });
          if (more) { card.append(more.node); extras = more.destroy; }
        }
        if (status.done) {
          useFormsHost(null);
          card.append(el('h2', { style: 'margin:0;font:600 var(--fs-l)/var(--lh-tight) var(--sans)' }, 'You are set'));
          const list = el('ul', { style: 'margin:0;padding-left:var(--sp-5);color:var(--text-dim)' });
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
    /* a stopped step says what failed in boopis's words, its stable code, and the way out (the host's one error mapper) */
    if (s.detail) item.append(el('div', { style: 'color:var(--text-dim)' }, s.detail + (s.state === 'blocked' && s.code ? ' (' + s.code + ')' : '')));
    /* a stopped step can be run again without restarting the app: setup recomputes every step from reality, so what is done
       stays done and the stopped one runs once more. A missing engine has its own "Check again". */
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
