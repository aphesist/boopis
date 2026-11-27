/* The GitHub Copilot sign-in card (ADR-0039): boopis's own GitHub device sign-in. The card (`signin-card.ts`) shows GitHub's
   page as a button and the one-time code to type there; the host waits for the approval and keeps the GitHub token in the OS
   keychain. This file is Copilot's words and its bridge over the generic `provider_*` commands. */
import { commands } from './bindings';
import type { ProviderState } from './bindings';
import { asHostError } from './bridge';
import { mountSigninCard, minutesLeft, providerSigninBridge } from './signin-card';
import type { SigninBridge, SigninCopy, SigninOptions } from './signin-card';

/** the catalogue's id of Copilot's sign-in way */
export const COPILOT_WAY = 'github-copilot.signin';

export const COPILOT_COPY: SigninCopy = {
  provider: COPILOT_WAY,
  brand: 'github',
  button: 'Sign in with GitHub',
  starting: 'Getting a code…',
  explain: () => 'Open GitHub’s sign-in page, sign in with the account that has GitHub Copilot, then type this code.',
  caution: (page, now) => {
    const left = minutesLeft(page.expiresAt, now);
    /* the page's own host, as the sign-in gave it: the code is typed there and nowhere else */
    let site = 'GitHub’s own page';
    try { site = new URL(page.url).host || site; } catch { /* no address given: the words stand */ }
    return `The code works for ${left === null ? 'a few' : String(left)} minutes. Type it only on ${site}, and only if you started this sign-in in boopis.`;
  },
  done: 'Signed in with GitHub.',
  gave: 'GitHub gave no code.'
};

export type CopilotBridge = SigninBridge & { signOut(): Promise<ProviderState> };
export const tauriCopilotBridge = (): CopilotBridge => providerSigninBridge(COPILOT_WAY);

/** What Settings needs of Copilot's sign-in: where it stands, and the card's bridge. */
export interface CopilotHandle {
  state(): Promise<ProviderState>;
  bridge: CopilotBridge;
}
export const tauriCopilot = (): CopilotHandle => ({
  state: async () => { try { return await commands.providerSigninStatus(COPILOT_WAY); } catch (e) { throw asHostError(e); } },
  bridge: tauriCopilotBridge()
});

/** Put the Copilot sign-in card into `host`. */
export function mountCopilotSignin(host: HTMLElement, bridge: SigninBridge, opts: SigninOptions = {}): { destroy: () => void } {
  return mountSigninCard(host, bridge, COPILOT_COPY, opts);
}
