/* The ChatGPT sign-in card (ADR-0030): boopis's own sign-in with a ChatGPT account. The host asks OpenAI for a one-time code
   and waits; this card shows OpenAI's page as a button that opens the system browser and the code in large mono with a copy
   button, says that it is waiting, and offers Cancel. How it ended comes from the host as an event. The tokens stay in the
   host and its keychain: nothing here ever holds one. Used by first-run setup and by Settings > Models. */
import { ui } from '@boopis/ui';
import { commands, events } from './bindings';
import type { ChatgptCode, ChatgptSigninEvent, ChatgptStatus_Serialize } from './bindings';
import { asHostError } from './bridge';

export type ChatgptStatus = ChatgptStatus_Serialize;
export type { ChatgptCode, ChatgptSigninEvent };

export interface ChatgptBridge {
  status(): Promise<ChatgptStatus>;
  /** ask OpenAI for a code; the wait runs in the host and ends with an event */
  start(): Promise<ChatgptCode>;
  cancel(): Promise<void>;
  signOut(): Promise<void>;
  /** be told how a sign-in ended; resolves to a function that stops listening */
  onEnd(cb: (e: ChatgptSigninEvent) => void): Promise<() => void>;
  /** open a page in the system browser */
  open(url: string): Promise<void>;
  /** put text on the clipboard */
  copy(text: string): Promise<void>;
}

async function call<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw asHostError(e); }
}

export function tauriChatgptBridge(): ChatgptBridge {
  return {
    status: async () => (await call(commands.chatgptStatus())) as ChatgptStatus,
    start: () => call(commands.chatgptSigninStart()),
    cancel: () => call(commands.chatgptSigninCancel()),
    signOut: async () => { await call(commands.chatgptSignOut()); },
    onEnd: (cb) => events.chatgptSigninEvent.listen((e) => { cb(e.payload); }),
    open: async (url) => { await call(commands.openExternal(url)); },
    copy: (text) => navigator.clipboard.writeText(text)
  };
}

/** the page's address as the card prints it: host and path, no scheme */
export const pageText = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

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
}

/** Put the sign-in card into `host`. It starts at its button, or at the code when a sign-in already waits in the host (a
    redrawn view picks it up again). `destroy` takes the card away and stops listening; the host's wait goes on (Cancel ends
    it, and so does the code's 15 minutes), so drawing a view again never loses a sign-in the user is finishing. */
export function mountChatgptSignin(host: HTMLElement, bridge: ChatgptBridge, opts: SigninOptions = {}): { destroy: () => void } {
  const root = el('div', { class: 'hx-signin', 'data-signin': 'chatgpt', style: 'display:grid;gap:var(--sp-3);justify-items:start' });
  host.append(root);
  let waiting = false;
  let stop: (() => void) | null = null;
  let gone = false;

  const draw = (...kids: Node[]): void => { root.replaceChildren(...kids); };
  const idle = (note: string, alert: boolean): void => {
    waiting = false;
    const kids: Node[] = [];
    if (note) kids.push(el('p', { role: alert ? 'alert' : 'status', style: 'margin:0;color:' + (alert ? 'var(--red-text)' : 'var(--text-dim)') }, note));
    kids.push(button(note ? 'Try again' : (opts.label ?? 'Sign in with ChatGPT'), 'primary', () => { void begin(); }, { 'data-act': 'start' }));
    draw(...kids);
  };
  const showCode = (code: ChatgptCode): void => {
    waiting = true;
    const copied = el('span', { role: 'status', style: 'color:var(--text-quiet);font:var(--fs-2xs)/1.45 var(--sans)' });
    const codeBox = el('output', { 'aria-label': 'One-time code', 'data-code': '', style: 'font:600 var(--fs-xl)/var(--lh-tight) var(--mono);letter-spacing:0.08em;user-select:all' }, code.user_code);
    draw(
      el('p', { style: 'margin:0' }, 'Open OpenAI’s sign-in page, sign in with your ChatGPT account, then type this code.'),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:center' },
        button('Open the sign-in page', 'primary', () => { void bridge.open(code.verification_url); }, { 'data-act': 'open' }),
        el('span', { style: 'color:var(--text-quiet);font:var(--fs-2xs)/1.45 var(--mono)', 'data-page': '' }, pageText(code.verification_url))),
      el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--sp-3);align-items:center' }, codeBox,
        button('Copy code', 'ghost', () => {
          bridge.copy(code.user_code).then(() => { copied.textContent = 'Copied'; }, () => { copied.textContent = 'Could not copy: select the code and copy it'; });
        }, { 'data-act': 'copy' }),
        copied),
      el('p', { style: 'margin:0;color:var(--text-quiet)' }, 'The code works for 15 minutes. Type it only on auth.openai.com, and only if you started this sign-in in boopis.'),
      el('p', { role: 'status', style: 'margin:0;color:var(--text-dim)', 'data-waiting': '' }, 'Waiting for you to finish signing in…'),
      button('Cancel', 'ghost', () => { void bridge.cancel(); }, { 'data-act': 'cancel' })
    );
  };
  const ended = (e: ChatgptSigninEvent): void => {
    if (gone || !waiting) return;
    if (e.outcome === 'signed_in') {
      waiting = false;
      draw(el('p', { role: 'status', style: 'margin:0', 'data-done': '' }, 'Signed in with ChatGPT.'));
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
      idle(e instanceof Error ? e.message : 'OpenAI gave no code.', true);
    }
  };
  idle('', false);
  /* a sign-in that already waits in the host (the view was drawn again) shows its code at once */
  void bridge.status().then(async (s) => {
    if (gone || s.state !== 'signing_in' || !s.code) return;
    stop ??= await bridge.onEnd(ended).catch(() => null);
    showCode(s.code);
  }).catch(() => undefined);
  return {
    destroy: () => {
      gone = true;
      stop?.();
      root.remove();
    }
  };
}
