/* The SuperGrok sign-in card (ADR-0039): boopis's own sign-in with an X or xAI account, in the shape of the ChatGPT card
   (ADR-0030). The host asks xAI for a one-time code and waits; this card shows xAI's page as a button that opens the system
   browser (the code is already in the page's address) and the code in large mono with a copy button, says that it is waiting, and
   offers Cancel. How it ended comes from the host as an event. The tokens stay in the host and its keychain: nothing here ever
   holds one. Used by first-run setup and by Settings > Models.

   It is built from the same kit pieces and the same markup as `chatgpt-signin.ts`, with the words of a lab in `Words`, so that the
   two join into one card with a lab's words as its only argument (the host side is already one: `provider_signin_*` takes the
   way). `mountSigninCard` is that card; `mountXaiSignin` is xAI's words and its bridge. */
import { ui } from '@boopis/ui';
import { commands, events } from './bindings';
import type { ProviderSigninEvent, ProviderState, SigninCode } from './bindings';
import { asHostError } from './bridge';
import { pageText } from './chatgpt-signin';

export type { ProviderSigninEvent, SigninCode };

/** the catalogue's way for this sign-in (`apps/shared/data/providers.json`) */
export const XAI_WAY = 'xai.signin';

export interface SigninBridge {
  /** where the way's sign-in stands, for a card drawn again while a code waits (null when the host cannot say yet) */
  waiting(): Promise<SigninCode | null>;
  /** ask the lab for a code; the wait runs in the host and ends with an event */
  start(): Promise<SigninCode>;
  cancel(): Promise<void>;
  /** sign out: the tokens leave the keychain; resolves to the state afterwards */
  signOut(): Promise<ProviderState>;
  /** be told how a sign-in of this way ended; resolves to a function that stops listening */
  onEnd(cb: (e: ProviderSigninEvent) => void): Promise<() => void>;
  /** open a page in the system browser */
  open(url: string): Promise<void>;
  /** put text on the clipboard */
  copy(text: string): Promise<void>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

/** the host's commands for one way */
export function tauriSigninBridge(way: string): SigninBridge {
  return {
    waiting: async () => {
      const all = await call(commands.providerList(null));
      const s = all.find((x) => x.way === way);
      return s?.status === 'signing_in' ? (s.signin ?? null) : null;
    },
    start: () => call(commands.providerSigninStart(way, null)),
    cancel: async () => { await call(commands.providerSigninCancel(way)); },
    signOut: () => call(commands.providerSignOut(way, null)),
    onEnd: (cb) => events.providerSigninEvent.listen((e) => { if (e.payload.way === way) cb(e.payload); }),
    open: async (url) => { await call(commands.openExternal(url)); },
    copy: (text) => navigator.clipboard.writeText(text)
  };
}

export const tauriXaiBridge = (): SigninBridge => tauriSigninBridge(XAI_WAY);

/** What a lab's card says. Every sentence names the lab's own page and never a secret. */
export interface Words {
  /** the first button */
  start: string;
  /** the line above the page button */
  open: string;
  /** the line under the code, given how many minutes the code works (null when the host did not say) and the page's host */
  warning: (minutes: number | null, host: string) => string;
  /** when the sign-in finished */
  done: string;
  /** when the host gave no code and said nothing more */
  noCode: string;
}

export const XAI_WORDS: Words = {
  start: 'Sign in with SuperGrok',
  open: 'Open xAI’s sign-in page, sign in with your X or xAI account and approve it. The page already has the code; if it asks, type this one.',
  warning: (minutes, host) => (minutes ? `The code works for ${minutes} minutes. ` : '') + `Approve it only on ${host}, and only if you started this sign-in in boopis.`,
  done: 'Signed in with SuperGrok.',
  noCode: 'xAI gave no code.'
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}
function button(text: string, variant: 'primary' | 'ghost' | '', onClick: () => void, attrs: Partial<Record<string, string>> = {}): HTMLButtonElement {
  const b = ui.button({ label: text, type: 'button', ...(variant ? { variant } : {}), attrs });
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

export interface SigninOptions {
  /** the first button's words */
  label?: string;
  /** called once the account is signed in */
  onSignedIn?: () => void;
  /** the clock, for the minutes a code has left (tests) */
  now?: () => number;
}

/** Put the sign-in card into `host`. It starts at its button, or at the code when a sign-in already waits in the host (a
    redrawn view picks it up again). `destroy` takes the card away and stops listening; the host's wait goes on (Cancel ends
    it, and so does the code's life), so drawing a view again never loses a sign-in the user is finishing. */
export function mountSigninCard(host: HTMLElement, bridge: SigninBridge, words: Words, kind: string, opts: SigninOptions = {}): { destroy: () => void } {
  const now = opts.now ?? Date.now;
  const root = el('div', { class: 'hx-signin', 'data-signin': kind, style: 'display:grid;gap:var(--sp-3);justify-items:start' });
  host.append(root);
  let waiting = false;
  let stop: (() => void) | null = null;
  let gone = false;

  const draw = (...kids: Node[]): void => { root.replaceChildren(...kids); };
  const idle = (note: string, alert: boolean): void => {
    waiting = false;
    const kids: Node[] = [];
    if (note) kids.push(el('p', { role: alert ? 'alert' : 'status', style: 'margin:0;color:' + (alert ? 'var(--red-text)' : 'var(--text-dim)') }, note));
    kids.push(button(note ? 'Try again' : (opts.label ?? words.start), 'primary', () => { void begin(); }, { 'data-act': 'start' }));
    draw(...kids);
  };
  const showCode = (code: SigninCode): void => {
    waiting = true;
    const left = code.expires_at ? Math.round((code.expires_at - now()) / 60000) : null;
    const copied = el('span', { role: 'status', style: 'color:var(--text-quiet);font:var(--fs-2xs)/1.45 var(--sans)' });
    const codeBox = el('output', { 'aria-label': 'One-time code', 'data-code': '', style: 'font:600 var(--fs-xl)/var(--lh-tight) var(--mono);letter-spacing:0.08em;user-select:all' }, code.user_code);
    const page = pageText(code.verification_url);
    draw(
      el('p', { style: 'margin:0' }, words.open),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center' },
        button('Open the sign-in page', 'primary', () => { void bridge.open(code.verification_url); }, { 'data-act': 'open' }),
        el('span', { style: 'color:var(--text-quiet);font:var(--fs-2xs)/1.45 var(--mono)', 'data-page': '' }, page.split('?')[0] ?? page)),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center' }, codeBox,
        button('Copy code', 'ghost', () => {
          bridge.copy(code.user_code).then(() => { copied.textContent = 'Copied'; }, () => { copied.textContent = 'Could not copy: select the code and copy it'; });
        }, { 'data-act': 'copy' }),
        copied),
      el('p', { style: 'margin:0;color:var(--text-quiet)' }, words.warning(left !== null && left > 0 ? left : null, new URL(code.verification_url).hostname)),
      el('p', { role: 'status', style: 'margin:0;color:var(--text-dim)', 'data-waiting': '' }, 'Waiting for you to finish signing in…'),
      button('Cancel', 'ghost', () => { void bridge.cancel(); }, { 'data-act': 'cancel' })
    );
  };
  const ended = (e: ProviderSigninEvent): void => {
    if (gone || !waiting) return;
    if (e.outcome === 'signed_in') {
      waiting = false;
      draw(el('p', { role: 'status', style: 'margin:0', 'data-done': '' }, words.done));
      opts.onSignedIn?.();
      return;
    }
    idle(e.message || 'The sign-in did not finish.', e.outcome !== 'cancelled');
  };
  const begin = async (): Promise<void> => {
    draw(button('Getting a code…', 'primary', () => undefined, { disabled: '', 'data-act': 'start' }));
    try {
      stop ??= await bridge.onEnd(ended).catch(() => null);
      const code = await bridge.start();
      if (!gone) showCode(code);
    } catch (e) {
      idle(e instanceof Error ? e.message : words.noCode, true);
    }
  };
  idle('', false);
  /* a sign-in that already waits in the host (the view was drawn again) shows its code at once */
  void bridge.waiting().then(async (code) => {
    if (gone || !code) return;
    stop ??= await bridge.onEnd(ended).catch(() => null);
    showCode(code);
  }).catch(() => undefined);
  return {
    destroy: () => {
      gone = true;
      stop?.();
      root.remove();
    }
  };
}

/** xAI's card: SuperGrok's words over the host's `provider_signin_*` commands for the way `xai.signin`. */
export const mountXaiSignin = (host: HTMLElement, bridge: SigninBridge, opts: SigninOptions = {}): { destroy: () => void } =>
  mountSigninCard(host, bridge, XAI_WORDS, 'xai', opts);
