/* The sign-in card every host-run sign-in shares (ADR-0030, ADR-0039): ChatGPT's, GitHub Copilot's, and the ones that follow.
   The host starts the sign-in and waits for it; this card shows where to go (the lab's own page, as a button that opens the
   system browser), the one-time code when the flow has one (large mono with a Copy button), says it is waiting, and offers
   Cancel. How it ended comes from the host as an event. The tokens stay in the host and its keychain: nothing here ever
   holds one. Built from the kit's button only; the layout is the design system's spacing tokens.

   To use it for another provider, write three things and call `mountSigninCard`:
     1. a `SigninBridge` (`providerSigninBridge(way)` makes one over the host's four generic commands for any way the host
        owns, or hand it your own fake in a test),
     2. a `SigninCopy`: the provider's words, one object (see `copilot-signin.ts` for the shortest),
     3. `opts.onSignedIn`, if something must happen when the account is in.
   A lab whose words are written as { start, open, warning(minutes, host), done, noCode } (the xAI card's) maps onto
   `SigninCopy` in five lines: button = start, explain = () => open, caution = (p, now) => warning(minutesLeft(p.expiresAt, now),
   new URL(p.url).hostname), done = done, gave = noCode (plus `provider` and `starting`).
   The card starts at its button, or at the page and code when a sign-in already waits in the host (a redrawn view picks it
   up again). `destroy` takes the card away and stops listening; the host's wait goes on (Cancel ends it, and so does the
   code's lifetime). A flow with no code to type gives `code: ''`, and the card then shows the page button and the wait only. */
import { kit, signinButton } from '@boopis/ui';
import type { SigninBrand } from '@boopis/ui';
import { commands, events } from './bindings';
import type { ProviderState, SigninCode } from './bindings';
import { asHostError } from './bridge';

/** Where to go, and the code to type there if there is one. */
export interface SigninPage {
  /** the lab's own page, free of any token */
  url: string;
  /** the one-time code; empty when the page does everything */
  code: string;
  /** when the attempt lapses, in ms since the epoch; null when the host does not say */
  expiresAt: number | null;
}

/** How a sign-in ended, as the host says it. */
export interface SigninEnd {
  /** `signed_in`, `failed`, `cancelled`, `timed_out`, or `signed_out` */
  outcome: string;
  /** plain words for the person; empty when signed in */
  message: string;
}

/** What the card needs of the host. Everything the host does stays behind it. */
export interface SigninBridge {
  /** the page and code of a sign-in already waiting in the host, or null */
  waiting(): Promise<SigninPage | null>;
  /** start a sign-in; the wait runs in the host and ends with an event */
  start(): Promise<SigninPage>;
  cancel(): Promise<void>;
  /** be told how a sign-in ended; resolves to a function that stops listening */
  onEnd(cb: (e: SigninEnd) => void): Promise<() => void>;
  /** open a page in the system browser */
  open(url: string): Promise<void>;
  /** put text on the clipboard */
  copy(text: string): Promise<void>;
}

/** One provider's words. */
export interface SigninCopy {
  /** the `data-signin` mark: `chatgpt`, `github-copilot` */
  provider: string;
  /** the lab's branded button (ADR-0040) for the first button; none draws the plain primary button */
  brand?: SigninBrand;
  /** the first button, when no sign-in waits */
  button: string;
  /** the button while the host starts the sign-in */
  starting: string;
  /** what to do, once the page is up; `hasCode` says whether there is a code to type */
  explain: (hasCode: boolean) => string;
  /** the one line of caution under it (where to type, how long it lasts); `now` is the card's clock, for the minutes left */
  caution: (page: SigninPage, now: number) => string;
  /** the line when the account is in */
  done: string;
  /** what to say when the host gave no reason for a failed start */
  gave: string;
}

export interface SigninOptions {
  /** the first button's words, over `copy.button` */
  label?: string;
  /** called once the account is signed in */
  onSignedIn?: () => void;
  /** the clock, for the minutes a code has left (tests) */
  now?: () => number;
}

/** the page's address as the card prints it: host and path, no scheme */
export const pageText = (url: string): string => url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/$/, '');

/** whole minutes left until `expiresAt`, never under one; null when the host did not say */
export const minutesLeft = (expiresAt: number | null, now: number = Date.now()): number | null =>
  expiresAt === null ? null : Math.max(1, Math.ceil((expiresAt - now) / 60000));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}
function button(text: string, variant: 'primary' | 'ghost' | '', onClick: () => void, attrs: Partial<Record<string, string>> = {}): HTMLButtonElement {
  const { disabled, ...rest } = attrs;
  const b = kit.button({ label: text, variant: variant || 'secondary', size: 32, ...(disabled != null ? { disabled: true } : {}), attrs: rest }) as HTMLButtonElement;
  b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
  return b;
}

/** the lab's own sign-in (ADR-0040): the kit's Button led by its mark */
function brandButton(brand: SigninBrand, disabled: boolean): HTMLButtonElement {
  const t = document.createElement('template');
  t.innerHTML = signinButton({ brand, disabled, attrs: { 'data-act': 'start' } });
  return kit.wire(t.content.firstElementChild as HTMLButtonElement);
}

/** Put the sign-in card into `host`. */
export function mountSigninCard(host: HTMLElement, bridge: SigninBridge, copy: SigninCopy, opts: SigninOptions = {}): { destroy: () => void } {
  const root = el('div', { class: 'hx-signin', 'data-signin': copy.provider, style: 'display:grid;gap:var(--sp-3);justify-items:start' });
  host.append(root);
  let waiting = false;
  let stop: (() => void) | null = null;
  let gone = false;

  const draw = (...kids: Node[]): void => { root.replaceChildren(...kids); };
  const idle = (note: string, alert: boolean): void => {
    waiting = false;
    const kids: Node[] = [];
    if (note) kids.push(el('p', { role: alert ? 'alert' : 'status', style: 'margin:0;color:' + (alert ? 'var(--red-text)' : 'var(--text-dim)') }, note));
    if (copy.brand && !note) {
      const b = brandButton(copy.brand, false);
      b.addEventListener('click', (e) => { e.preventDefault(); void begin(); });
      kids.push(b);
    } else kids.push(button(note ? 'Try again' : (opts.label ?? copy.button), 'primary', () => { void begin(); }, { 'data-act': 'start' }));
    draw(...kids);
  };
  const showPage = (page: SigninPage): void => {
    waiting = true;
    const hasCode = page.code !== '';
    const kids: Node[] = [
      el('p', { style: 'margin:0' }, copy.explain(hasCode)),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center' },
        button('Open the sign-in page', 'primary', () => { void bridge.open(page.url); }, { 'data-act': 'open' }),
        el('span', { style: 'color:var(--text-dim);font:var(--fs-2xs)/1.45 var(--mono);overflow-wrap:anywhere;min-width:0', 'data-page': '' }, pageText(page.url)))
    ];
    if (hasCode) {
      const copied = el('span', { role: 'status', style: 'color:var(--text-dim);font:var(--fs-2xs)/1.45 var(--sans)' });
      kids.push(el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center' },
        el('output', { 'aria-label': 'One-time code', 'data-code': '', style: 'font:600 var(--fs-xl)/var(--lh-tight) var(--mono);user-select:all' }, page.code),
        button('Copy code', 'ghost', () => {
          bridge.copy(page.code).then(() => { copied.textContent = 'Copied'; }, () => { copied.textContent = 'Could not copy: select the code and copy it'; });
        }, { 'data-act': 'copy' }),
        copied));
    }
    kids.push(
      el('p', { style: 'margin:0;color:var(--text-dim)' }, copy.caution(page, (opts.now ?? Date.now)())),
      el('p', { role: 'status', style: 'margin:0;color:var(--text-dim)', 'data-waiting': '' }, 'Waiting for you to finish signing in…'),
      button('Cancel', 'ghost', () => { void bridge.cancel(); }, { 'data-act': 'cancel' })
    );
    draw(...kids);
  };
  const ended = (e: SigninEnd): void => {
    if (gone || !waiting) return;
    if (e.outcome === 'signed_in') {
      waiting = false;
      draw(el('p', { role: 'status', style: 'margin:0', 'data-done': '' }, copy.done));
      opts.onSignedIn?.();
      return;
    }
    idle(e.message || 'The sign-in did not finish.', e.outcome !== 'cancelled');
  };
  const begin = async (): Promise<void> => {
    if (copy.brand) draw(brandButton(copy.brand, true));
    else draw(button(copy.starting, 'primary', () => undefined, { disabled: '', 'data-act': 'start' }));
    try {
      stop ??= await bridge.onEnd(ended).catch(() => null);
      const page = await bridge.start();
      if (!gone) showPage(page);
    } catch (e) {
      idle(e instanceof Error ? e.message : copy.gave, true);
    }
  };
  idle('', false);
  /* a sign-in that already waits in the host (the view was drawn again) shows its page at once */
  void bridge.waiting().then(async (page) => {
    if (gone || !page) return;
    stop ??= await bridge.onEnd(ended).catch(() => null);
    showPage(page);
  }).catch(() => undefined);
  return {
    destroy: () => {
      gone = true;
      stop?.();
      root.remove();
    }
  };
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

/** `SigninCode` of the host, as the card has it */
export const pageOf = (c: { verification_url: string; user_code: string; expires_at: number | null }): SigninPage => ({ url: c.verification_url, code: c.user_code, expiresAt: c.expires_at });

/** The card's bridge for any way the host runs a sign-in for, over the generic commands (`provider_signin_*`) and the
    `ProviderSigninEvent` of that way. Also signs out, resolving to the state afterwards (its `detail` says what to tell the person). */
export function providerSigninBridge(way: string): SigninBridge & { signOut(): Promise<ProviderState> } {
  return {
    waiting: async () => {
      const s = await call(commands.providerSigninStatus(way));
      return s.status === 'signing_in' && s.signin ? pageOf(s.signin as SigninCode) : null;
    },
    start: async () => pageOf(await call(commands.providerSigninStart(way, null))),
    cancel: async () => { await call(commands.providerSigninCancel(way)); },
    onEnd: (cb) => events.providerSigninEvent.listen((e) => { if (e.payload.way === way) cb({ outcome: e.payload.outcome, message: e.payload.message }); }),
    open: async (url) => { await call(commands.openExternal(url)); },
    copy: (text) => navigator.clipboard.writeText(text),
    signOut: () => call(commands.providerSignOut(way, null))
  };
}
