/* The first run's part (a), setup (boards O-P01 to O-P04, O01's "(a) Setup"): the whole window before the app, on the kit's SetupPage.
   Hello while the host gets the engine ready, the settings boopis needs, a model to think with, then (with `drafts`) Try it; the app
   opens after it, where the Sessions part carries on (ledger.ts, modules/session). It is driven by the host's setup (`SetupBridge`:
   the steps, the open form, the progress) and the providers' states (`ProvidersBridge`); it knows no setup logic of its own. A secret
   goes from its Field to the host and no further.

   Replaces the v6 first-run view (`host/first-run.ts`: a checklist, the hub of every provider, a summary with the ladder, optional
   Connectors and Store steps): round 3 draws one model question, and the rest lives in Settings › Models and Connectors. */
import { card as hostCard, icon, kit, markHTML } from '@boopis/ui';
import type { SetupAction, SetupPageOpts } from '@boopis/ui';
import '../cards';
import { useFormsHost } from '../cards/forms-host';
import { focusForm } from '../cards/form';
import type { FormsSource } from '../../data/provider';
import type { LaterFeature } from '../../data/types';
import { way as catalogueWay } from '../../data/providers';
import { fromConnectorForm } from '../../host/forms';
import type { Answer, ConnectorLogin, Form_Deserialize } from '../../host/bindings';
import { mountChatgptSignin, tauriChatgptBridge } from '../../host/chatgpt-signin';
import { mountXaiSignin, tauriXaiBridge } from '../../host/xai-signin';
import type { SigninBridge } from '../../host/xai-signin';
import type { ChatgptBridge } from '../../host/chatgpt-signin';
import type { SetupBridge, SetupProgress, SetupStatus } from '../../host/setup-bridge';
import { tauriProvidersBridge } from '../../host/providers-bridge';
import type { ProviderState, ProvidersBridge } from '../../host/providers-bridge';
import { useLocalRuntime } from '../../host/local-runtime';
import { inTauri, asHostError } from '../../host/bridge';
import { loginFor } from '../../host/logins';
import { windowControls as hostWindowControls } from '../../host/window-controls';
import type { WindowControls } from '../../host/window-controls';
import { esc, reduced } from '../../core/dom';
import { logger } from '../../core/log';
import { asV7 } from '../session/s0';
import { allRows, choiceFor, foundRows, offerRows, primaryOf, settingsOf } from './model';
import type { ModelRow } from './model';
import { startParts } from './ledger';

const log = logger('first-run');

/** What a setup form may offer beside its fields: a provider's sign-in from the host's own table (Claude Code's `claude auth login`),
    boopis's own ChatGPT sign-in, and pages to open */
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
  return { chatgpt, xai: tauriXaiBridge(), login: async (provider) => (await import('../../host/connectors-bridge')).tauriConnectorsBridge().login(provider), open: (url) => chatgpt.open(url) };
}

/** The sign-in and the pages a setup form offers, drawn under its card. `next` runs setup again once a sign-in finished (the host then
    finds it in place). Returns the element and what takes it away. */
export function formExtras(form: Form_Deserialize, deps: () => SetupSignins, next: () => void): { node: HTMLElement; destroy: () => void } | null {
  const links = form.links ?? [];
  if (!form.signin && links.length === 0) return null;
  const node = document.createElement('div');
  node.className = 'hx-fr__extras';
  node.dataset['formExtras'] = form.form_id;
  let destroy = (): void => undefined;
  const btn = (label: string, variant: 'primary' | 'ghost', on: () => void, extra: Record<string, string> = {}): HTMLButtonElement => {
    const b = kit.button({ label, variant, size: 32, attrs: extra }) as HTMLButtonElement;
    b.addEventListener('click', (e) => { e.preventDefault(); on(); });
    return b;
  };
  for (const [label, url] of links) node.append(btn(label, 'ghost', () => { void deps().open(url); }));
  const signin = form.signin;
  if (signin?.provider === 'chatgpt') destroy = mountChatgptSignin(node, deps().chatgpt, { label: signin.label, onSignedIn: next }).destroy;
  else if (signin?.provider === 'xai' && deps().xai) destroy = mountXaiSignin(node, deps().xai as SigninBridge, { label: signin.label, onSignedIn: next }).destroy;
  else if (signin) {
    const say = document.createElement('p'); say.setAttribute('role', 'status'); say.className = 'k7-type-s hx-fr__say';
    const out = document.createElement('pre'); out.className = 'k7-mono hx-fr__out'; out.hidden = true;
    const go = btn(signin.label, 'primary', () => {
      go.disabled = true; out.hidden = true;
      say.setAttribute('role', 'status');
      say.textContent = 'Finish signing in in your browser.';
      deps().login(signin.provider).then((r) => {
        if (r.ok) { say.textContent = 'Signed in.'; next(); return; }
        go.disabled = false;
        say.setAttribute('role', 'alert');
        say.textContent = r.timed_out ? 'The sign-in took too long and was stopped. Try again.' : 'The sign-in did not finish. Try again.';
        if (r.output.length) { out.textContent = r.output.slice(-4).join('\n'); out.hidden = false; }
      }, (e: unknown) => { go.disabled = false; say.setAttribute('role', 'alert'); say.textContent = e instanceof Error ? e.message : 'The sign-in did not start.'; });
    }, { 'data-signin': signin.provider });
    node.append(go, say, out);
  }
  return { node, destroy };
}

export interface FirstRunOptions {
  /** start the steps at once with no hello, and stop after the model question (Settings › Models' "Change models") */
  autostart?: boolean;
  /** the model question's heading in place of "A model to think with" (Change models) */
  title?: string;
  /** the sign-ins a step may run; the host's own when absent */
  signins?: SetupSignins;
  /** the provider commands (the host's own in the app; without them the model question is the host's own form) */
  providers?: ProvidersBridge;
  /** the window's controls for the page's glyphs; the page's own controller when absent */
  windowControls?: WindowControls;
  /** what exists yet (REPASS rule 2): `drafts` shows Try it. No provider has it; the lab's board fixture does */
  later?: ReadonlySet<LaterFeature>;
  /** whether the computer is online (the page says so over the model question); the browser's own when absent */
  online?: () => boolean;
}

/** the three ways a step's model question stands: what this computer has, the plans to sign in to, or every way there is */
type ModelMode = 'found' | 'offer' | 'all';
type Screen =
  | { k: 'hello' }
  | { k: 'working'; progress: SetupProgress | null }
  | { k: 'status'; error: string }
  | { k: 'model'; mode: ModelMode; chosen: string | null; error: string; busy: boolean }
  | { k: 'signin'; way: string; phase: 'waiting' | 'failed'; message: string }
  | { k: 'try'; phase: 'open' | 'ask' };

/** "62%": how far the unpack has come, from the host's own figures; nothing is estimated */
export function percentOf(p: SetupProgress | null): string {
  if (!p || p.read === null || p.total === null || !(p.total > 0)) return '';
  return String(Math.min(100, Math.floor((p.read / p.total) * 100))) + '%';
}

/** Shows the first run's setup if the host says it is needed, and resolves when the person is through it (or it was not needed). */
export async function runFirstRun(bridge: SetupBridge, mount: HTMLElement = document.body, opts: FirstRunOptions = {}): Promise<void> {
  const check = await bridge.check();
  if (!check.needed) return;
  const root = asV7(document.createElement('div'));
  root.className = 'hx-first-run';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'k7-setup-title');
  root.setAttribute('data-layer-host', '');
  mount.append(root);
  const controls = opts.windowControls ?? hostWindowControls();
  const providers: ProvidersBridge | null = opts.providers ?? (inTauri() ? tauriProvidersBridge() : null);
  const has = (f: LaterFeature): boolean => opts.later?.has(f) ?? false;
  const online = opts.online ?? ((): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  let signins: SetupSignins | null = opts.signins ?? null;
  const deps = (): SetupSignins => (signins ??= tauriSignins());

  return new Promise<void>((resolve) => {
    let screen: Screen = opts.autostart ? { k: 'working', progress: null } : { k: 'hello' };
    let status: SetupStatus | null = null;
    let states: ReadonlyMap<string, ProviderState> = new Map();
    let skipping = false, busy = false, typedKey = '';
    let detach = (): void => undefined, stopSignin = (): void => undefined, detachExtras = (): void => undefined;

    const leave = (): void => {
      stopSignin(); detach(); useFormsHost(null);
      if (!opts.autostart) startParts(skipping);
      root.remove();
      resolve();
    };
    /* ───────── drawing: one SetupPage per screen, its glyphs wired to the window ───────── */
    const page = (o: Omit<SetupPageOpts, 'windowParts'>): void => {
      const keep = (document.activeElement as HTMLElement | null)?.dataset['setup'] ?? null;
      detach(); detachExtras(); detachExtras = () => undefined;
      root.innerHTML = kit.html.setupPage({ ...o, windowParts: { group: { 'data-win-group': '' }, min: { 'data-win': 'min' }, max: { 'data-win': 'max' }, close: { 'data-win': 'close' } } }) +
        /* the window is undecorated: a strip along its top moves it (and a double press there maximises it), under the glyphs */
        '<div class="hx-fr__bar" data-tauri-drag-region="deep"></div>';
      kit.wire(root);
      const group = root.querySelector<HTMLElement>('[data-win-group]');
      detach = group ? controls.attach(group) : (): void => undefined;
      const again = keep ? root.querySelector<HTMLElement>('[data-setup="' + CSS.escape(keep) + '"]') : null;
      (again ?? root.querySelector<HTMLElement>('.k7-setup__acts [data-kit~="Button"]:not([disabled]), .k7-setup__body [aria-checked="true"]'))?.focus({ preventScroll: true });
    };
    const skip = (label = 'Skip setup'): SetupPageOpts['skip'] => (opts.autostart ? undefined : { label, value: 'skip' });
    const draw = (): void => {
      const s = screen;
      if (s.k === 'hello') return page(helloPage(null));
      if (s.k === 'working') return page(helloPage(s.progress));
      if (s.k === 'model') return drawModel(s);
      if (s.k === 'signin') return drawSignin(s);
      if (s.k === 'try') return drawTry(s);
      drawStatus(s.error);
    };
    const helloPage = (p: SetupProgress | null): Omit<SetupPageOpts, 'windowParts'> => ({
      title: opts.title ?? 'Hi, I’m boopis', lede: opts.autostart ? '' : 'A minute of setup here, then sessions, then your bots. I’ll walk you through it.', mark: 'hero',
      ...(screen.k === 'working' ? { status: { text: 'Getting boopis ready', figure: percentOf(p) } } : { actions: [{ label: 'Let’s start', primary: true, value: 'start' }] }),
      skip: skip()
    });

    /* what the host's status asks for now: the consent, the model question, another form, a stop, or the end */
    const drawStatus = (error: string): void => {
      const st = status;
      if (!st) return page({ ...helloPage(null), noticeHTML: error ? kit.html.notice({ tone: 'red', icon: 'alert', text: error }) : '' });
      const form = st.form ?? null;
      if (form?.form_id === 'setup.config') {
        const rows = settingsOf(form);
        return page({
          title: 'Settings boopis needs', lede: 'boopis changes three engine settings, and only these. It asks before it changes any other.',
          bodyHTML: kit.html.card({ variant: 'settings', rows: rows.map((r) => ({ label: r.label, subHTML: '<span class="k7-mono">' + esc(r.line) + '</span>', control: '<span class="hx-fr__on" role="img" aria-label="Changed">' + icon('check') + '</span>' })), attrs: { 'aria-label': 'The settings it changes' } }),
          actions: [{ label: 'Apply the changes', primary: true, value: 'apply', busy }, { label: 'Not now', value: 'decline', disabled: busy }],
          ...(error ? { noticeHTML: kit.html.notice({ tone: 'red', icon: 'alert', text: error }) } : {})
        });
      }
      if (form?.form_id === 'setup.ladder') { screen = { k: 'model', mode: 'found', chosen: null, error, busy: false }; void readProviders(true); return; }
      if (form) return drawForm(form, error);
      /* a step stopped: what failed in boopis's words, and the way out (no engine: the documented install command) */
      const stopped = st.steps.find((x) => x.state === 'blocked');
      if (stopped) {
        return page({
          title: 'Getting boopis ready', lede: stopped.detail || stopped.title, mark: 'top', markState: 'sleeping',
          ...(st.install_command ? { bodyHTML: kit.html.well({ kind: 'terminal', text: st.install_command }) } : {}),
          actions: [{ label: st.install_command ? 'Check again' : 'Try again', primary: true, value: 'retry' }], skip: skip()
        });
      }
      const declined = st.steps.find((x) => x.state === 'declined');
      if (declined && !st.done) return void run(null, false);
      if (declined) {
        return page({
          title: 'Settings boopis needs', lede: declined.detail || 'Not changed.', mark: 'top',
          actions: [{ label: 'Review the settings', primary: true, value: 'reconsider' }, { label: 'Continue', value: 'finish' }]
        });
      }
      if (st.done) return finish();
      void run(null, false);
    };
    /* any other question the host asks (a key it needs): the kit's form card on the page, answered through `setup_advance` */
    const drawForm = (form: NonNullable<SetupStatus['form']>, error: string): void => {
      useFormsHost(hostForms());
      const model = fromConnectorForm(form);
      page({ title: form.title, mark: 'top', bodyHTML: '<div data-fr-form></div>', ...(error ? { noticeHTML: kit.html.notice({ tone: 'red', icon: 'alert', text: error }) } : {}), skip: skip() });
      const slot = root.querySelector<HTMLElement>('[data-fr-form]');
      const c = hostCard('form', model.spec as unknown as Record<string, unknown>, { size: 'inline' });
      slot?.append(c);
      const more = formExtras(form, deps, () => { void run({ form_id: form.form_id, cancelled: false, values: {}, secrets: {} }, false); });
      if (more) { slot?.append(more.node); const prev = detachExtras; detachExtras = () => { prev(); more.destroy(); }; }
      queueMicrotask(() => { focusForm(c); });
    };
    const hostForms = (): FormsSource => ({
      submit: (id, outcome) => ask({ form_id: id, cancelled: false, values: outcome.values as Answer['values'], secrets: outcome.secrets as Answer['secrets'] }),
      cancel: (id) => ask({ form_id: id, cancelled: true, values: {}, secrets: {} }),
      signin: () => Promise.reject(new Error('Signing in is not part of this step.')),
      can: { signin: false, upload: false, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null)
    });

    /* ───────── O-P03: a model to think with ───────── */
    const offered = (): string[] => {
      const p = ((status?.form?.schema as { properties?: Record<string, { enum?: unknown[] }> } | null)?.properties ?? {})['choice'];
      return (p?.enum ?? []).map(String);
    };
    const rowsFor = (mode: ModelMode): ModelRow[] => (mode === 'found' ? foundRows(states).slice(0, 3) : mode === 'offer' ? offerRows() : allRows(states));
    const readProviders = async (probe: boolean): Promise<void> => {
      if (!providers) { if (status?.form) drawForm(status.form, ''); return; }
      const [list, local] = await Promise.allSettled([providers.list(), probe ? providers.probe() : Promise.resolve([] as ProviderState[])]);
      const next = new Map<string, ProviderState>();
      if (list.status === 'fulfilled') for (const s of list.value) next.set(s.way, s);
      if (local.status === 'fulfilled') for (const s of local.value) next.set(s.way, s);
      states = next;
      if (screen.k !== 'model') return;
      const mode: ModelMode = screen.mode === 'all' ? 'all' : foundRows(states).length ? 'found' : 'offer';
      const rows = rowsFor(mode);
      const chosen = rows.find((r) => r.way === (screen as { chosen: string | null }).chosen)?.way ?? rows[0]?.way ?? null;
      screen = { ...screen, mode, chosen, error: list.status === 'rejected' ? asHostError(list.reason).message : screen.error };
      if (skipping) { void answerLadder(offered().includes('later') ? 'later' : 'free'); return; }
      draw();
    };
    const drawModel = (s: Extract<Screen, { k: 'model' }>): void => {
      const rows = rowsFor(s.mode);
      const row = rows.find((r) => r.way === s.chosen) ?? null;
      const ledes: Record<ModelMode, string> = {
        found: 'I found these on this computer, so you only need to confirm.',
        offer: 'Use a plan you already pay for, or a key. Nothing is signed in on this computer yet.',
        all: 'Sign in with a plan you already pay for, or add a key.'
      };
      const list = rows.map((r) => kit.html.optionRow({ variant: 'question', label: r.name, meaning: r.meaning, chosen: r.way === s.chosen, value: r.way, ...(r.model ? { leadHTML: markHTML(r.model, { size: 16, label: false }) } : { icon: 'terminal' }), attrs: { role: 'radio' } })).join('');
      const keyField = row?.kind === 'key' ? kit.html.field({ id: 'hx-fr-key', secret: true, ariaLabel: row.name.replace(/^Use an? /, '') , placeholder: 'Paste the key', value: typedKey }) : '';
      const offline = !online();
      const actions: SetupAction[] = s.mode === 'offer'
        ? [{ label: row ? primaryOf(row) : 'Continue', primary: true, value: 'use', busy: s.busy, disabled: !row || (row.kind === 'key' && !typedKey) }, { label: 'Use the free models', value: 'free', disabled: s.busy }]
        : [{ label: row ? primaryOf(row) : 'Continue', primary: true, value: 'use', busy: s.busy, disabled: !row || (row.kind === 'key' && !typedKey) }, ...(s.mode === 'found' ? [{ label: 'Add another', value: 'more', disabled: s.busy }] : [{ label: 'Back', value: 'back', disabled: s.busy }])];
      page({
        title: opts.title ?? 'A model to think with', lede: ledes[s.mode],
        ...(offline ? { noticeHTML: kit.html.notice({ icon: 'clock', title: 'No internet right now.', text: ' Your answers are saved.', actions: [{ label: 'Try again', ghost: true, value: 'online' }] }) }
          : s.error ? { noticeHTML: kit.html.notice({ tone: 'red', icon: 'alert', text: s.error }) } : {}),
        bodyHTML: kit.html.block({ body: '<div class="hx-fr__rows" role="radiogroup" aria-label="Models">' + list + '</div>' + (keyField ? '<div class="hx-fr__key">' + keyField + '</div>' : ''), attrs: { 'data-fr-models': s.mode } }),
        actions, skip: skip()
      });
    };
    const answerLadder = async (choice: string): Promise<void> => ask({ form_id: 'setup.ladder', cancelled: false, values: { choice }, secrets: {} });
    /* the chosen row: use what is there, take a key, or sign in */
    const useRow = async (r: ModelRow): Promise<void> => {
      if (screen.k !== 'model') return;
      screen = { ...screen, busy: true, error: '' }; draw();
      const cat = catalogueWay(r.way);
      try {
        if (r.kind === 'local' && cat && providers) {
          await useLocalRuntime(providers, cat.way, states.get(r.way)?.base_url ?? cat.way.base_url?.default ?? '');
          /* a runtime on this computer is never a governed tier: the ladder question stays unanswered (the host keeps the model set) */
          return await ask({ form_id: 'setup.ladder', cancelled: true, values: {}, secrets: {} });
        }
        if (r.kind === 'key' && providers) {
          const st = await providers.setKey(r.way, typedKey);
          typedKey = '';
          if (st.status !== 'connected') throw new Error(st.detail ?? 'The key did not work.');
          states = new Map(states).set(r.way, st);
        }
        if (r.kind === 'signin') return startSignin(r.way);
        const c = cat ? choiceFor(cat.way, offered()) : null;
        await answerLadder(c ?? (offered().includes('connected') ? 'connected' : 'free'));
      } catch (e) {
        screen = { k: 'model', mode: screen.mode, chosen: r.way, busy: false, error: e instanceof Error ? e.message : asHostError(e).message };
        draw();
      }
    };

    /* ───────── O-P03c, O-P03d: signing in, and a sign-in that did not finish ───────── */
    const startSignin = (wayId: string): void => {
      stopSignin();
      screen = { k: 'signin', way: wayId, phase: 'waiting', message: '' }; draw();
      const cat = catalogueWay(wayId);
      const failed = (message: string): void => { if (screen.k === 'signin' && screen.way === wayId) { screen = { ...screen, phase: 'failed', message }; draw(); } };
      const signedIn = (): void => { stopSignin(); screen = { k: 'model', mode: 'found', chosen: wayId, error: '', busy: false }; void readProviders(false); };
      if (cat?.way.signin?.flow === 'cli') {
        let gone = false; stopSignin = () => { gone = true; };
        deps().login(cat.way.signin.login ?? 'claude-code').then((r) => { if (!gone) { if (r.ok) signedIn(); else failed(r.timed_out ? 'The sign-in took too long and was stopped.' : ''); } }, (e: unknown) => { if (!gone) failed(asHostError(e).message); });
        return;
      }
      if (wayId === 'openai.signin') {
        const c = deps().chatgpt;
        let off: (() => void) | null = null, gone = false;
        stopSignin = () => { gone = true; off?.(); };
        void c.onEnd((e) => { if (gone) return; if (e.outcome === 'signed_in') signedIn(); else failed(e.message); }).then((f) => { if (gone) f(); else off = f; });
        c.start().then((code) => c.open(code.verification_url)).catch((e: unknown) => { failed(asHostError(e).message); });
        return;
      }
      if (providers) {
        let off: (() => void) | null = null, gone = false;
        stopSignin = () => { gone = true; off?.(); };
        void providers.onSigninEnd((e) => { if (gone || e.way !== wayId) return; if (e.outcome === 'signed_in') signedIn(); else failed(e.message); }).then((f) => { if (gone) f(); else off = f; });
        providers.signinStart(wayId).then((code) => deps().open(code.verification_url)).catch((e: unknown) => { failed(asHostError(e).message); });
      }
    };
    const drawSignin = (s: Extract<Screen, { k: 'signin' }>): void => {
      const cat = catalogueWay(s.way);
      const name = cat ? (allRows(states).find((r) => r.way === s.way)?.name.replace(/^Sign in with /, '') ?? cat.entry.label) : s.way;
      const mark = cat ? ({ anthropic: 'claude-sonnet', openai: 'gpt-5', google: 'gemini-pro', xai: 'grok-4' } as Record<string, string>)[cat.entry.id] : undefined;
      const login = cat?.way.signin?.flow === 'cli' ? loginFor(cat.way.signin.login ?? undefined) : null;
      const st = states.get(s.way);
      if (s.phase === 'waiting') {
        return page({
          title: opts.title ?? 'A model to think with', lede: 'Finish signing in in your browser. This page moves on by itself when it’s done.', markState: 'thinking',
          bodyHTML: kit.html.askCard({ variant: 'form', state: 'asked', ask: 'The sign-in page is open in your browser.', who: 'Signing in with ' + name, ...(mark ? { model: mark } : { lead: '' }), word: { text: 'waiting' } }),
          actions: [{ label: 'Open the page again', primary: true, value: 'reopen' }, { label: 'Cancel', value: 'cancel' }], skip: skip()
        });
      }
      /* a program of the person's own that is not signed in, or not installed: the line to run in a terminal (the host's own table) */
      const missing = st?.status === 'needs_install';
      const line = missing ? st?.install?.command ?? '' : login?.line ?? '';
      const lede = login ? (missing ? `${login.name} isn’t installed here. Install it in a terminal, then check again.` : `I found ${login.name} here, but it isn’t signed in. Sign in once in a terminal, then check again.`)
        : s.message || 'The sign-in didn’t finish. Try again, or use something else.';
      page({
        title: opts.title ?? 'A model to think with', lede, markState: 'skeptic',
        bodyHTML: kit.html.askCard({ variant: 'form', state: 'asked', ask: '', who: name, ...(mark ? { model: mark } : { lead: '' }), word: { text: missing ? 'not installed' : 'not signed in', tone: 'red' }, ...(line ? { command: line } : {}) }),
        actions: [{ label: login ? 'Check again' : 'Try again', primary: true, value: login ? 'recheck' : 'reopen' }, { label: 'Use something else', value: 'cancel' }], skip: skip()
      });
    };

    /* ───────── O-P04: Try it (only with `drafts`: boopis reading a draft is not live yet) ───────── */
    const drawTry = (s: Extract<Screen, { k: 'try' }>): void => {
      const ask0 = s.phase === 'ask';
      const comp = kit.html.composer({ kind: 'session', label: 'An example draft', textHTML: 'refactor ' + kit.html.mark({ text: 'the billing helpers', state: 'shown' }) + ' and ' + kit.html.mark({ text: 'ship it', state: ask0 ? 'chosen' : 'open' }), hint: 'Will assume: the helpers in billing/', hintEnd: ask0 ? 'Sent with it: open a pull request' : 'Nothing is sent', attrs: { 'data-fr-try': '', inert: '' } });
      const menu = ask0 ? '' : kit.html.menu({ label: 'I read “ship it” as', entries: [{ heading: 'I read “ship it” as' }, { label: 'Open a pull request', value: 'pr', checked: true }, { label: 'Merge it into main', value: 'merge' }, { label: 'Commit, don’t push', value: 'commit' }, '-', { label: 'Something else…', value: 'else' }], attrs: { 'data-fr-reading': '' } });
      /* the example is recorded: no model reads it (the Notice says so, under the composer, clear of the reading above its mark) */
      const note = ask0 ? '' : kit.html.notice({ icon: 'clock', text: 'Recorded example. Connect a model and boopis reads your own drafts.' });
      page({
        title: ask0 ? 'Keep reading your drafts?' : 'One thing boopis does differently',
        lede: ask0 ? 'Reads with the cheapest model you have. Each read is on the ledger.' : 'I read what you write before you send it, and mark what I’d otherwise ask you later. Open a mark to answer it.',
        scene: true, bodyHTML: '<div class="hx-fr__try">' + menu + '<div class="hx-fr__trycomp">' + comp + note + '</div></div>',
        actions: ask0 ? [{ label: 'Keep it on', primary: true, value: 'keep' }, { label: 'Turn it off', value: 'off' }] : [{ label: 'Skip the example', value: 'skip-try' }], skip: skip()
      });
      placeReading();
    };
    /* the window changes size: the reading follows its mark */
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (screen.k === 'try') placeReading(); }).observe(root);
    /* the reading's menu sits above its mark: its start 8 left of the mark, its foot 8 over the mark's top (ob3-screens.js `place`) */
    const placeReading = (): void => {
      const menu = root.querySelector<HTMLElement>('[data-fr-reading]'), m = root.querySelector<HTMLElement>('[data-fr-try] [data-mark="open"]'), box = root.querySelector<HTMLElement>('.hx-fr__try');
      if (!menu || !m || !box) return;
      const r = m.getBoundingClientRect(), b = box.getBoundingClientRect();
      menu.style.left = String(Math.max(0, Math.min(r.left - b.left - 8, b.width - menu.offsetWidth))) + 'px';
      menu.style.bottom = String(b.bottom - r.top + 8) + 'px';
    };

    /* ───────── running the host's steps ───────── */
    const ask = async (answer: Answer): Promise<void> => {
      let next: SetupStatus;
      try { next = await bridge.advance(answer, false); } catch (e) { const err = asHostError(e); log.warn('setup step failed', err.code); throw new Error(err.message); }
      status = next;
      window.setTimeout(() => { screen = { k: 'status', error: '' }; drawStatus(''); }, reduced() ? 0 : 200);
    };
    const run = async (answer: Answer | null, reconsider: boolean): Promise<void> => {
      if (busy) return;
      busy = true;
      root.setAttribute('aria-busy', 'true');
      let stop: () => void = () => undefined;
      try {
        if (screen.k === 'hello' || screen.k === 'working') { screen = { k: 'working', progress: null }; draw(); }
        stop = await bridge.onProgress((p) => { if (screen.k === 'working') { screen = { k: 'working', progress: p }; page(helloPage(p)); } }).catch(() => () => undefined);
        status = await bridge.advance(answer, reconsider);
        busy = false;
        screen = { k: 'status', error: '' };
        drawStatus('');
      } catch (e) {
        const err = asHostError(e);
        log.warn('setup step failed', err.code);
        busy = false;
        screen = { k: 'status', error: err.message };
        drawStatus(err.message);
      } finally {
        stop();
        busy = false;
        root.removeAttribute('aria-busy');
      }
    };
    /* the host is through: Try it where it exists (not on Change models, not when skipped), then the app */
    const finish = (): void => {
      if (!opts.autostart && !skipping && has('drafts')) { screen = { k: 'try', phase: 'open' }; draw(); return; }
      leave();
    };

    /* ───────── what the person does ───────── */
    root.addEventListener('click', (e) => {
      const t = e.target as Element;
      const orow = t.closest<HTMLElement>('[data-fr-models] [data-kit~="OptionRow"]');
      if (orow && screen.k === 'model') { screen = { ...screen, chosen: orow.dataset['value'] ?? null, error: '' }; draw(); return; }
      if (t.closest('[data-kit~="Notice"] [data-value="online"]')) { void readProviders(true); return; }
      const b = t.closest<HTMLElement>('[data-setup]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      const v = b.dataset['setup'];
      if (v === 'start') { void run(null, false); return; }
      if (v === 'skip') {
        skipping = true;
        if (screen.k === 'hello') { void run(null, false); return; }
        if (screen.k === 'model') { void answerLadder(offered().includes('later') ? 'later' : 'free').catch((err: unknown) => { if (screen.k === 'model') { screen = { ...screen, error: String(err instanceof Error ? err.message : err) }; draw(); } }); return; }
        if (screen.k === 'try' || status?.done) { leave(); return; }
        return;
      }
      if (v === 'apply' || v === 'decline') {
        busy = true; drawStatus('');
        void ask({ form_id: 'setup.config', cancelled: v === 'decline', values: {}, secrets: {} }).catch((err: unknown) => { busy = false; drawStatus(err instanceof Error ? err.message : String(err)); }).then(() => { busy = false; });
        return;
      }
      if (v === 'retry') { void run(null, false); return; }
      if (v === 'reconsider') { void run(null, true); return; }
      if (v === 'finish') { leave(); return; }
      if (screen.k === 'model') {
        const sc = screen;
        if (v === 'more') { screen = { ...sc, mode: 'all', chosen: sc.chosen }; draw(); return; }
        if (v === 'back') { screen = { ...sc, mode: foundRows(states).length ? 'found' : 'offer', chosen: null }; void readProviders(false); return; }
        if (v === 'free') { screen = { ...sc, busy: true }; draw(); void answerLadder('free').catch((err: unknown) => { screen = { ...sc, busy: false, error: err instanceof Error ? err.message : String(err) }; draw(); }); return; }
        if (v === 'use') { const r = rowsFor(sc.mode).find((x) => x.way === sc.chosen); if (r) void useRow(r); return; }
      }
      if (screen.k === 'signin') {
        if (v === 'reopen') { startSignin(screen.way); return; }
        if (v === 'recheck') { const w = screen.way; stopSignin(); screen = { k: 'model', mode: 'found', chosen: w, error: '', busy: false }; void readProviders(false); return; }
        if (v === 'cancel') { const w = screen.way; stopSignin(); if (w === 'openai.signin') void deps().chatgpt.cancel().catch(() => undefined); else if (providers && catalogueWay(w)?.way.signin?.flow !== 'cli') void providers.signinCancel(w).catch(() => undefined); screen = { k: 'model', mode: foundRows(states).length ? 'found' : 'offer', chosen: null, error: '', busy: false }; void readProviders(false); return; }
      }
      if (screen.k === 'try') {
        if (v === 'skip-try' || v === 'off' || v === 'keep') { leave(); return; }
      }
    });
    /* the reading's menu: a pick answers the mark, and the question of keeping it on follows */
    root.addEventListener('click', (e) => {
      const r = (e.target as Element).closest('[data-fr-reading] [data-kit~="MenuRow"]');
      if (r && screen.k === 'try') { screen = { k: 'try', phase: 'ask' }; draw(); }
    });
    root.addEventListener('input', (e) => {
      const i = e.target as HTMLInputElement;
      if (i.id !== 'hx-fr-key' && !i.closest('#hx-fr-key')) return;
      const had = !!typedKey;
      typedKey = i.value;
      if (had !== !!typedKey) { const btn = root.querySelector<HTMLButtonElement>('[data-setup="use"]'); if (btn) btn.disabled = !typedKey; }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const rows = [...root.querySelectorAll<HTMLElement>('[data-fr-models] [data-kit~="OptionRow"]')];
      const i = rows.indexOf(document.activeElement as HTMLElement);
      if (i < 0 || screen.k !== 'model') return;
      e.preventDefault();
      const next = rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length];
      screen = { ...screen, chosen: next?.dataset['value'] ?? null }; draw();
      root.querySelector<HTMLElement>('[data-fr-models] [aria-checked="true"]')?.focus();
    });
    window.addEventListener('online', () => { if (screen.k === 'model' && root.isConnected) void readProviders(true); });
    window.addEventListener('offline', () => { if (screen.k === 'model' && root.isConnected) draw(); });

    if (opts.autostart) void run(null, false); else draw();
  });
}
