/* The ChatGPT sign-in card (ADR-0030, on OpenAI's Sign in with ChatGPT program): boopis's own sign-in with a ChatGPT account.
   The host opens OpenAI's page in the browser and waits for it to come back; the card (`signin-card.ts`, shared with every
   host-run sign-in) shows the page as a button for when the browser did not open, says it is waiting, and offers Cancel. This
   file is ChatGPT's words and its bridge over the `chatgpt_*` commands. The tokens stay in the host and its keychain: nothing
   here ever holds one. Used by first-run setup and by Settings > Models. */
import { commands, events } from './bindings';
import type { ChatgptCode, ChatgptSignedOut, ChatgptSigninEvent, ChatgptStatus_Serialize } from './bindings';
import { asHostError } from './bridge';
import { mountSigninCard, pageOf, pageText } from './signin-card';
import type { SigninBridge, SigninCopy, SigninOptions } from './signin-card';

export type ChatgptStatus = ChatgptStatus_Serialize;
export type { ChatgptCode, ChatgptSigninEvent };
export { pageText };
export type { SigninOptions };

export interface ChatgptBridge {
  status(): Promise<ChatgptStatus>;
  /** open the sign-in page; the wait runs in the host and ends with an event */
  start(): Promise<ChatgptCode>;
  cancel(): Promise<void>;
  /** sign out; says whether OpenAI confirmed ending the session */
  signOut(): Promise<ChatgptSignedOut>;
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
    signOut: () => call(commands.chatgptSignOut()),
    onEnd: (cb) => events.chatgptSigninEvent.listen((e) => { cb(e.payload); }),
    open: async (url) => { await call(commands.openExternal(url)); },
    copy: (text) => navigator.clipboard.writeText(text)
  };
}

/** ChatGPT's words: the page does everything, so there is no code to type */
export const CHATGPT_COPY: SigninCopy = {
  provider: 'chatgpt',
  brand: 'chatgpt',
  button: 'Sign in with ChatGPT',
  starting: 'Opening OpenAI…',
  explain: () => 'boopis opened OpenAI’s sign-in page in your browser. Sign in with your ChatGPT account and allow boopis to use your ChatGPT plan, and the browser sends you back. If the page did not open, use the button.',
  caution: () => 'Only sign in on auth.openai.com, and only if you started this sign-in in boopis. boopis never sees your password.',
  done: 'Signed in with ChatGPT.',
  gave: 'OpenAI’s sign-in did not start.'
};

const asBridge = (b: ChatgptBridge): SigninBridge => ({
  waiting: async () => {
    const s = await b.status();
    return s.state === 'signing_in' && s.code ? pageOf(s.code) : null;
  },
  start: async () => pageOf(await b.start()),
  cancel: () => b.cancel(),
  onEnd: (cb) => b.onEnd(cb),
  open: (url) => b.open(url),
  copy: (text) => b.copy(text)
});

/** Put the ChatGPT sign-in card into `host` (see `mountSigninCard`). */
export function mountChatgptSignin(host: HTMLElement, bridge: ChatgptBridge, opts: SigninOptions = {}): { destroy: () => void } {
  return mountSigninCard(host, asBridge(bridge), CHATGPT_COPY, opts);
}
