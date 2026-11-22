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
import { labForm, localForm, stepsFor, wayForm } from './first-run-ways';
import { localUseNote, useLocalRuntime } from './local-runtime';
import type { Steps, WayId } from './first-run-ways';
import { tauriProvidersBridge } from './providers-bridge';
import { mountProviders } from './providers-view';
import { HUB_LAYOUT } from './providers-hub';
import './signin-cards';
import { connectedList, LATER_LINE, phaseOf, progressText, startChoices, startSentence, stepStates, summaryOf } from './first-run-model';
import type { Connected, PhaseId, Summary } from './first-run-model';
import type { ProviderState } from './providers-bridge';
import type { ConnectorCatalogEntry, ModelsView } from './bindings';
import type { ProvidersBridge } from './providers-bridge';
import { inTauri } from './bridge';
import { asHostError } from './bridge';
import { windowBar } from './window-controls';
import type { WindowControls } from './window-controls';
import { esc, reduced } from '../core/dom';
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

/** Where the person wants to land once setup is over: the optional steps offer to open a screen of the app, which does not exist yet
    while first run is on screen, so the caller opens it after the app has started. */
export interface FirstRunExit { open: 'connectors' | 'store' | null }

/** One line of a list the optional steps show (a connector, a store item). */
export interface Offer { name: string; line: string }
/** What the optional steps read, so a lab or a test supplies it; the host's own when in the app. A failure reads as an empty list. */
export interface ExtrasSource {
  connectors: () => Promise<Offer[]>;
  store: () => Promise<Offer[]>;
}

export function tauriExtras(): ExtrasSource {
  return {
    connectors: async () => (await (await import('./connectors-bridge')).tauriConnectorsBridge().catalog()).slice(0, 4).map((c: ConnectorCatalogEntry) => ({ name: c.name, line: c.description })),
    store: async () => {
      const page = await (await import('./store-bridge')).tauriStoreBridge().catalogList();
      return (page.recommended ?? []).slice(0, 4).map((i) => ({ name: i.title, line: i.summary }));
    }
  };
}

export interface FirstRunOptions {
  /** told where the person wants to land, once setup is over */
  onExit?: (exit: FirstRunExit) => void;
  /** what the optional steps list; the host's own when absent */
  extras?: ExtrasSource;
  /** start the steps at once, with no first screen (the user already asked: "Change models") */
  autostart?: boolean;
  /** the heading */
  title?: string;
  /** the sign-ins and pages a form may offer; the host's own commands when absent */
  signins?: SetupSignins;
  /** the provider commands, for "Use a model on this computer" (the host's own when in the app; without them that way is not offered) */
  providers?: ProvidersBridge;
  /** the window's controls for the layer's title bar; the page's own controller when absent */
  windowControls?: WindowControls;
}

/** The sign-in and the pages a setup form offers, drawn under its card. `next` runs setup again once a sign-in finished
    (the host then finds it in place). Returns the element and what takes it away. */
export function formExtras(form: Form_Deserialize, deps: () => SetupSignins, next: () => void): { node: HTMLElement; destroy: () => void } | null {
  const links = form.links ?? [];
  if (!form.signin && links.length === 0) return null;
  const node = el('div', { 'data-form-extras': form.form_id, class: 'fr-extras' });
  let destroy = (): void => undefined;
  for (const [label, url] of links) node.append(button(label, 'ghost', () => { void deps().open(url); }));
  const signin = form.signin;
  if (signin?.provider === 'chatgpt') {
    destroy = mountChatgptSignin(node, deps().chatgpt, { label: signin.label, onSignedIn: next }).destroy;
  } else if (signin?.provider === 'xai' && deps().xai) {
    destroy = mountXaiSignin(node, deps().xai as SigninBridge, { label: signin.label, onSignedIn: next }).destroy;
  } else if (signin) {
    const say = el('p', { role: 'status', class: 'fr-note' });
    const out = el('pre', { class: 'ui-code fr-out', hidden: '' });
    const go = button(signin.label, 'primary', () => {
      go.disabled = true;
      say.textContent = 'Finish signing in in your browser. This card updates when it\u2019s done.';
      out.hidden = true;
      deps().login(signin.provider).then((r) => {
        if (r.ok) { say.textContent = 'Signed in.'; next(); return; }
        go.disabled = false;
        say.setAttribute('role', 'alert');
        say.textContent = r.timed_out ? 'The sign-in took too long and was stopped. Try again.' : 'The sign-in did not finish. Try again.';
        if (r.output.length) { out.textContent = r.output.slice(-4).join('\n'); out.hidden = false; }
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

/** The first-run view: a step at a time, with where you are, on one calm surface. Shows first-run setup if it is needed and
    resolves when the person is through it (or setup was not needed). */
export async function runFirstRun(bridge: SetupBridge, mount: HTMLElement = document.body, opts: FirstRunOptions = {}): Promise<void> {
  const check = await bridge.check();
  if (!check.needed) return;
  const intro = introText(await bridge.source().catch(() => null));
  const root = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title', class: 'hx-first-run', 'data-layer-host': '' });
  /* the layer covers the whole window, title bar included, so it carries the window's own: its controls and a drag area, laid
     out like the shell's (the window is undecorated: without them there is no way to move, shrink or close it during setup) */
  const titleBar = windowBar(opts.windowControls);
  const scroller = el('div', { class: 'fr-scroll ui-scroll' });
  const shell = el('div', { class: 'fr-shell' });
  scroller.append(shell);
  root.append(titleBar.node, scroller);
  /* the welcome is a big moment: the logo's hero, once, above whatever step is drawn (it is not redrawn with the card); it steps
     aside once the welcome is over, so the steps that need room have it */
  const logo = welcomeLogo();
  shell.append(logo);
  mount.append(root);
  return new Promise<void>((resolve) => {
    let busy = false;
    let signins: SetupSignins | null = opts.signins ?? null;
    const deps = (): SetupSignins => (signins ??= tauriSignins());
    let extras = (): void => undefined;
    let hub: { destroy: () => void } | null = null;
    /* the models question in two steps (first-run-ways.ts): where in it the person is, and what to say once at the next draw */
    type Stage = { kind: 'way' } | { kind: 'lab'; way: 'signin' | 'key' | 'configured' } | { kind: 'local'; found: Array<{ way: string; label: string; base_url: string; api_mode: string }> };
    let stage: Stage = { kind: 'way' };
    let note = '';
    let current: SetupStatus | null = null;
    /* after the host is done: the summary of the models, then the optional steps, then the end */
    type After = 'none' | 'summary' | 'connectors' | 'store' | 'ready';
    let after: After = 'none';
    let viaHub = false;
    let later = false;
    let offered: string[] = [];
    let states: ReadonlyMap<string, ProviderState> = new Map();
    let exitOpen: FirstRunExit['open'] = null;
    const providers: ProvidersBridge | null = opts.providers ?? (inTauri() ? tauriProvidersBridge() : null);
    const extrasSource = (): ExtrasSource => (opts.extras ??= tauriExtras());
    const ladderChoices = (form: NonNullable<SetupStatus['form']>): { ids: string[]; names: string[] } => {
      const p = ((form.schema as { properties?: Record<string, { enum?: unknown[]; enumNames?: unknown[] }> } | null)?.properties ?? {})['choice'];
      return { ids: (p?.enum ?? []).map(String), names: (p?.enumNames ?? []).map(String) };
    };
    const stepsOf = (form: NonNullable<SetupStatus['form']>): Steps | null => {
      if (form.form_id !== 'setup.ladder') return null;
      const { ids, names } = ladderChoices(form);
      return stepsFor(ids, names, providers !== null);
    };
    const leave = (): void => { hub?.destroy(); hub = null; extras(); extras = () => undefined; useFormsHost(null); foot?.remove(); titleBar.detach(); root.remove(); opts.onExit?.({ open: exitOpen }); resolve(); };

    /* ───────── the frame every step shares: where you are, and the card ───────── */
    const progress = (id: PhaseId): HTMLElement => {
      const wrap = el('div', { class: 'fr-progress', 'data-fr-phase': id });
      wrap.append(el('span', { class: 'fr-progress__text' }, progressText(id)));
      const line = el('ol', { class: 'fr-line', 'aria-label': `Setup. ${progressText(id)}` });
      for (const st of stepStates(id)) {
        const item = el('li', { class: 'fr-line__i', 'data-s': st.s });
        if (st.s === 'now') item.setAttribute('aria-current', 'step');
        item.append(el('span', { class: 'ui-ladder__st', 'data-s': st.s }), el('span', { class: 'fr-line__n' }, st.label));
        line.append(item);
      }
      wrap.append(line);
      return wrap;
    };
    /** the footer of the hub, pinned under the scrolling page; absent from every other step */
    let foot: HTMLElement | null = null;
    const place = (id: PhaseId, card: HTMLElement, wide: HTMLElement | null = null): void => {
      logo.hidden = id !== 'welcome';
      card.dataset['frCard'] = '';
      card.classList.add(wide ? 'fr-page' : 'fr-card');
      root.dataset['frLayout'] = wide ? 'hub' : 'card';
      const bar = progress(id);
      const shown = shell.querySelector('[data-fr-card]');
      const oldBar = shell.querySelector(':scope > .fr-progress');
      if (wide) {
        /* the page: its title and lede, and the progress beside them, then the body; the footer is the window's, not the page's */
        const head = card.querySelector('.fr-head');
        head?.append(bar);
        if (shown) shown.replaceWith(card); else shell.append(card);
        oldBar?.remove();
      } else {
        if (shown) shown.replaceWith(card); else shell.append(card);
        if (oldBar) oldBar.replaceWith(bar); else shell.insertBefore(bar, card);
      }
      foot?.remove();
      foot = wide;
      if (wide) root.append(wide);
      scroller.scrollTo?.({ top: 0 });
    };
    const heading = (text: string, lede = ''): HTMLElement[] => {
      const out = [el('h1', { id: 'fr-title', class: 'fr-title' }, opts.title ?? text)];
      if (lede) out.push(el('p', { class: 'fr-lede' }, lede));
      return out;
    };
    const actions = (primary: HTMLElement | null, ...quiet: HTMLElement[]): HTMLElement => {
      const bar = el('div', { class: 'fr-actions' });
      if (quiet.length) bar.append(el('div', { class: 'fr-actions__quiet' }, ...quiet));
      if (primary) bar.append(primary);
      return bar;
    };

    /* ───────── the steps ───────── */
    const settle = (fn: () => void): void => { window.setTimeout(fn, reduced() ? 200 : 700); };
    const draw = (status: SetupStatus | null, error: string): void => {
      current = status;
      hub?.destroy(); hub = null;
      extras();
      extras = () => undefined;
      const card = el('div', { class: 'fr-stack' });
      const phase = phaseOf(status);
      const open = status?.steps.find((x) => x.state !== 'done' && x.state !== 'skipped' && x.state !== 'declined');
      card.append(...heading(phase === 'welcome' ? (status?.form?.form_id === 'setup.config' ? 'Settings boopis needs' : open && open.id !== 'config' ? 'Getting boopis ready' : 'Set up boopis') : 'Connect your labs'));
      if (error) card.append(el('p', { role: 'alert', class: 'fr-note', 'data-error': '' }, error));
      if (!status) {
        card.append(el('p', { class: 'fr-lede' }, intro));
        card.append(actions(button('Set up', 'primary', () => { void run(null, false); })));
        return place('welcome', card);
      }
      if (!status.form || status.steps.some((s) => s.state === 'blocked' || s.state === 'declined' || s.state === 'skipped') || phase === 'welcome') card.append(steps(status, () => { void run(null, false); }));
      /* no engine on this computer (only with `--engine existing`): the step says what to do; boopis installs nothing */
      if (status.install_command) card.append(actions(button('Check again', 'primary', () => { void run(null, false); })));
      if (status.steps.some((s) => s.state === 'declined')) card.append(actions(null, button('Review again', 'ghost', () => { void run(null, true); })));
      if (status.form) {
        const form = status.form;
        const steps = stepsOf(form);
        if (note) { card.append(el('p', { role: 'status', 'data-fr-note': '', class: 'fr-note' }, note)); note = ''; }
        if (steps && providers && ladderChoices(form).ids.includes('connected')) {
          const built = hubView(form);
          return place('models', built.page, built.foot);
        } else if (steps) {
          if (stage.kind === 'way') card.append(formCard(fromConnectorForm(wayForm(steps, form.body, typeof (form.cancel as { label?: unknown } | null)?.label === 'string' ? String((form.cancel as { label: string }).label) : 'Skip for now'))));
          else if (stage.kind === 'lab') card.append(formCard(fromConnectorForm(labForm(stage.way, steps))));
          else if (stage.found.length) card.append(formCard(fromConnectorForm(localForm(stage.found))));
          else {
            card.append(el('p', { role: 'status', 'data-fr-none': '', class: 'fr-note' }, 'Nothing answered on this computer. Start Ollama, LM Studio, llama.cpp or vLLM, then check again.'));
            card.append(actions(button('Check again', 'primary', () => { void probeLocal(); }), button('Back', 'ghost', () => { stage = { kind: 'way' }; draw(current, ''); })));
          }
        } else {
          card.append(formCard(fromConnectorForm(form)));
          const more = formExtras(form, deps, () => { void run({ form_id: form.form_id, cancelled: false, values: {}, secrets: {} }, false); });
          if (more) { card.append(more.node); extras = more.destroy; }
        }
      }
      if (status.done) { useFormsHost(null); return finished(status); }
      place(phase, card);
    };

    /* ───────── the models hub: connect everything in one place, then continue, or do it later ───────── */
    const hubView = (form: NonNullable<SetupStatus['form']>): { page: HTMLElement; foot: HTMLElement } => {
      offered = ladderChoices(form).ids;
      const section = el('section', { class: 'ui-set fr-hub', 'aria-label': 'Your labs' });
      const cont = ui.button({ label: 'Continue', variant: 'primary', disabled: true, attrs: { 'data-fr-continue': '' } });
      const skip = ui.button({ label: 'Do it later', variant: 'ghost', attrs: { 'data-fr-later': '' } });
      const sum = el('span', { class: 'fr-foot__sum', role: 'status', 'data-fr-sum': '' }, startSentence([]));
      const foot = el('footer', { class: 'fr-foot', 'aria-label': 'Continue or do it later' },
        el('div', { class: 'fr-foot__later' }, skip, el('p', { class: 'fr-hint', 'data-fr-later-line': '' }, `Start with the free models. ${LATER_LINE}`)),
        el('div', { class: 'fr-foot__end' }, sum, cont));
      const answer = (choice: string): void => {
        later = choice === 'later';
        viaHub = true;
        cont.disabled = true; skip.disabled = true;
        void ask({ form_id: form.form_id, cancelled: false, values: { choice }, secrets: {} }).catch((e: unknown) => {
          cont.disabled = false; skip.disabled = false;
          draw(current, e instanceof Error ? e.message : 'That did not work');
        });
      };
      cont.addEventListener('click', () => { answer('connected'); });
      skip.addEventListener('click', () => { answer(ladderChoices(form).ids.includes('later') ? 'later' : 'free'); });
      const prov = mountProviders(section, {
        bridge: providers as ProvidersBridge, login: (p) => deps().login(p), chatgpt: deps().chatgpt, open: (u) => deps().open(u), toast: (t) => { ui.toast(t); }, layout: HUB_LAYOUT,
        onStates: (st) => {
          states = st;
          const list = connectedList(st, offered);
          sum.textContent = startSentence(list);
          cont.disabled = list.length === 0;
          cont.setAttribute('aria-describedby', 'fr-sum');
        }
      });
      sum.id = 'fr-sum';
      hub = { destroy: prov.destroy };
      const page = el('div', { class: 'fr-stack fr-stack--page' },
        el('header', { class: 'fr-head' }, el('div', { class: 'fr-head__t' }, ...heading('Connect your labs', 'Sign in with a plan you already pay for, or add an API key. Connect as many as you like; boopis builds its model ladder from what you connect.'))),
        section);
      return { page, foot };
    };

    /* ───────── after the host is done: the summary, the optional steps, the end ───────── */
    const finished = (status: SetupStatus): void => {
      if (opts.autostart || !viaHub) { after = 'ready'; return ready(status); }
      if (after === 'none') after = 'summary';
      if (after === 'summary') return void summary(status);
      if (after === 'connectors') return void offerStep(status, 'connectors');
      if (after === 'store') return void offerStep(status, 'store');
      ready(status);
    };
    const summary = async (status: SetupStatus): Promise<void> => {
      let view: ModelsView | null = null;
      try { view = (await bridge.modelsView?.()) ?? null; } catch (e) { log.warn('the summary could not read the models', asHostError(e).code); }
      const sum: Summary = summaryOf(view, connectedList(states, offered), later);
      const card = el('div', { class: 'fr-stack', 'data-fr-summary': '' });
      card.append(...heading(sum.later ? 'You are starting on the free models' : 'Your models are set', sum.later ? LATER_LINE : 'This is what boopis will use. You can change any of it in Settings, Models.'));
      card.append(summaryList(sum));
      const choices = startChoices(sum.connected);
      const change = choices.length > 1 ? button('Change my starting model', 'ghost', () => { chooseStart(status, choices); }) : null;
      card.append(actions(button('Continue', 'primary', () => { after = 'connectors'; finished(status); }), ...(change ? [change] : [])));
      place('models', card);
    };
    const summaryList = (sum: Summary): HTMLElement => {
      const rows: string[] = [];
      const start = sum.startsWith.free ? 'The free models' : ui.model(sum.startsWith.model ?? '').outerHTML;
      rows.push(ui.html.setRow({ label: 'Starts with', hint: sum.startsWith.free ? 'No account and no key. One model, from Nous Research.' : `The ${sum.startsWith.tier ?? ''} tier of your ladder.`, control: `<span class="ui-set__value">${sum.startsWith.free ? esc('The free models') : start}</span>` }));
      rows.push(ui.html.setRow({
        label: 'Governed mode',
        hint: sum.governed.available ? 'Runs only on frontier models, cheapest first.' : (sum.governed.why ?? 'Needs a frontier model. Connect one in Settings, Models.'),
        control: sum.ladder.length ? ui.html.ladder({ stations: sum.ladder.map((t) => [t.model] as const), variant: 'list', label: 'Governed ladder' }) : `<span class="ui-set__value">${sum.governed.available ? 'Ready' : 'Not available yet'}</span>`
      }));
      rows.push(ui.html.setRow({
        label: 'Connected', hint: sum.connected.length ? 'Also in the model menu, where the lab lists models.' : 'Nothing yet.',
        control: `<span class="ui-set__value">${sum.connected.length ? esc(sum.connected.map((c) => c.lab).filter((v, i, a) => a.indexOf(v) === i).join(', ')) : 'None'}</span>`
      }));
      const list = el('section', { class: 'ui-set' });
      list.innerHTML = rows.join('');
      ui.hydrate(list);
      return list;
    };
    /* the person picks another starting model among what is connected: the host forgets its choice (nothing changes until the new
       one is made), asks again, and is answered with the lab's own choice */
    const chooseStart = (status: SetupStatus, choices: Connected[]): void => {
      const card = el('div', { class: 'fr-stack', 'data-fr-start': '' });
      card.append(...heading('Which one should boopis start with?', 'All of them stay connected. This only picks where a new session begins.'));
      const group = ui.chipGroup({ options: choices.map((c) => ({ label: c.lab + (c.plan ? ` (${c.plan})` : ''), value: c.choice ?? '' })), value: choices[0]?.choice ?? '', label: 'Starting model' });
      let pick = choices[0]?.choice ?? '';
      group.addEventListener('ui:change', (e) => { pick = (e as CustomEvent<{ value: string }>).detail.value; });
      const go = button('Use this', 'primary', () => {
        go.disabled = true;
        void (async () => {
          try {
            await bridge.reopen?.();
            await bridge.advance(null, false);
            const next = await bridge.advance({ form_id: 'setup.ladder', cancelled: false, values: { choice: pick }, secrets: {} }, false);
            current = next;
            await summary(next);
          } catch (e) { const err = asHostError(e); go.disabled = false; card.prepend(el('p', { role: 'alert', class: 'fr-note' }, err.message)); }
        })();
      });
      card.append(group, actions(go, button('Back', 'ghost', () => { void summary(status); })));
      place('models', card);
    };
    const offerStep = (status: SetupStatus, which: 'connectors' | 'store'): void => {
      const connectors = which === 'connectors';
      const card = el('div', { class: 'fr-stack', 'data-fr-extra': which });
      card.append(...heading(connectors ? 'Connect your tools' : 'Look at the store', connectors
        ? 'Connectors let boopis use the tools you already work in, such as GitHub or a database. Each one asks before it does anything. This step is optional.'
        : 'The store has skills, connectors and plugins that people at boopis have read against their publishers’ own sources. This step is optional.'));
      const list = el('section', { class: 'ui-set', 'aria-label': connectors ? 'Some connectors' : 'Recommended in the store' });
      card.append(list);
      void (extrasSource()[which]().catch(() => [] as Offer[])).then((items) => {
        list.innerHTML = items.length ? ui.html.setHead({ id: 'fr-offer-h', label: connectors ? 'A few to start with' : 'Recommended by boopis', level: 2 }) + items.map((o) => ui.html.setRow({ label: o.name, hint: o.line })).join('') : '';
        if (!items.length) list.remove();
      });
      const next = (): void => { after = connectors ? 'store' : 'ready'; finished(status); };
      card.append(actions(
        button(connectors ? 'Open Connectors' : 'Browse the store', 'primary', () => { exitOpen = which; after = 'ready'; finished(status); }),
        button('Skip', 'ghost', next)));
      place(connectors ? 'connectors' : 'store', card);
    };
    const ready = (status: SetupStatus): void => {
      const card = el('div', { class: 'fr-stack' });
      card.append(...heading('You are set'));
      if (note) { card.append(el('p', { role: 'status', 'data-fr-note': '', class: 'fr-note' }, note)); note = ''; }
      /* what was done, step by step; the receipt's own lines are those the steps do not already say (a declined consent, the platform's gaps) */
      card.append(steps(status, () => { void run(null, false); }));
      const own = (status.receipt?.lines ?? []).filter((l) => !status.steps.some((s) => l.startsWith(s.title + ': ')));
      if (own.length) { const list = el('ul', { class: 'fr-receipt' }); for (const line of own) list.append(el('li', {}, line)); card.append(list); }
      card.append(actions(button('Open boopis', 'primary', leave)));
      place('ready', card);
    };

    /* the form card's answer sink: `setup_advance` takes the answer, and what it returns is drawn once the receipt has shown */
    const ask = async (answer: Answer): Promise<void> => {
      let next: SetupStatus;
      try { next = await bridge.advance(answer, false); } catch (e) { const err = asHostError(e); log.warn('setup step failed', err.code); throw new Error(err.message); }
      stage = { kind: 'way' };
      settle(() => { draw(next, ''); });
    };
    const goTo = (to: Stage): void => { stage = to; settle(() => { draw(current, ''); }); };
    /* ask the runtimes on this computer, loopback only, and keep what answered with its address and wire */
    const probeLocal = async (): Promise<void> => {
      const found: Array<{ way: string; label: string; base_url: string; api_mode: string }> = [];
      try {
        for (const s of await (providers as ProvidersBridge).probe()) {
          if (s.status !== 'found_local') continue;
          const hit = (await import('../data/providers')).way(s.way);
          if (hit && s.base_url) found.push({ way: s.way, label: hit.way.label + (s.models_count != null ? ` (${String(s.models_count)} ${s.models_count === 1 ? 'model' : 'models'})` : ''), base_url: s.base_url, api_mode: hit.way.api_mode ?? 'chat_completions' });
        }
      } catch (e) { log.warn('the probe failed', asHostError(e).code); }
      stage = { kind: 'local', found };
      draw(current, '');
    };
    /* a runtime chosen: ask it for its models, save it as an endpoint under the catalogue's own name and make its first model
       the person's model; the ladder question then stays unanswered (models on this computer are never governed ones) */
    const useLocal = async (wayId: string, formId: string): Promise<void> => {
      const hit = stage.kind === 'local' ? stage.found.find((f) => f.way === wayId) : undefined;
      const cat = (await import('../data/providers')).way(wayId);
      if (!hit || !cat || !providers) return;
      try {
        const use = await useLocalRuntime(providers, cat.way, hit.base_url);
        note = use.builtin || !use.model ? localUseNote(cat.entry, use) : `Saved ${cat.entry.label} as your endpoint, using ${use.model}. Governed mode stays off for models on this computer.`;
      } catch (e) { const err = asHostError(e); throw new Error(err.message); }
      let next: SetupStatus;
      try { next = await bridge.advance({ form_id: formId, cancelled: true, values: {}, secrets: {} }, false); } catch (e) { const err = asHostError(e); throw new Error(err.message); }
      stage = { kind: 'way' };
      settle(() => { draw(next, ''); });
    };
    const hostForms = (): FormsSource => ({
      async submit(id, outcome) {
        const choice = String(outcome.values['choice'] ?? '');
        if (id === 'setup.way') {
          const way = choice as WayId;
          if (way === 'free') return ask({ form_id: 'setup.ladder', cancelled: false, values: { choice: 'free' }, secrets: {} });
          if (way === 'local') { await probeLocal(); return; }
          goTo({ kind: 'lab', way: way as 'signin' | 'key' | 'configured' });
          return;
        }
        if (id === 'setup.lab') return ask({ form_id: 'setup.ladder', cancelled: false, values: { choice }, secrets: {} });
        if (id === 'setup.local') return useLocal(choice, 'setup.ladder');
        return ask({ form_id: id, cancelled: false, values: outcome.values as Answer['values'], secrets: outcome.secrets as Answer['secrets'] });
      },
      async cancel(id) {
        if (id === 'setup.lab' || id === 'setup.local') { goTo({ kind: 'way' }); return; }
        const formId = id === 'setup.way' ? 'setup.ladder' : id;
        try { draw(await bridge.advance({ form_id: formId, cancelled: true, values: {}, secrets: {} }, false), ''); } catch (e) { const err = asHostError(e); log.warn('setup step failed', err.code); draw(null, err.message); }
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
      const bytes = el('span', { id: 'fr-work-bytes', class: 'fr-bytes' });
      const dots = progressDots({ value: null, label: 'Setting up' });
      const card = el('div', { class: 'fr-stack' },
        el('h1', { id: 'fr-title', class: 'fr-title' }, opts.title ?? 'Getting boopis ready'),
        el('div', { class: 'fr-working', 'data-fr-working': '' }, label, dots, bytes));
      place('welcome', card);
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
        draw(null, err.message);
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
  const list = el('ol', { 'aria-label': 'Setup steps', class: 'fr-steps' });
  for (const s of status.steps) {
    const item = el('li', { 'data-state': s.state, class: 'fr-step' },
      el('span', { class: 'fr-step__title' }, s.title), el('span', { class: 'fr-step__state' }, STATE_WORD[s.state] ?? s.state));
    /* a stopped step says what failed in boopis's words, its stable code, and the way out (the host's one error mapper) */
    if (s.detail) item.append(el('span', { class: 'fr-step__detail' }, s.detail));
    /* a stopped step can be run again without restarting the app: setup recomputes every step from reality, so what is done
       stays done and the stopped one runs once more. A missing engine has its own "Check again". */
    if (s.state === 'blocked' && !status.install_command) {
      const b = button('Retry', 'ghost', retry);
      b.setAttribute('aria-label', 'Retry ' + s.title);
      b.dataset['retry'] = s.id;
      item.append(el('span', { class: 'fr-step__act' }, b));
    }
    list.append(item);
  }
  return list;
}
